import { describe, expect, it } from 'vitest';
import { coerceAction, coerceFlag, coerceHHMM, normalizePlan } from './normalize';
import { PlanOutputSchema } from './schema';

describe('coerceAction', () => {
	it('keeps vocabulary actions', () => {
		expect(coerceAction('eat_meal')).toBe('eat_meal');
		expect(coerceAction('Nap')).toBe('nap');
	});

	it('maps common synonyms from small models', () => {
		expect(coerceAction('lunch')).toBe('eat_meal');
		expect(coerceAction('dinner')).toBe('eat_meal');
		expect(coerceAction('breakfast')).toBe('eat_meal');
		expect(coerceAction('coffee')).toBe('caffeine_cutoff');
		expect(coerceAction('study')).toBe('study_block');
		expect(coerceAction('homework')).toBe('study_block');
		expect(coerceAction('walk')).toBe('light_exposure');
		expect(coerceAction('no screens')).toBe('screen_off');
		expect(coerceAction('bedtime')).toBe('wind_down');
		expect(coerceAction('lecture')).toBe('class');
	});

	it('rejects nonsense actions', () => {
		expect(coerceAction('do_backflips')).toBeNull();
		expect(coerceAction(42)).toBeNull();
	});
});

describe('coerceHHMM', () => {
	it('repairs loose time formats', () => {
		expect(coerceHHMM('9:30')).toBe('09:30');
		expect(coerceHHMM('9.30')).toBe('09:30');
		expect(coerceHHMM('23')).toBe('23:00');
		expect(coerceHHMM('07:05')).toBe('07:05');
	});

	it('rejects impossible times', () => {
		expect(coerceHHMM('25:99')).toBeNull();
		expect(coerceHHMM('half past six')).toBeNull();
		expect(coerceHHMM(1330)).toBeNull();
	});
});

describe('coerceFlag', () => {
	it('keeps known flags', () => {
		expect(coerceFlag('deadline_crunch')).toBe('deadline_crunch');
	});

	it('maps invented flag names onto the fixed vocabulary', () => {
		expect(coerceFlag('late_caffeine')).toBe('high_caffeine_evening');
		expect(coerceFlag('professional_help')).toBe('suggest_professional_help');
		expect(coerceFlag('exam_crush')).toBe('deadline_crunch');
		expect(coerceFlag('meal_skipping')).toBe('meal_skipping_risk');
	});

	it('drops unknown flags', () => {
		expect(coerceFlag('vibes_are_off')).toBeNull();
	});
});

