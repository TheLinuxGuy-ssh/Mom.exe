import type { ContextPayload, TodayInfo } from '../engine/context';
import type { Stats } from '../engine/stats';
import type { Profile } from '../storage/types';
import {
	PlanOutputSchema,
	ExtractionSchema,
	WeekDigestSchema,
	IntentSchema,
	HandoffSchema,
	type PlanOutput,
	type Extraction,
	type WeekDigestOut,
	type Intent,
	type Handoff
} from './schema';
import { chat, LLMError } from './client';
import { extractJsonText, salvageAdvice } from './parse';
import { polishAdvice } from './dialogue';
import { buildClassifyFirstMessages, buildOneShotMessages, buildRepairMessages, parseClassification } from './prompt';
import { tryParseJson } from './parse';
import { normalizePlan } from './normalize';
import { templatePlan } from './template';
import { intentHint, isHinglishFeeling } from '../engine/mutation';
import { reconcileAdviceWithPlan } from '../engine/consistency';
import { getLLMConfig } from './config';
import type { LLMConfig } from './config';
import { nowMinutesInTz } from '../engine/time';

export interface OneShotParsed {
	intent: Intent;
	understanding: Extraction | null;
	advice: string | null;
	plan: PlanOutput | null;
	handoff: Handoff | null;
	digest: WeekDigestOut[];
	issue?: string;
}

/** Set by the classifier when it has already decided intent, so the main call skips that work. */
export interface OneShotArgs {
	note: string | null;
	context: ContextPayload;
	profile: Profile;
	stats: Stats;
	today: TodayInfo;
	authToken?: string;
	preclassified?: boolean;
}

/**
 * The proxy is not a pass-through: its zod schema caps every request, and anything outside those
 * caps comes back as a flat `400 invalid payload`. This budget is the classifier's only reason
 * to exist, so it stays tiny, but it must clear `max_tokens: z.number().int().min(64)` in the
 * edge function. Sending 40 sat under that floor, every classification was rejected, and the
 * bare catch below swallowed it: routing silently fell back to the model's own intent and the
 * whole thing looked like the model had got worse. Never let this dip below 64.
 */
export const CLASSIFIER_MAX_TOKENS = 64;

export interface OneShotResult {
	intent: Intent;
	understanding: Extraction | null;
	advice: string | null;
	output: PlanOutput | null;
	handoff: Handoff | null;
	digest: WeekDigestOut[];
	model_id: string;
	usedTemplate: boolean;
	fallbackReason?: string;
}

/**
 * Validates the three parts of the one-shot envelope independently, so a bad
 * plan never throws away a good understanding and vice versa.
 */
export function parseOneShot(text: string): OneShotParsed {
	const env = tryParseJson(text) as Record<string, unknown> | null;
	if (!env || typeof env !== 'object' || Array.isArray(env)) {
		return {
			intent: 'plan',
			understanding: null,
			advice: null,
			plan: null,
			handoff: null,
			digest: [],
			issue: 'no json envelope found'
		};
	}

	const understandingRes = ExtractionSchema.safeParse(env['understanding'] ?? null);
	const understanding = understandingRes.success ? understandingRes.data : null;

	const rawAdvice = env['advice'];
	const advice =
		typeof rawAdvice === 'string' && rawAdvice.trim() ? rawAdvice.trim().slice(0, 300) : null;

	const handoffRes = HandoffSchema.safeParse(env['handoff'] ?? null);
	const handoff = handoffRes.success ? handoffRes.data : null;

	const digest: WeekDigestOut[] = [];
	if (Array.isArray(env['digest'])) {
		for (const d of env['digest']) {
			const parsed = WeekDigestSchema.safeParse(d);
			if (parsed.success) digest.push(parsed.data);
		}
	}

	const rawPlan = env['plan'];
	let plan: PlanOutput | null = null;
	let planIssue: string | undefined;
	// a missing or null plan is the correct shape for a chat, so do not treat it as a defect
	const planExpected = rawPlan !== undefined && rawPlan !== null;
	if (planExpected) {
		const direct = PlanOutputSchema.safeParse(rawPlan);
		if (direct.success) {
			plan = direct.data;
		} else {
			planIssue = direct.error.issues[0]?.message;
			const repaired = PlanOutputSchema.safeParse(normalizePlan(rawPlan));
			if (repaired.success) plan = repaired.data;
		}
	}

	// When she explicitly says this was conversation, believe her and drop any schedule she
	// attached out of habit. Overriding this the other way round is what makes a vent turn
	// into a wall of blocks, which is the one thing that makes someone stop talking to her.
	//
	// When she omits intent entirely, infer from the shape of the reply instead of defaulting
	// to "plan". A conversational reply with no blocks is a chat, and treating it as a failed
	// plan burns a repair retry on a response that was already fine.
	const intentRes = IntentSchema.safeParse(env['intent']);
	let intent: Intent;
	if (intentRes.success) {
		intent = intentRes.data;
		if (intent === 'chat' && advice) plan = null;
	} else {
		intent = plan ? 'plan' : advice ? 'chat' : 'plan';
	}

	// a planning request with no plan at all still needs flagging, even though no key was sent
	if (intent === 'plan' && !plan && !planIssue) {
		return {
			intent,
			understanding,
			advice,
			plan: null,
			handoff,
			digest,
			issue: 'planning request returned no plan'
		};
	}

	// chat is only a valid outcome when she actually said something
	if (intent === 'chat' && !advice) {
		return {
			intent: 'plan',
			understanding,
			advice,
			plan: null,
			handoff,
			digest,
			issue: 'chat intent carried no reply'
		};
	}

	return {
		intent,
		understanding,
		advice,
		plan,
		handoff,
		digest,
		issue: plan || !planExpected ? undefined : (planIssue ?? 'plan object invalid')
	};
}

