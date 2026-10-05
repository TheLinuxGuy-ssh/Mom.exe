import { afterEach, describe, expect, it, vi } from 'vitest';
import { chat, testConnection, LLMError } from './client';
import type { LLMConfig } from './config';

const proxyConfig: LLMConfig = {
	mode: 'proxy',
	url: 'https://project.supabase.co/functions/v1/plan',
	model: 'openai/gpt-oss-20b',
	apiKey: '',
	reasoningEffort: 'low',
	maxTokens: 1200,
	timeoutMs: 5000
};

const directConfig: LLMConfig = {
	mode: 'direct',
	url: 'http://localhost:11434/v1',
	model: 'llama3.1:8b',
	apiKey: '',
	reasoningEffort: 'low',
	maxTokens: 1200,
	timeoutMs: 5000
};

function mockFetch(response: Response | (() => Response)) {
	const fn = vi.fn(async (..._args: unknown[]) => (typeof response === 'function' ? response() : response));
	vi.stubGlobal('fetch', fn);
	return fn;
}

function callArgs(fn: ReturnType<typeof mockFetch>, index: number): [string, RequestInit] {
	const call = fn.mock.calls[index] as unknown as [string, RequestInit];
	return call;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('chat response contract', () => {
	it('reads an OpenAI-shaped response from direct mode', async () => {
		mockFetch(
			new Response(JSON.stringify({ choices: [{ message: { content: 'hello from ollama' } }] }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		const out = await chat(directConfig, [{ role: 'user', content: 'hi' }]);
		expect(out).toBe('hello from ollama');
	});

	it('reads the shape the supabase edge function returns', async () => {
		mockFetch(
			new Response(JSON.stringify({ content: 'hello from nim' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		const out = await chat(proxyConfig, [{ role: 'user', content: 'hi' }], { authToken: 'jwt' });
		expect(out).toBe('hello from nim');
	});

	it('posts to the bare function url in proxy mode', async () => {
		const fn = mockFetch(
			new Response(JSON.stringify({ content: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
		);
		await chat(proxyConfig, [{ role: 'user', content: 'hi' }], { authToken: 'jwt' });
		expect(callArgs(fn, 0)[0]).toBe(proxyConfig.url);
	});

	it('appends /chat/completions in direct mode', async () => {
		const fn = mockFetch(
			new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
		);
		await chat(directConfig, [{ role: 'user', content: 'hi' }]);
		expect(callArgs(fn, 0)[0]).toBe('http://localhost:11434/v1/chat/completions');
	});

	it('sends the bearer token for proxy calls', async () => {
		const fn = mockFetch(
			new Response(JSON.stringify({ content: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
		);
		await chat(proxyConfig, [{ role: 'user', content: 'hi' }], { authToken: 'jwt-123' });
		const init = callArgs(fn, 0)[1];
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-123');
	});
});

describe('failure surfaces', () => {
	it('explains that proxy mode needs a signed-in user', async () => {
		mockFetch(new Response('{}', { status: 200 }));
		await expect(chat(proxyConfig, [{ role: 'user', content: 'hi' }])).rejects.toThrow(/sign in/i);
	});

	it('surfaces the error body from the edge function', async () => {
		mockFetch(
			new Response(JSON.stringify({ error: 'model call failed', detail: 'invalid api key' }), {
				status: 502,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		await expect(
			chat(proxyConfig, [{ role: 'user', content: 'hi' }], { authToken: 'jwt' })
		).rejects.toThrow(/invalid api key/);
	});

	it('reports a 401 from the gateway as a sign-in problem', async () => {
		mockFetch(new Response(JSON.stringify({ message: 'JWT' }), { status: 401 }));
		const err = await chat(proxyConfig, [{ role: 'user', content: 'hi' }], { authToken: 'bad' }).catch(
			(e) => e as LLMError
		);
		expect(err).toBeInstanceOf(LLMError);
		expect(String(err)).toMatch(/401/);
	});

	it('explains a dead local ollama', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('fetch failed');
			})
		);
		await expect(chat(directConfig, [{ role: 'user', content: 'hi' }])).rejects.toThrow(/ollama|unreachable/i);
	});
});

describe('testConnection', () => {
	it('reports the status code and detail on failure', async () => {
		mockFetch(new Response(JSON.stringify({ error: 'model key missing' }), { status: 500 }));
		const res = await testConnection(proxyConfig, 'jwt');
		expect(res.ok).toBe(false);
		expect(res.detail).toMatch(/model key missing/);
	});

	it('succeeds against a live proxy health endpoint', async () => {
		mockFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
		const res = await testConnection(proxyConfig, 'jwt');
		expect(res.ok).toBe(true);
	});

	it('asks the function for its own path, since it has no /health route', async () => {
		// the function answers GET /plan with { ok: true }. Requesting /plan/health returns 404 on a
		// perfectly healthy deployment, which made this test always report failure.
		const fn = mockFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
		await testConnection(proxyConfig, 'jwt');
		expect(callArgs(fn, 0)[0]).toBe('https://project.supabase.co/functions/v1/plan');
	});
});