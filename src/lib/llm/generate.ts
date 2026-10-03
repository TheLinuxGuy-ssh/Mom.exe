import type { ContextPayload } from '../engine/context';
import type { Profile } from '../storage/types';
import type { Stats } from '../engine/stats';
import type { TodayInfo } from '../engine/context';
import { PlanOutputSchema, ExtractionSchema, type PlanOutput, type Extraction } from './schema';
import { chat, LLMError, type ChatMessage } from './client';
import { buildPlanMessages, buildExtractMessages, buildRepairMessages } from './prompt';
import { tryParseJson } from './parse';
import { normalizePlan } from './normalize';
import { templatePlan } from './template';
import { getLLMConfig, type LLMConfig } from './config';
import { nowMinutesInTz } from '../engine/time';
import { scrubText } from '../engine/scrub';

export interface PlanResult {
	output: PlanOutput;
	model_id: string;
	usedTemplate: boolean;
	fallbackReason?: string;
}

export function parsePlanText(text: string) {
	const direct = PlanOutputSchema.safeParse(tryParseJson(text));
	if (direct.success) return direct;
	const repaired = PlanOutputSchema.safeParse(normalizePlan(tryParseJson(text)));
	if (repaired.success) return repaired;
	return direct;
}

export async function generatePlan(
	payload: ContextPayload,
	profile: Profile,
	stats: Stats,
	today: TodayInfo,
	authToken?: string
): Promise<PlanResult> {
	const config = getLLMConfig();
	const messages = buildPlanMessages(payload);

	try {
		let text = await chat(config, messages, { temperature: 0.4, authToken });
		let parsed = parsePlanText(text);
		if (!parsed.success) {
			const retryMessages = buildRepairMessages(
				messages,
				text,
				parsed.error.issues[0]?.message ?? 'invalid json'
			);
			text = await chat(config, retryMessages, { temperature: 0.2, authToken });
			parsed = parsePlanText(text);
		}
		if (parsed.success) {
			return { output: parsed.data, model_id: config.model, usedTemplate: false };
		}
		throw new LLMError(
			`the model answered, but not in the shape i asked for (${parsed.error.issues[0]?.message ?? 'schema mismatch'}). i planned in code instead.`
		);
	} catch (e) {
		return {
			output: templatePlan(profile, stats, today, nowMinutesInTz(profile.timezone)),
			model_id: 'template',
			usedTemplate: true,
			fallbackReason: e instanceof Error ? e.message : String(e)
		};
	}
}

export async function extractViaLLM(
	note: string,
	authToken?: string,
	config: LLMConfig = getLLMConfig()
): Promise<Extraction | null> {
	try {
		const messages = buildExtractMessages(scrubText(note));
		const text = await chat(config, messages, { temperature: 0, timeoutMs: 12000, authToken });
		const parsed = ExtractionSchema.safeParse(tryParseJson(text));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}
