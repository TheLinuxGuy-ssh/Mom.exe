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
	const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
	if (supabaseUrl) {
		return {
			mode: 'proxy',
			url: `${supabaseUrl}/functions/v1/plan`,
			model: import.meta.env.VITE_NIM_MODEL ?? 'openai/gpt-oss-20b',
			apiKey: '',
			reasoningEffort: 'low',
			maxTokens: 1200,
			timeoutMs: 30000
		};
	}
	return {
		mode: 'direct',
		url: 'http://localhost:11434/v1',
		model: 'llama3.1:8b',
		apiKey: '',
		reasoningEffort: 'low',
		maxTokens: 1200,
		timeoutMs: 45000
	};
}

export function getLLMConfig(): LLMConfig {
	try {
		const raw = localStorage.getItem(LS_KEY);
		if (raw) return { ...defaultLLMConfig(), ...(JSON.parse(raw) as Partial<LLMConfig>) };
	} catch {
		/* fall through to defaults */
	}
	return defaultLLMConfig();
}

export function setLLMConfig(cfg: LLMConfig): void {
	localStorage.setItem(LS_KEY, JSON.stringify(cfg));
}
