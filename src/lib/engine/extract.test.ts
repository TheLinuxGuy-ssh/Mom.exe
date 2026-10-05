import { describe, expect, it } from 'vitest';
import {
	heuristicExtract,
	mergeUnderstanding,
	mergeCheckinRow,
	computeSleepHours
} from './extract';
import type { NotePatch } from './extract';
import type { Checkin } from '../storage/types';
import { scrubText, ageBand } from './scrub';
import type { Extraction } from '../llm/schema';

describe('negation handling (the keyword bug)', () => {
	it('"i didn\'t eat breakfast" is skipped, not eaten', () => {
		const p = heuristicExtract("i didn't eat breakfast");
		expect(p.meals?.b).toBe(false);
	});

	it('"i did not eat breakfast" is skipped', () => {
		const p = heuristicExtract('i did not eat breakfast');
		expect(p.meals?.b).toBe(false);
	});

	it('"haven\'t had breakfast" is skipped', () => {
		const p = heuristicExtract("haven't had breakfast");
		expect(p.meals?.b).toBe(false);
	});

	it('"no dinner" is skipped', () => {
		const p = heuristicExtract('no dinner, straight to bed');
		expect(p.meals?.d).toBe(false);
	});

	it('"did have lunch" is eaten', () => {
		const p = heuristicExtract('did have lunch at least');
		expect(p.meals?.l).toBe(true);
	});

	it('"had lunch" stays eaten', () => {
		const p = heuristicExtract('had lunch already');
		expect(p.meals?.l).toBe(true);
	});

	it('negation does not leak across a comma into the next clause', () => {
		const p = heuristicExtract("i didn't eat breakfast, had lunch at 1");
		expect(p.meals?.b).toBe(false);
		expect(p.meals?.l).toBe(true);
	});

	it('"not great, just okay" reads okay', () => {
		const p = heuristicExtract('not great, just okay');
		expect(p.quick).toBe('okay');
	});
});

describe('mergeUnderstanding', () => {
	it('AI understanding wins over heuristic keywords', () => {
		const heur = heuristicExtract('didn\'t eat breakfast');
		const ai: Extraction = { meals: { b: true, l: null, s: null, d: null }, disturbances: [] };
		const merged = mergeUnderstanding(heur, ai, null);
		expect(merged.meals?.b).toBe(true);
	});

	it('explicit tap beats both AI and heuristic', () => {
		const heur = heuristicExtract('rough night');
		const ai: Extraction = { quick: 'okay', disturbances: [] };
		const merged = mergeUnderstanding(heur, ai, 'great');
		expect(merged.quick).toBe('great');
	});

	it('heuristic quick survives when AI has none', () => {
		const heur = heuristicExtract('rough night');
		const merged = mergeUnderstanding(heur, null, null);
		expect(merged.quick).toBe('rough');
	});

	it('derives sleep hours from times when AI omitted them', () => {
		const ai: Extraction = { slept_at: '04:00', woke_at: '10:00', disturbances: [] };
		const merged = mergeUnderstanding(heuristicExtract(''), ai, null);
		expect(merged.sleep_hours).toBe(6);
	});
});

describe('computeSleepHours', () => {
	it('handles overnight sleep', () => {
		expect(computeSleepHours('04:00', '10:00')).toBe(6);
		expect(computeSleepHours('23:30', '07:00')).toBe(7.5);
	});
});

describe('heuristicExtract', () => {
	it('extracts slept/woke times and derives hours', () => {
		const p = heuristicExtract('slept at 2, woke at 7:30, skipped breakfast');
		expect(p.slept_at).toBe('02:00');
		expect(p.woke_at).toBe('07:30');
		expect(p.sleep_hours).toBeCloseTo(5.5, 1);
		expect(p.meals?.b).toBe(false);
	});

	it('extracts pm times', () => {
		const p = heuristicExtract('went to bed at 1:30 am after coffee');
		expect(p.slept_at).toBe('01:30');
		expect(p.disturbances).toContain('caffeine');
	});

	it('extracts explicit hours and quick band', () => {
		const p = heuristicExtract('got like 4 hours of sleep, rough one');
		expect(p.sleep_hours).toBe(4);
		expect(p.quick).toBe('rough');
	});

	it('picks up deadlines and meals eaten', () => {
		const p = heuristicExtract('had lunch already, DSA assignment due tomorrow');
		expect(p.meals?.l).toBe(true);
		expect(p.deadline_notes).toBeTruthy();
	});

	it('detects roommate noise', () => {
		const p = heuristicExtract('roommates were gaming till 2');
		expect(p.disturbances).toContain('roommate_noise');
	});
});

