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
	// models write midnight as 24:00 and it means 00:00. rejecting it dropped the block on the
	// floor, which for a 20:49 study block meant losing the study and the wind-down with it
	if (h === 24 && min === 0) return '00:00';
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

	// A day runs from its earliest block, and anything starting before that belongs after midnight
	// at the end of it: the only reading that keeps a 20:49-00:00 study and a 00:30 sleep in one
	// plan instead of deleting one of them.
	//
	// The first hour is excluded from that choice on purpose. 00:00 and 00:30 are the far side of
	// midnight, not the start of a day, so letting them set the anchor would drag the whole
	// evening after them and scramble the order. If every block sits in that hour there is nothing
	// else to anchor on, so it falls back to the earliest.
	const afterFirstHour = cleaned.filter((b) => startOf(b) >= 60);
	const anchorPool = afterFirstHour.length > 0 ? afterFirstHour : cleaned;
	const anchorStart = anchorPool.reduce((min, b) => Math.min(min, startOf(b)), 24 * 60);
	const kept = removeOverlaps(sortByStart(cleaned), anchorStart);
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

/**
 * Sorted by clock time, a day that runs past midnight is a lie: 01:00 sorts before 23:00, so a
 * study block sitting inside a 23:00-07:00 sleep block compared as if it were that morning and
 * both survived. Anchoring on the first block's start lifts any earlier-looking block to the end of
 * the day, which is where a plan that started in the evening actually puts it.
 */
function removeOverlaps(sorted: CleanBlock[], anchor: number): CleanBlock[] {
	if (sorted.length === 0) return sorted;
	// `anchor` is the first block of the day as the model wrote it. Any block that looks earlier on
	// the clock than the anchor belongs after midnight at the end of that same day, so lifting it
	// by a day is what makes the comparison honest: a 01:00 study block and a 23:00-07:00 sleep
	// block overlap, and only one of them can stay.
	//
	// Resolution happens in lifted order, not clock order. Sorted by raw start, the 01:00 study
	// comes first, and letting it win would then delete the sleep block that contained it. Real
	// time order keeps sleep (which starts at 23:00) and discards the study hour inside it.
	const span = (b: CleanBlock): { s: number; e: number } => {
		const raw = startOf(b);
		const s = raw < anchor ? raw + 1440 : raw;
		return { s, e: s + (endOf(b) - raw) };
	};
	const out: { b: CleanBlock; s: number; e: number }[] = [];
	for (const b of [...sorted].sort((x, y) => span(x).s - span(y).s)) {
		const { s, e } = span(b);
		const clash = out.some((o) => s < o.e && e > o.s);
		if (!clash) out.push({ b, s, e });
	}
	return out.map((o) => o.b);
}
