import { z } from 'https://esm.sh/zod@3';

/**
 * Mom.exe — the `plan` edge function.
 *
 * The browser cannot hold a model provider key, so it posts here instead and this function is the
 * only place the key exists. Three jobs, in order:
 *
 *   1. prove the caller is a signed-in user of this Supabase project
 *   2. validate the body with zod, because the app treats this URL as a hard contract
 *   3. forward to the provider and hand back only the content
 *
 * The zod caps are load-bearing, not decoration. They were exceeded twice before being pinned
 * here, and both times the failure surfaced as a bare 400 with no field named, which reads in the
 * app as the model being unreachable:
 *
 *   - max_tokens floor 64: the intent classifier asks for 64. It used to ask for 40.
 *   - content cap 24000: the one-shot prompt carries the whole dialogue corpus and is longer than
 *     that, so the app sends it split across several system messages rather than trimming it.
 *
 * Deploy:
 *   supabase secrets set MODEL_API_KEY=...   (NIM_API_KEY still accepted)
 *   supabase functions deploy plan
 *
 * GET on this exact path answers { ok: true }. There is no /health route, and Supabase's gateway
 * verifies a JWT before this code runs, so even the GET needs an Authorization header.
 */

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const BodySchema = z.object({
	model: z.string().max(120),
	messages: z
		.array(
			z.object({
				role: z.enum(['system', 'user', 'assistant']),
				content: z.string().min(1).max(24000)
			})
		)
		.min(1)
		.max(12),
	// 0.5 is measured, not guessed: 0.4 reproduced one canned reply for every student, and 0.6
	// cost plan validity (live eval 7/8 -> 5/8, with the repair retry no longer rescuing the rest).
	temperature: z.number().min(0).max(2).default(0.5),
	// Passed through instead of being pinned below. It used to be hardcoded to 0.7 here, which
	// silently overrode the client and narrowed sampling enough to bring back the same reply every
	// turn. The client is now the single place that decides how varied her voice is.
	top_p: z.number().min(0.1).max(1).optional(),
	reasoning_effort: z.enum(['low', 'medium', 'high']).optional(),
	max_tokens: z.number().int().min(64).max(4096).optional(),
	stream: z.literal(false).optional()
});

/**
 * Where the model call actually goes.
 *
 * Provider-neutral on purpose, because the provider became a latency question rather than a feature
 * one. Measured against NVIDIA NIM with the real 9,296-token prompt: a 60-token control request
 * took 1.0s and the full one took 4.6s, so roughly 3.6s of the wait is prefill — pushing the static
 * system prompt through the model before it writes a word. NIM caches no prefix (three identical
 * calls all reported 9,296 prompt tokens, with no speedup), so that prefill was paid in full every
 * time. Groq serves the same model under the same slug and caches static prefixes automatically, so
 * the same prompt is near-free after the first call.
 *
 * The host is inferred from the key's shape when MODEL_BASE_URL is not set, matching
 * `scripts/provider.ts`: Groq keys are `gsk_`, NVIDIA's are `nvapi-`. Without this, pointing the
 * function at Groq meant also setting a second secret, and getting it wrong sent a Groq key to
 * NVIDIA — which answered 401, surfaced to the browser as a 502 on every note.
 */
const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

function resolveBaseUrl(key: string): string {
	const explicit = Deno.env.get('MODEL_BASE_URL');
	if (explicit) return explicit;
	if (key.startsWith('gsk_')) return GROQ_URL;
	return NIM_URL;
}

/**
 * Whether this model accepts OpenAI-style `reasoning_effort`.
 *
 * A deliberate copy of `src/lib/llm/capabilities.ts`, which cannot be imported here because this
 * function runs on Deno with no access to the app's source tree. Kept tiny and obviously equivalent
 * for that reason: when it changes, change it in both places.
 */
function supportsReasoningEffort(model: string): boolean {
	return /^openai\/(?:gpt-oss|o[134])/i.test((model ?? '').trim());
}

Deno.serve(async (req) => {
	if (req.method === 'OPTIONS') {
		return new Response('ok', { headers: corsHeaders });
	}

	if (req.method === 'GET') {
		return Response.json({ ok: true }, { headers: corsHeaders });
	}

	const authHeader = req.headers.get('Authorization') ?? '';
	if (!authHeader.startsWith('Bearer ')) {
		return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders });
	}

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
	if (!supabaseUrl || !anonKey) {
		return Response.json({ error: 'server misconfigured' }, { status: 500, headers: corsHeaders });
	}

	const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
		headers: { Authorization: authHeader, apikey: anonKey }
	});
	if (!userRes.ok) {
		return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders });
	}

	// NIM_API_KEY kept as the fallback name so the existing deployment keeps working untouched.
	const modelKey = Deno.env.get('MODEL_API_KEY') ?? Deno.env.get('NIM_API_KEY');
	if (!modelKey) {
		return Response.json(
			{ error: 'model key missing. set MODEL_API_KEY (or NIM_API_KEY) as a function secret.' },
			{ status: 500, headers: corsHeaders }
		);
	}

	const parsed = BodySchema.safeParse(await req.json().catch(() => null));
	if (!parsed.success) {
		return Response.json({ error: 'invalid payload' }, { status: 400, headers: corsHeaders });
	}

	const { model, messages, temperature, top_p, reasoning_effort, max_tokens } = parsed.data;

	const modelRes = await fetch(resolveBaseUrl(modelKey), {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${modelKey}`,
			'Content-Type': 'application/json',
			Accept: 'application/json',
			// Groq reads these for attribution; harmless and ignored elsewhere.
			...(Deno.env.get('MODEL_REFERER') ? { 'HTTP-Referer': Deno.env.get('MODEL_REFERER')! } : {}),
			...(Deno.env.get('MODEL_TITLE') ? { 'X-Title': Deno.env.get('MODEL_TITLE')! } : {})
		},
		body: JSON.stringify({
			model,
			messages,
			temperature,
			top_p: top_p ?? 0.95,
			max_tokens: max_tokens ?? 1200,
			stream: false,
			// Only for models that have the field. It is an OpenAI/gpt-oss extension; Gemma has no
			// such parameter, and sending an unsupported one is rejected at worst. A rejection here
			// comes back as a 502 to the browser, which the app reports as "could not reach the
			// model" on every note — so the gate lives here as well as in the client, because this
			// function is the only thing that actually talks to the provider in hosted mode.
			...(supportsReasoningEffort(model) && reasoning_effort && reasoning_effort !== 'medium'
				? { reasoning_effort }
				: {})
		})
	});

	if (!modelRes.ok) {
		const detail = await modelRes.text();
		// Name the host and status. A 401/403 here almost always means the key was sent to the
		// wrong provider, which is invisible otherwise: the app just reports "could not reach the
		// model" on every note.
		const host = resolveBaseUrl(modelKey).includes('groq.com') ? 'Groq' : 'NVIDIA NIM';
		console.error('model call failed', { host, status: modelRes.status, detail: detail.slice(0, 300) });
		return Response.json(
			{ error: `model call failed (${host} ${modelRes.status})`, detail: detail.slice(0, 500) },
			{ status: 502, headers: corsHeaders }
		);
	}

	const data = await modelRes.json();
	const content = data?.choices?.[0]?.message?.content ?? '';
	return Response.json({ content }, { headers: corsHeaders });
});