/** Typing nothing meaningful ("idk", "hm", "idk what to do") is a request to be planned, not a
 * conversation. Decided here because the send button promises exactly that, and a model asked
 * to classify a contentless note tends to invent something to react to. */
export function isContentFree(note: string | null): boolean {
	if (note === null) return true;
	const t = note.trim().toLowerCase();
	if (t.length === 0) return true;
	// punctuation and whitespace carry nothing: "..", "??"
	if (/^[\s.!?]+$/.test(t)) return true;

	// pure filler, no information at all: "idk", "hm", "hmm", "idk what to do"
	if (/^(idk|hm+|hmm+|k|nah|nope|whatever|maybe|not sure|who knows)\b[\s.!?]*$/.test(t)) return true;
	// filler that trails into a bare request, but only while it stays short. Anything with real
	// content in it ("idk what to do about tomorrow, lab until 7") is a genuine note.
	if (/^(idk|hm+|hmm+|not sure)\b/.test(t) && t.length <= 24) return true;
	// a greeting or an acknowledgement on its own is small talk, not a scheduling request
	if (/^(hi|hey|hello|yo|sup|ok|okay|k|cool|nice|thanks|thank you|bye)\b[\s.!?]*$/.test(t)) return true;

	return false;
}

/**
 * Everything the student reads goes through here on its way out of the pipeline.
 *
 * The prompt already forbids scorekeeper language and the consistency pass already refuses advice
 * that contradicts the plan; this is the last of the three, and it exists because a ban written in
 * a prompt is a request rather than a rule. Live runs kept producing "i hear you" and "let me know
 * if anything comes up" with both of them named in the prompt as banned, and no amount of
 * rephrasing the instruction had stopped it.
 */
function polishReply(advice: string | null): string | null {
	return polishAdvice(advice);
}

/**
 * Ask the model, and if it hands back an empty message, ask once more with a bigger budget.
 *
 * gpt-oss is a reasoning model: with a long context it will sometimes spend the entire token
 * allowance on reasoning and return no content at all. That is not a wrong answer, it is a short
 * budget, and it was the single most common reason a real student message fell through to the
 * template planner. Doubling the room and dropping the temperature once is enough to fix it.
 */
/**
 * The reply as plain speech, or null if it was an envelope (or nothing usable).
 *
 * Only used to rescue a chat that the JSON contract lost. A reasoning model asked for one object
 * will sometimes just answer, and discarding a good sentence because it arrived without braces is
 * the whole problem this exists to solve.
 */
