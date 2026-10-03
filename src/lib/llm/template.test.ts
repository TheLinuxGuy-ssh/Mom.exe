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
