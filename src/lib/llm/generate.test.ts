import { describe, expect, it } from 'vitest';
import { generateFromNote, isContentFree } from './generate';
import { LLMError } from './client';
import type { ContextPayload, TodayInfo } from '../engine/context';
import type { Stats } from '../engine/stats';
import type { Profile } from '../storage/types';
import type { LLMConfig } from './config';

const TZ = 'Asia/Kolkata';

function profile(): Profile {
	return {
		id: 'u1',
		display_name: 'beta',
		situation: 'student_hostel',
		birth_year: 2005,
		height_cm: null,
		weight_kg: null,
		class_start: '09:00',
		target_bed: '23:30',
		target_wake: '07:00',
		chronotype: 'night',
		roommates: 'shared_noisy',
		mess: { breakfast: '07:30-09:30', lunch: '12:30-14:30', dinner: '19:30-21:30' },
		diet_pref: 'veg',
		allergies: [],
		caffeine: 'high_late',
		timezone: TZ,
		created_at: '2026-10-01T00:00:00Z'
	} as Profile;
}

function stats(): Stats {
	return {
		avg_sleep_hours_7d: { value: 5.2, n: 3 },
		sleep_debt_hours_7d: { value: 4, n: 3 },
		bedtime_drift_hours: { value: 0.4, n: 4 },
		nights_under_5h_14d: { value: 3, n: 14 },
		top_disturbance: { value: 'noise', n: 6 },
		skipped_meal_rate: { value: 0.4, n: 3 },
		worst_weekday: { value: 'wednesday', n: 3 },
		followed_rate_by_action: {},
		known_days_of_last_14: 3,
		days_since_last_checkin: 1
	};
}

function today(): TodayInfo {
	return {
		classes: [],
		deadline_notes: null,
		sleep_so_far_hours: null,
		meals_so_far: { b: true, l: true, s: false, d: null },
		caffeine_last_at: '14:00'
	};
}

function context(): ContextPayload {
	return {
		today: today(),
		prior_plan: null,
		notes_today: [],
		conversation: { recent: [], older_digests: [], to_digest: [] }
	} as unknown as ContextPayload;
}

const config: LLMConfig = {
	mode: 'direct',
	url: 'https://example.invalid/v1/chat/completions',
	model: 'test',
	apiKey: 'k',
	reasoningEffort: 'low',
	maxTokens: 100,
	timeoutMs: 2000
};

/** Answer every call with the given content, and count how many calls it took. */
function respondWith(...contents: string[]): { restore: () => void; calls: () => number } {
	const original = globalThis.fetch;
	let n = 0;
	globalThis.fetch = (async () =>
		new Response(
			JSON.stringify({
				choices: [{ message: { content: contents[Math.min(n, contents.length - 1)] ?? '' } }]
			}),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		)) as typeof fetch;
	return {
		restore: () => {
			globalThis.fetch = original;
		},
		calls: () => ++n
	};
}

describe('content free notes', () => {
	it('treats a genuinely absent note as a request to be planned', () => {
		// the send button promises a plan, so nothing typed has to mean one
		expect(isContentFree(null)).toBe(true);
		expect(isContentFree('   ')).toBe(true);
		expect(isContentFree('...')).toBe(true);
		expect(isContentFree('idk')).toBe(true);
		expect(isContentFree('hmm')).toBe(true);
		expect(isContentFree('who knows')).toBe(true);
	});

	it('leaves a typed greeting to the model, which calls it chat', () => {
		// this returned true once and forced a timetable on someone who only said hello, which is the
		// exact failure this app is supposed to not have. The comment above the old line said
		// "small talk, not a scheduling request" and the code returned true anyway.
		for (const greeting of ['hi', 'Hi.', 'hey', 'hello', 'yo', 'sup', 'ok', 'okay', 'cool', 'thanks', 'thanks!', 'bye']) {
			expect(isContentFree(greeting), greeting).toBe(false);
		}
	});

	it('still reads a bare "k" as asking for the plan', () => {
		// the one terse input that stays content free: it is the reply to something she just said,
		// and pressing "what do I do now?" and typing "k" is asking to be planned
		expect(isContentFree('k')).toBe(true);
	});

	it('leaves a real note alone, even a short one', () => {
		expect(isContentFree('could not eat till 3')).toBe(false);
		expect(isContentFree('idk what to do about tomorrow, lab until 7')).toBe(false);
	});
});

