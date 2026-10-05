import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateFromNote, isContentFree } from './generate';
import { buildClassifyFirstMessages, buildOneShotMessages, MOM_VOICE, SYSTEM_ONESHOT_PROMPT } from './prompt';
import type { LLMConfig } from './config';
import type { ContextPayload } from '../engine/context';
import type { Profile } from '../storage/types';
import { computeStats } from '../engine/stats';
import { nowMinutesInTz } from '../engine/time';

/**
 * The real thing, end to end, against the real request path.
 *
 * The app cannot call NIM from a test, so this stands up a local server that enforces the same
 * zod contract as the deployed Supabase function, then drives `generateFromNote` through it. If a
 * request would be rejected in production it is rejected here, with the same status and body, and
 * the test fails. That is the whole point: the failures that cost us most were silent ones, where
 * the request was quietly refused and the app answered from its fallback instead.
 */

const TZ = 'Asia/Kolkata';
const TODAY = '2026-10-04';

/** mirrors BodySchema in supabase edge function `plan` */
const CAPS = { content: 24000, messages: 12, minTokens: 64, maxTokens: 4096, model: 120 } as const;

type Captured = { path: string; body: Record<string, unknown> };

const captured: Captured[] = [];
let server: Server;
let baseUrl = '';

/** what the model "says" back for the router call and for the full call */
let routerSays = '{"intent":"chat"}';
let modelSays = '{}';
/** set to make the upstream NIM call fail, the way a retired model id would */
let nimFails = false;

function validate(body: Record<string, unknown>): string | null {
	const model = body['model'];
	if (typeof model !== 'string' || !model.length || model.length > CAPS.model) return 'invalid payload';
	const messages = body['messages'];
	if (!Array.isArray(messages) || messages.length < 1 || messages.length > CAPS.messages) {
		return 'invalid payload';
	}
	for (const m of messages as { role: string; content: string }[]) {
		if (!['system', 'user', 'assistant'].includes(m.role)) return 'invalid payload';
		if (typeof m.content !== 'string' || m.content.length < 1 || m.content.length > CAPS.content) {
			return 'invalid payload';
		}
	}
	const temp = body['temperature'];
	if (typeof temp !== 'number' || temp < 0 || temp > 2) return 'invalid payload';
	if (body['max_tokens'] !== undefined) {
		const t = body['max_tokens'] as number;
		if (!Number.isInteger(t) || t < CAPS.minTokens || t > CAPS.maxTokens) return 'invalid payload';
	}
	if (body['stream'] !== undefined && body['stream'] !== false) return 'invalid payload';
	return null;
}

