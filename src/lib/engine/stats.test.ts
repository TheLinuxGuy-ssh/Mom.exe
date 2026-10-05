import { describe, expect, it } from 'vitest';
import { computeStats } from './stats';
import type { Checkin, Followup } from '../storage/types';

function mk(date: string, over: Partial<Checkin> = {}): Checkin {
	return {
		id: date,
		user_id: 'u1',
		local_date: date,
		quick: null,
		sleep_hours: null,
		slept_at: null,
		woke_at: null,
		meals: null,
		mood: null,
		notes: null,
		source: 'note',
		created_at: '2026-10-03T10:00:00Z',
		...over
	};
}

const TODAY = '2026-10-10';

describe('computeStats', () => {
	it('treats unknown days as unknown, never zero', () => {
		const s = computeStats([mk('2026-10-09', { sleep_hours: 6 })], [], 'UTC', TODAY);
		expect(s.avg_sleep_hours_7d.n).toBe(1);
		expect(s.avg_sleep_hours_7d.value).toBe(6);
		expect(s.known_days_of_last_14).toBe(1);
	});

	it('counts sleep debt only over known nights', () => {
		const checkins = [
			mk('2026-10-09', { sleep_hours: 5 }),
			mk('2026-10-08', { sleep_hours: 6 })
		];
		const s = computeStats(checkins, [], 'UTC', TODAY);
		expect(s.sleep_debt_hours_7d.value).toBe(4);
		expect(s.sleep_debt_hours_7d.n).toBe(2);
	});

	it('flags nights under 5h in a 14-day window', () => {
		const checkins = [
			mk('2026-10-09', { sleep_hours: 4 }),
			mk('2026-10-07', { sleep_hours: 4.5 }),
			mk('2026-10-05', { sleep_hours: 8 })
		];
		const s = computeStats(checkins, [], 'UTC', TODAY);
		expect(s.nights_under_5h_14d.value).toBe(2);
		expect(s.nights_under_5h_14d.n).toBe(3);
	});

	it('computes bedtime drift', () => {
		const checkins = [
			mk('2026-10-09', { slept_at: '02:00' }),
			mk('2026-10-08', { slept_at: '01:50' }),
			mk('2026-10-07', { slept_at: '01:40' }),
			mk('2026-10-06', { slept_at: '00:30' }),
			mk('2026-10-05', { slept_at: '00:20' })
		];
		const s = computeStats(checkins, [], 'UTC', TODAY);
		expect(s.bedtime_drift_hours.value).toBeGreaterThan(0.5);
	});

	it('finds the top disturbance from notes', () => {
		const checkins = [
			mk('2026-10-09', { notes: 'roommates gaming' }),
			mk('2026-10-08', { notes: 'loud music again' }),
			mk('2026-10-07', { notes: 'scrolled reels all night' })
		];
		const s = computeStats(checkins, [], 'UTC', TODAY);
		expect(s.top_disturbance.value).toBe('roommate_noise');
	});

	it('computes followed rate per action', () => {
		const followups: Followup[] = [
			{ id: 'f1', plan_id: 'p1', user_id: 'u1', action: 'wind_down', block_ref: 'x', followed: 'yes', created_at: '' },
			{ id: 'f2', plan_id: 'p1', user_id: 'u1', action: 'wind_down', block_ref: 'y', followed: 'no', created_at: '' },
			{ id: 'f3', plan_id: 'p1', user_id: 'u1', action: 'eat_meal', block_ref: 'z', followed: 'yes', created_at: '' }
		];
		const s = computeStats([], followups, 'UTC', TODAY);
		expect(s.followed_rate_by_action['wind_down'].value).toBe(0.5);
		expect(s.followed_rate_by_action['eat_meal'].value).toBe(1);
	});

	it('days since last check-in uses the most recent known day', () => {
		const s = computeStats([mk('2026-10-06')], [], 'UTC', TODAY);
		expect(s.days_since_last_checkin).toBe(4);
	});
});

describe('bedtime drift across midnight', () => {
	/**
	 * Bedtimes are a circle, not a line. Averaging 23:50 and 00:30 as plain numbers puts 00:30
	 * "before" 23:50 by 23 hours, so a student drifting half an hour later was reported as
	 * collapsing by a full day, which the model reads as a crisis.
	 */
	function at(dayAgo: number, sleptAt: string, sleepHours = 7): Checkin {
		return {
			id: `c${dayAgo}`,
			user_id: 'u1',
			local_date: `2026-10-${String(10 - dayAgo).padStart(2, '0')}`,
			quick: null,
			sleep_hours: sleepHours,
			slept_at: sleptAt,
			woke_at: null,
			meals: { b: null, l: null, s: null, d: null },
			mood: null,
			notes: null,
			notes_theme: null,
			created_at: '',
			updated_at: ''
		} as unknown as Checkin;
	}

	it('reads a small drift as a small number, not as most of a day', () => {
		const rows = [at(0, '00:30'), at(1, '00:20'), at(2, '23:50'), at(3, '23:40')];
		const s = computeStats(rows, [], 'UTC', '2026-10-10');
		expect(Math.abs(Number(s.bedtime_drift_hours.value ?? 99))).toBeLessThan(1.5);
	});

	it('reports no drift rather than a fabricated one when there is too little to compare', () => {
		const s = computeStats([at(0, '23:30'), at(1, '23:30')], [], 'UTC', '2026-10-10');
		expect(s.bedtime_drift_hours.value).toBeNull();
	});

	it('treats no nights as unknown sleep debt, never zero', () => {
		// the model reads 0.0 as "you are fully rested", which is exactly the guess every prompt
		// in this app forbids
		const s = computeStats([], [], 'UTC', '2026-10-10');
		expect(s.sleep_debt_hours_7d.value).toBeNull();
		expect(s.sleep_debt_hours_7d.n).toBe(0);
	});

	it('still reports real debt when there are nights to report', () => {
		const s = computeStats([at(0, '01:00', 5), at(1, '01:00', 5)], [], 'UTC', '2026-10-10');
		expect(s.sleep_debt_hours_7d.value).toBe(5);
	});
});
