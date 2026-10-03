import { describe, expect, it } from 'vitest';
import { heuristicExtract } from './extract';
import { scrubText, ageBand } from './scrub';

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