describe('normalizePlan', () => {
	const messy = {
		summary: 'here is your day',
		flags: ['meal_skipping_risk'],
		blocks: [
			{ start: '12:30', end: '14:30', action: 'lunch', detail: 'eat at the mess', why: 'mess window' },
			{ start: '14:30', end: '15:00', action: 'nap', detail: 'short nap', why: '' },
			{ start: '22:30', end: '23:30', action: 'wind_down', detail: 'dim lights', why: 'bedtime target' },
			{ start: '23:30', end: '07:00', action: 'sleep', detail: 'lights out', why: '' },
			{ start: '13:00', end: '14:00', action: 'do_backflips', detail: 'ignore me', why: '' }
		]
	};

	it('repairs near-miss output into the schema', () => {
		const clean = normalizePlan(messy);
		expect(clean).not.toBeNull();
		const parsed = PlanOutputSchema.safeParse(clean);
		expect(parsed.success).toBe(true);
		expect(clean!.blocks.map((b) => b.action)).toEqual(['eat_meal', 'nap', 'wind_down', 'sleep']);
	});

	it('repairs invented flags and keeps known ones', () => {
		const clean = normalizePlan({
			summary: 'a fine day ahead',
			flags: ['late_caffeine', 'vibes_are_off', 'deadline'],
			blocks: [{ start: '09:00', end: '10:00', action: 'class', detail: 'lecture', why: '' }]
		});
		expect(clean!.flags).toEqual(['high_caffeine_evening', 'deadline_crunch']);
		expect(PlanOutputSchema.safeParse(clean).success).toBe(true);
	});

	it('truncates over-long detail and why to schema limits', () => {
		const clean = normalizePlan({
			summary: 'a fine day ahead',
			blocks: [
				{ start: '09:00', end: '10:00', action: 'class', detail: 'a'.repeat(400), why: 'b'.repeat(400) }
			]
		});
		expect(clean!.blocks[0].detail.length).toBeLessThanOrEqual(160);
		expect(PlanOutputSchema.safeParse(clean).success).toBe(true);
	});

	it('drops overlapping blocks and sorts by time', () => {
		const clean = normalizePlan({
			summary: 'x',
			blocks: [
				{ start: '20:00', end: '21:00', action: 'study_block', detail: 'later block', why: '' },
				{ start: '09:00', end: '10:00', action: 'class', detail: 'morning', why: '' },
				{ start: '09:30', end: '10:30', action: 'nap', detail: 'overlaps class', why: '' }
			]
		});
		expect(clean!.blocks.map((b) => b.start)).toEqual(['09:00', '20:00']);
	});

	it('returns null when nothing usable is left', () => {
		expect(normalizePlan({ summary: 'x', blocks: [] })).toBeNull();
		expect(normalizePlan({ blocks: [{ start: '09:00' }] })).toBeNull();
		expect(normalizePlan(null)).toBeNull();
	});

	it('keeps a helpful summary requirement', () => {
		expect(normalizePlan({ blocks: [{ start: '09:00', end: '10:00', action: 'nap', detail: 'x' }] })).toBeNull();
	});
});
describe('plans that cross midnight', () => {
	/**
	 * A study block at 01:00 sorted before the 23:00 sleep block that contains it, so the overlap
	 * check compared them as if both were that morning and let them both through. The plan then
	 * showed an hour of study in the middle of the night.
	 *
	 * The day is anchored on its earliest block, which is why the fixture starts in the evening:
	 * a plan whose earliest block really is 01:00 is a small-hours plan, and nothing in the times
	 * alone would say otherwise.
	 */
	it('drops a block that sits inside an overnight one', () => {
		const clean = normalizePlan({
			summary: 'late night',
			flags: [],
			blocks: [
				{ start: '22:00', end: '01:00', action: 'study_block', detail: 'study', why: '' },
				{ start: '23:30', end: '07:00', action: 'sleep', detail: 'lights out', why: '' }
			]
		});
		// study 22:00-01:00 starts first and is kept; the sleep that overlaps it is dropped
		expect(clean!.blocks.map((b) => b.action)).toEqual(['study_block']);
	});

	it('keeps a real late-night run intact', () => {
		// the shape the app actually produces: study to midnight, wind down, sleep. The study block
		// (20:49-00:00) and the wind-down (00:00-00:30) touch at midnight but do not overlap.
		const clean = normalizePlan({
			summary: 'late study night',
			flags: [],
			blocks: [
				{ start: '20:49', end: '00:00', action: 'study_block', detail: 'study till midnight', why: '' },
				{ start: '00:00', end: '00:30', action: 'wind_down', detail: 'dim the lights', why: '' },
				{ start: '00:30', end: '07:00', action: 'sleep', detail: 'sleep', why: '' }
			]
		});
		const actions = clean!.blocks.map((b) => b.action);
		expect(actions).toEqual(['study_block', 'wind_down', 'sleep']);
	});

	it('keeps an evening plan that does not cross midnight', () => {
		const clean = normalizePlan({
			summary: 'normal evening',
			flags: [],
			blocks: [
				{ start: '18:00', end: '19:00', action: 'exercise', detail: 'walk', why: '' },
				{ start: '19:00', end: '19:30', action: 'eat_meal', detail: 'dinner', why: '' },
				{ start: '22:45', end: '23:15', action: 'wind_down', detail: 'dim', why: '' },
				{ start: '23:30', end: '07:00', action: 'sleep', detail: 'sleep', why: '' }
			]
		});
		expect(clean!.blocks.map((b) => b.action)).toEqual(['exercise', 'eat_meal', 'wind_down', 'sleep']);
	});

	it('orders a midnight-crossing plan the way it happens', () => {
		const clean = normalizePlan({
			summary: 'evening then morning',
			flags: [],
			blocks: [
				{ start: '20:00', end: '21:00', action: 'study_block', detail: 'study', why: '' },
				{ start: '00:15', end: '00:45', action: 'wind_down', detail: 'dim', why: '' },
				{ start: '00:45', end: '07:00', action: 'sleep', detail: 'sleep', why: '' }
			]
		});
		expect(clean!.blocks.map((b) => b.start)).toEqual(['20:00', '00:15', '00:45']);
	});
});

describe('midnight written as 24:00', () => {
	it('reads 24:00 as 00:00 rather than dropping the block', () => {
		expect(coerceHHMM('24:00')).toBe('00:00');
		expect(coerceHHMM('24:30')).toBeNull();
		expect(coerceHHMM('25:00')).toBeNull();
	});

	it('keeps a study block that ends at midnight', () => {
		const clean = normalizePlan({
			summary: 'study to midnight',
			flags: [],
			blocks: [
				{ start: '20:49', end: '24:00', action: 'study_block', detail: 'study', why: '' },
				{ start: '00:00', end: '00:30', action: 'wind_down', detail: 'dim', why: '' }
			]
		});
		const actions = clean!.blocks.map((b) => b.action);
		expect(actions).toContain('study_block');
		expect(actions).toContain('wind_down');
		expect(clean!.blocks.find((b) => b.action === 'study_block')!.end).toBe('00:00');
	});
});
