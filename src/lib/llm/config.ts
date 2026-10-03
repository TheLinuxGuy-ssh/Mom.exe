export interface LLMConfig {
	mode: 'proxy' | 'direct';
	url: string;
	model: string;
	apiKey: string;
	reasoningEffort: 'low' | 'medium' | 'high';
	maxTokens: number;
	timeoutMs: number;
}

const LS_KEY = 'momexe:llm-config';

export function defaultLLMConfig(): LLMConfig {
	const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
	return {
		mode: 'proxy',
		url: supabaseUrl ? `${supabaseUrl}/functions/v1/plan` : '',
		model: import.meta.env.VITE_NIM_MODEL ?? 'openai/gpt-oss-20b',
		apiKey: '',
		reasoningEffort: 'low',
		maxTokens: 1200,
		timeoutMs: 30000
	};
}

export function getLLMConfig(): LLMConfig {
	try {
		const raw = localStorage.getItem(LS_KEY);
		// `mode` is pinned to 'proxy'. Settings no longer offers a local/direct choice, so a
		// stale stored 'direct' must not keep silently bypassing the hosted proxy.
		if (raw) return { ...defaultLLMConfig(), ...(JSON.parse(raw) as Partial<LLMConfig>), mode: 'proxy' };
	} catch {
		/* fall through to defaults */
	}
	return defaultLLMConfig();
}

export function setLLMConfig(cfg: LLMConfig): void {
	localStorage.setItem(LS_KEY, JSON.stringify(cfg));
}