function proseOnly(text: string): string | null {
	if (extractJsonText(text)) return null;
	const stripped = text
		.replace(/^\s*(?:sure|okay|ok|alright|here(?:'s| is)[^:\n]{0,40}:)\s*/i, '')
		.replace(/```[a-z]*|```/g, '')
		.trim();
	return stripped.length > 0 ? stripped : null;
}

async function ask(
	config: LLMConfig,
	messages: { role: string; content: string }[],
	opts: { temperature?: number; timeoutMs?: number; maxTokens?: number; authToken?: string }
): Promise<string> {
	try {
		return await chat(config, messages, opts);
	} catch (e) {
		if (!(e instanceof LLMError && /no message content/.test(e.message))) throw e;
		const budget = opts.maxTokens ?? config.maxTokens ?? 1200;
		return chat(config, messages, { ...opts, temperature: 0.2, maxTokens: budget * 2 });
	}
}

export async function generateFromNote(args: OneShotArgs, configOverride?: LLMConfig): Promise<OneShotResult> {
	const config = configOverride ?? getLLMConfig();
	// Always the full prompt. `preclassified` means the caller already knows the intent, so it skips
	// the routing call below; it must never decide which prompt the answer is generated from. That
	// conflation once sent the router prompt as the main call, so the model returned a bare
	// {"intent":"chat"} with no advice and no plan, and every note came back empty after a full
	// round trip to the model.
	const messages = buildOneShotMessages(args.note, args.context);

	let understanding: Extraction | null = null;
	let advice: string | null = null;
	let digest: WeekDigestOut[] = [];

	const wantsPlan = isContentFree(args.note);

	/**
	 * An explicit instruction to move, add or drop something outranks both models. Asked for in
	 * code because the one failure that cannot be tolerated is someone saying "could you shift it"
	 * and being answered with small talk: the request is unambiguous, so it is not left to a
	 * judgement call that changes with the weather.
	 */
	const forced = intentHint(args.note);
	if (forced === 'plan') return answer(args, config, messages, forced, null);

	// One short voice-free routing call first. Cheap, and it keeps the big voice prompt from
	// interfering with the single decision it is worst at.
	let routed: 'chat' | 'plan' | null = null;
	if (!wantsPlan && !args.preclassified) {
		try {
			const verdict = await chat(config, buildClassifyFirstMessages(args.note, args.context), {
				temperature: 0,
				maxTokens: CLASSIFIER_MAX_TOKENS,
				timeoutMs: 15000,
				authToken: args.authToken
			});
			routed = parseClassification(verdict);
			// a Hindi note saying how the day felt is not a scheduling request, however the
			// classifier reads romanized Hindi. it keeps the model's own answer rather than being
			// overruled into a timetable.
			if (routed === 'plan' && isHinglishFeeling(args.note)) routed = null;
		} catch (e) {
			// Routing still stands without it: the main call declares its own intent and we use that.
			// But never swallow the reason in silence. A bare catch here is what let a rejected
			// request hide for days while the blame sat with the model.
			routed = null;
			console.warn(
				`[mom-exe] intent classifier unavailable, using the model's own intent instead: ${
					e instanceof LLMError ? e.message : String(e)
				}`
			);
		}
	}

	return answer(args, config, messages, null, routed);
}

/**
 * Runs the model call and settles the intent, shared by the normal path and the forced one. A note
 * recognised in code as a request to change the plan goes through exactly the same answering,
 * repair and fallback machinery as every other plan request: no second, lesser code path for the
 * cases we are already sure about.
 *
 * `override` is 'plan' when the note was recognised deterministically. It outranks whatever the
 * model or the classifier says, the same way an empty note does.
 */
async function answer(
	args: OneShotArgs,
	config: LLMConfig,
	messages: { role: string; content: string }[],
	override: 'plan' | 'chat' | null,
	routed: 'chat' | 'plan' | null
): Promise<OneShotResult> {
	let understanding: Extraction | null = null;
	let advice: string | null = null;
	let digest: WeekDigestOut[] = [];
	const wantsPlan = isContentFree(args.note) || override === 'plan';

	/**
	 * Applies every intent override we hold over whatever the model just declared. Called after
	 * each parse, not once: the repair retry replaces the whole envelope, and taking that second
	 * answer at face value threw away the override, so a note we had already decided was a plan
	 * could still come back as a chat.
	 */
	const settle = (parsed: OneShotParsed): OneShotParsed => {
		let out = parsed;
		// The classifier gets the casting vote: it saw the note with nothing else in the way. This is
		// load-bearing. Relaxing it to "only over silence" was tried and cost ten of thirty-two live
		// turns — she will happily answer a feeling with a schedule, and stopping that is the whole
		// reason the routing call exists.
		if (routed && (routed === 'chat') !== (out.intent === 'chat')) {
			out = { ...out, intent: routed, plan: routed === 'chat' ? null : out.plan, issue: undefined };
		}
		// an empty note still owes us a plan, whatever she said in passing
		if (wantsPlan && out.intent === 'chat') out = { ...out, intent: 'plan', issue: undefined };
		return out;
	};

	/** whatever she last said, envelope or not, so the catch below can salvage the words */
	let lastProse: string | null = null;
	let lastRaw: string | null = null;
	try {
		let text = await ask(config, messages, { temperature: 0.4, authToken: args.authToken });
		lastRaw = text;
		lastProse = proseOnly(text);
		let parsed = settle(parseOneShot(text));
		understanding = parsed.understanding;
		advice = polishReply(reconcileAdviceWithPlan(parsed.advice, args.context.prior_plan));
		digest = parsed.digest;

		/**
		 * A planning request needs a plan; and an envelope we could not read at all needs another go
		 * whatever the routing decided.
		 *
		 * The second clause came from a live run. The model returned JSON with a stray quote in it,
		 * the classifier had already called the turn a conversation, so `intent` was chat, so the
		 * old condition was false, so nothing was retried and a student who had typed three honest
		 * sentences got silence. An unreadable reply is a failed reply, not a chat.
		 */
		const unreadable = parsed.issue === 'no json envelope found';
		const needsRepair = (parsed.intent === 'plan' && !parsed.plan) || unreadable;
		if (needsRepair) {
			// be specific about the debt. "that reply was invalid" leaves the model guessing, and a
			// first greeting answered with small talk then failed the retry exactly like this
			const need = unreadable
				? 'shape'
				: parsed.advice
					? 'plan'
					: wantsPlan || routed === 'plan'
						? 'plan'
						: 'advice';
			const retryMessages = buildRepairMessages(
				messages,
				text,
				parsed.issue ?? 'invalid json',
				need
			);
			text = await ask(config, retryMessages, { temperature: 0.2, authToken: args.authToken });
			lastRaw = text;
			lastProse = proseOnly(text);
			parsed = settle(parseOneShot(text));
			understanding = parsed.understanding ?? understanding;
			advice = polishReply(reconcileAdviceWithPlan(parsed.advice, args.context.prior_plan) ?? advice);
			// a retry replaces the whole envelope, so prefer the newer digest but keep the
			// old one rather than losing a week of memory to a flaky second response
			digest = parsed.digest.length > 0 ? parsed.digest : digest;
		}

		if (parsed.intent === 'chat' && parsed.advice) {
			return {
				intent: 'chat',
				understanding: parsed.understanding ?? understanding,
				advice,
				output: null,
				handoff: parsed.handoff,
				digest,
				model_id: config.model,
				usedTemplate: false
			};
		}

		if (parsed.plan) {
			return {
				intent: 'plan',
				understanding: parsed.understanding ?? understanding,
				advice,
				output: parsed.plan,
				handoff: null,
				digest,
				model_id: config.model,
				usedTemplate: false
			};
		}
		throw new LLMError(parsed.issue ?? 'plan invalid after retry');
	} catch (e) {
		// She answered in prose. That is a real answer, not a failure: "ha. drink some water, then
		// eat something, and get to bed early" is exactly what she would have put in the advice
		// field, and throwing it away to show a template schedule instead meant a student who was
		// told something perfectly good got a generic day plan. Recover it for a chat. A planning
		// request still needs blocks, so it keeps going to the code planner.
		const salvage = salvageAdvice(lastRaw ?? '');
		if (salvage && !wantsPlan) {
			return {
				intent: 'chat',
				understanding: null,
				advice: polishReply(salvage),
				output: null,
				handoff: null,
				digest,
				model_id: config.model,
				usedTemplate: false,
				fallbackReason: 'her envelope was malformed; her reply was recovered from it'
			};
		}

		const prose = lastProse;
		const proseIsUsable = prose && !wantsPlan && prose.length >= 8 && prose.length <= 600;
		if (proseIsUsable) {
			return {
				intent: 'chat',
				understanding,
				advice: polishReply(prose),
				output: null,
				handoff: null,
				digest,
				model_id: config.model,
				usedTemplate: false,
				fallbackReason: 'she wrote prose instead of the envelope; her words were used as the reply'
			};
		}

		// Out of reach. Planning still gets a real answer from the template planner; a chat
		// does not, because inventing a conversation she never had would be worse than silence.
		// Only a note we have no reason to plan for can be answered with silence. An empty note, or
		// one recognised as a request to change the plan, still gets a day written in code rather
		// than an empty conversation: being told "planned in code" beats being told nothing.
		const isChatOnly = args.note !== null && !understanding && !advice && !wantsPlan;
		if (isChatOnly) {
			return {
				intent: 'chat',
				understanding: null,
				advice: null,
				output: null,
				handoff: null,
				digest,
				model_id: 'offline',
				usedTemplate: true,
				fallbackReason: e instanceof Error ? e.message : String(e)
			};
		}
		return {
			intent: 'plan',
			understanding,
			advice,
			output: templatePlan(args.profile, args.stats, args.today, nowMinutesInTz(args.profile.timezone)),
			handoff: null,
			digest,
			model_id: 'template',
			usedTemplate: true,
			fallbackReason: e instanceof Error ? e.message : String(e)
		};
	}
}