beforeAll(async () => {
	server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => {
			const send = (status: number, payload: unknown): void => {
				res.writeHead(status, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(payload));
			};

			// mirrors the deployed function's auth gate
			const auth = req.headers.authorization ?? '';
			if (!auth.startsWith('Bearer ')) return send(401, { error: 'unauthorized' });
			if (req.method === 'GET') return send(200, { ok: true });

			let body: Record<string, unknown>;
			try {
				body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
			} catch {
				return send(400, { error: 'invalid payload' });
			}
			captured.push({ path: req.url ?? '', body });

			const problem = validate(body);
			if (problem) return send(400, { error: problem });

			if (nimFails) return send(502, { error: 'model call failed', detail: 'model is retired' });

			const messages = body['messages'] as { role: string; content: string }[];
			const isRouterCall = messages.length === 2 && messages[0].content.length < 2000;
			return send(200, { content: isRouterCall ? routerSays : modelSays });
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/functions/v1/plan`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

function config(): LLMConfig {
	return {
		mode: 'proxy',
		url: baseUrl,
		model: 'openai/gpt-oss-20b',
		apiKey: '',
		reasoningEffort: 'low',
		maxTokens: 1200,
		timeoutMs: 15000
	};
}

function payload(): ContextPayload {
	return {
		as_of_local: `${TODAY}T21:00`,
		day_of_week: 'Sunday',
		timezone: TZ,
		nickname: 'beta',
		prior_plan: null,
		today: todayInfo(),
		conversation: { recent: [], older_digests: [], to_digest: [] },
		recent_days: []
	} as unknown as ContextPayload;
}

const profile = {
	id: 'u1',
	display_name: 'beta',
	birth_year: 2007,
	height_cm: null,
	weight_kg: null,
	class_start: '09:00',
	target_bed: '23:30',
	target_wake: '07:30',
	chronotype: 'night',
	roommates: 'shared_noisy',
	mess: { breakfast: '08:00', lunch: '13:00', dinner: '20:00' },
	diet_pref: 'veg',
	allergies: [],
	caffeine: 'low',
	timezone: TZ,
	created_at: `${TODAY}T00:00:00.000Z`
} satisfies Profile;

const stats = computeStats([], [], TZ, TODAY);

function todayInfo() {
	return {
		classes: [{ start: '09:00', end: '10:30' }],
		deadline_notes: null,
		sleep_so_far_hours: 4,
		meals_so_far: { b: true, l: true, s: null, d: null },
		caffeine_last_at: '15:00'
	};
}

const CHAT_REPLY = JSON.stringify({
	intent: 'chat',
	understanding: null,
	advice: 'eat something before you sleep, and tell me how the lab went.',
	plan: null,
	handoff: null,
	digest: []
});

const PLAN_REPLY = JSON.stringify({
	intent: 'plan',
	understanding: null,
	advice: null,
	plan: {
		summary: 'eat, then wind down, then bed.',
		blocks: [
			{ start: '21:00', end: '21:30', action: 'snack', detail: 'eat something small', why: '' },
			{ start: '22:30', end: '23:00', action: 'wind_down', detail: 'screens off', why: '' },
			{ start: '23:00', end: '23:30', action: 'sleep', detail: 'go to bed', why: '' }
		],
		flags: []
	},
	handoff: null,
	digest: []
});

describe('the app and the edge function actually agree', () => {
	it('never sends anything the proxy would reject, for a chat note', async () => {
		captured.length = 0;
		modelSays = CHAT_REPLY;
		nimFails = false;

		await generateFromNote(
			{ note: 'slept 4 hrs, lab was brutal', context: payload(), profile, stats, today: todayInfo(), authToken: 'jwt' },
			config()
		);

		expect(captured.length).toBeGreaterThan(0);
		for (const call of captured) expect(validate(call.body)).toBeNull();
		expect(captured.some((c) => c.body['max_tokens'] === 1200)).toBe(true);
	});

	it('never sends anything the proxy would reject, for an empty note that needs a plan', async () => {
		captured.length = 0;
		modelSays = PLAN_REPLY;
		nimFails = false;

		await generateFromNote({ note: null, context: payload(), profile, stats, today: todayInfo(), authToken: 'jwt' }, config());

		expect(captured.length).toBeGreaterThan(0);
		for (const call of captured) expect(validate(call.body)).toBeNull();
	});

	it('generates the answer from the full prompt, not the router prompt', async () => {
		captured.length = 0;
		modelSays = CHAT_REPLY;
		nimFails = false;

		await generateFromNote({ note: 'slept 4 hrs', context: payload(), profile, stats, today: todayInfo(), authToken: 'jwt' }, config());

		const main = captured.find((c) => (c.body['messages'] as unknown[]).length > 2);
		expect(main, 'expected a call carrying the whole one-shot prompt').toBeDefined();
		const messages = main!.body['messages'] as { role: string; content: string }[];
		// only the system messages carry the prompt; the last one is the note and context payload
		const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('');
		expect(system).toBe(SYSTEM_ONESHOT_PROMPT);
		expect(system).toContain(MOM_VOICE);
		expect(messages.at(-1)?.role).toBe('user');
		expect(messages.at(-1)?.content).toContain('slept 4 hrs');
	});

	it('routes with a separate short call that the proxy accepts', async () => {
		captured.length = 0;
		routerSays = '{"intent":"chat"}';
		modelSays = CHAT_REPLY;

		await generateFromNote({ note: 'slept 4 hrs', context: payload(), profile, stats, today: todayInfo(), authToken: 'jwt' }, config());

		const router = captured.find((c) => (c.body['messages'] as unknown[]).length === 2);
		expect(router).toBeDefined();
		expect(router!.body['max_tokens']).toBeGreaterThanOrEqual(CAPS.minTokens);
		const messages = router!.body['messages'] as { role: string; content: string }[];
		expect(messages).toEqual(buildClassifyFirstMessages('slept 4 hrs', payload()));
	});

	it('returns a real chat reply rather than falling back', async () => {
		routerSays = '{"intent":"chat"}';
		modelSays = CHAT_REPLY;
		nimFails = false;

		const res = await generateFromNote(
			{ note: 'slept 4 hrs', context: payload(), profile, stats, today: todayInfo(), authToken: 'jwt' },
			config()
		);

		expect(res.usedTemplate).toBe(false);
		expect(res.fallbackReason).toBeUndefined();
		expect(res.model_id).toBe('openai/gpt-oss-20b');
		expect(res.intent).toBe('chat');
		expect(res.advice).toMatch(/eat something/i);
	});

	it('returns a real plan rather than falling back', async () => {
		routerSays = '{"intent":"plan"}';
		modelSays = PLAN_REPLY;
		nimFails = false;

		const res = await generateFromNote({ note: null, context: payload(), profile, stats, today: todayInfo(), authToken: 'jwt' }, config());

		expect(res.usedTemplate).toBe(false);
		expect(res.intent).toBe('plan');
		expect(res.output?.blocks.length).toBe(3);
	});

	it('skips the routing call when the caller already knows the intent', async () => {
		captured.length = 0;
		routerSays = '{"intent":"plan"}';
		modelSays = CHAT_REPLY;

		await generateFromNote(
			{
				note: 'slept 4 hrs',
				context: payload(),
				profile,
				stats,
				today: todayInfo(),
				authToken: 'jwt',
				preclassified: true
			},
			config()
		);

		expect(captured).toHaveLength(1);
		expect((captured[0].body['messages'] as unknown[]).length).toBeGreaterThan(2);
	});
});

describe('an explicit request to change the plan', () => {
	const SHIFT_NOTE = 'i cant study at 8:30 because i have to hang out with my friends a bit, could you shift it';

	it('reaches a plan even when both models insist it is a conversation', async () => {
		// the exact failure: the classifier called it chat, and the model called it chat. She was
		// asked to move a block, so the answer has to be a day with that block moved.
		routerSays = '{"intent":"chat"}';
		modelSays = JSON.stringify({
			intent: 'chat',
			understanding: null,
			advice: 'that sounds like fun. have a good time.',
			plan: null,
			handoff: null,
			digest: []
		});
		nimFails = false;
		captured.length = 0;

		const res = await generateFromNote(
			{ note: SHIFT_NOTE, context: payload(), profile, stats, today: todayInfo(), authToken: 'jwt' },
			config()
		);

		expect(res.intent).toBe('plan');
		// no point routing a note we already know the answer for
		expect(captured.every((c) => (c.body['messages'] as unknown[]).length > 2)).toBe(true);
	});

	it('does not spend a routing call on it at all', async () => {
		routerSays = '{"intent":"plan"}';
		modelSays = PLAN_REPLY;
		captured.length = 0;

		await generateFromNote(
			{ note: SHIFT_NOTE, context: payload(), profile, stats, today: todayInfo(), authToken: 'jwt' },
			config()
		);

		expect(captured).toHaveLength(1);
	});

	it('still returns a real plan rather than falling back', async () => {
		routerSays = '{"intent":"plan"}';
		modelSays = PLAN_REPLY;

		const res = await generateFromNote(
			{ note: SHIFT_NOTE, context: payload(), profile, stats, today: todayInfo(), authToken: 'jwt' },
			config()
		);

		expect(res.usedTemplate).toBe(false);
		expect(res.output?.blocks.length).toBe(3);
	});

	it('leaves ordinary venting as a conversation', async () => {
		// the guard is only worth having if it stays narrow
		routerSays = '{"intent":"chat"}';
		modelSays = CHAT_REPLY;

		const res = await generateFromNote(
			{ note: 'today was awful, i had a fight with my roommate', context: payload(), profile, stats, today: todayInfo(), authToken: 'jwt' },
			config()
		);

		expect(res.intent).toBe('chat');
		expect(res.output).toBeNull();
	});

	it('falls back to a working plan if the model is unreachable, not to a chat', async () => {
		nimFails = true;
		const res = await generateFromNote(
			{ note: SHIFT_NOTE, context: payload(), profile, stats, today: todayInfo(), authToken: 'jwt' },
			config()
		);
		nimFails = false;

		expect(res.intent).toBe('plan');
		expect(res.usedTemplate).toBe(true);
		expect(res.output).not.toBeNull();
	});
});

describe('talking about a day that is already planned', () => {
	/**
	 * The plan on screen said study till 00:00, wind down 00:00-00:30, sleep from 00:30. Her reply
	 * said "keep coding, then wind down, sleep by 23:30": the standing target bedtime rather than
	 * tonight's plan, and an activity that was not in the plan at all. Both were on screen at once,
	 * which reads as her not knowing what she had just planned.
	 */
	const PLANNED: ContextPayload = {
		...payload(),
		prior_plan: {
			as_of: '2026-10-04T20:49:00.000Z',
			blocks: [
				{ start: '20:49', end: '00:00', action: 'study_block', status: 'in_progress' },
				{ start: '00:00', end: '00:30', action: 'wind_down', status: 'unknown' },
				{ start: '00:30', end: '07:00', action: 'sleep', status: 'unknown' }
			]
		}
	} as ContextPayload;

	it('drops the sentence that names a bedtime the plan does not contain', async () => {
		routerSays = '{"intent":"chat"}';
		modelSays = JSON.stringify({
			intent: 'chat',
			understanding: null,
			advice: 'you have got this. keep coding, then wind down, sleep by 23:30.',
			plan: null,
			handoff: null,
			digest: []
		});

		const res = await generateFromNote(
			{ note: 'thinking of studying then sleeping, as you know from the schedule', context: PLANNED, profile, stats, today: todayInfo(), authToken: 'jwt' },
			config()
		);

		expect(res.intent).toBe('chat');
		expect(res.advice).toBe('you have got this.');
		expect(res.advice).not.toMatch(/23:30/);
	});

	it('keeps a reply that agrees with the plan exactly as written', async () => {
		routerSays = '{"intent":"chat"}';
		modelSays = JSON.stringify({
			intent: 'chat',
			understanding: null,
			advice: 'finish the study block at midnight, wind down, then sleep at 00:30.',
			plan: null,
			handoff: null,
			digest: []
		});

		const res = await generateFromNote(
			{ note: 'on track, studying then sleeping', context: PLANNED, profile, stats, today: todayInfo(), authToken: 'jwt' },
			config()
		);

		expect(res.advice).toBe('finish the study block at midnight, wind down, then sleep at 00:30.');
	});

	it('says nothing rather than say something wrong', async () => {
		routerSays = '{"intent":"chat"}';
		modelSays = JSON.stringify({
			intent: 'chat',
			understanding: null,
			advice: 'sleep by 23:30.',
			plan: null,
			handoff: null,
			digest: []
		});

		const res = await generateFromNote(
			{ note: 'when should i sleep', context: PLANNED, profile, stats, today: todayInfo(), authToken: 'jwt' },
			config()
		);

		expect(res.advice).toBeNull();
	});

	it('leaves a reply alone on a day with no plan to contradict', async () => {
		routerSays = '{"intent":"chat"}';
		const advice = 'sleep by 23:30, and get up at 7.';
		modelSays = JSON.stringify({
			intent: 'chat',
			understanding: null,
			advice,
			plan: null,
			handoff: null,
			digest: []
		});

		const res = await generateFromNote(
			{ note: 'when should i sleep', context: payload(), profile, stats, today: todayInfo(), authToken: 'jwt' },
			config()
		);

		expect(res.advice).toBe(advice);
	});
});

describe('when the proxy or the model refuses, the app says so', () => {
	it('falls back to a real plan and records the upstream error when NIM fails', async () => {
		nimFails = true;
		const res = await generateFromNote({ note: null, context: payload(), profile, stats, today: todayInfo(), authToken: 'jwt' }, config());
		nimFails = false;

		expect(res.usedTemplate).toBe(true);
		expect(res.model_id).toBe('template');
		expect(res.fallbackReason).toMatch(/502|model call failed/i);

		// and it still returns a usable plan rather than nothing. Asserted by shape, not by exact
		// equality: the deterministic planner's contents are allowed to improve, and a test that
		// pins every block makes that impossible without looking like a change nobody asked for.
		const blocks = res.output?.blocks ?? [];
		expect(blocks.length).toBeGreaterThanOrEqual(3);
		expect(blocks.map((b) => b.action)).toContain('sleep');
		const last = blocks[blocks.length - 1]!;
		expect(last.action).toBe('sleep');
		for (const b of blocks) {
			const [sh, sm] = b.start.split(':').map(Number);
			const [eh, em] = b.end.split(':').map(Number);
			const start = sh * 60 + sm;
			let end = eh * 60 + em;
			if (end <= start) end += 1440;
			const now = nowMinutesInTz(TZ, new Date(`${TODAY}T21:00:00`));
			const relStart = start >= now ? start : start + 1440;
			expect(relStart, `${b.action} ${b.start} predates now`).toBeGreaterThanOrEqual(now);
		}
	});

	it('never reaches the model without a token, in proxy mode', async () => {
		captured.length = 0;
		const res = await generateFromNote({ note: 'hi', context: payload(), profile, stats, today: todayInfo() }, config());
		expect(res.usedTemplate).toBe(true);
		expect(captured).toHaveLength(0);
	});

	it('is honest about what the fallback path is for', () => {
		expect(isContentFree('slept 4 hrs, lab was brutal')).toBe(false);
		expect(isContentFree(null)).toBe(true);
	});
});