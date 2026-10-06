/**
 * The user's report, verbatim, driven through the real pipeline.
 *
 * "just alive somehow, im thinking of studying since i have my maths exam tomorrow. any tip?"
 * came back as flawless, motherless advice: review the shaky chapters, try a practice set, keep
 * water nearby. The register test at the bottom is deliberately crude — it is not a judgement about
 * quality, only a smoke detector. Whether she actually sounds like a mum is for the user to read.
 *
 *   npx tsx scripts/replay-voice-report.ts
 *
 * NIM only. Tests do not run on Groq.
 */
import { PERSONAS } from '../dev-fixtures/personas';
import { generateFromNote } from '../src/lib/llm/generate';
import { buildContext, buildTodayInfo } from '../src/lib/engine/context';
import { computeStats } from '../src/lib/engine/stats';
import { toContextWindow } from '../src/lib/engine/memory';
import { resolveProvider } from './provider';

const provider = resolveProvider();
if (provider.name !== 'NVIDIA NIM') {
	throw new Error(`this replay is a NIM test and must not be run against ${provider.name}`);
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

const TRANSCRIPT: string[] = [
	'hey mom! how are you?',
	'just alive somehow, im thinking of studying since i have my maths exam tomorrow. any tip?'
];

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

const history: { role: 'user' | 'mom'; content: string }[] = [];

function contextFor() {
	const { payload } = buildContext(built.profile, checkins, [], today, now, null, {
		recent: toContextWindow(
			// newest first, which is what toContextWindow is built against. Handing it chronological
			// order flips the window and the model answers whichever turn it thinks came first.
			[...history]
				.reverse()
				.map((h, n) => ({
					...h,
					id: 'm' + n,
					user_id: 'u1',
					local_date: '2026-10-03',
					kind: 'chat' as const,
					created_at: now.toISOString(),
					session_id: null
				})) as never,
			20
		),
		older_digests: [],
		to_digest: []
	});
	return payload;
}

/**
 * A crude smoke detector, not a quality score.
 *
 * Each marker is something she uses constantly and a study coach never does. A reply can pass every
 * one of these and still be bland; it exists so that a total collapse of register is visible in a log
 * without anyone having to judge it.
 */
const MARKERS: [string, RegExp][] = [
	['taunt', /\b(bold|we both know|drawer|obviously|sure you did|oh, so)\b/i],
	['possessive', /\b(you|your|the phone|laptop|beta|love)\b/i],
	['verdict', /^(k\.|fine\.|hmm\.|oh,)/i],
	['imperative', /\b(go\.|eat\.|sleep\.|drink\.|close it|bag it|do it)\b/i],
	['dry openers', /^(ha|scoff|k\.|oh)\b/i]
];

const ASSISTANT_MARKERS =
	/\b(let me know|i understand how you feel|it sounds like|great question|here are some tips|feel free|would you like|i can help|keep a glass of water so you)\b/i;

(async () => {
	console.log(`provider: ${provider.name}  model: ${provider.model}\n`);

	const replies: string[] = [];
	let withMove = 0;
	let assistantish = 0;

	for (const [i, note] of TRANSCRIPT.entries()) {
		const t0 = Date.now();
		const r = await generateFromNote(
			{ note, context: contextFor(), profile: built.profile, stats, today },
			config
		);
		const ms = Date.now() - t0;
		const advice = (r.advice ?? '').trim() || '(nothing)';
		replies.push(advice);

		const hits = MARKERS.filter(([, re]) => re.test(advice)).map(([n]) => n);
		if (hits.length > 0) withMove++;
		const bad = ASSISTANT_MARKERS.test(advice);
		if (bad) assistantish++;

		console.log(`turn ${i + 1}  ${note}`);
		console.log(`        [${r.intent}, ${(ms / 1000).toFixed(1)}s] ${advice}`);
		console.log(`        moves: ${hits.length ? hits.join(', ') : 'NONE — information only'}`);
		if (bad) console.log(`        !! assistant marker present`);
		console.log();

		history.push({ role: 'user', content: note });
		if (advice !== '(nothing)') history.push({ role: 'mom', content: advice });
	}

	console.log('-'.repeat(74));
	console.log(`carrying a mum move : ${withMove}/${TRANSCRIPT.length}`);
	console.log(`assistant markers   : ${assistantish}/${TRANSCRIPT.length}`);
	console.log(`distinct replies    : ${new Set(replies.map((r) => r.toLowerCase())).size}/${replies.length}`);
})();
