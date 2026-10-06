/**
 * The full sweep. Every way a student can talk to her, against every shape of context she can be
 * holding, checked against what the app actually requires of a reply.
 *
 * This is the harness that found the three live bugs of the last session — a canned greeting, a
 * timetable offered to someone who asked to talk, and a study coach with no mother in it — so it is
 * written to be run, not admired. Each case asserts against the contract the rest of the repo
 * enforces: the intent that must come back, whether a plan is owed, that no banned word appears, and
 * that chat replies carry her rather than a helpdesk.
 *
 *   npx tsx scripts/full-sweep.ts                 # everything
 *   npx tsx scripts/full-sweep.ts chat context    # only those groups
 *
 * NIM only. Tests do not run on Groq.
 */
import { PERSONAS } from '../dev-fixtures/personas';
import { generateFromNote } from '../src/lib/llm/generate';
import { buildContext, buildTodayInfo } from '../src/lib/engine/context';
import { computeStats } from '../src/lib/engine/stats';
import { toContextWindow } from '../src/lib/engine/memory';
import { findSoftRegister } from '../src/lib/llm/prompt';
import { polishAdvice } from '../src/lib/llm/dialogue';
import { resolveProvider } from './provider';
import type { ContextPayload, TodayInfo } from '../src/lib/engine/context';
import type { Stats } from '../src/lib/engine/stats';
import type { Profile } from '../src/lib/storage/types';
import type { LLMConfig } from '../src/lib/llm/config';

const provider = resolveProvider();
if (provider.name !== 'NVIDIA NIM') {
	throw new Error(`the sweep is a NIM test and must not be run against ${provider.name}`);
}
const config: LLMConfig = {
	mode: 'direct',
	url: provider.url,
	model: provider.model,
	apiKey: provider.key,
	reasoningEffort: 'low',
	maxTokens: 1200,
	timeoutMs: 180_000
};

const TZ = 'Asia/Kolkata';
const built: any = (PERSONAS[1] as any).build(TZ);
const profile = built.profile as Profile;
const checkins = built.checkins.map((c: any, i: number) => ({
	...c,
	id: 'c' + i,
	user_id: 'u1',
	created_at: c.local_date + 'T08:00:00Z'
}));
const stats = computeStats(checkins, [], TZ, '2026-10-03') as Stats;

