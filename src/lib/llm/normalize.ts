import { ACTIONS, FLAGS, type Action, type Flag } from '../engine/actions';
import { hhmmToMin, minToHHMM } from '../engine/time';

const ALIASES: Record<string, Action> = {
	breakfast: 'eat_meal',
	lunch: 'eat_meal',
	dinner: 'eat_meal',
	brunch: 'eat_meal',
	meal: 'eat_meal',
	food: 'eat_meal',
	eat: 'eat_meal',
	coffee: 'caffeine_cutoff',
	tea: 'caffeine_cutoff',
	caffeine: 'caffeine_cutoff',
	no_caffeine: 'caffeine_cutoff',
	rest: 'nap',
	sleep: 'sleep',
	night_sleep: 'sleep',
	bedtime: 'wind_down',
	relax: 'me_time',
	break: 'me_time',
	downtime: 'me_time',
	sunlight: 'light_exposure',
	walk: 'light_exposure',
	outdoors: 'light_exposure',
	sun: 'light_exposure',
	morning_light: 'light_exposure',
	study: 'study_block',
	homework: 'study_block',
	revision: 'study_block',
	assignment: 'study_block',
	exam: 'study_block',
	phone: 'screen_off',
	screens: 'screen_off',
	social_media: 'screen_off',
	no_screens: 'screen_off',
	water: 'hydration',
	drink: 'hydration',
	gym: 'exercise',
	workout: 'exercise',
	run: 'exercise',
	lecture: 'class',
	classes: 'class',
	college: 'class',
	friends: 'social_time',
	social: 'social_time',
	hangout: 'social_time',
	free_time: 'free',
	buffer: 'free'
};

export function coerceAction(raw: unknown): Action | null {
	if (typeof raw !== 'string') return null;
	const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
	if ((ACTIONS as readonly string[]).includes(key)) return key as Action;
	return ALIASES[key] ?? null;
}

export const FLAG_ALIASES: Record<string, Flag> = {
	professional_help: 'suggest_professional_help',
	suggest_help: 'suggest_professional_help',
	see_counselor: 'suggest_professional_help',
	counselor: 'suggest_professional_help',
	doctor: 'suggest_professional_help',
	therapist: 'suggest_professional_help',
	late_sleep: 'persistent_late_sleep',
	sleep_debt: 'persistent_late_sleep',
	persistent_sleep: 'persistent_late_sleep',
	chronic_sleep: 'persistent_late_sleep',
	meal_skipping: 'meal_skipping_risk',
	skipping_meals: 'meal_skipping_risk',
	meals: 'meal_skipping_risk',
	caffeine: 'high_caffeine_evening',
	late_caffeine: 'high_caffeine_evening',
	caffeine_risk: 'high_caffeine_evening',
	deadline: 'deadline_crunch',
	exam_crush: 'deadline_crunch',
	exam: 'deadline_crunch',
	crunch: 'deadline_crunch',
	deadline_stress: 'deadline_crunch',
	low_mood: 'low_mood_signs',
	depression_risk: 'low_mood_signs',
	sad: 'low_mood_signs',
	mood: 'low_mood_signs'
};

export function coerceFlag(raw: unknown): Flag | null {
	if (typeof raw !== 'string') return null;
	const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
	if ((FLAGS as readonly string[]).includes(key)) return key as Flag;
	return FLAG_ALIASES[key] ?? null;
}

export function coerceHHMM(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const m = raw.trim().match(/^(\d{1,2})[:.h]?(\d{2})?$/);
	if (!m) return null;
	const h = Number(m[1]);
	const min = m[2] ? Number(m[2]) : 0;
	if (h > 23 || min > 59) return null;
	return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function coerceText(raw: unknown, max: number): string {
	if (typeof raw !== 'string') return '';
	return raw.replace(/\s+/g, ' ').trim().slice(0, max);
}

export interface LooseBlock {
	start?: unknown;
	end?: unknown;
	action?: unknown;
	detail?: unknown;
	why?: unknown;
}

export interface LoosePlan {
	summary?: unknown;
	data_note?: unknown;
	blocks?: unknown;
	flags?: unknown;
}

export interface CleanBlock {
	start: string;
	end: string;
	action: Action;
	detail: string;
	why: string;
}

export interface CleanPlan {
	summary: string;
	data_note?: string;
	blocks: CleanBlock[];
	flags: string[];
}

/**
 * Coerces near-miss model output into the fixed contract: alias-maps actions,
 * repairs times, drops unusable blocks, removes overlaps, sorts by start time.
 */
export function normalizePlan(raw: unknown): CleanPlan | null {
	if (!raw || typeof raw !== 'object') return null;
	const plan = raw as LoosePlan;

	const summary = coerceText(plan.summary, 400);
	if (!summary) return null;

	const flags: Flag[] = [];
	if (Array.isArray(plan.flags)) {
		for (const f of plan.flags) {
			const flag = coerceFlag(f);
			if (flag && !flags.includes(flag)) flags.push(flag);
		}
	}

	const rawBlocks = Array.isArray(plan.blocks) ? (plan.blocks as LooseBlock[]) : [];
	const cleaned: CleanBlock[] = [];

	for (const b of rawBlocks) {
		const action = coerceAction(b.action);
		const start = coerceHHMM(b.start);
		const end = coerceHHMM(b.end);
		if (!action || !start || !end) continue;
		if (start === end) continue;
		const detail = coerceText(b.detail, 160);
		if (!detail) continue;
		cleaned.push({ start, end, action, detail, why: coerceText(b.why, 160) });
		if (cleaned.length >= 12) break;
	}

	const kept = removeOverlaps(sortByStart(cleaned));
	if (kept.length === 0) return null;

	const dataNote = coerceText(plan.data_note, 200);
	return {
		summary,
		...(dataNote ? { data_note: dataNote } : {}),
		blocks: kept,
		flags
	};
}

function startOf(b: CleanBlock): number {
	return hhmmToMin(b.start);
}

function endOf(b: CleanBlock): number {
	const s = hhmmToMin(b.start);
	const e = hhmmToMin(b.end);
	return e <= s ? e + 1440 : e;
}

function sortByStart(blocks: CleanBlock[]): CleanBlock[] {
	return [...blocks].sort((a, b) => startOf(a) - startOf(b));
}

function removeOverlaps(sorted: CleanBlock[]): CleanBlock[] {
	const out: CleanBlock[] = [];
	for (const b of sorted) {
		const s = startOf(b);
		const e = endOf(b);
		const clash = out.some((o) => {
			const os = startOf(o);
			const oe = endOf(o);
			return s < oe && e > os;
		});
		if (!clash) out.push(b);
	}
	return out;
}

export function planEndsWithinDay(blocks: CleanBlock[], maxMinutesAfterStart = 60): boolean {
	if (blocks.length === 0) return false;
	const first = startOf(blocks[0]);
	return endOf(blocks[blocks.length - 1]) - first <= 1440 - maxMinutesAfterStart + 1440;
}

export function shiftPlanForward(blocks: CleanBlock[], fromMinute: number): CleanBlock[] {
	return blocks.map((b) => ({
		...b,
		start: minToHHMM(Math.max(startOf(b), fromMinute))
	}));
}