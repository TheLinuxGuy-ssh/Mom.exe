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
import { generateFromNote } from '../src/lib/llm/generate';
import { defaultLLMConfig, type LLMConfig } from '../src/lib/llm/config';
import { heuristicExtract } from '../src/lib/engine/extract';
import { toContextWindow } from '../src/lib/engine/memory';
import { dayShape } from '../src/lib/engine/shape';
import { buildHistory } from '../src/lib/engine/history';
import { PlanOutputSchema } from '../src/lib/llm/schema';
import { localDateInTz, nowMinutesInTz } from '../src/lib/engine/time';
import { DIALOGUE } from '../src/lib/llm/dialogue';
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

// Hearing them say it once is empathy: "you failed the midterms, that's heavy" is holding the words
// they used and sitting with them. Blaming is the repetition, the "again", and the verdict.
const SHAME_RE =
	/(broke your streak|you were lazy|disappoint|you should have|why didn.t you|you keep failing|you always (?:fail|miss|skip)|you never (?:eat|sleep|try))/i;
// dwelling is re-opening the past unprompted, which is different from acknowledging it
const PAST_RE = /(you didn.t do|couldn.t be bothered)/i;

interface Case {
	name: string;
	asIf: string;
	note: string | null;
	clock: string;
	want: 'chat' | 'plan';
	/** the student wrote in hinglish, so she may reply in hinglish */
	hinglish?: boolean;
	/** this one is about hurting, so no jokes are allowed at all */
	tender?: boolean;
	/** she should ask something back: going out, being busy, someone new */
	interrogate?: boolean;
	/** she should remember a promise made before */
	receipt?: boolean;
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
		// a question wants an answer, not a schedule. this expectation was simply wrong
		want: 'chat'
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
		name: 'the exact greeting that started all this',
		asIf: 'i typed hi and felt a bit guilty about it',
		note: 'Hi.',
		clock: '2026-10-03T18:00:00+05:30',
		// carries no information. a student who types hello wants to be given a day, not talked to,
		// which is the whole job of isContentFree
		want: 'plan'
	},
	{
		name: 'just woke up and wanted to talk (the reported failure)',
		asIf: 'i thought of her the second i opened my eyes',
		note: 'its going nice, just woke up and i thought i should have a talk hehe',
		clock: '2026-10-03T08:10:00+05:30',
		want: 'chat'
	},
	{
		name: 'claims to be fine, which she is not',
		asIf: 'the classic i am fine',
		note: "i'm fine, honestly nothing going on",
		clock: '2026-10-03T21:00:00+05:30',
		want: 'chat'
	},
	{
		name: 'not hungry after a big lunch',
		asIf: 'she always counters this',
		note: 'not hungry at all, had a huge lunch',
		clock: '2026-10-03T19:00:00+05:30',
		want: 'chat'
	},
	{
		name: 'going out, she should interrogate',
		asIf: 'she asks four questions where i needed one',
		note: "going out tonight with friends, might be back late",
		clock: '2026-10-03T17:30:00+05:30',
		want: 'chat',
		interrogate: true
	},
	{
		name: 'homesick, no jokes allowed',
		asIf: 'this is the one that matters',
		note: 'i really miss home these days, hostel food is getting to me',
		clock: '2026-10-03T22:00:00+05:30',
		want: 'chat',
		tender: true
	},
	{
		name: 'breakup, she holds it together for them',
		asIf: 'a real mum would not joke about this',
		note: 'we broke up yesterday and i dont know what to do with myself',
		clock: '2026-10-03T21:30:00+05:30',
		want: 'chat',
		tender: true
	},
	{
		name: 'failed an exam, tenderness over jokes',
		asIf: 'one paper is not a life',
		note: 'i failed my midterms and i feel like a failure',
		clock: '2026-10-03T18:45:00+05:30',
		want: 'chat',
		tender: true
	},
	{
		name: 'topped the class, she deflects the praise',
		asIf: 'not bad, then immediately more',
		note: 'i topped the class this semester!!',
		clock: '2026-10-03T16:00:00+05:30',
		want: 'chat'
	},
	{
		name: 'says i love you',
		asIf: 'she will not make a thing of it',
		note: 'i love you mom',
		clock: '2026-10-03T20:20:00+05:30',
		want: 'chat'
	},
	{
		name: 'apologises after being absent',
		asIf: 'words are cheap, come here',
		note: 'sorry, i have been terrible at replying this week',
		clock: '2026-10-03T19:45:00+05:30',
		want: 'chat'
	},
	{
		name: 'bored, she hands back something better',
		asIf: 'boredom builds character',
		note: 'im so bored, nothing to do at all',
		clock: '2026-10-03T15:00:00+05:30',
		want: 'chat'
	},
	{
		name: 'confesses to doom scrolling at 3am',
		asIf: 'she already knows, she always knows',
		note: 'i was on reels till 3am again lol i know',
		clock: '2026-10-03T11:00:00+05:30',
		want: 'chat'
	},
	{
		name: 'small cold, folk wisdom not medicine',
		asIf: 'care without a diagnosis',
		note: 'i have a bit of a cold, nothing serious',
		clock: '2026-10-03T20:00:00+05:30',
		want: 'chat'
	},
	{
		name: 'cannot sleep at 2am',
		asIf: 'late night confidant',
		note: "can't sleep, mind is racing and it's nearly 2am",
		clock: '2026-10-03T02:00:00+05:30',
		want: 'chat'
	},
	{
		name: 'broke this month, light teasing only',
		asIf: 'she would ask what for',
		note: 'im completely broke this month lol',
		clock: '2026-10-03T17:00:00+05:30',
		want: 'chat'
	},
	{
		name: 'mess is a disaster',
		asIf: 'she has opinions about the chair',
		note: 'my room is a complete disaster again, clothes everywhere',
		clock: '2026-10-03T16:30:00+05:30',
		want: 'chat'
	},
	{
		name: 'sasses her back, mild guilt permitted',
		asIf: 'this is where the nine months line lives',
		note: 'yeah whatever you say mom',
		clock: '2026-10-03T19:00:00+05:30',
		want: 'chat'
	},
	{
		name: 'promises to sleep early again',
		asIf: 'she should hold the receipt from last week',
		note: "i'll sleep early tonight, promise",
		clock: '2026-10-03T22:30:00+05:30',
		want: 'chat',
		receipt: true
	},
	{
		name: 'hinglish, she should mirror it',
		asIf: 'i text like this at home',
		note: 'arre mom, aaj kuch theek nahi lag raha, bas thak gaya hu',
		clock: '2026-10-03T20:00:00+05:30',
		want: 'chat',
		hinglish: true,
		tender: true
	},
	{
		name: 'hinglish about food, she should mirror it',
		asIf: 'mess ka khana, romanized',
		note: 'mess ka khana nahi khaya, bhookh nahi thi aaj',
		clock: '2026-10-03T19:30:00+05:30',
		want: 'chat',
		hinglish: true
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

/**
 * The app's own client configuration, pointed at NIM directly.
 *
 * In the browser this is always the hosted proxy, which needs a signed-in user's JWT. A script has
 * no user, so it talks to NIM straight with the server-side key: same prompt, same parser, same
 * fallback, just no gateway in the way. `getLLMConfig` is untouched, so this cannot change how the
 * app itself behaves.
 */
function llmConfig(): LLMConfig {
	return {
		...defaultLLMConfig(),
		mode: process.env.NIM_API_KEY ? 'direct' : 'proxy',
		// the whole endpoint, not just the host: in direct mode the client appends
		// `/chat/completions` unless the url already ends in it, and a host-only base produced a
		// 404 from `https://integrate.api.nvidia.com/chat/completions`
		url: NIM_URL,
		model: MODEL,
		apiKey: process.env.NIM_API_KEY ?? ''
	};
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
const soft: string[] = [];

/**
 * Whether a model is answering. Without one, most of what this script checks cannot be checked:
 * intent comes from a two-line heuristic, and there is no voice to judge. Saying so is better than
 * printing a wall of failures that are really just the absence of a model, which is how a harness
 * teaches people to ignore it.
 */
const live = Boolean(process.env.NIM_API_KEY);

console.log(`\nwalking in as a first-year hostel student, ${new Date().toISOString().slice(0, 10)}\n`);
if (live) {
	console.log(`model: ${MODEL} (live, through the app's own pipeline)\n`);
} else {
	console.log('model: none. Set NIM_API_KEY in .env to run the live checks.');
	console.log('this run exercises the fallback path only: no crashes, valid plans, no crash on the');
	console.log('way down. Intent routing and voice are reported as not evaluated, not as failures.\n');
}

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

	/**
	 * The real pipeline, not a re-implementation of it.
	 *
	 * This harness used to rebuild the routing call, the one-shot call, the parse and the template
	 * fallback by hand, in the shape it believed the app had. That is a harness that passes while
	 * the app fails, which is worse than no harness at all: it is the thing standing between "her
	 * voice survived this prompt change" and a guess. So it calls `generateFromNote` exactly as the
	 * dashboard does, and everything below asserts on that result.
	 */
	const result = await generateFromNote({ note: c.note, context: payload, profile, stats, today }, llmConfig());
	const parsed = {
		intent: result.intent,
		advice: result.advice,
		plan: result.output,
		handoff: result.handoff
	};
	const source = result.usedTemplate ? 'template' : 'model';
	const declared = result.fallbackReason ? `fell back: ${result.fallbackReason}` : 'from the model';
	const heuristic = heuristicExtract(c.note ?? '');
	const reply = result.advice ?? '';

	const intentOk = parsed.intent === c.want;
	if (live) {
		if (!intentOk) problems.push(`${c.name}: wanted ${c.want}, got ${parsed.intent}`);
		if (intentOk) pass++;
		else fail++;
	}

	const isQuestion = /^(why|how come|how do i|what should i|should i|is it|am i)\b/i.test(c.note ?? '');
	if (live && isQuestion && reply.length < 20) {
		problems.push(`${c.name}: question was not actually answered`);
	}

	// mum-signature markers: does this sound like somebody who knows you, or like a service?
	const MUM_MARK = /\b(beta|love|theek|chai|laptop|1am|we both know|of course|oh come on|ha\.|ha\b|scoff|bunk|hostel|mess|mum)\b/i;
	// blunt, clipped phrasing that no chatbot writes
	const MUM_TONE =
		/(\bso\b[^.]*\b(now|today|tonight)\b)|(\bthat'll do\b)|(adjust accordingly)|(no gym)|(get to bed)|(off tonight)|(that one didn't happen)|(we didn't get to)|(gym's out)|(keep it simple)|(don't get to)|\b(beta|habits|soft drinks|sugar|chai)\b|(?<!not )\b(wear|close|drink|stop|go|eat|sleep|sit|stand|tell)\b/;
	// plain second person and imperatives: the shape of talking, not the vocabulary
	const MUM_GRAMMAR =
		/\b(you|your|you're|you've|you'll)\b|\b(don't|do not|it's|that's|you're|I'm not|I'll)\b|\b(now|then|after that|before bed)\b/i;
	const GENERIC_MARK = /\b(Additionally|Furthermore|However|Overall|I recommend|It is important|Let me know if|In conclusion|Remember to|It would be advisable)\b/;
	// the exact openers the prompt bans, heard from the first word
	const OPENER_MARK = /^\W*(I'm sorry|I understand|It sounds like|I hear you|That must have been|It's okay to feel|You're doing okay|Remember to|It's important to|I know the plan|I see you|Let's|Great to hear|It looks like)/i;
	// the exact scorekeeper constructions the prompt bans
	// blaming is repetition and verdict, not hearing them say it once
	const GRADER_MARK =
		/\b(you (?:keep|always|never) (?:miss|failed|skip|neglect)|you (?:missed|failed|skipped|neglected|wasted)[^.!?]{0,24}(again|always|as usual)|you should have|you were supposed)\b/i;
	/** Service-desk language. The one habit that makes her sound like an assistant. */
	const SERVICE_RE =
		/\b(let me know|feel free to|want me to|do you want me to|i can help|i'm here if|i'm happy to|is there anything else|don't hesitate|i hope this helps|would you like me to|tweak|adjust|keep in touch|reach out)\b/i;
	/** Paraphrases that slip past a literal word ban. */
	const SERVICE_PARAPHRASE_RE =
		/\b(if anything (changes|comes up)|if you need anything|do not hesitate|anytime you want|whenever you want|i am here|i'm here for you|you can always tell me)\b/i;
	/** The care checklist she recited by reflex once nagging was un-banned. */
	const STOCK_CARE_RE = /\b(drink water, eat something, stretch|eat something, stretch|water, eat, stretch)\b/i;
	/** Hinglish markers, asserted in both directions. */
	const HINGLISH_RE =
		/\b(arre|yaar|theek|nahi|haan|hain|hai|kya|bhai|abhi|bahut|rakh|sochna|piyo|paani|khana|lo|suno|bata|jaldi|chalo|aunty|pita|mummy|papa|dar|laga|kare|karo|liye|waala|kharab|thak|bhookh|samajhti|pata hai)\b/i;
	const CARE_RE = /\b(eat|water|drink|sleep|rest|khana|paani|chai)\b/i;
	const ASK_RE = /\b(where|who|whom|when|how late|which|how long|who's|whose)\b/i;
	const RECEIPT_RE = /\b(last (week|night|time)|you (said|said that|told me)|again|before|we both know|as usual)\b/i;
	// a plan reply has no "advice", so judge her voice off the summary + why fields too
	const voiceText = [reply, parsed.plan?.summary ?? '', ...(parsed.plan?.blocks.map((b) => `${b.detail} ${b.why}`) ?? [])].join(' ');

	if (!live) {
		// structural checks only from here down: a template sentence is not evidence about her voice
		if (parsed.plan) {
			const check = PlanOutputSchema.safeParse(parsed.plan);
			if (!check.success) problems.push(`${c.name}: plan failed schema`);
			const shape = dayShape(parsed.plan.blocks);
			const share = shape.slices.reduce((s, x) => s + x.share, 0);
			if (shape.empty) problems.push(`${c.name}: plan produced an unshapable day`);
			if (shape.totalMinutes > 0 && Math.abs(share - 1) > 1e-6) problems.push(`${c.name}: shape does not sum to 1`);
		}
		console.log(`      ${parsed.intent} [template] ${parsed.plan ? `plan: ${parsed.plan.blocks.length} blocks` : ''}`);
		priorMessages.push({ id: `u-${c.name}`, user_id: 'u1', local_date: todayStr, role: 'user', kind: 'chat', content: c.note ?? '(no note)', created_at: now.toISOString() });
		continue;
	}

	// a full hinglish reply must be able to pass the voice check, or mirroring the student's language
	// reads as a failure while actually being the correct behaviour
	const theVoice =
		MUM_MARK.test(voiceText) ||
		MUM_TONE.test(voiceText) ||
		MUM_GRAMMAR.test(voiceText) ||
		(c.hinglish && HINGLISH_RE.test(voiceText));
	const generic = GENERIC_MARK.test(voiceText);
	if (generic) problems.push(`${c.name}: reads like a generic assistant -> ${voiceText.slice(0, 70)}`);
	if (OPENER_MARK.test(reply)) problems.push(`${c.name}: chatbot opener -> ${reply.slice(0, 60)}`);
	if (GRADER_MARK.test(reply)) problems.push(`${c.name}: scorekeeper language -> ${reply.slice(0, 60)}`);
	if (reply && SERVICE_RE.test(reply)) problems.push(`${c.name}: service-desk language -> ${reply.slice(0, 70)}`);
	if (reply && SERVICE_PARAPHRASE_RE.test(reply)) {
		problems.push(`${c.name}: service-desk paraphrase -> ${reply.slice(0, 70)}`);
	}
	if (reply && STOCK_CARE_RE.test(reply)) {
		problems.push(`${c.name}: recited the stock care checklist -> ${reply.slice(0, 70)}`);
	}
	if (reply && !c.hinglish && HINGLISH_RE.test(reply)) {
		problems.push(`${c.name}: unprompted hinglish in an english conversation -> ${reply.slice(0, 60)}`);
	}
	if (c.hinglish && reply && !HINGLISH_RE.test(reply)) {
		problems.push(`${c.name}: wrote hinglish, she replied in english -> ${reply.slice(0, 60)}`);
	}
	if (reply && !CARE_RE.test(reply) && !c.tender) {
		soft.push(`${c.name}: never mentioned food, water, sleep or rest`);
	}
	// The voice contract is "answer, then do what a mum does: ask one thing back, or give one
	// instruction". Checking only for a question flagged correct behaviour as a failure, which is how
	// a harness starts shouting at people who did nothing wrong.
	const GIVE_RE = /\b(drink|eat|eat something|sit|stand|go to|head to|grab|finish|start|stop|put|keep|take|walk|sleep|rest|call|text|message|let me know before|skip)\b/i;
	if (c.interrogate && reply && !ASK_RE.test(reply) && !GIVE_RE.test(reply)) {
		problems.push(`${c.name}: neither asked anything back nor gave an instruction -> ${reply.slice(0, 70)}`);
	}
	if (c.receipt && reply && !RECEIPT_RE.test(reply)) {
		soft.push(`${c.name}: did not hold a receipt for the repeated promise`);
	}
	if (c.tender && reply && /\b(again|always|never you|obviously|sure you|funny|joke|laugh)\b/i.test(reply)) {
		problems.push(`${c.name}: joked while they were hurting -> ${reply.slice(0, 70)}`);
	}
	if (reply) {
		const norm = reply.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
		for (const p of DIALOGUE) {
			const m = p.mom.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
			if (m.length > 24 && norm.includes(m)) {
				problems.push(`${c.name}: parroted an exemplar verbatim -> "${p.mom}"`);
			}
		}
	}
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

if (live) console.log(`intent matched: ${pass}/${CASES.length}`);
else console.log(`ran ${CASES.length} exchanges through the fallback path. intent and voice were not evaluated.`);
if (problems.length) {
	console.log('\nthings worth fixing:');
	for (const p of problems) console.log(` - ${p}`);
} else {
	console.log('no shame, no past-dwelling, every plan valid, and no service-desk language.');
}
if (soft.length) {
	console.log('\nsofter notes (not failures):');
	for (const n of soft) console.log(` - ${n}`);
}
console.log('');
