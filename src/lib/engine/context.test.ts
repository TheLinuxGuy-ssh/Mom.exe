import { describe, expect, it } from 'vitest';
import { buildContext, buildTodayInfo, basisFor, buildPriorPlan } from './context';
import type { Checkin, Followup, Plan, Profile } from '../storage/types';
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

describe('buildPriorPlan', () => {
	const tz = 'Asia/Kolkata';

	function plan(blocks: { start: string; end: string; action: string }[]): Plan {
		return {
			id: 'p1',
			user_id: 'u1',
			local_date: '2026-10-03',
			as_of: '2026-10-03T09:00:00.000Z',
			context_snapshot: {},
			output: {
				summary: 's',
				blocks: blocks.map((b) => ({ ...b, detail: 'd', why: '' })),
				flags: []
			},
			basis: 'full',
			model_id: 'm',
			fallback_reason: null,
			supersedes_plan_id: null,
			created_at: '2026-10-03T09:00:00.000Z'
		};
	}

	// 2026-10-03T21:40+05:30 === 16:10Z
	const now = new Date('2026-10-03T21:40:00+05:30');

	it('is null when there is no plan to supersede', () => {
		expect(buildPriorPlan(null, {}, now, tz)).toBeNull();
	});

	it('drops blocks that have not started yet', () => {
		const p = plan([
			{ start: '09:00', end: '10:30', action: 'class' },
			{ start: '22:00', end: '23:00', action: 'wind_down' }
		]);
		const out = buildPriorPlan(p, {}, now, tz)!;
		expect(out.blocks).toHaveLength(1);
		expect(out.blocks[0].action).toBe('class');
	});

	it('maps taps to done and skipped, and elapsed-but-untapped to unknown', () => {
		const p = plan([
			{ start: '09:00', end: '10:30', action: 'class' },
			{ start: '13:00', end: '14:00', action: 'study_block' },
			{ start: '15:00', end: '15:30', action: 'hydration' }
		]);
		const out = buildPriorPlan(
			p,
			{ '09:00-10:30': 'yes', '13:00-14:00': 'no' },
			now,
			tz
		)!;
		expect(out.blocks.map((b) => b.status)).toEqual(['done', 'skipped', 'unknown']);
	});

	it('marks the block the clock is inside as in_progress', () => {
		const p = plan([
			{ start: '09:00', end: '10:30', action: 'class' },
			{ start: '21:00', end: '22:00', action: 'study_block' }
		]);
		const out = buildPriorPlan(p, {}, now, tz)!;
		expect(out.blocks[1].status).toBe('in_progress');
	});

	it('does not treat an overnight block as already over', () => {
		// 01:00-07:00 sleep block, clock at 03:00 -> still in progress, not elapsed
		const p = plan([{ start: '01:00', end: '07:00', action: 'sleep' }]);
		const out = buildPriorPlan(p, {}, new Date('2026-10-04T03:00:00+05:30'), tz)!;
		expect(out.blocks[0].status).toBe('in_progress');
	});

	it('treats an overnight block as done once the morning is past it', () => {
		const p = plan([{ start: '23:30', end: '07:00', action: 'sleep' }]);
		const out = buildPriorPlan(p, { '23:30-07:00': 'yes' }, new Date('2026-10-04T09:00:00+05:30'), tz)!;
		expect(out.blocks[0].status).toBe('done');
	});

	it('is null when nothing has started, so the model is not told about an untouched plan', () => {
		const p = plan([{ start: '22:00', end: '23:00', action: 'wind_down' }]);
		expect(buildPriorPlan(p, {}, now, tz)).toBeNull();
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
