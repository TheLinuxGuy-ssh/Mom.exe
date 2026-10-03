import { describe, expect, it } from 'vitest';
import { ACTIONS } from './actions';
import { CATEGORIES, categoryOf, dayShape, formatDuration, minutesOf } from './shape';
import type { PlanBlock } from '../storage/types';

function block(start: string, end: string, action: string): PlanBlock {
	return { start, end, action, detail: '', why: '' };
}

describe('category coverage', () => {
	it('assigns every known action to a category', () => {
		for (const a of ACTIONS) {
			expect(CATEGORIES).toContain(categoryOf(a));
		}
	});

	it('falls back to rest for an action it has never seen', () => {
		expect(categoryOf('teleport')).toBe('rest');
	});

	it('keeps people-time and me-time with the people bucket', () => {
		expect(categoryOf('social_time')).toBe('people');
		expect(categoryOf('me_time')).toBe('people');
	});
});

describe('minutesOf', () => {
	it('measures a normal block', () => {
		expect(minutesOf(block('09:00', '10:30', 'class'))).toBe(90);
	});

	it('measures a block that crosses midnight', () => {
		expect(minutesOf(block('23:30', '07:00', 'sleep'))).toBe(450);
	});
});

describe('dayShape', () => {
	it('is empty with no blocks, so the widget can stay quiet', () => {
		expect(dayShape([]).empty).toBe(true);
		expect(dayShape([]).slices).toEqual([]);
	});

	it('splits a day and always sums to the whole', () => {
		const shape = dayShape([
			block('09:00', '11:00', 'class'),
			block('11:00', '13:00', 'study_block'),
			block('13:00', '13:30', 'eat_meal'),
			block('14:00', '15:00', 'social_time'),
			block('23:00', '07:00', 'sleep')
		]);
		expect(shape.empty).toBe(false);
		const summed = shape.slices.reduce((s, x) => s + x.share, 0);
		expect(summed).toBeCloseTo(1, 6);
		expect(shape.slices.find((s) => s.category === 'work')?.minutes).toBe(240);
		expect(shape.slices.find((s) => s.category === 'rest')?.minutes).toBe(480);
	});

	it('drops categories with nothing in them instead of showing 0%', () => {
		const shape = dayShape([block('13:00', '13:30', 'eat_meal')]);
		expect(shape.slices.map((s) => s.category)).toEqual(['body']);
	});

	it('reports a total that includes an overnight block once', () => {
		const shape = dayShape([block('23:00', '07:00', 'sleep')]);
		expect(shape.totalMinutes).toBe(480);
	});

	it('handles a single short block without dividing by zero', () => {
		const shape = dayShape([block('13:00', '13:01', 'hydration')]);
		expect(shape.slices[0].share).toBe(1);
	});
});

describe('formatDuration', () => {
	it('reads the way a person would say it', () => {
		expect(formatDuration(45)).toBe('45m');
		expect(formatDuration(60)).toBe('1h');
		expect(formatDuration(90)).toBe('1h 30m');
		expect(formatDuration(480)).toBe('8h');
	});
});
