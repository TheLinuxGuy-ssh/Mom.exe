import type { ContextPayload, TodayInfo } from '../engine/context';
import type { Stats } from '../engine/stats';
import type { Profile } from '../storage/types';
import { PlanOutputSchema, ExtractionSchema, type PlanOutput, type Extraction } from './schema';
import { chat, LLMError } from './client';
import { buildOneShotMessages, buildRepairMessages } from './prompt';
import { tryParseJson } from './parse';
import { normalizePlan } from './normalize';
import { templatePlan } from './template';
import { getLLMConfig } from './config';
import { nowMinutesInTz } from '../engine/time';

export interface OneShotParsed {
	understanding: Extraction | null;
	advice: string | null;
	plan: PlanOutput | null;
	issue?: string;
}

export interface OneShotResult {
	understanding: Extraction | null;
	advice: string | null;
	output: PlanOutput;
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
		return { understanding: null, advice: null, plan: null, issue: 'no json envelope found' };
	}

	const understandingRes = ExtractionSchema.safeParse(env['understanding'] ?? null);
	const understanding = understandingRes.success ? understandingRes.data : null;

	const rawAdvice = env['advice'];
	const advice =
		typeof rawAdvice === 'string' && rawAdvice.trim() ? rawAdvice.trim().slice(0, 300) : null;

	const rawPlan = env['plan'];
	const direct = PlanOutputSchema.safeParse(rawPlan);
	if (direct.success) return { understanding, advice, plan: direct.data };
	const repaired = PlanOutputSchema.safeParse(normalizePlan(rawPlan));
	if (repaired.success) return { understanding, advice, plan: repaired.data };

	return {
		understanding,
		advice,
		plan: null,
		issue: direct.error.issues[0]?.message ?? 'plan object invalid'
	};
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

	try {
		let text = await chat(config, messages, { temperature: 0.4, authToken: args.authToken });
		let parsed = parseOneShot(text);
		understanding = parsed.understanding;
		advice = parsed.advice;
		const needsRepair = !parsed.plan || (args.note !== null && !parsed.understanding);
		if (needsRepair) {
			const retryMessages = buildRepairMessages(messages, text, parsed.issue ?? 'invalid json');
			text = await chat(config, retryMessages, { temperature: 0.2, authToken: args.authToken });
			parsed = parseOneShot(text);
			understanding = parsed.understanding ?? understanding;
			advice = parsed.advice ?? advice;
		}
		if (parsed.plan) {
			return {
				understanding: parsed.understanding ?? understanding,
				advice: parsed.advice ?? advice,
				output: parsed.plan,
				model_id: config.model,
				usedTemplate: false
			};
		}
		throw new LLMError(parsed.issue ?? 'plan invalid after retry');
	} catch (e) {
		return {
			understanding,
			advice,
			output: templatePlan(args.profile, args.stats, args.today, nowMinutesInTz(args.profile.timezone)),
			model_id: 'template',
			usedTemplate: true,
			fallbackReason: e instanceof Error ? e.message : String(e)
		};
	}
}