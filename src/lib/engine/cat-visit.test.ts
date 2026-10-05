import { describe, expect, it } from 'vitest';
import {
	ARRIVAL_MAX_MS,
	ARRIVAL_MIN_MS,
	AWAY_MS,
	CORE_LINES,
	GRACE_MAX_MS,
	GRACE_MIN_MS,
	IDLE_MAX_MS,
	IDLE_MIN_MS,
	IDEAS,
	catDate,
	hash,
	pickCoreLine,
	pickIdea,
	readCatDay,
	remainingUntilArrival,
	rollArrivalDelay,
	rollGraceDelay,
	rollIdleDelay,
	touchCatDay,
	updateCatDay
} from './cat-visit';

function memStorage(): {
	storage: { getItem(k: string): string | null; setItem(k: string, v: string): void };
	get: (k: string) => string | null;
} {
	const map = new Map<string, string>();
	return {
		storage: {
			getItem: (k) => map.get(k) ?? null,
			setItem: (k, v) => void map.set(k, v)
		},
		get: (k) => map.get(k) ?? null
	};
}

const fixedRand = (v: number) => () => v;

describe('rolls stay inside their bands', () => {
	it('arrival is a minute or two of platform time', () => {
		for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
			const v = rollArrivalDelay(fixedRand(r));
			expect(v).toBeGreaterThanOrEqual(ARRIVAL_MIN_MS);
			expect(v).toBeLessThanOrEqual(ARRIVAL_MAX_MS);
		}
		expect(rollArrivalDelay(fixedRand(0))).toBe(ARRIVAL_MIN_MS);
		expect(rollArrivalDelay(fixedRand(1))).toBe(ARRIVAL_MAX_MS);
	});

	it('patience is ten to twenty minutes', () => {
		for (const r of [0, 0.5, 1]) {
			const v = rollIdleDelay(fixedRand(r));
			expect(v).toBeGreaterThanOrEqual(IDLE_MIN_MS);
			expect(v).toBeLessThanOrEqual(IDLE_MAX_MS);
		}
	});

	it('the reload grace is short', () => {
		for (const r of [0, 0.5, 1]) {
			const v = rollGraceDelay(fixedRand(r));
			expect(v).toBeGreaterThanOrEqual(GRACE_MIN_MS);
			expect(v).toBeLessThanOrEqual(GRACE_MAX_MS);
		}
	});

	it('the cat does not hover for a second', () => {
		expect(AWAY_MS).toBe(60_000);
	});
});

describe('the day record', () => {
	it('is created on first sighting with a rolled delay', () => {
		const { storage } = memStorage();
		const day = touchCatDay({ storage, now: () => 1_000, rand: fixedRand(0.5), date: '2026-10-04' });
		expect(day).not.toBeNull();
		expect(day!.date).toBe('2026-10-04');
		expect(day!.firstSeen).toBe(1_000);
		expect(day!.appeared).toBe(false);
		expect(day!.dismissed).toBe(false);
		expect(day!.delayMs).toBeGreaterThan(0);
	});

	it('is stable across reloads the same day, so the cat does not move', () => {
		const { storage } = memStorage();
		const first = touchCatDay({ storage, now: () => 1_000, rand: fixedRand(0.2), date: '2026-10-04' });
		const second = touchCatDay({ storage, now: () => 500_000, rand: fixedRand(0.9), date: '2026-10-04' });
		expect(second).toEqual(first);
	});

	it('starts over on a new day', () => {
		const { storage } = memStorage();
		touchCatDay({ storage, now: () => 1_000, rand: fixedRand(0.2), date: '2026-10-04' });
		const next = touchCatDay({ storage, now: () => 2_000, rand: fixedRand(0.9), date: '2026-10-05' });
		expect(next!.date).toBe('2026-10-05');
		expect(next!.firstSeen).toBe(2_000);
		expect(next!.dismissed).toBe(false);
	});

	it('ignores a record left over from yesterday', () => {
		const { storage } = memStorage();
		touchCatDay({ storage, now: () => 1_000, date: '2026-10-04' });
		expect(readCatDay({ storage, date: '2026-10-05' })).toBeNull();
	});

	it('remembers that it already appeared and that it was sent away', () => {
		const { storage } = memStorage();
		touchCatDay({ storage, now: () => 0, date: '2026-10-04' });
		expect(updateCatDay({ appeared: true }, { storage, date: '2026-10-04' })!.appeared).toBe(true);
		expect(updateCatDay({ dismissed: true }, { storage, date: '2026-10-04' })!.dismissed).toBe(true);
		expect(readCatDay({ storage, date: '2026-10-04' })!.dismissed).toBe(true);
	});

	it('copes with no storage at all', () => {
		expect(touchCatDay({ storage: null, date: '2026-10-04' })).toBeNull();
		expect(readCatDay({ storage: null, date: '2026-10-04' })).toBeNull();
		expect(updateCatDay({ dismissed: true }, { storage: null, date: '2026-10-04' })).toBeNull();
	});

	it('survives corrupted storage instead of throwing at the user', () => {
		const storage = { getItem: () => 'not json', setItem: () => {} };
		expect(readCatDay({ storage, date: '2026-10-04' })).toBeNull();
	});
});

