import { z } from 'https://esm.sh/zod@3';

/**
 * Mom.exe — the `plan` edge function.
 *
 * The browser cannot hold an NVIDIA NIM key, so it posts here instead and this function is the
 * only place the key exists. Three jobs, in order:
 *
 *   1. prove the caller is a signed-in user of this Supabase project
 *   2. validate the body with zod, because the app treats this URL as a hard contract
 *   3. forward to NIM and hand back only the content
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
 *   supabase secrets set NIM_API_KEY=nvapi-...
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
	temperature: z.number().min(0).max(2).default(0.4),
	reasoning_effort: z.enum(['low', 'medium', 'high']).optional(),
	max_tokens: z.number().int().min(64).max(4096).optional(),
	stream: z.literal(false).optional()
});

const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

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

	const nimKey = Deno.env.get('NIM_API_KEY');
	if (!nimKey) {
		return Response.json({ error: 'model key missing' }, { status: 500, headers: corsHeaders });
	}

	const parsed = BodySchema.safeParse(await req.json().catch(() => null));
	if (!parsed.success) {
		return Response.json({ error: 'invalid payload' }, { status: 400, headers: corsHeaders });
	}

	const { model, messages, temperature, reasoning_effort, max_tokens } = parsed.data;

	const nimRes = await fetch(NIM_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${nimKey}`,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: JSON.stringify({
			model,
			messages,
			temperature,
			top_p: 0.7,
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

	if (!nimRes.ok) {
		const detail = await nimRes.text();
		return Response.json(
			{ error: 'model call failed', detail: detail.slice(0, 500) },
			{ status: 502, headers: corsHeaders }
		);
	}

	const data = await nimRes.json();
	const content = data?.choices?.[0]?.message?.content ?? '';
	return Response.json({ content }, { headers: corsHeaders });
});