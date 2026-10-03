import { describe, expect, it } from 'vitest';
import {
	DIGEST_WEEKS,
	MEMORY_WINDOW,
	selectDigestBatches,
	toContextWindow,
	weekStartOf
} from './memory';
import type { Message, WeekDigest } from '../storage/types';

function msg(local_date: string, content: string, role: 'user' | 'mom' = 'user', minutes = 0): Message {
	return {
		id: `${local_date}-${minutes}-${role}`,
		user_id: 'u1',
		local_date,
		role,
		kind: 'chat',
		content,
		created_at: `${local_date}T00:${String(minutes).padStart(2, '0')}:00.000Z`
	};
}

function digest(week_start: string): WeekDigest {
	return {
		id: week_start,
		user_id: 'u1',
		week_start,
		content: 'notes',
		created_at: '2026-10-01T00:00:00.000Z'
	};
}

describe('weekStartOf', () => {
	it('snaps any date back to its Monday', () => {
		expect(weekStartOf('2026-10-04')).toBe('2026-09-28'); // Sunday -> prior Monday
		expect(weekStartOf('2026-10-05')).toBe('2026-10-05'); // Monday -> itself
		expect(weekStartOf('2026-10-11')).toBe('2026-10-05'); // Sunday -> prior Monday
		expect(weekStartOf('2026-10-07')).toBe('2026-10-05'); // Wednesday
	});

	it('crosses a month boundary cleanly', () => {
		expect(weekStartOf('2026-03-02')).toBe('2026-03-02'); // first Monday of March
		expect(weekStartOf('2026-03-01')).toBe('2026-02-23'); // Sunday before
	});
});

describe('toContextWindow', () => {
	it('reverses newest-first storage into chronological order', () => {
		const stored = [msg('2026-10-03', 'third'), msg('2026-10-02', 'second'), msg('2026-10-01', 'first')];
		const out = toContextWindow(stored);
		expect(out.map((m) => m.text)).toEqual(['first', 'second', 'third']);
	});

	it('keeps only the configured window', () => {
		const stored = Array.from({ length: MEMORY_WINDOW + 10 }, (_, i) => msg('2026-10-03', `m${i}`));
		expect(toContextWindow(stored)).toHaveLength(MEMORY_WINDOW);
	});

	it('scrubs PII on the way out but leaves the stored copy alone', () => {
		const stored = [msg('2026-10-03', 'hey I am Rahul, rahul@x.com, call me on 9876543210')];
		const out = toContextWindow(stored);
		expect(out[0].text).not.toContain('Rahul');
		expect(out[0].text).not.toContain('rahul@x.com');
		expect(stored[0].content).toContain('Rahul');
	});

	it('caps a single very long message', () => {
		const out = toContextWindow([msg('2026-10-03', 'x'.repeat(5000))]);
		expect(out[0].text.length).toBe(240);
	});

	it('drops messages that scrub down to nothing', () => {
		expect(toContextWindow([msg('2026-10-03', '   ')])).toHaveLength(0);
	});
});

describe('selectDigestBatches', () => {
	it('ignores anything still inside the window', () => {
		const stored = Array.from({ length: 5 }, (_, i) => msg('2026-10-03', `m${i}`));
		expect(selectDigestBatches(stored, [])).toHaveLength(0);
	});

	it('picks up messages that fell out of the window', () => {
		const stored = [
			...Array.from({ length: MEMORY_WINDOW }, (_, i) => msg('2026-10-03', `recent${i}`)),
			msg('2026-09-01', 'old one'),
			msg('2026-09-01', 'old two')
		];
		const out = selectDigestBatches(stored, []);
		expect(out.map((m) => m.text)).toEqual(['old one', 'old two']);
	});

	it('tags each message with the week it belongs to', () => {
		const stored = [...Array.from({ length: MEMORY_WINDOW }, () => msg('2026-10-03', 'recent')), msg('2026-09-02', 'ancient')];
		expect(selectDigestBatches(stored, [])[0].week_start).toBe('2026-08-31');
	});

	it('never asks for a week that already has a digest', () => {
		const stored = [
			...Array.from({ length: MEMORY_WINDOW }, () => msg('2026-10-03', 'recent')),
			msg('2026-09-02', 'already summarized')
		];
		expect(selectDigestBatches(stored, [digest('2026-08-31')])).toHaveLength(0);
	});

	it('caps the batch so one call cannot grow unbounded', () => {
		const stored = [
			...Array.from({ length: MEMORY_WINDOW }, () => msg('2026-10-03', 'recent')),
			...Array.from({ length: 200 }, () => msg('2026-09-02', 'old'))
		];
		expect(selectDigestBatches(stored, [])).toHaveLength(40);
	});

	it('keeps the week boundary weeks distinct', () => {
		const stored = [
			...Array.from({ length: MEMORY_WINDOW }, () => msg('2026-10-03', 'recent')),
			msg('2026-09-04', 'week one'),
			msg('2026-09-08', 'week two')
		];
		expect(selectDigestBatches(stored, []).map((m) => m.week_start)).toEqual([
			'2026-08-31',
			'2026-09-07'
		]);
	});
});

describe('digest budget', () => {
	it('carries a small, fixed number of weeks', () => {
		expect(DIGEST_WEEKS).toBe(4);
	});
});