/** Rejected everywhere: the scorekeeper words, and the chatbot register. */
const BANNED =
	/\b(you missed|you failed|you skipped|you didn'?t|you should have|you were supposed|you neglected|you wasted|lazy|fell behind)\b/i;
const CHATBOT =
	/\b(let me know|feel free|would you like|do you want|shall i|is there anything else|i can help|i'?m here if|i hope this helps|as an ai)\b/i;

/**
 * See `voice-check.ts`, which grades this against known replies. It is imported rather than copied so
 * the two can never disagree, which they did: the first copy in this file used `\b` after a `.`, which
 * can never match, so "ha." and "hmm." both failed and 11 of 13 real replies were called voiceless.
 */
import { carriesHerVoice } from '../src/lib/llm/voice-detector';

interface Ctx {
	at: string;
	history?: { role: 'user' | 'mom'; content: string }[];
	priorPlan?: boolean;
	digestBacklog?: number;
}

/** Builds a payload shaped like the dashboard's, at a given hour. */
function contextFor(c: Ctx): ContextPayload {
	const now = new Date(c.at);
	const today = buildTodayInfo(profile, checkins[checkins.length - 1], TZ) as TodayInfo;
	const history = c.history ?? [];

	// the dashboard stores newest-first; toContextWindow reverses that back to chronological
	const stored = [...history]
		.reverse()
		.map((h, n) => ({
			...h,
			id: 'm' + n,
			user_id: 'u1',
			local_date: c.at.slice(0, 10),
			kind: 'chat' as const,
			created_at: now.toISOString(),
			session_id: null
		}));

	const backlog = c.digestBacklog
		? Array.from({ length: c.digestBacklog }, (_, i) => ({
				id: 'd' + i,
				user_id: 'u1',
				local_date: '2026-08-24',
				role: 'user' as const,
				kind: 'chat' as const,
				content: 'that week was rough, the room was loud and i could not settle',
				created_at: '2026-08-24T20:00:00Z',
				session_id: null
			}))
		: [];

	const prior = c.priorPlan
		? {
				as_of: c.at,
				blocks: [
					{ start: '09:00', end: '10:00', action: 'class', status: 'done' },
					{ start: '19:00', end: '21:00', action: 'study_block', status: 'in_progress' },
					{ start: '23:30', end: '07:00', action: 'sleep', status: 'upcoming' }
				]
			}
		: null;

	return buildContext(profile, checkins, [], today, now, prior as never, {
		recent: toContextWindow(stored as never, 20),
		older_digests: [],
		to_digest: backlog as never
	}).payload;
}

interface Case {
	group: 'chat' | 'plan' | 'mutation' | 'context' | 'time';
	note: string | null;
	expect: 'chat' | 'plan';
	label: string;
	at?: string;
	ctx?: Ctx;
	/** things that must be present in the reply */
	must?: RegExp[];
	/** things that must be absent */
	mustNot?: RegExp[];
}

const NIGHT = '2026-10-03T22:30:00+05:30';
const MORNING = '2026-10-04T08:10:00+05:30';
const MIDNIGHT = '2026-10-04T00:20:00+05:30';

const CASES: Case[] = [
	// ---- chat: the shapes a student actually opens with -------------------------------
	{ group: 'chat', label: 'greeting', note: 'hey mom! how are you?', expect: 'chat', at: NIGHT },
	{ group: 'chat', label: 'short greeting', note: 'hi', expect: 'chat', at: NIGHT },
	{ group: 'chat', label: 'good morning', note: 'good morning ma', expect: 'chat', at: MORNING },
	{ group: 'chat', label: 'feeling', note: 'i am so tired of this hostel honestly', expect: 'chat', at: NIGHT },
	{ group: 'chat', label: 'venting about a person', note: 'my roommate played music till 3am again', expect: 'chat', at: NIGHT },
	{ group: 'chat', label: 'brag', note: 'i topped the class!', expect: 'chat', at: NIGHT, must: [/ha|hmm/i] },
	{ group: 'chat', label: 'apology', note: 'sorry mom, i was rude yesterday', expect: 'chat', at: NIGHT },
	{ group: 'chat', label: 'asks about her', note: 'do you get lonely here?', expect: 'chat', at: NIGHT },
	{ group: 'chat', label: 'wants to talk, no schedule', note: 'lets just talk for a while', expect: 'chat', at: NIGHT },
	{
		group: 'chat',
		label: 'leave the schedule alone',
		note: 'i just wanted to talk to you, leave the schedule for a bit',
		expect: 'chat',
		at: NIGHT,
		mustNot: [/here is your (plan|schedule)/i]
	},
	{ group: 'chat', label: 'hinglish feeling', note: 'arre mom, aaj kuch theek nahi lag raha', expect: 'chat', at: NIGHT },
	{ group: 'chat', label: 'hinglish question', note: 'kya karun, thak gaya hu', expect: 'chat', at: NIGHT },
	{ group: 'chat', label: 'thanks', note: 'thanks, that helped', expect: 'chat', at: NIGHT },

	// ---- plan: fresh, and the reasoning a planner owes ---------------------------------
	{ group: 'plan', label: 'empty note means plan the day', note: null, expect: 'plan', at: NIGHT },
	{ group: 'plan', label: 'filler only', note: 'idk', expect: 'plan', at: NIGHT },
	{ group: 'plan', label: 'open ask', note: 'what do i do now?', expect: 'plan', at: NIGHT },
	{ group: 'plan', label: 'exam crunch', note: 'i have my maths exam tomorrow morning, what should i do?', expect: 'plan', at: NIGHT },
	{ group: 'plan', label: 'clash', note: 'i have a lab until 7pm so i cannot study then', expect: 'plan', at: NIGHT },
	{
		group: 'plan',
		label: 'why do i keep doing this',
		note: 'why do i always wake up at 3am?',
		expect: 'plan',
		at: NIGHT,
		must: [/\?|because/i]
	},

	// ---- mutation: every instruction about the plan, however casually wrapped ---------
	{ group: 'mutation', label: 'move a block', note: 'could you shift my study block to 8pm', expect: 'plan', at: NIGHT },
	{ group: 'mutation', label: 'move, with feeling', note: 'honestly i am gutted, can we push the gym to tomorrow', expect: 'plan', at: NIGHT },
	{ group: 'mutation', label: 'make room', note: 'can you make room for dinner at 9?', expect: 'plan', at: NIGHT },
	{ group: 'mutation', label: 'drop a block', note: 'drop the gym for today', expect: 'plan', at: NIGHT },
	{ group: 'mutation', label: 'named time they cannot make', note: 'i cannot study at 8:30, i have to meet my friends', expect: 'plan', at: NIGHT },
	{ group: 'mutation', label: 'plan is not working', note: 'this schedule is not working for me', expect: 'plan', at: NIGHT },
	{
		group: 'mutation',
		label: 'describes clash, asks for nothing',
		note: 'the seminar ran over so i missed the library slot',
		expect: 'chat',
		at: NIGHT
	},

	// ---- context: the same message against different memory ---------------------------
	{
		group: 'context',
		label: 'no history at all',
		note: 'how are you?',
		expect: 'chat',
		at: NIGHT,
		ctx: {}
	},
	{
		group: 'context',
		label: 'already greeted, must not greet again',
		note: 'any tips for studying?',
		expect: 'chat',
		at: NIGHT,
		ctx: {
			history: [
				{ role: 'user', content: 'hey mom! how are you?' },
				{ role: 'mom', content: "i'm fine, you're the one awake at this hour" }
			]
		},
		mustNot: [/^(hey|hi|hello|good morning)\b/i]
	},
	{
		group: 'context',
		label: 'digest backlog present',
		note: 'how are you?',
		expect: 'chat',
		at: NIGHT,
		ctx: { digestBacklog: 40 }
	},
	{
		group: 'context',
		label: 'prior plan on screen',
		note: 'what should i do now?',
		expect: 'plan',
		at: NIGHT,
		ctx: { priorPlan: true },
		mustNot: [/24:00|25:00/]
	},

	// ---- time: the anchors that broke before ----------------------------------------
	{ group: 'time', label: 'just after midnight', note: 'what do i do now?', expect: 'plan', at: MIDNIGHT, mustNot: [/24:00|25:00/] },
	{ group: 'time', label: 'early morning', note: 'i cannot sleep, what now?', expect: 'plan', at: MORNING },
	{ group: 'time', label: 'midnight greeting', note: 'hey, still up?', expect: 'chat', at: MIDNIGHT }
];

const verbose = process.argv.includes('--verbose');
const groups = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const selected = groups.length ? CASES.filter((c) => groups.includes(c.group)) : CASES;

interface Row {
	label: string;
	ok: boolean;
	notes: string[];
	reply: string;
	ms: number;
}

(async () => {
	console.log(`provider: ${provider.name}  model: ${provider.model}`);
	console.log(`sweep: ${selected.length} cases across ${new Set(selected.map((c) => c.group)).size} groups\n`);

	const rows: Row[] = [];

	for (const c of selected) {
		const at = c.at ?? NIGHT;
		const notes: string[] = [];
		const t0 = Date.now();

		let result;
		try {
			result = await generateFromNote(
				{ note: c.note, context: contextFor({ at, ...(c.ctx ?? {}) }), profile, stats, today: buildTodayInfo(profile, checkins[checkins.length - 1], TZ) as TodayInfo },
				config
			);
		} catch (e) {
			notes.push(`threw: ${(e as Error).message.slice(0, 120)}`);
			rows.push({ label: c.label, ok: false, notes, reply: '', ms: Date.now() - t0 });
			continue;
		}
		const ms = Date.now() - t0;

		// when the routing call disagrees with the one-shot, the classifier wins, so it is worth
		// seeing both when the verdict is wrong
		if (notes.length && result.intent !== c.expect) {
			try {
				const { buildClassifyFirstMessages, parseClassification } = await import(
					'../src/lib/llm/prompt'
				);
				const verdict = parseClassification(
					await askRaw(buildClassifyFirstMessages(c.note, contextFor({ at, ...(c.ctx ?? {}) })))
				);
				notes.push(`classifier said ${verdict ?? 'nothing'}`);
			} catch {
				/* diagnostic only */
			}
		}

		// intent
		if (result.intent !== c.expect) notes.push(`intent ${result.intent}, wanted ${c.expect}`);

		// the chat path owes a reply; the plan path owes blocks
		const reply = result.advice?.trim() ?? '';
		if (c.expect === 'chat') {
			if (!reply) notes.push('chat with no reply');
			if (result.output) notes.push('chat wrote a plan');
		} else {
			if (!result.output) notes.push('plan with no blocks');
			if (result.output && result.output.blocks.length === 0) notes.push('plan with zero blocks');
			if (result.output && result.output.blocks.length > 12) notes.push('more than 12 blocks');
		}

		// she never falls back silently
		if (result.usedTemplate && !result.fallbackReason) notes.push('template fallback with no reason');

		// the scorekeeper words, in every field that renders
		const rendered = [reply, result.output?.summary ?? '', result.output?.data_note ?? '', ...(result.output?.blocks.flatMap((b) => [b.detail, b.why]) ?? [])].join(' | ');
		if (BANNED.test(rendered)) notes.push(`banned word: ${rendered.match(BANNED)?.[0]}`);
		if (CHATBOT.test(reply)) notes.push(`chatbot register: ${reply.match(CHATBOT)?.[0]}`);

		// chat replies must not read like a worksheet
		if (c.expect === 'chat' && reply) {
			if (!carriesHerVoice(reply)) notes.push('no voice in the reply');
			const soft = findSoftRegister(reply);
			if (soft) notes.push(`soft register: ${soft}`);
		}

		for (const re of c.must ?? []) if (reply && !re.test(reply)) notes.push(`missing ${re}`);
		for (const re of c.mustNot ?? []) if (re.test(rendered)) notes.push(`unexpected ${re}`);

		rows.push({ label: c.label, ok: notes.length === 0, notes, reply, ms });
		const flag = notes.length === 0 ? 'ok  ' : 'FAIL';
		console.log(`[${flag}] ${c.label.padEnd(38)} ${(ms / 1000).toFixed(1)}s  ${result.intent}`);
		if (verbose) console.log(`         > ${reply || '(none)'}`);
		for (const n of notes) console.log(`         - ${n}`);
	}

	const failed = rows.filter((r) => !r.ok);
	console.log('\n' + '='.repeat(78));
	console.log(`${rows.length - failed.length}/${rows.length} passing`);
	if (failed.length) {
		console.log(`\nfailures:`);
		for (const f of failed) console.log(`  ${f.label}: ${f.notes.join('; ')}`);
	}
	console.log(`median latency ${Math.round(median(rows.map((r) => r.ms)))}ms`);
})();

/** A bare classifier call, for the diagnostic above. Not part of any assertion. */
async function askRaw(messages: { role: string; content: string }[]): Promise<string> {
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
			temperature: 0,
			max_tokens: 64,
			reasoning_effort: 'low',
			stream: false
		}),
		signal: AbortSignal.timeout(120_000)
	});
	const body: any = await res.json();
	return body?.choices?.[0]?.message?.content ?? '';
}

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}