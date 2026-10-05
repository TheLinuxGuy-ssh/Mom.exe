export interface LLMConfig {
	mode: 'proxy' | 'direct';
	url: string;
	model: string;
	apiKey: string;
	reasoningEffort: 'low' | 'medium' | 'high';
	maxTokens: number;
	timeoutMs: number;
}

export function defaultLLMConfig(): LLMConfig {
	// `import.meta.env` is defined by Vite and undefined under plain node, so the dev scripts in
	// `scripts/` could not call this without a TypeError before they got as far as testing anything
	const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL ?? '';
	return {
		mode: 'proxy',
		url: supabaseUrl ? `${supabaseUrl}/functions/v1/plan` : '',
		model: import.meta.env?.VITE_NIM_MODEL ?? 'openai/gpt-oss-20b',
		apiKey: '',
		reasoningEffort: 'low',
		maxTokens: 1200,
		/*
		 * 60s, not 30s, and the margin is not theoretical. gpt-oss is a reasoning model and its
		 * latency on this prompt is bimodal: measured repeatedly against NIM with the real 35k
		 * character one-shot payload, most calls land at 3-6s and the slowest observed was 21s. A
		 * 30s budget therefore had almost no headroom over the tail, and every call in that tail
		 * failed with "could not reach the model" even though the model was answering perfectly
		 * well 200ms later.
		 *
		 * The cost of being generous is small and bounded: the app degrades to the deterministic code
		 * planner if the model is genuinely gone, and the composer already tells the student that
		 * hosted models take 10-25s to think. A few seconds of extra waiting on the rare slow call
		 * beats throwing away a good answer.
		 */
		timeoutMs: 60000
	};
}

/**
 * The endpoint is the hosted proxy, always.
 *
 * The model and the key stay on the server: the browser only ever posts a note and receives a plan,
 * so there is nothing here worth storing and nothing that should be able to point the app at a
 * different backend. Settings no longer offers a direct connection either.
 */
export function getLLMConfig(): LLMConfig {
	return defaultLLMConfig();
}
