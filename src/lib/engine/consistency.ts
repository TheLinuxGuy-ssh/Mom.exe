import type { ContextPayload } from './context';

/**
 * Keeping what she says in agreement with the plan the student is looking at.
 *
 * The conversation and the plan are two different answers, and only one of them is the schedule.
 * When she is talking, the model has the plan in CONTEXT.prior_plan and is told to use it, and
 * mostly does. When it does not, it falls back on the standing targets in the profile: "sleep by
 * 23:30" is her target bedtime on paper, but tonight the plan says study till midnight and sleep
 * at 00:30, and the student can see both at once. That reads as her not knowing what she just
 * planned, which is worse than saying nothing.
 *
 * So the prompt is not trusted with it. Any sentence in a chat reply that puts bedtime, wind down
 * or waking at a time the current plan does not contain is dropped before it is shown. Scoped
 * tightly on purpose: those are the times a student checks against the schedule, and they are the
 * ones the standing targets disagree with. Other times are left alone, because a reply is allowed
 * to suggest a new time as a suggestion.
 */

type PriorPlan = ContextPayload['prior_plan'];

const HHMM = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm)?`;

/** A bedtime claim in her own words: "sleep by 23:30", "bed at 11:30", "wind down at 9". */
const BED_CLAIM = new RegExp(
	String.raw`\b(sleep|sleeping|bed|bedtime|wind down|winding down|wake|waking)\b[^.!?]{0,24}?\b(by|at|around|before)?\s*${HHMM}`,
	'i'
);

/** Actions in the plan that fix when the day winds down. */
const WIND_DOWN_ACTIONS = new Set(['sleep', 'wind_down', 'screen_off']);

function toMinutes(h: string, m: string | undefined, meridiem: string | undefined): number | null {
	let hour = Number(h);
	if (!Number.isFinite(hour) || hour < 0 || hour > 24) return null;
	const minute = m === undefined ? 0 : Number(m);
	if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
	if (meridiem) {
		const lower = meridiem.toLowerCase();
		if (lower === 'pm' && hour < 12) hour += 12;
		if (lower === 'am' && hour === 12) hour = 0;
	}
	return hour * 60 + minute;
}

/** Every minute-of-day the current plan actually commits to. */
export function planTimes(prior: PriorPlan): Set<number> {
	const out = new Set<number>();
	for (const b of prior?.blocks ?? []) {
		for (const raw of [b.start, b.end]) {
			const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
			if (!m) continue;
			out.add(Number(m[1]) * 60 + Number(m[2]));
		}
	}
	return out;
}

/**
 * The time the plan winds down, as minutes. Null when tonight has no sleep or wind-down block, in
 * which case there is nothing to disagree with.
 */
export function planWindDownTime(prior: PriorPlan): number | null {
	for (const b of prior?.blocks ?? []) {
		if (!WIND_DOWN_ACTIONS.has(b.action)) continue;
		const m = /^(\d{1,2}):(\d{2})$/.exec(b.start);
		if (m) return Number(m[1]) * 60 + Number(m[2]);
	}
	return null;
}

/** The offending sentences, so they can be dropped instead of the whole reply. */
function claimsThatContradict(text: string, prior: PriorPlan): string[] {
	const planMinutes = planTimes(prior);
	// a plan that spans midnight commits to both ends of the day, so accept either reading
	const allowed = new Set<number>();
	for (const m of planMinutes) {
		allowed.add(m);
		allowed.add((m + 720) % 1440);
	}
	const bad: string[] = [];
	for (const sentence of text.split(/(?<=[.!?])\s+/)) {
		const match = BED_CLAIM.exec(sentence);
		if (!match) continue;
		// groups: 1 the phrase, 2 the preposition, 3 the hour, 4 the minutes, 5 am/pm
		const minutes = toMinutes(match[3]!, match[4], match[5]);
		if (minutes === null) continue;
		// "sleep by 11" with no minutes is a bare hour; accept it if any plan time lands on it
		if (match[4] === undefined && match[5] === undefined) {
			const hourOnly = Math.floor(minutes / 60);
			const anywhereOnTheHour = [...allowed].some((m) => Math.floor(m / 60) === hourOnly);
			if (anywhereOnTheHour) continue;
		}
		if (!allowed.has(minutes)) bad.push(sentence);
	}
	return bad;
}

/**
 * Returns advice with any sentence that contradicts the current plan removed, or null when that
 * leaves nothing worth showing. Silence beats a wrong time on screen next to the real one.
 */
export function reconcileAdviceWithPlan(advice: string | null, prior: PriorPlan): string | null {
	if (!advice) return null;
	if (planWindDownTime(prior) === null) return advice;

	const bad = claimsThatContradict(advice, prior);
	if (bad.length === 0) return advice;

	const kept = advice
		.split(/(?<=[.!?])\s+/)
		.filter((s) => !bad.includes(s))
		.join(' ')
		.trim();
	return kept.length > 0 ? kept : null;
}

/**
 * True when the reply says something about bedtime that the plan does not agree with.
 *
 * No opinion when tonight has no sleep or wind-down block: there is nothing to check a time
 * against, and a bedtime quoted from her standing targets is perfectly correct on a day with no
 * plan to contradict it.
 */
export function adviceContradictsPlan(advice: string | null, prior: PriorPlan): boolean {
	if (!advice) return false;
	if (planWindDownTime(prior) === null) return false;
	return claimsThatContradict(advice, prior).length > 0;
}