describe('prose recovery', () => {
	/**
	 * The JSON envelope is a contract with the model, not with the student. When she answers in
	 * plain sentences instead, those sentences are the reply, and swapping them for a template
	 * schedule means throwing away a good answer and showing a generic one.
	 */
	it('keeps her prose as the reply when no envelope came back', async () => {
		const fake = respondWith('ha. drink some water, then eat something before bed');
		try {
			const res = await generateFromNote(
				{ note: 'i keep forgetting to drink water', context: context(), profile: profile(), stats: stats(), today: today() },
				config
			);
			expect(res.intent).toBe('chat');
			expect(res.advice).toContain('drink some water');
			expect(res.usedTemplate).toBe(false);
		} finally {
			fake.restore();
		}
	});

	it('still plans in code when a planning request gets prose instead of blocks', async () => {
		// an empty note owes the student a day. her sentence is not one, so the fallback stands
		const fake = respondWith('ha. you should really get some rest tonight, you look tired');
		try {
			const res = await generateFromNote(
				{ note: null, context: context(), profile: profile(), stats: stats(), today: today() },
				config
			);
			expect(res.usedTemplate).toBe(true);
			expect(res.output?.blocks.length ?? 0).toBeGreaterThan(0);
		} finally {
			fake.restore();
		}
	});
});

describe('retrying an empty model reply', () => {
	it('spends a bigger budget once when the model returns nothing at all', async () => {
		// gpt-oss sometimes burns the whole allowance on reasoning and answers with nothing. that
		// is a short budget, not a wrong answer, and it was the most common reason a real note fell
		// through to the template planner
		let attempts = 0;
		const original = globalThis.fetch;
		globalThis.fetch = (async () => {
			attempts += 1;
			const content =
				attempts === 1
					? ''
					: JSON.stringify({ intent: 'chat', understanding: null, advice: 'eat something, then rest', plan: null, handoff: null, digest: [] });
			return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}) as typeof fetch;
		try {
			const res = await generateFromNote(
				{ note: 'i keep forgetting to drink water', context: context(), profile: profile(), stats: stats(), today: today() },
				config
			);
			expect(attempts).toBeGreaterThan(1);
			expect(res.advice).toContain('eat something');
			expect(res.usedTemplate).toBe(false);
		} finally {
			globalThis.fetch = original;
		}
	});
});

describe('the contract error a missing envelope reports', () => {
	it('is an LLMError the caller can show', async () => {
		expect(new LLMError('model replied but no message content was found in the response')).toBeInstanceOf(Error);
	});
});
describe('the routing call running beside the main one', () => {
	/**
	 * The classifier is started in parallel with the one-shot rather than awaited first, because
	 * awaiting it cost a serial round trip on every note. But an unbounded wait was worse than the
	 * win was worth: NVIDIA's shared free tier queues the second request when two arrive at once, and
	 * one interleaved run came back at 46.7s.
	 *
	 * So the verdict is taken if it has landed and dropped if it has not. Dropping it is not a new
	 * failure mode — a null verdict is already what a timed-out or erroring classifier produces, and
	 * the model declares its own intent in that case.
	 */
	it('does not wait on a classifier that never answers', async () => {
		const original = globalThis.fetch;
		let calls = 0;
		globalThis.fetch = (async (input: any) => {
			calls += 1;
			// call 1 is the classifier in flight; call 2 is the one-shot
			if (calls === 1) return new Promise<Response>(() => undefined); // never settles
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									intent: 'chat',
									understanding: null,
									advice: 'ha. go on then, i am listening',
									plan: null,
									handoff: null,
									digest: []
								})
							}
						}
					]
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			);
		}) as typeof fetch;

		try {
			const started = Date.now();
			const res = await generateFromNote(
				{ note: 'i just wanted to talk', context: context(), profile: profile(), stats: stats(), today: today() },
				{ ...config, timeoutMs: 5000 }
			);
			// the 300ms grace period is a bound, not a hang
			expect(Date.now() - started).toBeLessThan(2500);
			expect(res.intent).toBe('chat');
			expect(res.advice).toContain('listening');
		} finally {
			globalThis.fetch = original;
		}
	});

	it('still uses the classifier when it answers in time', async () => {
		// classifier says chat, the one-shot returns a plan: the classifier's vote is what stops a
		// feeling turning into a wall of blocks, so it must not be silently dropped
		const original = globalThis.fetch;
		let calls = 0;
		globalThis.fetch = (async () => {
			calls += 1;
			if (calls === 1) {
				return new Response(JSON.stringify({ choices: [{ message: { content: '{"intent":"chat"}' } }] }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									intent: 'plan',
									understanding: null,
									advice: null,
									plan: {
										summary: 'a day',
										flags: [],
										blocks: [
											{ start: '19:00', end: '20:00', action: 'study_block', detail: 'read', why: '' }
										]
									},
									handoff: null,
									digest: []
								})
							}
						}
					]
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			);
		}) as typeof fetch;

		try {
			const res = await generateFromNote(
				{ note: 'honestly today was awful', context: context(), profile: profile(), stats: stats(), today: today() },
				config
			);
			expect(res.intent).toBe('chat');
			expect(res.output).toBeNull();
		} finally {
			globalThis.fetch = original;
		}
	});
});

