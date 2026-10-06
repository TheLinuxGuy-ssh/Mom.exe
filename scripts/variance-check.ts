/**
 * Sends the same greeting three times and shows the three replies.
 *
 * The original complaint was not that a reply was wrong. It was that "how are you?" came back as the
 * same sentence every time, so this measures the only thing that matters for it: are these different.
 * Each send carries an empty conversation, which is the worst case for the guard — there is no
 * earlier line of hers to compare against, so anything repeated here is the model itself, not the
 * retry.
 *
 *   npx tsx scripts/variance-check.ts
 *
 * NIM only. Tests do not run on Groq.
 *
 * Pass a note to check a different one: npx tsx scripts/variance-check.ts "your note here"
 */
import { PERSONAS } from '../dev-fixtures/personas';
import { generateFromNote } from '../src/lib/llm/generate';
import { buildContext, buildTodayInfo } from '../src/lib/engine/context';
import { computeStats } from '../src/lib/engine/stats';
import { resolveProvider } from './provider';

const provider = resolveProvider();
if (provider.name !== 'NVIDIA NIM') {
	throw new Error(`this check is a NIM test and must not be run against ${provider.name}`);
}

const config = {
	mode: 'direct' as const,
	url: provider.url,
	model: provider.model,
	apiKey: provider.key,
	reasoningEffort: 'low' as const,
	maxTokens: 1200,
	timeoutMs: 120_000
};

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

const bare = (s: string) =>
	s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

const ASK = process.argv[2] ?? 'hey ma how are you?';

(async () => {
	console.log(`provider: ${provider.name}  model: ${provider.model}`);
	console.log(`sending the same note ${3} times with an empty conversation each time\n`);
	console.log(`note: ${ASK}\n`);

	const replies: string[] = [];
	for (let i = 1; i <= 3; i++) {
		const t0 = Date.now();
		const r = await generateFromNote(
			{ note: ASK, context: payload, profile: built.profile, stats, today },
			config
		);
		const ms = Date.now() - t0;
		const advice = (r.advice ?? '').trim() || '(nothing)';
		replies.push(advice);
		console.log(`${i}. [${r.intent}, ${(ms / 1000).toFixed(1)}s] ${advice}`);
	}

	const distinct = new Set(replies.map(bare));
	console.log();
	console.log(`${distinct.size}/${replies.length} distinct`);

	// the line that used to come back every time, in any casing or punctuation
	const stock = replies.filter((r) => bare(r).includes('texting at this hour'));
	console.log(`the old stock line appeared in ${stock.length}/${replies.length}`);
	console.log(distinct.size === replies.length ? 'PASS' : 'SOME REPEATED — the guard cannot help with an empty history');
})();
