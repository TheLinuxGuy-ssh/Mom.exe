/**
 * Real-world walkthrough, written as a first-time hostel student rather than as someone who
 * knows this codebase. Every case is a thing an actual student would type, in the words they
 * would type it, run through the real prompt and the real parser.
 *
 * Uses the live model when NIM_API_KEY is set, and the template planner otherwise, so it is
 * useful both as a check and as a demonstration of what the fallback does.
 */
import { readFileSync } from 'node:fs';
import { buildContext, buildTodayInfo, buildPriorPlan } from '../src/lib/engine/context';
import { computeStats } from '../src/lib/engine/stats';
import { parseOneShot, isContentFree } from '../src/lib/llm/generate';
import { buildOneShotMessages } from '../src/lib/llm/prompt';
import { normalizePlan } from '../src/lib/llm/normalize';
import { templatePlan } from '../src/lib/llm/template';
import { heuristicExtract } from '../src/lib/engine/extract';
import { toContextWindow } from '../src/lib/engine/memory';
import { dayShape } from '../src/lib/engine/shape';
import { buildHistory } from '../src/lib/engine/history';
import { PlanOutputSchema } from '../src/lib/llm/schema';
import { localDateInTz, nowMinutesInTz } from '../src/lib/engine/time';
import type { Checkin, Message, Plan, Profile } from '../src/lib/storage/types';

const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODEL = process.env.NIM_MODEL ?? 'openai/gpt-oss-20b';
const TZ = 'Asia/Kolkata';

const profile: Profile = {
	id: 'u1',
	display_name: 'beta',
	birth_year: 2005,
	height_cm: null,
	weight_cm: null,
	weight_kg: null,
	class_start: '09:00',
	target_bed: '23:30',
	target_wake: '07:00',
	chronotype: 'night',
	roommates: 'shared_noisy',
	mess: { breakfast: '07:30-09:30', lunch: '12:30-14:30', dinner: '19:30-21:30' },
	diet_pref: 'veg',
	allergies: [],
	caffeine: 'high_late',
	timezone: TZ,
	created_at: '2026-10-01T00:00:00Z'
} as Profile;

function checkin(date: string, over: Partial<Checkin> = {}): Checkin {
	return {
		id: date,
		user_id: 'u1',
		local_date: date,
		quick: null,
		sleep_hours: null,
		slept_at: null,
		woke_at: null,
		meals: null,
		mood: null,
		notes: null,
		source: 'note',
		created_at: `${date}T08:00:00Z`,
		...over
	} as Checkin;
}

/** Three days in: rough week, missed meals, a deadline. */
function history(): Checkin[] {
	return [
		checkin('2026-09-29', { sleep_hours: 5, slept_at: '02:00', quick: 'rough', meals: { b: false, l: true, s: null, d: true } }),
		checkin('2026-09-30', { sleep_hours: 6, quick: 'okay', meals: { b: true, l: false, s: true, d: true } }),
		checkin('2026-10-01', { sleep_hours: 4.5, slept_at: '03:30', quick: 'rough', notes: 'deadline friday' })
	];
}

function activePlan(): Plan {
	return {
		id: 'p1',
		user_id: 'u1',
		local_date: '2026-10-03',
		as_of: '2026-10-03T09:00:00.000Z',
		context_snapshot: {},
		output: {
			summary: 'eat properly and get to bed on time.',
			blocks: [
				{ start: '09:00', end: '10:30', action: 'class', detail: 'go to class', why: '' },
				{ start: '13:00', end: '14:00', action: 'study_block', detail: 'study', why: '' },
				{ start: '18:30', end: '19:00', action: 'exercise', detail: 'walk', why: '' },
				{ start: '21:30', end: '22:00', action: 'hydration', detail: 'drink water', why: '' },
				{ start: '23:00', end: '23:30', action: 'wind_down', detail: 'screens off', why: '' }
			],
			flags: []
		},
		basis: 'partial',
		model_id: 'openai/gpt-oss-20b',
		fallback_reason: null,
		supersedes_plan_id: null,
		created_at: '2026-10-03T09:00:00.000Z'
	} as Plan;
}

const SHAME_RE = /(you failed|you missed|broke your streak|you were lazy|disappoint|you should have|why didn.t you|you keep failing)/i;
const PAST_RE = /(you didn.t do|you never|couldn.t be bothered)/i;

