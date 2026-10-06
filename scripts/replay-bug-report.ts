/**
 * The bug report, run through the real pipeline instead of a hand-rolled imitation of it.
 *
 * The earlier replay called the classifier and the one-shot by hand, which meant the dedupe guard
 * never fired: the guard lives in `generateFromNote`, and a replay that skips it reports a repeat
 * without ever trying to fix one. This drives the same entry point the app calls, so a repeated line
 * costs one extra round trip here exactly as it would for a student.
 *
 *   npx tsx scripts/replay-bug-report.ts
 *
 * NIM only. This is a test, and the agreed rule is that tests run on NIM.
 */
import { PERSONAS } from '../dev-fixtures/personas';
import { generateFromNote } from '../src/lib/llm/generate';
import { buildContext, buildTodayInfo } from '../src/lib/engine/context';
import { computeStats } from '../src/lib/engine/stats';
import { toContextWindow } from '../src/lib/engine/memory';
import { findRepeatedReply } from '../src/lib/llm/prompt';
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
	'Hey Ma! How are you?',
	'just chillin here, what about you!?',
	'just alive somehow! hehe',
	'i just wanted to talk to you, leave the schedule for a bit, lets talk'
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

function contextFor(note: string | null) {
	const { payload } = buildContext(built.profile, checkins, [], today, now, null, {
		recent: toContextWindow(
			// newest first, which is the contract toContextWindow is built against: storage returns
			// created_at descending and the helper reverses it. Handing it chronological order
			// instead flips the entire window, and the model then reads the newest message as the
			// oldest and answers whichever turn it thought came first. Cost me one very confusing
			// test run before I noticed.
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

const bare = (s: string) =>
	s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

(async () => {
	console.log(`provider: ${provider.name}  model: ${provider.model}`);
	console.log('driving generateFromNote directly, so the dedupe guard is live\n');

	const replies: string[] = [];
	let wrongIntent = 0;
	let survived = 0;

	for (const [i, note] of TRANSCRIPT.entries()) {
		const context = contextFor(note);
		const t0 = Date.now();
		const result = await generateFromNote(
			{ note, context, profile: built.profile, stats, today },
			config
		);
		const ms = Date.now() - t0;

		const advice = (result.advice ?? '').trim();
		const ok = result.intent === 'chat';
		if (!ok) wrongIntent++;
		if (advice) replies.push(advice);

		// did the guard fire, and did the retry actually produce something new?
		const wouldRepeat = advice ? findRepeatedReply(advice, context.conversation.recent) : null;
		if (!wouldRepeat) survived++;

		console.log(`turn ${i + 1}  ${note}`);
		console.log(
			`        intent=${result.intent}  ${ok ? 'OK' : 'WRONG — wanted chat'}  ${(ms / 1000).toFixed(1)}s` +
				(result.usedTemplate ? '  [template fallback]' : '') +
				(result.fallbackReason ? `  [${result.fallbackReason}]` : '')
		);
		console.log(`        mom: ${advice || '(nothing)'}`);
		console.log(`        duplicate of her last line: ${wouldRepeat ? 'YES' : 'no'}`);
		console.log();

		history.push({ role: 'user', content: note });
		if (advice) history.push({ role: 'mom', content: advice });
	}

	console.log('-'.repeat(78));
	console.log(`intent correct : ${TRANSCRIPT.length - wrongIntent}/${TRANSCRIPT.length}`);
	console.log(`not a repeat   : ${survived}/${TRANSCRIPT.length}`);
	console.log(`distinct replies: ${new Set(replies.map(bare)).size}/${replies.length}`);
	for (const [n, r] of new Set(replies.map(bare)).entries()) console.log(`   ${n + 1}. ${r}`);
})();
