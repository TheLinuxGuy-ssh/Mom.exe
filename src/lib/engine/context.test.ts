import { describe, expect, it } from 'vitest';
import { buildContext, buildTodayInfo, basisFor } from './context';
import type { Checkin, Followup, Profile } from '../storage/types';
import { scrubText, ageBand } from './scrub';

const profile: Profile = {
	id: 'u1',
	display_name: 'Rahul Sharma',
	birth_year: 2005,
	height_cm: 170,
	weight_kg: 60,
	class_start: '09:00',
	target_bed: '23:30',
	target_wake: '07:00',
	chronotype: 'night',
	roommates: 'shared_noisy',
	mess: { breakfast: '07:30-09:30', lunch: '12:30-14:30', dinner: '19:30-21:30' },
	diet_pref: 'veg',
	allergies: ['peanut'],
	caffeine: 'high_late',
	timezone: 'Asia/Kolkata',
	created_at: '2026-10-01T00:00:00Z'
};

function checkin(date: string, over: Partial<Checkin> = {}): Checkin {
	return {
		id: date,
		user_id: 'u1',
		local_date: date,
		quick: 'okay',
		sleep_hours: 6,
		slept_at: '01:00',
		woke_at: '07:00',
		meals: { b: false, l: true, s: null, d: true },
		mood: 3,
		notes: null,
		source: 'note',
		created_at: '2026-10-03T08:00:00Z',
		...over
	};
}

describe('buildContext', () => {
	it('never includes name, email or exact birth year in the payload', () => {
		const { payload } = buildContext(
			profile,
			[checkin('2026-10-02'), checkin('2026-10-03', { notes: 'my name is Rahul and rahul@gmail.com slept badly' })],
			[] as Followup[],
			buildTodayInfo(profile, null, 'Asia/Kolkata'),
			new Date('2026-10-03T15:00:00+05:30')
		);
		const raw = JSON.stringify(payload);
		expect(raw).not.toContain('Rahul');
		expect(raw).not.toContain('rahul@gmail.com');
		expect(raw).not.toContain('2004');
		expect(payload.profile_anon.age_band).toBe('18-21');
	});

	it('scrubs free-text notes going into the payload', () => {
		const today = checkin('2026-10-03', { notes: 'call me Priya at priya@x.com, roommate noise' });
		const { payload } = buildContext(
			profile,
			[today],
			[],
			buildTodayInfo(profile, today, 'Asia/Kolkata'),
			new Date('2026-10-03T15:00:00+05:30')
		);
		const raw = JSON.stringify(payload);
		expect(raw).not.toContain('priya@x.com');
		expect(raw).not.toContain('Priya');
	});

	it('marks basis priors with zero history and passes staleness', () => {
		const { payload, basis } = buildContext(
			profile,
			[],
			[],
			buildTodayInfo(profile, null, 'Asia/Kolkata'),
			new Date('2026-10-03T15:00:00+05:30')
		);
		expect(basis).toBe('priors');
		expect(payload.data_quality.basis).toBe('priors');
		expect(payload.data_quality.days_since_last_checkin).toBe(99);
		expect(payload.data_quality.note).toContain('no history yet');
	});

	it('labels recent days as days_ago, never with absolute dates', () => {
		const { payload } = buildContext(
			profile,
			[checkin('2026-10-02')],
			[],
			buildTodayInfo(profile, null, 'Asia/Kolkata'),
			new Date('2026-10-03T15:00:00+05:30')
		);
		expect(payload.recent_days.length).toBe(1);
		expect(payload.recent_days[0].days_ago).toBe(1);
	});
});

describe('basisFor', () => {
	it('priors, partial, full thresholds', () => {
		expect(basisFor(0)).toBe('priors');
		expect(basisFor(3)).toBe('partial');
		expect(basisFor(7)).toBe('full');
	});
});

describe('scrub integration', () => {
	it('extracts sleep facts but not PII from a real note', () => {
		const note = 'I am Sneha, sneha@college.edu, slept at 3am, skipped breakfast, dsa due tomorrow';
		const scrubbed = scrubText(note);
		expect(scrubbed).not.toContain('sneha@college.edu');
		expect(scrubbed).not.toContain('Sneha');
		expect(scrubbed).toContain('slept at 3am');
		expect(ageBand(2005, 2026)).toBe('18-21');
	});
});
