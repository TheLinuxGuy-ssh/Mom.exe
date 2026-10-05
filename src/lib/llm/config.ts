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
		timeoutMs: 30000
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
