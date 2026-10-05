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
		created_at: `${local_date}T00:${String(minutes).padStart(2, '0')}:00.000Z`,
		session_id: null
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

describe('memory across chat sessions', () => {
	it('reads the last 20 messages regardless of which session they were written in', () => {
		// closing the app empties the chat box, it must not shorten her memory
		const across = [
			msg('2026-10-03', 'older', 'user', 5),
			msg('2026-10-03', 'same session', 'user', 30),
			msg('2026-10-03', 'newer', 'user', 45)
		];
		const window = toContextWindow(across, 20);
		expect(window.map((m) => m.text)).toEqual(['newer', 'same session', 'older']);
	});

	it('orders the window oldest first, so the model reads the thread in order', () => {
		const rows = [
			msg('2026-10-03', 'second', 'user', 10),
			msg('2026-10-03', 'first', 'mom', 5)
		];
		expect(toContextWindow(rows, 20).map((m) => m.text)).toEqual(['first', 'second']);
	});
});

describe('digest selection', () => {
	function msg(local_date: string, content: string, i = 0): Message {
		return {
			id: `m${local_date}-${i}`,
			user_id: 'u1',
			local_date,
			role: 'user',
			kind: 'chat',
			content,
			created_at: `${local_date}T10:00:00.000Z`,
			session_id: null
		};
	}

	function digest(week_start: string): WeekDigest {
		return { id: week_start, user_id: 'u1', week_start, content: 'summary', created_at: '' };
	}

	it('never digests the week that is still running', () => {
		// Monday's burst used to freeze that week permanently: the digest was written, every later
		// message became "already covered", and a long conversation was remembered as its first few
		const monday = msg('2026-09-28', 'a', 0); // Monday of that week
		const tuesday = msg('2026-09-29', 'b', 1);
		const old = msg('2026-08-04', 'an older thing', 2);
		const batch = selectDigestBatches([tuesday, monday, old], [], 1, 40, '2026-09-29');
		expect(batch.map((b) => b.week_start)).toEqual(['2026-08-03']);
	});

	it('does not re-digest a week that already has a digest', () => {
		const rows = [msg('2026-08-04', 'a', 0), msg('2026-08-05', 'b', 1)];
		expect(selectDigestBatches(rows, [digest('2026-08-03')], 0, 40, '2026-09-29')).toEqual([]);
	});

	it('digests a finished week once, even when its digest is older than the newest four', () => {
		// passing only the newest four made this week look uncovered on every call, so it was
		// re-summarized and overwritten from a partial batch, forever
		const rows = [msg('2026-08-04', 'a', 0), msg('2026-08-05', 'b', 1)];
		const history = [
			digest('2026-09-28'),
			digest('2026-09-21'),
			digest('2026-09-14'),
			digest('2026-09-07'),
			digest('2026-08-03')
		];
		expect(selectDigestBatches(rows, history, 0, 40, '2026-09-29')).toEqual([]);
	});

	it('falls back to digesting a small-hours week when that is all there is', () => {
		// a week whose messages all sit after midnight still deserves summarizing once it is past
		const rows = [msg('2026-08-05', 'late night talk', 0), msg('2026-08-05', 'more', 1)];
		expect(selectDigestBatches(rows, [], 0, 40, '2026-09-29')).toHaveLength(2);
	});
});
