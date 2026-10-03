import type { Checkin, Meals, QuickBand } from '../storage/types';

export interface NotePatch {
	quick: QuickBand | null;
	sleep_hours: number | null;
	slept_at: string | null;
	woke_at: string | null;
	meals: Meals | null;
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

export function disturbanceTheme(note: string | null): string | null {
	if (!note) return null;
	const n = note.toLowerCase();
	if (/roommate|room mate|noise|noisy|loud|gaming|music|dorm/.test(n)) return 'roommate_noise';
	if (/scroll|reel|phone|screen|youtube|netflix|insta|game/.test(n)) return 'screens';
	if (/coffee|tea|caffeine|energy drink|red bull/.test(n)) return 'caffeine';
	if (/exam|assignment|submission|deadline|project|test/.test(n)) return 'exams';
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
		deadline_notes: null,
		disturbances: []
	};

	const slept = t.match(/(?:slept|went to bed|bed)(?: down)? at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
	if (slept) {
		patch.slept_at = to24(Number(slept[1]), slept[2] ? Number(slept[2]) : null, slept[3] ?? null);
	}

	const woke = t.match(/(?:woke|got up|woken|up) (?:up )?at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
	if (woke) {
		patch.woke_at = to24(Number(woke[1]), woke[2] ? Number(woke[2]) : null, woke[3] ?? null);
	}

	const hrs = t.match(/(\d{1,2}(?:\.\d)?)\s*(?:h|hrs?|hours?)\s*(?:of )?sleep/) ?? t.match(/slept (?:for )?(\d{1,2}(?:\.\d)?)\s*(?:h|hrs?|hours?)?/);
	if (hrs) patch.sleep_hours = Number(hrs[1]);

	if (!patch.sleep_hours && patch.slept_at && patch.woke_at) {
		const [sh, sm] = patch.slept_at.split(':').map(Number);
		const [wh, wm] = patch.woke_at.split(':').map(Number);
		let diff = wh * 60 + wm - (sh * 60 + sm);
		if (diff <= 0) diff += 1440;
		patch.sleep_hours = Math.round((diff / 60) * 10) / 10;
	}

	const meals: Meals = { b: null, l: null, s: null, d: null };
	for (const [key, word] of [
		['b', 'breakfast'],
		['l', 'lunch'],
		['d', 'dinner']
	] as const) {
		if (new RegExp(`(?:skipped|missed|no) (?:my )?${word}`).test(t)) meals[key] = false;
		else if (new RegExp(`(?:had|ate|eaten|eating|eat|had my) ${word}`).test(t)) meals[key] = true;
	}
	if (/snack/.test(t)) meals.s = true;
	patch.meals = meals;

	const deadline = text.match(/\b(?:due|exam|submission|assignment|quiz|test|project)\b[^.]{0,60}/i);
	if (deadline) patch.deadline_notes = deadline[0].slice(0, 120);

	if (/\b(rough|bad|terrible|awful|horrible)\b/.test(t)) patch.quick = 'rough';
	else if (/\bokay\b/.test(t)) patch.quick = 'okay';
	else if (/\b(great|good|fine|solid)\b/.test(t)) patch.quick = 'great';

	const theme = disturbanceTheme(text);
	if (theme) patch.disturbances.push(theme);

	return patch;
}
