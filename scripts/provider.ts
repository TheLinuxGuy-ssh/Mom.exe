/**
 * Where the dev scripts send their requests.
 *
 * Kept provider-neutral for the same reason the edge function is: the provider turned out to be a
 * latency decision rather than a feature one. These scripts exist to measure that, so they must be
 * able to point at whichever host is configured without being edited first.
 *
 *   MODEL_BASE_URL  overrides the endpoint
 *   NIM_API_KEY     NVIDIA key, and the provider these scripts default to
 *   MODEL_API_KEY   production key (Groq), used only when NIM_API_KEY is absent
 *
 * NIM wins when both are set, deliberately. These scripts are the test surface, and the agreed rule
 * is that testing runs on NIM while Groq is reserved for the deployed app. Preferring MODEL_API_KEY
 * would point every `npm run eval` at Groq the moment both keys existed in .env, so the scripts would
 * quietly stop being the free NIM check they were built to be.
 */
import { readFileSync } from 'node:fs';

const DEFAULTS: Record<string, string> = {
	'nim': 'https://integrate.api.nvidia.com/v1/chat/completions',
	'groq': 'https://api.groq.com/openai/v1/chat/completions'
};

export function loadEnv(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const f of ['.env', '.env.local']) {
		try {
			for (const line of readFileSync(f, 'utf8').split('\n')) {
				const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
				if (m) out[m[1]!] = m[2]!.trim();
			}
		} catch {
			continue;
		}
	}
	return { ...out, ...process.env };
}

export interface Provider {
	name: string;
	url: string;
	key: string;
	model: string;
}

/**
 * Resolve the provider from the environment.
 *
 * Infers the host from the key's shape when no URL is given, because a key is a strong signal of
 * where it belongs and asking someone to set both is one more way to get this wrong: Groq keys are
 * `gsk_`, NVIDIA's are `nvapi-`.
 */
export function resolveProvider(env: Record<string, string> = loadEnv()): Provider {
	const key = env.NIM_API_KEY ?? env.MODEL_API_KEY ?? '';
	const explicit = env.MODEL_BASE_URL;
	const inferred =
		key.startsWith('gsk_') ? DEFAULTS['groq']! :
		key.startsWith('nvapi-') ? DEFAULTS['nim']! :
		DEFAULTS['nim']!;
	const url = explicit ?? inferred;
	const name = url.includes('groq.com') ? 'Groq' : url.includes('nvidia.com') ? 'NVIDIA NIM' : 'custom';
	return {
		name,
		url,
		key,
		model: env.MODEL_ID ?? env.NIM_MODEL ?? env.VITE_MODEL_ID ?? 'openai/gpt-oss-20b'
	};
}
