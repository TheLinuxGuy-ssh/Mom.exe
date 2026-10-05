import { describe, expect, it, vi, afterEach } from 'vitest';
import { chat } from './client';
import { CLASSIFIER_MAX_TOKENS } from './generate';
import { buildClassifyFirstMessages, buildOneShotMessages, MOM_VOICE, SYSTEM_ONESHOT_PROMPT } from './prompt';
import type { ContextPayload } from '$lib/engine/context';
import type { LLMConfig } from './config';

/**
 * The app does not talk to NVIDIA directly: the browser posts to a Supabase edge function that
 * validates the body with zod before spending a token. Its caps are a hard contract, and anything
 * outside them returns a flat `400 invalid payload` with no field named.
 *
 * The classifier once sent `max_tokens: 40` against a `min(64)` floor. Every classification was
 * rejected, a bare catch swallowed it, and routing quietly fell back to the model's own intent, so
 * the symptom looked like the model had regressed rather than a request the proxy would not take.
 * These tests keep every cap honest from the app's side, which is the half that gets tuned.
 */

const proxyConfig: LLMConfig = {
	mode: 'proxy',
	url: 'https://project.supabase.co/functions/v1/plan',
	model: 'openai/gpt-oss-20b',
	apiKey: '',
	reasoningEffort: 'low',
	maxTokens: 1200,
	timeoutMs: 5000
};

/** mirrors BodySchema in the edge function */
const LIMITS = {
	modelChars: 120,
	maxMessages: 12,
	maxContentChars: 24000,
	minTokens: 64,
	maxTokens: 4096,
	minTemperature: 0,
	maxTemperature: 2
} as const;

const ROLES = ['system', 'user', 'assistant'] as const;

function payloadOfSize(historyChars: number): ContextPayload {
	// shaped like the worst case the app can actually build: a full memory window plus a fortnight
	// of checkins and a couple of digests waiting to be summarised
	const recent = Array.from({ length: 20 }, (_, i) => ({
		role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
		text: 'x'.repeat(historyChars)
	}));
	return {
		as_of_local: '2026-10-04T21:00',
		day_of_week: 'Sunday',
		timezone: 'Asia/Kolkata',
		nickname: 'beta',
		prior_plan: null,
		today: {
			local_date: '2026-10-04',
			target_bedtime: '23:30',
			target_wake: '07:30',
			class_schedule: ['09:00-10:30'],
			deadlines: []
		},
		conversation: {
			recent,
			older_digests: [
				{ week_start: '2026-09-21', text: 'y'.repeat(400) },
				{ week_start: '2026-09-28', text: 'z'.repeat(400) }
			],
			to_digest: [{ kind: 'chat', text: 'w'.repeat(240) }]
		},
		recent_days: Array.from({ length: 14 }, (_, i) => ({
			days_ago: i + 1,
			quick: 'ok',
			sleep_hours: 6.5,
			meals_eaten: 3,
			mood: 3,
			notes_theme: 'tired'
		}))
	} as unknown as ContextPayload;
}