describe('arrival arithmetic', () => {
	it('waits out the rest of the day\'s first visit', () => {
		const day = { date: '2026-10-04', firstSeen: 1_000, delayMs: 90_000, appeared: false, dismissed: false };
		expect(remainingUntilArrival(day, 1_000)).toBe(90_000);
		expect(remainingUntilArrival(day, 31_000)).toBe(60_000);
	});

	it('is already due once the window has passed', () => {
		const day = { date: '2026-10-04', firstSeen: 1_000, delayMs: 90_000, appeared: false, dismissed: false };
		expect(remainingUntilArrival(day, 500_000)).toBe(0);
	});
});

describe('what the cat says', () => {
	it('says the same thing all day and a different thing tomorrow', () => {
		expect(pickIdea('2026-10-04')).toBe(pickIdea('2026-10-04'));
		expect(pickCoreLine('2026-10-04')).toBe(pickCoreLine('2026-10-04'));
		expect(pickIdea('2026-10-04')).not.toBe(pickIdea('2026-10-05'));
	});

	it('actually rotates over a stretch of days', () => {
		const days = Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
		const ideas = new Set(days.map(pickIdea));
		const cores = new Set(days.map(pickCoreLine));
		expect(ideas.size).toBeGreaterThan(days.length / 2);
		expect(cores.size).toBeGreaterThan(1);
	});

	it('has nothing empty, duplicated or lecture-shaped', () => {
		for (const line of [...CORE_LINES, ...IDEAS]) {
			expect(line.trim()).toBe(line);
			expect(line.length).toBeGreaterThan(10);
			expect(line.length).toBeLessThan(90);
			expect(line).toMatch(/^[a-z0-9 ,.'’!?-]+$/);
			expect(line).not.toMatch(/\b(streak|you should have|you failed|you missed)\b/);
		}
		expect(new Set(IDEAS).size).toBe(IDEAS.length);
		expect(new Set(CORE_LINES).size).toBe(CORE_LINES.length);
		expect(IDEAS.length).toBeGreaterThanOrEqual(30);
		expect(CORE_LINES.length).toBeGreaterThanOrEqual(4);
	});

	it('points at the people who actually care, every time', () => {
		for (const line of CORE_LINES) {
			expect(line).toMatch(/\b(she|mum|mom|parents|her)\b/i);
		}
	});
});

describe('helpers', () => {
	it('formats today as a local date, not UTC', () => {
		expect(catDate(new Date(2026, 0, 5))).toBe('2026-01-05');
		expect(catDate(new Date(2026, 11, 31))).toBe('2026-12-31');
	});

	it('hashes to something stable and signed', () => {
		expect(hash('2026-10-04')).toBe(hash('2026-10-04'));
		expect(hash('2026-10-04')).not.toBe(hash('2026-10-05'));
		expect(Number.isInteger(hash('abc'))).toBe(true);
	});
});