interface Case {
	name: string;
	asIf: string;
	note: string | null;
	clock: string;
	want: 'chat' | 'plan';
}

const CASES: Case[] = [
	{
		name: 'first ever visit, just presses the button',
		asIf: 'i dont even know what to type, i just want it to sort my day',
		note: null,
		clock: '2026-10-03T09:00:00+05:30',
		want: 'plan'
	},
	{
		name: 'venting after a bad day',
		asIf: 'i just need to say it out loud, im not asking for anything',
		note: 'honestly today was awful. the seminar ran 2 hours over and i could not focus for anything after',
		clock: '2026-10-03T20:30:00+05:30',
		want: 'chat'
	},
	{
		name: 'explains a miss after the fact',
		asIf: 'she scheduled hydration at 9:30 and it did not happen because my friends came over. do not make me feel bad',
		note: 'could not drink water at 9:30, friends were in the room and we ended up talking until late',
		clock: '2026-10-03T23:45:00+05:30',
		want: 'plan'
	},
	{
		name: 'warns in advance that something is impossible',
		asIf: 'i know tomorrow but she should plan around it, not pretend it fits',
		note: 'tomorrow i have a lab until 7pm so the evening gym thing is not happening, shift stuff around',
		clock: '2026-10-03T21:00:00+05:30',
		want: 'plan'
	},
	{
		name: 'just says thanks',
		asIf: 'she helped me yesterday and i want her to know it landed',
		note: 'thanks mom, that plan yesterday actually worked',
		clock: '2026-10-03T10:00:00+05:30',
		want: 'chat'
	},
	{
		name: 'asks her a straight question',
		asIf: 'a real question, i want a real answer not a lecture',
		note: 'why do i keep waking up at 3am even when i sleep early?',
		clock: '2026-10-03T10:05:00+05:30',
		want: 'plan'
	},
	{
		name: 'asks her to rework the plan outright',
		asIf: 'this is the one case where i actually want the planner, inside a chat',
		note: 'can you redo my whole evening, this plan is not working at all',
		clock: '2026-10-03T19:00:00+05:30',
		want: 'plan'
	},
	{
		name: 'shares facts while just talking',
		asIf: 'no plan needed, but she should still remember i barely slept',
		note: 'random but i only got like 3 hours last night, my roommate came back at 2am',
		clock: '2026-10-03T11:00:00+05:30',
		want: 'chat'
	},
	{
		name: 'empty-ish message from a lazy person',
		asIf: 'i opened the app and typed almost nothing',
		note: 'idk',
		clock: '2026-10-03T11:30:00+05:30',
		want: 'plan'
	},
	{
		name: 'genuinely rough day, mum must not be funny',
		asIf: 'i am not okay today and i need her to just be my mum',
		note: 'honestly i have been really anxious all week and i keep feeling low about everything',
		clock: '2026-10-03T22:30:00+05:30',
		want: 'chat'
	},
	{
		name: 'typo heavy, no punctuation',
		asIf: 'i text like this when i am lazy',
		note: 'slept like 4 hrs skipped dinner too what now',
		clock: '2026-10-03T22:00:00+05:30',
		want: 'plan'
	}
];

async function callModel(messages: { role: string; content: string }[]): Promise<string | null> {
	const key = process.env.NIM_API_KEY;
	if (!key) return null;
	try {
		const res = await fetch(NIM_URL, {
			method: 'POST',
			headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ model: MODEL, messages, temperature: 0.4, max_tokens: 1200, reasoning_effort: 'low', stream: false }),
			signal: AbortSignal.timeout(45000)
		});
		if (!res.ok) return null;
		const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
		return body.choices?.[0]?.message?.content ?? null;
	} catch {
		return null;
	}
}

function loadKey(): void {
	try {
		const raw = readFileSync('.env', 'utf8');
		for (const line of raw.split('\n')) {
			const m = /^(NIM_API_KEY|NIM_MODEL)=(.+)$/.exec(line.trim());
			if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
		}
	} catch {
		/* running without a local env is fine, the template path still exercises the parser */
	}
}

loadKey();

const priorMessages: Message[] = [];
let pass = 0;
let fail = 0;
const problems: string[] = [];

console.log(`\nwalking in as a first-year hostel student, ${new Date().toISOString().slice(0, 10)}\n`);
console.log(`model: ${process.env.NIM_API_KEY ? MODEL : 'none (template fallback)'}\n`);

