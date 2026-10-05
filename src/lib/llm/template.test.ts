import { describe, expect, it } from 'vitest';
import { templatePlan } from './template';
import type { Profile } from '../storage/types';
import type { Stats } from '../engine/stats';
import type { TodayInfo } from '../engine/context';

const profile: Profile = {
	id: 'u1',
	display_name: 'test',
	birth_year: 2004,
	height_cm: null,
	weight_kg: null,
	class_start: '09:00',
	target_bed: '23:30',
	target_wake: '07:00',
	chronotype: 'night',
	roommates: 'shared_noisy',
	mess: { breakfast: '07:30-09:30', lunch: '12:30-14:30', dinner: '19:30-21:30' },
	diet_pref: 'veg',
	allergies: [],
	caffeine: 'high_late',
	timezone: 'UTC',
	created_at: ''
};

function stats(over: Partial<Stats> = {}): Stats {
	return {
		avg_sleep_hours_7d: { value: 5.5, n: 5 },
		sleep_debt_hours_7d: { value: 8, n: 5 },
		bedtime_drift_hours: { value: 1.2, n: 5 },
		nights_under_5h_14d: { value: 3, n: 9 },
		top_disturbance: { value: 'roommate_noise', n: 4 },
		skipped_meal_rate: { value: 0.45, n: 40 },
		worst_weekday: { value: 'wednesday', n: 3 },
		followed_rate_by_action: {},
		known_days_of_last_14: 9,
		days_since_last_checkin: 1,
		...over
	};
}

function today(over: Partial<TodayInfo> = {}): TodayInfo {
	return {
		classes: [],
		deadline_notes: null,
		sleep_so_far_hours: 5,
		meals_so_far: { b: false, l: null, s: null, d: null },
		caffeine_last_at: null,
		...over
	};
}

describe('templatePlan', () => {
	it('always ends with wind_down, screen_off and sleep before bed', () => {
		const out = templatePlan(profile, stats(), today(), 16 * 60);
		const actions = out.blocks.map((b) => b.action);
		expect(actions).toContain('wind_down');
		expect(actions).toContain('screen_off');
		expect(actions[actions.length - 1]).toBe('sleep');
	});

	it('places caffeine cutoff for late caffeine users', () => {
		const out = templatePlan(profile, stats(), today(), 16 * 60);
		expect(out.blocks.some((b) => b.action === 'caffeine_cutoff')).toBe(true);
	});

	it('flags persistent rough sleep and meal skipping', () => {
		const out = templatePlan(profile, stats(), today(), 16 * 60);
		expect(out.flags).toContain('persistent_late_sleep');
		expect(out.flags).toContain('meal_skipping_risk');
	});

	it('suggests professional help when sleep and meals are both bad', () => {
		const out = templatePlan(profile, stats({ skipped_meal_rate: { value: 0.6, n: 40 } }), today(), 16 * 60);
		expect(out.flags).toContain('suggest_professional_help');
	});

	it('does not double-book overlapping blocks', () => {
		const out = templatePlan(profile, stats(), today({ deadline_notes: 'dsa due tomorrow' }), 12 * 60);
		const sorted = out.blocks.map((b) => b.start).sort();
		expect(out.blocks.length).toBeGreaterThan(3);
		for (let i = 1; i < sorted.length; i++) {
			expect(sorted[i] >= sorted[i - 1]).toBe(true);
		}
	});

	it('writes an honest data note', () => {
		const priors = templatePlan(profile, stats({ known_days_of_last_14: 0 }), today(), 16 * 60);
		expect(priors.data_note).toContain('setup');
	});
});

describe('templatePlan late in the day', () => {
	/**
	 * These are the bugs that made the offline planner unusable at night, which is exactly when it
	 * gets used: the moment the model is unreachable. None are visible without planning at a late
	 * hour, so they are pinned here rather than left to be rediscovered during a demo.
	 */
	function planAt(targetBed: string, nowMinutes: number, over: Partial<TodayInfo> = {}) {
		const p: Profile = { ...profile, target_bed: targetBed, target_wake: '07:30' };
		return templatePlan(p, stats(), today(over), nowMinutes);
	}

	function startMinutes(block: { start: string }): number {
		const [h, m] = block.start.split(':').map(Number);
		return h * 60 + m;
	}

	function spans(blocks: { start: string; end: string; action: string }[]): { s: number; e: number; action: string }[] {
		return blocks.map((b) => {
			const s = startMinutes(b);
			const [eh, em] = b.end.split(':').map(Number);
			const raw = eh * 60 + em;
			return { s, e: raw <= s ? raw + 1440 : raw, action: b.action };
		});
	}

	for (const bed of ['23:30', '01:00', '00:30']) {
		for (const [label, now] of [
			['early evening', 16 * 60],
			['before bedtime', 22 * 60],
			['after bedtime', 23 * 60 + 45]
		] as [string, number][]) {
			it(`keeps a sleep block with a ${bed} bedtime, ${label}`, () => {
				// at 23:45 with a 23:30 target the entire wind-down-to-sleep window is behind the
				// student. Clamping each block on its own left nothing before it, so every one was
				// dropped and the plan came back with no sleep in it at all.
				const out = planAt(bed, now);
				const actions = out.blocks.map((b) => b.action);
				expect(actions).toContain('sleep');
				expect(actions[actions.length - 1]).toBe('sleep');
			});
		}
	}

	it('never schedules a block that has already started', () => {
		// A block that starts after midnight reads as an early-morning minute, so compare in
		// "minutes since now" space: a block is in the past only if its whole span precedes now.
		for (const now of [16 * 60, 22 * 60, 23 * 60 + 45]) {
			for (const b of planAt('23:30', now).blocks) {
				const s = startMinutes(b);
				const [eh, em] = b.end.split(':').map(Number);
				let e = eh * 60 + em;
				if (e <= s) e += 1440; // crosses midnight
				// lift an early-morning start to tonight when that is the only reading in the future
				const relStart = s >= now ? s : s + 1440;
				const relEnd = e >= now ? e : e + 1440;
				expect(relEnd, `${b.action} ${b.start}-${b.end} ends before now=${now}`).toBeGreaterThan(now);
				expect(relStart, `${b.action} ${b.start} is entirely before now=${now}`).toBeGreaterThanOrEqual(now);
			}
		}
	});

	it('never schedules two blocks over the same minute, across midnight', () => {
		// the deadline block runs 23:15-00:45 and the wind-down starts after midnight; comparing
		// those as plain clock times made the clash invisible and both survived
		for (const bed of ['01:00', '23:30']) {
			const list = spans(planAt(bed, 23 * 60, { deadline_notes: 'assignment due' }).blocks);
			for (let i = 0; i < list.length; i++) {
				for (let j = i + 1; j < list.length; j++) {
					const a = list[i]!;
					const b = list[j]!;
					expect(a.s < b.e && a.e > b.s, `${a.action} overlaps ${b.action} (bed ${bed})`).toBe(false);
				}
			}
		}
	});

	it('moves the wind-down forward when bedtime has already gone by', () => {
		const out = planAt('23:30', 23 * 60 + 45);
		const wind = out.blocks.find((b) => b.action === 'wind_down');
		expect(wind).toBeDefined();
		expect(startMinutes(wind!)).toBeGreaterThanOrEqual(23 * 60 + 45);
	});
});
