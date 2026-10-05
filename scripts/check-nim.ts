import { readFileSync } from 'node:fs';

function loadEnv(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const f of ['.env', '.env.local']) {
		try {
			for (const line of readFileSync(f, 'utf8').split('\n')) {
				const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
				if (m) out[m[1]] = m[2].trim();
			}
		} catch {
			continue;
		}
	}
	return out;
}

const env = { ...loadEnv(), ...process.env };
const KEY = env.NIM_API_KEY;
const MODEL = env.NIM_MODEL ?? env.VITE_NIM_MODEL ?? 'openai/gpt-oss-20b';
const URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

/**
 * Order matters: whatever VITE_NIM_MODEL is set to is tried first, so a deliberate switch needs no
 * edit here, and the rest are fallbacks if it is retired. Asking the provider what is actually live
 * beats trusting a list that was correct last week.
 *
 * Gemma was evaluated against this and is deliberately absent. `google/gemma-3-27b-it` and
 * `google/gemma-2-2b-it` return 410, retired; `google/gemma-3-12b-it`, `google/gemma-3-4b-it`,
 * `google/gemma-2-9b-it` and the Gemma 4 ids return 404 or hang. NVIDIA is not serving this account a
 * Gemma model, and local inference is not an option either: gemma-3-27b needs roughly 16GB and the
 * machine has no GPU and 7GB of RAM, so the 4B variant would run at a few tokens a second and put a
 * minute on every note. They are listed in the README rather than here, because a probe list full of
 * dead ids is just noise to read past.
 */
const CANDIDATES = [
	MODEL,
	'openai/gpt-oss-20b',
	'moonshotai/kimi-k3',
	'meta/llama-3.1-8b-instruct',
	'qwen/qwen3-8b'
];

async function probe(model: string): Promise<{ status: number; note: string }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 25000);
	try {
		const res = await fetch(URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${KEY ?? ''}`,
				'Content-Type': 'application/json'
			},
			signal: controller.signal,
			body: JSON.stringify({
				model,
				messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
				max_tokens: 400,
				temperature: 0
			})
		});
		const body = (await res.json().catch(() => null)) as
			| {
					choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[];
					detail?: string;
					error?: string;
			  }
			| null;
		const choice = body?.choices?.[0];
		const content = choice?.message?.content ?? '';
		const reasoning = choice?.message?.reasoning_content ?? '';
		const note = res.ok
			? `OK [finish=${choice?.finish_reason ?? '?'}] content=${JSON.stringify(content).slice(0, 50)}${
					reasoning ? ` reasoning=${reasoning.length}ch` : ''
				}`
			: String(body?.detail ?? body?.error ?? JSON.stringify(body)).slice(0, 110);
		return { status: res.status, note };
	} catch (e) {
		return { status: -1, note: e instanceof Error ? e.message : String(e) };
	} finally {
		clearTimeout(timer);
	}
}

async function main(): Promise<void> {
	console.log(`model under test: ${MODEL}`);
	if (!KEY) {
		console.log('NIM_API_KEY not found in .env or the environment. get one at https://build.nvidia.com\n');
	}

	const seen = new Set<string>();
	let working: string | null = null;
	for (const model of CANDIDATES) {
		if (seen.has(model)) continue;
		seen.add(model);
		const { status, note } = await probe(model);
		const label =
			status === 200 ? 'LIVE ' : status === 401 ? 'LIVE? (auth)' : status === 410 ? 'EOL  ' : status === 404 ? 'NOPE ' : 'DOWN ';
		console.log(`${label} [${String(status).padStart(4)}] ${model}  ${note}`);
		if (status === 200 && !working) working = model;
		if (working === model) break;
	}

	if (working && working !== MODEL) {
		console.log(`\nyour VITE_NIM_MODEL is ${MODEL}, which does not work with this key.`);
		console.log(`set it to the live one:  VITE_NIM_MODEL=${working}`);
	} else if (working) {
		console.log(`\nNIM is working end to end with ${working}.`);
		console.log('keep NIM_API_KEY as a Supabase edge-function secret, then: supabase functions deploy plan');
	} else {
		console.log('\nnone of the candidates returned 200 with this key. check that the key is active at https://build.nvidia.com');
	}
}

void main();