import type { Checkin, Followup } from '../storage/types';
import { daysBetween } from './time';
import { disturbanceTheme } from './extract';

export interface StatValue {
	value: number | string | null;
	n: number;
}

export interface Stats {
	avg_sleep_hours_7d: StatValue;
	sleep_debt_hours_7d: StatValue;
	bedtime_drift_hours: StatValue;
	nights_under_5h_14d: StatValue;
	top_disturbance: StatValue;
	skipped_meal_rate: StatValue;
	worst_weekday: StatValue;
	followed_rate_by_action: Record<string, StatValue>;
	known_days_of_last_14: number;
	days_since_last_checkin: number;
}

const QUICK_SCORE: Record<string, number> = { rough: 0, okay: 1, great: 2 };
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function weekdayOf(dateStr: string): string {
	const d = new Date(dateStr + 'T12:00:00Z');
	return WEEKDAYS[d.getUTCDay()];
}

export function computeStats(
	checkins: Checkin[],
	followups: Followup[],
	tz: string,
	today: string
): Stats {
	const withDays = checkins
		.map((c) => ({ c, daysAgo: daysBetween(c.local_date, today) }))
		.filter((x) => x.daysAgo >= 0 && x.daysAgo <= 14)
		.sort((a, b) => a.daysAgo - b.daysAgo);

	const known7 = withDays.filter((x) => x.daysAgo <= 6);
	const sleeps7 = known7.filter((x) => x.c.sleep_hours != null);

	const avgSleep =
		sleeps7.length > 0
			? {
					value: Math.round((sleeps7.reduce((s, x) => s + (x.c.sleep_hours ?? 0), 0) / sleeps7.length) * 10) / 10,
					n: sleeps7.length
				}
			: { value: null, n: 0 };

	const debt = sleeps7.reduce((s, x) => s + Math.max(0, 7.5 - (x.c.sleep_hours ?? 0)), 0);
	const sleepDebt = { value: Math.round(debt * 10) / 10, n: sleeps7.length };

	const bedtimes = known7
		.filter((x) => x.c.slept_at)
		.map((x) => {
			const [h, m] = (x.c.slept_at as string).split(':').map(Number);
			return h * 60 + m;
		});
	let drift = { value: null as number | null, n: 0 };
	if (bedtimes.length >= 4) {
		const recent = bedtimes.slice(0, Math.min(3, Math.ceil(bedtimes.length / 2)));
		const older = bedtimes.slice(recent.length);
		const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
		const raw = (avg(recent) - avg(older)) / 60;
		drift = { value: Math.round(raw * 10) / 10, n: bedtimes.length };
	}

	const under5 = withDays.filter((x) => x.c.sleep_hours != null && x.c.sleep_hours < 5);
	const nightsUnder5 = { value: under5.length, n: withDays.filter((x) => x.c.sleep_hours != null).length };

	const themes = new Map<string, number>();
	for (const x of withDays) {
		const theme = x.c.notes ? disturbanceTheme(x.c.notes) : null;
		if (theme) themes.set(theme, (themes.get(theme) ?? 0) + 1);
	}
	let top: string | null = null;
	let topN = 0;
	for (const [k, v] of themes) {
		if (v > topN) {
			top = k;
			topN = v;
		}
	}
	const topDisturbance = { value: top, n: topN };

	let eaten = 0;
	let knownSlots = 0;
	for (const x of withDays) {
		const m = x.c.meals;
		if (!m) continue;
		for (const key of ['b', 'l', 's', 'd'] as const) {
			if (m[key] !== null) {
				knownSlots++;
				if (m[key] === true) eaten++;
			}
		}
	}
	const skippedMealRate = knownSlots
		? { value: Math.round((1 - eaten / knownSlots) * 100) / 100, n: knownSlots }
		: { value: null, n: 0 };

	const byWeekday = new Map<string, { sum: number; n: number }>();
	for (const x of withDays) {
		if (!x.c.quick) continue;
		const wd = weekdayOf(x.c.local_date);
		const cur = byWeekday.get(wd) ?? { sum: 0, n: 0 };
		cur.sum += QUICK_SCORE[x.c.quick];
		cur.n++;
		byWeekday.set(wd, cur);
	}
	let worst: string | null = null;
	let worstScore = Infinity;
	let worstN = 0;
	for (const [wd, { sum, n }] of byWeekday) {
		if (n >= 2) {
			const avg = sum / n;
			if (avg < worstScore) {
				worst = wd;
				worstScore = avg;
				worstN = n;
			}
		}
	}
	const worstWeekday = { value: worst, n: worstN };

	const followedByAction = new Map<string, { yes: number; n: number }>();
	for (const f of followups) {
		if (f.followed === 'na') continue;
		const cur = followedByAction.get(f.action) ?? { yes: 0, n: 0 };
		if (f.followed === 'yes') cur.yes++;
		cur.n++;
		followedByAction.set(f.action, cur);
	}
	const followedRate: Record<string, StatValue> = {};
	for (const [action, { yes, n }] of followedByAction) {
		followedRate[action] = { value: Math.round((yes / n) * 100) / 100, n };
	}

	const knownDays = withDays.length;
	const daysSince = withDays.length > 0 ? withDays[0].daysAgo : -1;

	return {
		avg_sleep_hours_7d: avgSleep,
		sleep_debt_hours_7d: sleepDebt,
		bedtime_drift_hours: drift,
		nights_under_5h_14d: nightsUnder5,
		top_disturbance: topDisturbance,
		skipped_meal_rate: skippedMealRate,
		worst_weekday: worstWeekday,
		followed_rate_by_action: followedRate,
		known_days_of_last_14: knownDays,
		days_since_last_checkin: daysSince
	};
}
