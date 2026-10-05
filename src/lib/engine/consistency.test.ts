import { describe, expect, it } from 'vitest';
import {
	adviceContradictsPlan,
	planTimes,
	planWindDownTime,
	reconcileAdviceWithPlan
} from './consistency';
import type { ContextPayload } from './context';

/**
 * The plan the student was looking at when she contradicted it: study until midnight, wind down
 * after, sleep at 00:30. Her reply said "sleep by 23:30", which is her standing target bedtime
 * rather than tonight's plan, so both were on screen at once and she looked like she did not know
 * what she had just planned.
 */
type PriorPlan = ContextPayload['prior_plan'];

const PLAN: PriorPlan = {
	as_of: '2026-10-04T20:49:00.000Z',
	blocks: [
		{ start: '20:49', end: '00:00', action: 'study_block', status: 'in_progress' },
		{ start: '00:00', end: '00:30', action: 'wind_down', status: 'unknown' },
		{ start: '00:30', end: '07:00', action: 'sleep', status: 'unknown' }
	]
};

describe('plan times', () => {
	it('collects every minute the plan commits to', () => {
		const times = planTimes(PLAN);
		expect(times.has(20 * 60 + 49)).toBe(true);
		expect(times.has(30)).toBe(true); // 00:30
		expect(times.has(420)).toBe(true); // 07:00
	});

	it('finds the wind down, which is what students check against', () => {
		expect(planWindDownTime(PLAN)).toBe(0); // 00:00
	});

	it('has nothing to disagree with when there is no sleep or wind down', () => {
		const noSleep: PriorPlan = {
			as_of: 'x',
			blocks: [{ start: '09:00', end: '10:30', action: 'class', status: 'unknown' }]
		};
		expect(planWindDownTime(noSleep)).toBeNull();
		expect(reconcileAdviceWithPlan('sleep whenever, honestly.', noSleep)).toBe('sleep whenever, honestly.');
	});
});

describe('a reply that contradicts the plan on screen', () => {
	it('catches the exact line from the transcript', () => {
		const advice = 'good. keep coding, then wind down, sleep by 23:30.';
		expect(adviceContradictsPlan(advice, PLAN)).toBe(true);
	});

	it('drops the offending sentence and keeps the rest of what she said', () => {
		const out = reconcileAdviceWithPlan('you have got this. sleep by 23:30. then get up.', PLAN);
		expect(out).toBe('you have got this. then get up.');
	});

	it('says nothing rather than say something wrong', () => {
		// the whole reply was the bad claim, so the honest answer is silence
		expect(reconcileAdviceWithPlan('sleep by 23:30.', PLAN)).toBeNull();
	});

	it('leaves a reply that agrees with the plan alone', () => {
		const advice = 'good. finish the study block at midnight, wind down, then sleep at 00:30.';
		expect(adviceContradictsPlan(advice, PLAN)).toBe(false);
		expect(reconcileAdviceWithPlan(advice, PLAN)).toBe(advice);
	});

	it('accepts the same time written the other way round', () => {
		// 12:30am and 00:30 are the same moment and a student will not see the difference
		expect(adviceContradictsPlan('wind down at 12:30.', PLAN)).toBe(false);
	});

	it('accepts a bare hour the plan mentions', () => {
		expect(adviceContradictsPlan('sleep by 7.', PLAN)).toBe(false);
	});

	it('leaves times that are not about bedtime alone', () => {
		// a reply is allowed to propose a new time for something that is not the day's wind down
		const advice = 'the lab is at 3, so move the walk to 5.';
		expect(adviceContradictsPlan(advice, PLAN)).toBe(false);
		expect(reconcileAdviceWithPlan(advice, PLAN)).toBe(advice);
	});

	it('has no opinion without a plan to disagree with', () => {
		expect(adviceContradictsPlan('sleep by 23:30.', null)).toBe(false);
		expect(reconcileAdviceWithPlan(null, PLAN)).toBeNull();
	});
});