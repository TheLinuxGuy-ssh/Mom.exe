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
		recent: [],
		older_digests: []
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
	it('treats filler and greetings as a request to be planned', () => {
		// the send button promises a plan, so "idk" and "hi" have to mean one
		expect(isContentFree(null)).toBe(true);
		expect(isContentFree('   ')).toBe(true);
		expect(isContentFree('...')).toBe(true);
		expect(isContentFree('idk')).toBe(true);
		expect(isContentFree('Hi.')).toBe(true);
		expect(isContentFree('thanks!')).toBe(true);
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