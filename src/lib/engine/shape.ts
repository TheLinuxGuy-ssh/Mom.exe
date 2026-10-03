import type { PlanBlock } from '../storage/types';
import type { Action } from './actions';

/**
 * How a day divides up. Four buckets is the most a person can hold in their head at a glance,
 * and every action in the vocabulary has to land in exactly one of them so the bar always
 * adds up to the whole day rather than leaving an unlabelled remainder.
 */
export const CATEGORIES = ['work', 'body', 'people', 'rest'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
	work: 'work',
	body: 'body',
	people: 'people',
	rest: 'rest'
};

const ACTION_CATEGORY: Record<Action, Category> = {
	study_block: 'work',
	class: 'work',
	eat_meal: 'body',
	snack: 'body',
	hydration: 'body',
	exercise: 'body',
	light_exposure: 'body',
	caffeine_cutoff: 'body',
	social_time: 'people',
	me_time: 'people',
	sleep: 'rest',
	nap: 'rest',
	wind_down: 'rest',
	screen_off: 'rest',
	free: 'rest'
};

export function categoryOf(action: string): Category {
	return ACTION_CATEGORY[action as Action] ?? 'rest';
}

export interface CategorySlice {
	category: Category;
	minutes: number;
	share: number;
}

export interface DayShape {
	slices: CategorySlice[];
	totalMinutes: number;
	/** True when there is nothing to draw yet, so the widget can stay quiet. */
	empty: boolean;
}

export function minutesOf(block: PlanBlock): number {
	const [sh, sm] = block.start.split(':').map(Number);
	const [eh, em] = block.end.split(':').map(Number);
	let mins = eh * 60 + em - (sh * 60 + sm);
	// a block that ends at or before it started runs past midnight
	if (mins <= 0) mins += 1440;
	return mins;
}

/**
 * Minutes per category across the whole plan. This is the shape of the day she proposed, which
 * is knowable exactly from the blocks. It deliberately does not claim to be what the student
 * actually did: only blocks they tapped are known, and quietly treating untapped blocks as
 * "not done" would contradict the rule that missing data is unknown, never zero.
 */
export function dayShape(blocks: PlanBlock[]): DayShape {
	const totals: Record<Category, number> = { work: 0, body: 0, people: 0, rest: 0 };
	for (const b of blocks) totals[categoryOf(b.action)] += minutesOf(b);

	const totalMinutes = CATEGORIES.reduce((s, c) => s + totals[c], 0);
	if (totalMinutes === 0) return { slices: [], totalMinutes: 0, empty: true };

	const slices = CATEGORIES.map((c) => ({
		category: c,
		minutes: totals[c],
		share: totals[c] / totalMinutes
	})).filter((s) => s.minutes > 0);

	return { slices, totalMinutes, empty: false };
}

export function formatDuration(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = Math.round(minutes % 60);
	if (h === 0) return `${m}m`;
	if (m === 0) return `${h}h`;
	return `${h}h ${m}m`;
}
