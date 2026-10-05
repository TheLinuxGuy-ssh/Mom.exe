import { describe, expect, it } from 'vitest';
import { extractJsonText, tryParseJson, salvageAdvice } from './parse';
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

describe('salvaging a reply from a broken envelope', () => {
	/**
	 * The model writes the reply first and the JSON around it second. Both of these came back from a
	 * live run, both are unparseable, and both contain a perfectly good reply that was about to be
	 * thrown away in favour of the deterministic planner.
	 */
	it('finds the words inside malformed JSON', () => {
		const strayQuote =
			'{"intent":"chat","understanding":"sleep_hours":3,"advice":"the 2am visit was loud. drink some water now","plan":null}';
		expect(salvageAdvice(strayQuote)).toBe('the 2am visit was loud. drink some water now');
	});

	it('unescapes a reply that came with escapes in it', () => {
		expect(salvageAdvice('{"advice":"eat something\\nthen rest"}')).toBe('eat something then rest');
		expect(salvageAdvice('{"advice":"she said \\"hi\\" first"}')).toBe('she said "hi" first');
	});

	it('has nothing to say when there is no reply in there', () => {
		expect(salvageAdvice('{"intent":"plan","plan":{"summary":"x"}}')).toBeNull();
		expect(salvageAdvice('{"advice":""}')).toBeNull();
		expect(salvageAdvice('not json at all')).toBeNull();
	});
});