describe('scrubText', () => {
	it('removes emails, links and phone numbers', () => {
		const out = scrubText('hi, rahul@gmail.com here, see https://x.com or call 9876543210');
		expect(out).not.toContain('rahul@gmail.com');
		expect(out).not.toContain('https://x.com');
		expect(out).not.toContain('9876543210');
		expect(out).toContain('hi');
	});

	it('redacts self-introduced names', () => {
		const out = scrubText('my name is Rahul and I slept badly');
		expect(out).not.toContain('Rahul');
		expect(out).toContain('slept badly');
	});
});

describe('ageBand', () => {
	it('bands birth years', () => {
		expect(ageBand(2005, 2026)).toBe('18-21');
		expect(ageBand(2003, 2026)).toBe('22-25');
		expect(ageBand(null, 2026)).toBe('unknown');
	});
});

describe('times that are not wake times', () => {
	it('does not read "stayed up at 3" as a wake time', () => {
		// a bare "up at" matched, invented a 3am wake, and turned it into a night's sleep
		expect(heuristicExtract('i stayed up at 3 finishing the assignment').woke_at).toBeNull();
	});

	it('still reads the ways people actually say it', () => {
		expect(heuristicExtract('woke up at 7:30 feeling rough').woke_at).toBe('07:30');
		expect(heuristicExtract('got up at 6 and dragged').woke_at).toBe('06:00');
		expect(heuristicExtract('woke at 9pm').woke_at).toBe('21:00');
		expect(heuristicExtract('up at 7am').woke_at).toBe('07:00');
	});
});

describe('sleep hours', () => {
	it('treats identical clock times as unknown rather than a 24 hour night', () => {
		// nobody sleeps exactly 24 hours, and 24 is the worst number the payload could carry
		expect(computeSleepHours('02:00', '02:00')).toBeNull();
	});

	it('measures a night that crosses midnight', () => {
		expect(computeSleepHours('23:30', '07:00')).toBe(7.5);
	});

	it('keeps a genuine zero instead of recomputing over it', () => {
		// 0 is falsy, so the old guard replaced "slept 0 hours" with a figure derived from times
		expect(heuristicExtract('slept 0 hours somehow').sleep_hours).toBe(0);
	});
});

describe('removing a chip', () => {
	const saved = {
		id: 'c1',
		user_id: 'u1',
		local_date: '2026-10-05',
		quick: null,
		sleep_hours: 5,
		slept_at: '01:00',
		woke_at: '06:00',
		meals: { b: true, l: null, s: null, d: null },
		mood: 2,
		notes: null,
		notes_theme: null,
		created_at: '',
		updated_at: ''
	} as unknown as Checkin;

	it('clears the value the chip stood for, instead of restoring it', () => {
		// the patch field was null for "not mentioned", so `patch ?? base` put the deleted value
		// straight back: tapping the x did nothing, and nothing on screen said so
		const patch: NotePatch = {
			quick: null,
			sleep_hours: null,
			slept_at: '01:00',
			woke_at: '06:00',
			meals: { b: true, l: null, s: null, d: null },
			mood: null,
			deadline_notes: null,
			disturbances: []
		};
		const row = mergeCheckinRow(saved, patch, 'slept around 1', '2026-10-05', [
			'sleep_hours',
			'meals.b'
		]);
		expect(row.sleep_hours).toBeNull();
		expect(row.meals?.b).toBeNull();
		// what they did not remove still merges as usual
		expect(row.slept_at).toBe('01:00');
	});

	it('still merges untouched fields over what was already saved', () => {
		const patch: NotePatch = {
			quick: null,
			sleep_hours: 7,
			slept_at: null,
			woke_at: null,
			meals: null,
			mood: null,
			deadline_notes: null,
			disturbances: []
		};
		const row = mergeCheckinRow(saved, patch, 'slept 7 hours', '2026-10-05', ['meals.b']);
		expect(row.sleep_hours).toBe(7);
		expect(row.meals?.b).toBeNull();
	});

	it('removes the quick band when its chip goes', () => {
		const patch: NotePatch = {
			quick: 'rough',
			sleep_hours: null,
			slept_at: null,
			woke_at: null,
			meals: null,
			mood: null,
			deadline_notes: null,
			disturbances: []
		};
		const row = mergeCheckinRow(
			{ ...saved, quick: 'rough' } as unknown as Checkin,
			patch,
			'rough one',
			'2026-10-05',
			['quick']
		);
		expect(row.quick).toBeNull();
	});
});
