import type { LLMConfig } from './config';

export interface ChatMessage {
	role: string;
	content: string;
}

export class LLMError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
		public readonly detail?: string
	) {
		super(message);
	}
}

function targetUrl(config: LLMConfig): string {
	if (config.mode === 'proxy') return config.url;
	const base = config.url.replace(/\/$/, '');
	return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

function authHeaders(config: LLMConfig, authToken?: string): Record<string, string> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
	else if (config.mode === 'direct' && config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
	return headers;
}

function messageFromBody(body: unknown, fallback: string): string {
	if (body && typeof body === 'object') {
		const rec = body as Record<string, unknown>;
		for (const key of ['detail', 'error', 'message']) {
			const value = rec[key];
			if (typeof value === 'string' && value.trim()) return value.slice(0, 300);
		}
	}
	return fallback;
}

async function readBody(res: Response): Promise<unknown> {
	try {
		return await res.json();
	} catch {
		try {
			return await res.text();
		} catch {
			return null;
		}
	}
}

export async function chat(
	config: LLMConfig,
	messages: ChatMessage[],
	opts: { temperature?: number; timeoutMs?: number; maxTokens?: number; authToken?: string } = {}
): Promise<string> {
	const { temperature = 0.4, authToken } = opts;
	const timeoutMs = opts.timeoutMs ?? config.timeoutMs ?? 30000;
	if (config.mode === 'proxy' && !authToken) {
		throw new LLMError('hosted mode needs a signed-in account. sign in with email, or switch to local mode in settings.');
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	const reqBody: Record<string, unknown> = {
		model: config.model,
		messages,
		temperature,
		max_tokens: opts.maxTokens ?? config.maxTokens ?? 1200,
		stream: false
	};
	if (config.reasoningEffort && config.reasoningEffort !== 'medium') {
		reqBody['reasoning_effort'] = config.reasoningEffort;
	}

	try {
		const res = await fetch(targetUrl(config), {
			method: 'POST',
			headers: authHeaders(config, authToken),
			signal: controller.signal,
			body: JSON.stringify(reqBody)
		});

		const resBody = await readBody(res);

		if (!res.ok) {
			if (res.status === 401 || res.status === 403) {
				throw new LLMError(
					`hosted mode rejected this request (${res.status}). sign in again, or switch to local mode in settings.`,
					res.status
				);
			}
			const detail = messageFromBody(resBody, '');
			throw new LLMError(
				detail
					? `model call failed (${res.status}): ${detail}`
					: `model call failed (${res.status}) from ${targetUrl(config)}`,
				res.status,
				detail
			);
		}

		if (resBody && typeof resBody === 'object') {
			const rec = resBody as Record<string, unknown>;
			const choices = rec['choices'] as { message?: { content?: string } }[] | undefined;
			const openAiContent = choices?.[0]?.message?.content;
			if (typeof openAiContent === 'string' && openAiContent.trim()) return openAiContent;
			const flat = rec['content'];
			if (typeof flat === 'string' && flat.trim()) return flat;
		}

		throw new LLMError('model replied but no message content was found in the response', res.status);
	} catch (e) {
		if (e instanceof LLMError) throw e;
		if (e instanceof DOMException && e.name === 'AbortError') {
			throw new LLMError('the model took too long to answer and was cut off');
		}
		if (config.mode === 'direct' && /localhost|127\.0\.0\.1/.test(config.url)) {
			throw new LLMError(
				`could not reach Ollama at ${config.url}. is it running? start it with OLLAMA_ORIGINS=* ollama serve, then check connection in settings.`,
				undefined,
				e instanceof Error ? e.message : String(e)
			);
		}
		throw new LLMError(
			`network error talking to ${targetUrl(config)}: ${e instanceof Error ? e.message : String(e)}`
		);
	} finally {
		clearTimeout(timer);
	}
}

export interface ConnectionResult {
	ok: boolean;
	detail: string;
	status?: number;
}

export async function testConnection(config: LLMConfig, authToken?: string): Promise<ConnectionResult> {
	if (config.mode === 'proxy' && !authToken) {
		return { ok: false, detail: 'hosted mode needs a signed-in account first.' };
	}
	// The edge function answers GET on its own path with { ok: true }. There is no /health route,
	// so appending one turned a working deployment into a permanent 404 and made the in-app
	// connection test report failure for a proxy that was fine.
	const url =
		config.mode === 'proxy' ? config.url.replace(/\/$/, '') : `${config.url.replace(/\/$/, '')}/models`;
	try {
		const headers: Record<string, string> = {};
		if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
		else if (config.mode === 'direct' && config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
		const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
		if (res.ok) {
			return {
				ok: true,
				detail:
					config.mode === 'proxy'
						? `edge function reachable at ${config.url}. NIM calls are made server-side.`
						: `model server reachable at ${config.url}.`,
				status: res.status
			};
		}
		const body = await readBody(res);
		return {
			ok: false,
			status: res.status,
			detail:
				res.status === 401 || res.status === 403
					? `sign-in rejected (${res.status}). sign in again or switch to local mode.`
					: messageFromBody(body, `server returned ${res.status} at ${url}`)
		};
	} catch (e) {
		return {
			ok: false,
			detail:
				config.mode === 'direct' && /localhost|127\.0\.0\.1/.test(config.url)
					? `nothing answering at ${config.url}. start Ollama with OLLAMA_ORIGINS=* ollama serve.`
					: `network error: ${e instanceof Error ? e.message : String(e)}`
		};
	}
}