function assertProxyAccepts(body: Record<string, unknown>): void {
	expect(typeof body['model']).toBe('string');
	expect(String(body['model']).length).toBeLessThanOrEqual(LIMITS.modelChars);

	const messages = body['messages'] as { role: string; content: string }[];
	expect(Array.isArray(messages)).toBe(true);
	expect(messages.length).toBeGreaterThanOrEqual(1);
	expect(messages.length).toBeLessThanOrEqual(LIMITS.maxMessages);
	for (const m of messages) {
		expect(ROLES).toContain(m.role as (typeof ROLES)[number]);
		expect(m.content.length).toBeGreaterThan(0);
		expect(m.content.length).toBeLessThanOrEqual(LIMITS.maxContentChars);
	}

	const temp = body['temperature'] as number;
	expect(temp).toBeGreaterThanOrEqual(LIMITS.minTemperature);
	expect(temp).toBeLessThanOrEqual(LIMITS.maxTemperature);

	if (body['max_tokens'] !== undefined) {
		const tokens = body['max_tokens'] as number;
		expect(Number.isInteger(tokens)).toBe(true);
		expect(tokens).toBeGreaterThanOrEqual(LIMITS.minTokens);
		expect(tokens).toBeLessThanOrEqual(LIMITS.maxTokens);
	}

	if (body['stream'] !== undefined) expect(body['stream']).toBe(false);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the classifier request the proxy will actually accept', () => {
	it('asks for at least the minimum the edge function allows', () => {
		// the regression itself: 40 was under the floor and every classification was rejected
		expect(CLASSIFIER_MAX_TOKENS).toBeGreaterThanOrEqual(LIMITS.minTokens);
		expect(CLASSIFIER_MAX_TOKENS).toBeLessThanOrEqual(LIMITS.maxTokens);
	});

	it('stays small enough to be a routing call rather than a second plan', () => {
		expect(CLASSIFIER_MAX_TOKENS).toBeLessThan(200);
	});

	it('sends a body that clears every cap in BodySchema', async () => {
		const fn = vi.fn(async () => new Response(JSON.stringify({ content: 'chat' }), { status: 200 }));
		vi.stubGlobal('fetch', fn);

		await chat(proxyConfig, buildClassifyFirstMessages('slept like 4 hrs', payloadOfSize(240)), {
			temperature: 0,
			maxTokens: CLASSIFIER_MAX_TOKENS,
			authToken: 'jwt'
		});

		const body = JSON.parse((fn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as Record<
			string,
			unknown
		>;
		assertProxyAccepts(body);
		expect(body['max_tokens']).toBe(CLASSIFIER_MAX_TOKENS);
	});

	it('sends a body that clears every cap on the full plan call too', async () => {
		const fn = vi.fn(async () => new Response(JSON.stringify({ content: '{}' }), { status: 200 }));
		vi.stubGlobal('fetch', fn);

		await chat(proxyConfig, buildOneShotMessages('slept like 4 hrs', payloadOfSize(240)), {
			temperature: 0.4,
			authToken: 'jwt'
		});

		const body = JSON.parse((fn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as Record<
			string,
			unknown
		>;
		assertProxyAccepts(body);
	});
});

describe('the message builders respect the per-message caps', () => {
	it('never exceeds the message count the proxy allows', () => {
		expect(buildClassifyFirstMessages('hi', payloadOfSize(240)).length).toBeLessThanOrEqual(LIMITS.maxMessages);
		expect(buildOneShotMessages('hi', payloadOfSize(240)).length).toBeLessThanOrEqual(LIMITS.maxMessages);
	});

	it('splits the one-shot prompt across messages instead of trimming the corpus', () => {
		// the prompt with its corpus inlined is over the proxy's per-message cap, so it goes out as
		// two system messages. That must be lossless: same text, same order, nothing dropped.
		const messages = buildOneShotMessages('slept like 4 hrs', payloadOfSize(240));
		const system = messages.filter((m) => m.role === 'system').map((m) => m.content);
		expect(system.length).toBeGreaterThan(1);
		expect(system.join('')).toBe(SYSTEM_ONESHOT_PROMPT);
		expect(system.join('')).toContain(MOM_VOICE);
		for (const content of system) expect(content.length).toBeLessThanOrEqual(LIMITS.maxContentChars);
	});

	it('never sends an empty content string, which zod rejects outright', () => {
		for (const messages of [buildClassifyFirstMessages('', payloadOfSize(0)), buildOneShotMessages(null, payloadOfSize(0))]) {
			for (const m of messages) expect(m.content.length).toBeGreaterThan(0);
		}
	});

	it('fits a full memory window and a fortnight of checkins inside the content cap', () => {
		// 20 messages at the app's own truncation limit, plus digests and history
		const content = buildOneShotMessages('slept like 4 hrs, skipped dinner', payloadOfSize(240)).at(-1)!.content;
		expect(content.length).toBeLessThanOrEqual(LIMITS.maxContentChars);
	});
});