describe('how many round trips a turn is allowed to spend', () => {
	/**
	 * Counts one-shot calls, ignoring the classifier.
	 *
	 * The classifier runs in parallel and is capped by the routing grace, so it is not on the critical
	 * path in the way these are.
	 */
	function oneShotCounter(...contents: string[]) {
		const original = globalThis.fetch;
		let oneShots = 0;
		let classifiers = 0;
		globalThis.fetch = (async (_url: unknown, init: { body?: string } | undefined) => {
			const body = JSON.parse(init?.body ?? '{}');
			const isClassifier = Array.isArray(body.messages) && /you decide one thing/i.test(body.messages[0]?.content ?? '');
			if (isClassifier) {
				classifiers += 1;
				return new Response(JSON.stringify({ choices: [{ message: { content: '{"intent":"chat"}' } }] }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			oneShots += 1;
			const content = contents[Math.min(oneShots - 1, contents.length - 1)] ?? '';
			return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}) as typeof fetch;
		return {
			restore: () => {
				globalThis.fetch = original;
			},
			oneShots: () => oneShots,
			classifiers: () => classifiers
		};
	}

	const chatEnvelope = (advice: string) =>
		JSON.stringify({ intent: 'chat', understanding: null, advice, plan: null, handoff: null, digest: [] });

	it('spends nothing extra on a checklist, because the surplus is cut in code', async () => {
		// this was the expensive one. A four-instruction reply used to be fixed by asking the model
		// again, which is three to six seconds of the student's wait for a shorter sentence. The
		// surplus is cut in polishAdvice now, so the correction is free and the turn keeps its one
		// call. This test exists to stop anyone reintroducing the round trip.
		const counter = oneShotCounter(
			chatEnvelope('study first, then take a short walk. keep a glass of water nearby while you read.'),
			chatEnvelope('ha. maths tomorrow, so start with the toughest chapter. go.')
		);
		try {
			const res = await generateFromNote(
				{ note: 'maths exam tomorrow, any tips?', context: context(), profile: profile(), stats: stats(), today: today() },
				config
			);
			expect(counter.oneShots()).toBe(1);
			expect(res.advice).not.toContain('glass of water');
		} finally {
			counter.restore();
		}
	});

	it('does not add a third call when the reply is both a duplicate and a checklist', async () => {
		// the two checks used to chain, so the worst turn could spend four one-shots
		const withHistory = () => ({
			...context(),
			conversation: {
				recent: [
					{ role: 'user', text: 'maths exam tomorrow' },
					{ role: 'mom', text: 'study first, then take a short walk. keep a glass of water nearby while you read.' }
				],
				older_digests: [],
				to_digest: []
			}
		} as unknown as ContextPayload);

		const counter = oneShotCounter(
			chatEnvelope('study first, then take a short walk. keep a glass of water nearby while you read.'),
			chatEnvelope('ha. then we start with the hardest one. go.')
		);
		try {
			await generateFromNote(
				{ note: 'and what about tonight?', context: withHistory(), profile: profile(), stats: stats(), today: today() },
				config
			);
			expect(counter.oneShots()).toBeLessThanOrEqual(2);
		} finally {
			counter.restore();
		}
	});

	it('keeps the structural repair, which outranks both checks', async () => {
		// a planning request that came back without blocks is the case the repair exists for: without
		// the second asking, this turn falls through to the template planner. So the budget goes here
		// first and the tone is never looked at.
		const counter = oneShotCounter(
			JSON.stringify({ intent: 'plan', understanding: null, advice: null, plan: null, handoff: null, digest: [] }),
			JSON.stringify({
				intent: 'plan',
				understanding: null,
				advice: 'eat, then bed. go.',
				plan: {
					summary: 'eat, then bed',
					flags: [],
					blocks: [{ start: '20:00', end: '21:00', action: 'eat_meal', detail: 'eat dinner', why: 'mess closes at 9' }]
				},
				handoff: null,
				digest: []
			})
		);
		try {
			const res = await generateFromNote(
				// content free, so wantsPlan is true and a plan is genuinely owed
				{ note: null, context: context(), profile: profile(), stats: stats(), today: today() },
				config
			);
			expect(res.output).not.toBeNull();
			expect(counter.oneShots()).toBe(2);
		} finally {
			counter.restore();
		}
	});
});
