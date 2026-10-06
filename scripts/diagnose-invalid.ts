/**
 * Why is eval reporting INVALID? One call, with the provider's own diagnostics.
 *
 * Two very different things look identical in the eval table: a model that returned an envelope the
 * parser rejects, and a model that returned nothing at all because NVIDIA's free tier queued the
 * request long enough for the reasoning budget to be spent without reaching content. Only one of
 * those is a prompt problem.
 *
 *   npx tsx scripts/diagnose-invalid.ts
 */
import { PERSONAS } from '../dev-fixtures/personas';
import { buildOneShotMessages } from '../src/lib/llm/prompt';
import { parseOneShot } from '../src/lib/llm/generate';
import { buildContext, buildTodayInfo } from '../src/lib/engine/context';
import { computeStats } from '../src/lib/engine/stats';
import { resolveProvider } from './provider';

const provider = resolveProvider();
if (provider.name !== 'NVIDIA NIM') {
	throw new Error(`this diagnostic is a NIM test and must not be run against ${provider.name}`);
}

const built: any = (PERSONAS[1] as any).build('Asia/Kolkata');
const checkins = built.checkins.map((c: any, i: number) => ({
	...c,
	id: 'c' + i,
	user_id: 'u1',
	created_at: c.local_date + 'T08:00:00Z'
}));
const now = new Date('2026-10-03T22:30:00+05:30');
const today = buildTodayInfo(built.profile, checkins[checkins.length - 1], 'Asia/Kolkata');
const stats = computeStats(checkins, [], 'Asia/Kolkata', '2026-10-03');
const { payload } = buildContext(built.profile, checkins, [], today, now, null, {
	recent: [],
	older_digests: [],
	to_digest: []
});

(async () => {
	const messages = buildOneShotMessages(null, payload);
	const t0 = Date.now();
	const res = await fetch(provider.url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${provider.key}`,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: JSON.stringify({
			model: provider.model,
			messages,
			temperature: 0.5,
			top_p: 0.95,
			max_tokens: 1200,
			reasoning_effort: 'low',
			stream: false
		}),
		signal: AbortSignal.timeout(180_000)
	});
	const ms = Date.now() - t0;
	const body: any = await res.json();
	const choice = body?.choices?.[0];
	const content: string = choice?.message?.content ?? '';

	console.log(`http ${res.status}  ${(ms / 1000).toFixed(1)}s`);
	console.log(`finish_reason: ${choice?.finish_reason}`);
	console.log(`usage: ${JSON.stringify(body?.usage ?? null)}`);
	console.log(`content length: ${content.length}`);
	console.log(`reasoning length: ${(choice?.message?.reasoning_content ?? '').length}`);
	if (body?.error) console.log(`error: ${JSON.stringify(body.error).slice(0, 300)}`);
	console.log(`\ncontent head: ${content.slice(0, 300)}`);
	const parsed = parseOneShot(content);
	console.log(`\nparser issue : ${parsed.issue ?? 'none'}`);
	console.log(`parser plan  : ${parsed.plan ? 'present' : 'null'}`);
})();