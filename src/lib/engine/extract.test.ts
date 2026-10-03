import { describe, expect, it } from 'vitest';
import { heuristicExtract, mergeUnderstanding, computeSleepHours } from './extract';
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
