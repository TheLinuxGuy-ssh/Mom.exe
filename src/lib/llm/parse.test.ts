import { describe, expect, it } from 'vitest';
import { extractJsonText, tryParseJson } from './parse';
import { PlanOutputSchema, ExtractionSchema } from './schema';

describe('parse', () => {
	it('parses raw json', () => {
		expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
	});

	it('parses fenced json', () => {
		const text = 'Here is your plan:\n```json\n{"summary":"ok"}\n```\nbye';
		expect(tryParseJson(text)).toEqual({ summary: 'ok' });
	});

	it('parses json embedded in prose', () => {
		const text = 'Sure! {"summary":"hello","blocks":[],"flags":[]} hope this helps';
		expect(tryParseJson(text)).toEqual({ summary: 'hello', blocks: [], flags: [] });
	});

	it('returns null for garbage', () => {
		expect(tryParseJson('no json here')).toBeNull();
		expect(tryParseJson('{broken')).toBeNull();
	});

	it('extracts candidate text', () => {
		expect(extractJsonText('x {"a":1} y')).toBe('{"a":1}');
	});
});

describe('schemas', () => {
	it('validates a good plan', () => {
		const res = PlanOutputSchema.safeParse({
			summary: 'Here is your evening.',
			blocks: [{ start: '22:30', end: '23:00', action: 'wind_down', detail: 'Dim the lights.', why: 'target bedtime is near' }],
			flags: ['high_caffeine_evening']
		});
		expect(res.success).toBe(true);
	});

	it('rejects invented actions and bad times', () => {
		expect(
			PlanOutputSchema.safeParse({
				summary: 'ok ok ok',
				blocks: [{ start: '22:30', end: '23:00', action: 'do_backflips', detail: 'nope', why: '' }],
				flags: []
			}).success
		).toBe(false);
		expect(
			PlanOutputSchema.safeParse({
				summary: 'ok ok ok',
				blocks: [{ start: '25:99', end: '23:00', action: 'nap', detail: 'nope', why: '' }],
				flags: []
			}).success
		).toBe(false);
	});

	it('rejects unknown extraction keys semantics via strict types', () => {
		const res = ExtractionSchema.safeParse({ sleep_hours: 6, slept_at: null, woke_at: null, meals: null, mood: null, quick: 'okay', disturbances: [], deadline_notes: null });
		expect(res.success).toBe(true);
		expect(ExtractionSchema.safeParse({ sleep_hours: 99, slept_at: null, woke_at: null, meals: null, mood: null, quick: null, disturbances: [], deadline_notes: null }).success).toBe(false);
	});
});