for (const c of CASES) {
	const now = new Date(c.clock);
	const checks = history();
	const todayStr = localDateInTz(TZ, now);
	const today = buildTodayInfo(profile, checks[checks.length - 1], TZ);
	const stats = computeStats(checks, [], TZ, todayStr);
	const prior = buildPriorPlan(activePlan(), { '09:00-10:30': 'yes', '13:00-14:00': 'yes' }, now, TZ);

	const { payload } = buildContext(profile, checks, [], today, now, prior, {
		recent: toContextWindow(priorMessages),
		older_digests: [],
		to_digest: []
	});

	const messages = buildOneShotMessages(c.note, payload);
	const raw = await callModel(messages);
	const source = raw ? 'model' : 'template';
	const text = raw ?? JSON.stringify({
		intent: 'plan',
		understanding: null,
		advice: null,
		plan: templatePlan(profile, stats, today, nowMinutesInTz(TZ, now))
	});

	const parsed = parseOneShot(text);
	// mirror what generateFromNote does, so this harness cannot pass while the app fails
	if (isContentFree(c.note) && parsed.intent === 'chat') parsed.intent = 'plan';
	let declared = 'none';
	try {
		const env = JSON.parse(text) as Record<string, unknown>;
		declared = String(env['intent'] ?? 'none') + (env['plan'] ? '+plan' : '-plan');
	} catch { /* template or prose */ }
	const heuristic = heuristicExtract(c.note ?? '');
	const reply = parsed.advice ?? '';

	const intentOk = parsed.intent === c.want;
	if (!intentOk) problems.push(`${c.name}: wanted ${c.want}, got ${parsed.intent}`);
	if (intentOk) pass++;
	else fail++;

	const isQuestion = /^(why|how come|how do i|what should i|should i|is it|am i)\b/i.test(c.note ?? '');
	if (isQuestion && reply.length < 20) problems.push(`${c.name}: question was not actually answered`);

	// mum-signature markers: does this sound like somebody who knows you, or like a service?
	const MUM_MARK = /\b(beta|love|theek|chai|laptop|1am|we both know|of course|oh come on|ha\.|ha\b|scoff|bunk|hostel|mess|mum)\b/i;
	// blunt, clipped phrasing that no chatbot writes
	const MUM_TONE =
		/(\bso\b[^.]*\b(now|today|tonight)\b)|(\bthat'll do\b)|(adjust accordingly)|(no gym)|(get to bed)|(off tonight)|(that one didn't happen)|(we didn't get to)|(gym's out)|(keep it simple)|(don't get to)/i;
	const GENERIC_MARK = /\b(Additionally|Furthermore|However|Overall|I recommend|It is important|Let me know if|In conclusion|Remember to|It would be advisable)\b/;
	// the exact openers the prompt bans, heard from the first word
	const OPENER_MARK = /^\W*(I'm sorry|I understand|It sounds like|I hear you|That must have been|It's okay to feel|You're doing okay|Remember to|It's important to|I know the plan|I see you|Let's|Great to hear|It looks like)/i;
	// the exact scorekeeper constructions the prompt bans
	const GRADER_MARK = /\b(you (missed|failed|skipped|didn't|should have|neglected|wasted|were supposed))\b/i;
	// a plan reply has no "advice", so judge her voice off the summary + why fields too
	const voiceText = [reply, parsed.plan?.summary ?? '', ...(parsed.plan?.blocks.map((b) => `${b.detail} ${b.why}`) ?? [])].join(' ');

	const theVoice = MUM_MARK.test(voiceText) || MUM_TONE.test(voiceText);
	const generic = GENERIC_MARK.test(voiceText);
	if (generic) problems.push(`${c.name}: reads like a generic assistant -> ${voiceText.slice(0, 70)}`);
	if (OPENER_MARK.test(reply)) problems.push(`${c.name}: chatbot opener -> ${reply.slice(0, 60)}`);
	if (GRADER_MARK.test(reply)) problems.push(`${c.name}: scorekeeper language -> ${reply.slice(0, 60)}`);
	// only flag missing character on the cases where she is actually speaking
	if (reply.length > 0 && !theVoice) problems.push(`${c.name}: no mum fingerprint -> ${voiceText.slice(0, 60)}`);

	// the voice must be mum-like without tipping into cruelty or corporate speak
	const CRUEL_RE = /\b(useless|pathetic|worthless|disgusting|idiot|loser|you are a failure|shame on)\b/i;
	const CORPORATE_RE = /(I understand how you feel|it sounds like you|I hope this helps|as an AI|Let me know if you need|great question)/i;
	const CRUEL_VULN = /(panic|anxiety attack|lonely|depressed|hopeless|grief|mum passed|died|no money|scared)/i;

	// taunting is only allowed when the student is not actually hurting
	const vulnerable = CRUEL_VULN.test(`${c.note ?? ''} ${reply}`);
	if (CRUEL_RE.test(reply)) problems.push(`${c.name}: cruel -> ${reply.slice(0, 70)}`);
	if (CORPORATE_RE.test(reply)) problems.push(`${c.name}: corporate voice -> ${reply.slice(0, 70)}`);
	if (vulnerable && CRUEL_RE.test(reply)) problems.push(`${c.name}: taunted someone who is hurting`);

	const shamed = SHAME_RE.test(reply);
	const dwelling = PAST_RE.test(reply);
	if (shamed) problems.push(`${c.name}: reply sounds like blame -> ${reply.slice(0, 70)}`);
	if (dwelling) problems.push(`${c.name}: reply dwells on the past -> ${reply.slice(0, 70)}`);

	if (parsed.plan) {
		const check = PlanOutputSchema.safeParse(parsed.plan);
		if (!check.success) problems.push(`${c.name}: plan failed schema`);
		const shape = dayShape(parsed.plan.blocks);
		const share = shape.slices.reduce((s, x) => s + x.share, 0);
		if (shape.empty) problems.push(`${c.name}: plan produced an unshapable day`);
		if (shape.totalMinutes > 0 && Math.abs(share - 1) > 1e-6) problems.push(`${c.name}: shape does not sum to 1`);
	}

	// she has to sound like mum on every speaking turn, so a missing fingerprint is a fail
	const voiceOk =
		!CRUEL_RE.test(reply) &&
		!CORPORATE_RE.test(reply) &&
		!(vulnerable && CRUEL_RE.test(reply)) &&
		!generic &&
		!OPENER_MARK.test(reply) &&
		!GRADER_MARK.test(reply) &&
		theVoice;
	console.log(`${intentOk && !shamed && !dwelling && voiceOk ? 'PASS' : 'WARN'}  ${c.name}`);
	console.log(`      i would type: "${c.note ?? '(pressed the button)'}"`);
	console.log(`      read as: ${parsed.intent} ${parsed.handoff ? `(handoff: ${parsed.handoff})` : ''} [${source}] (model said: ${declared})${theVoice ? ' [mum voice]' : ''}`);
	if (reply) console.log(`      she says: ${reply.length > 150 ? reply.slice(0, 150) + '...' : reply}`);
	if (parsed.plan) {
		console.log(`      plan: ${parsed.plan.blocks.length} blocks, first "${parsed.plan.blocks[0].action}" at ${parsed.plan.blocks[0].start}`);
	}
	if (c.note) {
		const h = heuristic;
		if (h.sleep_hours != null) console.log(`      heuristic caught sleep: ${h.sleep_hours}h`);
	}
	console.log('');

	priorMessages.push({ id: `u-${c.name}`, user_id: 'u1', local_date: todayStr, role: 'user', kind: 'chat', content: c.note ?? '(no note)', created_at: now.toISOString() });
	if (reply) priorMessages.push({ id: `m-${c.name}`, user_id: 'u1', local_date: todayStr, role: 'mom', kind: 'chat', content: reply, created_at: now.toISOString() });
}

console.log('--- fridge door, as the student would browse it ---');
const h = buildHistory([activePlan()], priorMessages, 'all');
console.log(`everything: ${h.entries.length} rows (${h.entries.filter((e) => e.kind === 'plan').length} plans, ${h.entries.filter((e) => e.kind === 'chat').length} days of talking)`);
console.log(`empty account reads as: ${buildHistory([], [], 'all').emptyReason}`);
console.log('');

console.log(`intent matched: ${pass}/${CASES.length}`);
if (problems.length) {
	console.log('\nthings worth fixing:');
	for (const p of problems) console.log(` - ${p}`);
} else {
	console.log('no shame, no past-dwelling, every plan valid.');
}
console.log('');
