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
import { buildOneShotMessages, buildRepairMessages } from './prompt';
import { tryParseJson } from './parse';
import { normalizePlan } from './normalize';
import { templatePlan } from './template';
import { getLLMConfig } from './config';
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
	// Intent is only inferred when the model did not declare a usable one.
	const intentRes = IntentSchema.safeParse(env['intent']);
	let intent: Intent = 'plan';
	if (intentRes.success) {
		intent = intentRes.data;
		if (intent === 'chat' && advice) plan = null;
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

export async function generateFromNote(args: {
	note: string | null;
	context: ContextPayload;
	profile: Profile;
	stats: Stats;
	today: TodayInfo;
	authToken?: string;
}): Promise<OneShotResult> {
	const config = getLLMConfig();
	const messages = buildOneShotMessages(args.note, args.context);

	let understanding: Extraction | null = null;
	let advice: string | null = null;
	let digest: WeekDigestOut[] = [];

	const wantsPlan = isContentFree(args.note);

	try {
		let text = await chat(config, messages, { temperature: 0.4, authToken: args.authToken });
		let parsed = parseOneShot(text);
		if (wantsPlan && parsed.intent === 'chat') parsed = { ...parsed, intent: 'plan', issue: undefined };
		understanding = parsed.understanding;
		advice = parsed.advice;
		digest = parsed.digest;

		// a chat needs no plan, so only a planning request can be "needing repair"
		const needsRepair = parsed.intent === 'plan' && !parsed.plan;
		if (needsRepair) {
			const retryMessages = buildRepairMessages(messages, text, parsed.issue ?? 'invalid json');
			text = await chat(config, retryMessages, { temperature: 0.2, authToken: args.authToken });
			parsed = parseOneShot(text);
			understanding = parsed.understanding ?? understanding;
			advice = parsed.advice ?? advice;
			// a retry replaces the whole envelope, so prefer the newer digest but keep the
			// old one rather than losing a week of memory to a flaky second response
			digest = parsed.digest.length > 0 ? parsed.digest : digest;
		}

		if (parsed.intent === 'chat' && parsed.advice) {
			return {
				intent: 'chat',
				understanding: parsed.understanding ?? understanding,
				advice: parsed.advice ?? advice,
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
				advice: parsed.advice ?? advice,
				output: parsed.plan,
				handoff: null,
				digest,
				model_id: config.model,
				usedTemplate: false
			};
		}
		throw new LLMError(parsed.issue ?? 'plan invalid after retry');
	} catch (e) {
		// Out of reach. Planning still gets a real answer from the template planner; a chat
		// does not, because inventing a conversation she never had would be worse than silence.
		const isChatOnly = args.note !== null && !understanding && !advice;
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