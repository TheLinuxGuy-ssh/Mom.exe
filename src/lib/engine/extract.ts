import type { Checkin, CheckinInput, Meals, QuickBand } from '../storage/types';
import type { Extraction } from '../llm/schema';

export interface NotePatch {
	quick: QuickBand | null;
	sleep_hours: number | null;
	slept_at: string | null;
	woke_at: string | null;
	meals: Meals | null;
	mood: number | null;
	deadline_notes: string | null;
	disturbances: string[];
}

export const DISTURBANCE_LABEL: Record<string, string> = {
	roommate_noise: 'roommate noise',
	screens: 'late screens',
	caffeine: 'late caffeine',
	exams: 'exams / deadlines',
	other: 'something else'
};

function to24(h: number, m: number | null, ampm: string | null): string {
	let hour = h;
	if (ampm) {
		const isPm = ampm.toLowerCase() === 'pm';
		if (isPm && hour < 12) hour += 12;
		if (!isPm && hour === 12) hour = 0;
	}
	const mm = m ?? 0;
	return `${String(hour % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function computeSleepHours(sleptAt: string, wokeAt: string): number | null {
	const [sh, sm] = sleptAt.split(':').map(Number);
	const [wh, wm] = wokeAt.split(':').map(Number);
	let diff = wh * 60 + wm - (sh * 60 + sm);
	// identical times are unknown, not a full day: nobody sleeps exactly 24 hours and reporting
	// it as 24 would be the single worst number in the whole payload
	if (diff === 0) return null;
	if (diff < 0) diff += 1440;
	if (diff > 1440) return null;
	return Math.round((diff / 60) * 10) / 10;
}

export function disturbanceTheme(note: string | null): string | null {
	if (!note) return null;
	const n = note.toLowerCase();
	if (/roommate|room mate|noise|noisy|loud|gaming|music|dorm/.test(n)) return 'roommate_noise';
	if (/scroll|reel|phone|screen|youtube|netflix|insta|game/.test(n)) return 'screens';
	if (/coffee|tea|caffeine|energy drink|red bull/.test(n)) return 'caffeine';
	if (/exam|assignment|submission|deadline|project|test/.test(n)) return 'exams';
	return null;
}

const EATEN_VERB = /\b(had|ate|eaten|eating|eat|have|having)\b\s+(?:my\s+)?$/;
const NEGATION = /\b(didn'?t|did not|don'?t|do not|never|haven'?t|have not|hasn'?t|hardly|barely)\b/;
const SKIP_WORD = /\b(no|skip(?:ped|ping)?|miss(?:ed|ing)?)\b\s+(?:my\s+)?$/;

function mealState(text: string, word: string): boolean | null {
	const idx = text.indexOf(word);
	if (idx === -1) return null;
	const before = text.slice(Math.max(0, idx - 30), idx);
	if (EATEN_VERB.test(before)) {
		const sep = Math.max(
			before.lastIndexOf(','),
			before.lastIndexOf(';'),
			before.lastIndexOf('.'),
			before.lastIndexOf(' but '),
			before.lastIndexOf(' and ')
		);
		const clause = sep >= 0 ? before.slice(sep) : before;
		return NEGATION.test(clause) ? false : true;
	}
	if (SKIP_WORD.test(before)) return false;
	return null;
}

export function heuristicExtract(text: string): NotePatch {
	const t = ' ' + text.toLowerCase() + ' ';
	const patch: NotePatch = {
		quick: null,
		sleep_hours: null,
		slept_at: null,
		woke_at: null,
		meals: null,
		mood: null,
		deadline_notes: null,
		disturbances: []
	};

	const slept = t.match(/(?:slept|went to bed|bed)(?: down)? at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
	if (slept) {
		patch.slept_at = to24(Number(slept[1]), slept[2] ? Number(slept[2]) : null, slept[3] ?? null);
	}

	// "stayed up at 3" is about sleeping late, not waking. A bare "up at" matched it and invented
	// a wake time, which then became a 24 hour night's sleep further down. So "up at" only counts
	// when it carries a meridiem, and the waking verbs win either way.
	const woke =
		t.match(/\b(?:woke|got|woken|awake)\s+up\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i) ??
		t.match(/\b(?:woke|got|woken|awake)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i) ??
		t.match(/\bup\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
	if (woke) {
		patch.woke_at = to24(Number(woke[1]), woke[2] ? Number(woke[2]) : null, woke[3] ?? null);
	}

	const hrs =
		t.match(/(\d{1,2}(?:\.\d)?)\s*(?:h|hrs?|hours?)\s*(?:of )?sleep/) ??
		t.match(/slept (?:for )?(\d{1,2}(?:\.\d)?)\s*(?:h|hrs?|hours?)?/);
	if (hrs) patch.sleep_hours = Number(hrs[1]);

	if (patch.sleep_hours == null && patch.slept_at && patch.woke_at) {
		patch.sleep_hours = computeSleepHours(patch.slept_at, patch.woke_at);
	}

	const meals: Meals = { b: null, l: null, s: null, d: null };
	for (const [key, word] of [
		['b', 'breakfast'],
		['l', 'lunch'],
		['d', 'dinner']
	] as const) {
		meals[key] = mealState(t, word);
	}
	if (/snack/.test(t)) meals.s = mealState(t, 'snack') ?? true;
	patch.meals = meals;

	const deadline = text.match(/\b(?:due|exam|submission|assignment|quiz|test|project)\b[^.]{0,60}/i);
	if (deadline) patch.deadline_notes = deadline[0].slice(0, 120);

	const notPrefix = /\bnot\s+(?:so\s+|very\s+|that\s+|too\s+)?$/;
	function band(re: RegExp): boolean {
		const m = re.exec(t);
		if (!m) return false;
		const before = t.slice(Math.max(0, m.index - 10), m.index);
		return !notPrefix.test(before);
	}
	if (band(/\b(rough|bad|terrible|awful|horrible)\b/)) patch.quick = 'rough';
	else if (band(/\bokay\b/)) patch.quick = 'okay';
	else if (band(/\b(great|good|fine|solid)\b/)) patch.quick = 'great';

	const theme = disturbanceTheme(text);
	if (theme) patch.disturbances.push(theme);

	return patch;
}

function pick<T>(...vals: (T | null | undefined)[]): T | null {
	for (const v of vals) {
		if (v !== null && v !== undefined) return v;
	}
	return null;
}

/**
 * Merge precedence per field: explicit quick tap > AI understanding > heuristic.
 */
export function mergeUnderstanding(heur: NotePatch, ai: Extraction | null, explicitQuick: string | null): NotePatch {
	const heurMeals = heur.meals ?? { b: null, l: null, s: null, d: null };
	const aiMeals = ai?.meals ?? null;
	const merged: NotePatch = {
		quick: (explicitQuick as QuickBand | null) ?? ai?.quick ?? heur.quick ?? null,
		sleep_hours: pick(ai?.sleep_hours ?? null, heur.sleep_hours),
		slept_at: pick(ai?.slept_at ?? null, heur.slept_at),
		woke_at: pick(ai?.woke_at ?? null, heur.woke_at),
		meals: {
			b: pick(aiMeals?.b ?? null, heurMeals.b),
			l: pick(aiMeals?.l ?? null, heurMeals.l),
			s: pick(aiMeals?.s ?? null, heurMeals.s),
			d: pick(aiMeals?.d ?? null, heurMeals.d)
		},
		mood: pick(ai?.mood ?? null, heur.mood),
		deadline_notes: pick(ai?.deadline_notes ?? null, heur.deadline_notes),
		disturbances: [...new Set([...(ai?.disturbances ?? []), ...heur.disturbances])].slice(0, 4)
	};
	if (merged.sleep_hours == null && merged.slept_at && merged.woke_at) {
		merged.sleep_hours = computeSleepHours(merged.slept_at, merged.woke_at);
	}
	return merged;
}

export function hasAnySignal(patch: NotePatch): boolean {
	return Boolean(
		patch.quick ||
			patch.sleep_hours != null ||
			patch.slept_at ||
			patch.woke_at ||
			patch.mood != null ||
			patch.deadline_notes ||
			patch.disturbances.length > 0 ||
			(patch.meals && (patch.meals.b != null || patch.meals.l != null || patch.meals.s != null || patch.meals.d != null))
	);
}

/**
 * Fold a note into the day's row.
 *
 * `removedKeys` are the chips the student threw away, and they beat the stored row. Every other
 * field merges with the note winning over what is already saved, which is right for "I slept at 2"
 * but useless for removal: a null patch field used to mean "not mentioned", so `patch ?? base`
 * put the very value they had just deleted straight back. Tapping the x on "~5h sleep" did
 * nothing at all, and nothing on screen said so.
 */
export function mergeCheckinRow(
	base: Checkin | null,
	patch: NotePatch,
	note: string,
	localDate: string,
	removedKeys: string[] = []
): CheckinInput {
	const baseMeals = base?.meals ?? { b: null, l: null, s: null, d: null };
	const patchMeals = patch.meals ?? { b: null, l: null, s: null, d: null };
	const notes = [base?.notes, note]
		.filter((n): n is string => Boolean(n))
		.join(' | ')
		.slice(0, 500);
	const row: CheckinInput = {
		local_date: localDate,
		quick: patch.quick ?? base?.quick ?? null,
		sleep_hours: patch.sleep_hours ?? base?.sleep_hours ?? null,
		slept_at: patch.slept_at ?? base?.slept_at ?? null,
		woke_at: patch.woke_at ?? base?.woke_at ?? null,
		meals: {
			b: patchMeals.b ?? baseMeals.b,
			l: patchMeals.l ?? baseMeals.l,
			s: patchMeals.s ?? baseMeals.s,
			d: patchMeals.d ?? baseMeals.d
		},
		mood: patch.mood ?? base?.mood ?? null,
		notes: notes || null,
		source: 'note'
	};
	for (const key of removedKeys) {
		if (key.startsWith('meals.')) {
			const slot = key.split('.')[1] as 'b' | 'l' | 's' | 'd';
			if (row.meals) row.meals[slot] = null;
		} else if (key === 'quick') {
			row.quick = null;
		} else {
			(row as unknown as Record<string, unknown>)[key] = null;
		}
	}
	return row;
}