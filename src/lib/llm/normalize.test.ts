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