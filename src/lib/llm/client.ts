import type { LLMConfig } from './config';
import { supportsReasoningEffort } from './capabilities';

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

/**
 * Latency accounting, off unless explicitly switched on.
 *
 * This exists because the performance work was guesswork until it was measured. The one-shot prompt
 * is 9,296 tokens and a 60-token control request returns in 1.0s, so roughly 3.6s of a 4.6s wait is
 * prefill — the model reading the system prompt before it can answer. Without the prompt_tokens
 * number in the response there is no way to tell that from "the model is slow", and the two lead to
 * completely different fixes.
 *
 * Enabled with VITE_LLM_TIMING=true. Silent otherwise, because a console line per note is noise in
 * a product console.
 */
function reportTiming(reqBody: Record<string, unknown>, resBody: unknown, elapsedMs: number): void {
	if (!import.meta.env?.VITE_LLM_TIMING) return;
	const usage = (resBody as { usage?: Record<string, unknown> } | null)?.usage ?? {};
	const messages = (reqBody['messages'] as { content: string }[] | undefined) ?? [];
	const promptChars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
	// NIM reports prompt_tokens; OpenAI-compatible hosts that cache prefixes also report
	// prompt_tokens_details.cached_tokens, which is the number that proves caching is working
	const details = usage['prompt_tokens_details'] as { cached_tokens?: number } | null | undefined;
	console.info(
		`[llm] ${elapsedMs}ms  prompt_chars=${promptChars}  prompt_tokens=${usage['prompt_tokens'] ?? '?'}` +
			`  cached=${details?.cached_tokens ?? 0}  completion=${usage['completion_tokens'] ?? '?'}`
	);
}

export async function chat(
	config: LLMConfig,
	messages: ChatMessage[],
	opts: { temperature?: number; timeoutMs?: number; maxTokens?: number; authToken?: string } = {}
): Promise<string> {
	// 0.5, and the number is a measured one rather than a taste. At 0.4 the model returned the same
	// greeting near-verbatim every time, because the corpus held one canonical "how are you" answer and
	// low sampling made it the only likely one. At 0.6 the repetition went away and so did the plans:
	// live eval fell from 7/8 to 5/8 valid, and — worse — the repair retry stopped rescuing the
	// failures, dropping from 8/8 to 5/8, which is what sends a student to the template planner.
	// The variance is bought by removing the corpus anchor and by the dedupe guard instead, which is
	// where it belongs; sampling stays low enough that a JSON envelope survives the first attempt.
	const { temperature = 0.5, authToken } = opts;
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
		// Passed through rather than pinned at the host. The hosted function used to hardcode 0.7,
		// which quietly overrode this client, and 0.7 with a 9k-token prompt is narrow enough to
		// reproduce the same line every turn. 0.95 keeps the tail of the distribution alive while
		// temperature still decides how far she wanders.
		top_p: 0.95,
		max_tokens: opts.maxTokens ?? config.maxTokens ?? 1200,
		stream: false
	};
	// Two conditions, both load-bearing.
	//
	// 'medium' is skipped on purpose: at that setting gpt-oss spends the entire token budget on
	// reasoning and returns no content (41s, finish_reason: length), which reads in the app as the
	// model being unreachable.
	//
	// And it is only sent to models that actually have the field. It is an OpenAI/gpt-oss extension;
	// Gemma has no such parameter, and an unsupported one is ignored at best and rejected at worst.
	// A rejection is invisible here — it reaches the student as "could not reach the model" on every
	// note, with a generic plan in place of the one they asked for.
	if (
		supportsReasoningEffort(config.model) &&
		config.reasoningEffort &&
		config.reasoningEffort !== 'medium'
	) {
		reqBody['reasoning_effort'] = config.reasoningEffort;
	}

	try {
		const started = Date.now();
		const res = await fetch(targetUrl(config), {
			method: 'POST',
			headers: authHeaders(config, authToken),
			signal: controller.signal,
			body: JSON.stringify(reqBody)
		});

		const resBody = await readBody(res);
		reportTiming(reqBody, resBody, Date.now() - started);

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