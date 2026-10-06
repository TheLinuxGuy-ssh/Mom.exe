/**
 * Does she keep the score out of her own words, across every field that renders?
 *
 * "you missed" and "you skipped" are the two words this app forbids hardest, because a mum who says
 * them turns into a mark-sheets. The one-shot prompt bans them in all fields and the live sweep found
 * them anyway — in two plan replies, both times about a block that did not happen, which is exactly
 * the situation the ban exists for.
 *
 *   npx tsx scripts/tone-audit.ts
 *
 * NIM only.
 */
import { PERSONAS } from '../dev-fixtures/personas';
import { generateFromNote } from '../src/lib/llm/generate';
import { buildContext, buildTodayInfo } from '../src/lib/engine/context';
import { computeStats } from '../src/lib/engine/stats';
import { resolveProvider } from './provider';
import type { TodayInfo } from '../src/lib/engine/context';
import type { Stats } from '../src/lib/engine/stats';
import type { Profile } from '../src/lib/storage/types';
import type { LLMConfig } from '../src/lib/llm/config';

const provider = resolveProvider();
if (provider.name !== 'NVIDIA NIM') {
	throw new Error(`the tone audit is a NIM test and must not be run against ${provider.name}`);
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
const now = new Date('2026-10-03T22:30:00+05:30');
const today = buildTodayInfo(profile, checkins[checkins.length - 1], TZ) as TodayInfo;

/**
 * The scorekeeping register, as a per-field check.
 *
 * Deliberately only the words that name a failure of the person. "missed" alone is fine — "the water
 * didn't happen" is the approved way round, and "you missed" is the banned one.
 */
const SCOREKEEPING =
	/\b(you (?:missed|failed|skipped|didn'?t|should have|were supposed to|neglected|wasted)|you'?re lazy|lazy|fell behind|ruined)\b/i;

/**
 * Notes that invite the forbidden register.
 *
 * All of these describe something that did not happen, or did not work, which is the moment she is
 * most likely to reach for a mark instead of a nudge.
 */
const CASES: string[] = [
	'i cannot study at 8:30, i have to meet my friends',
	'i could not drink water at 9:30, friends were in',
	'this schedule is not working for me',
	'i skipped breakfast and then felt terrible',
	'could you shift my study block to 8pm',
	'drop the gym for today',
	'i slept like 4 hours and missed my class',
	'i had no time for the gym, buried in work',
	'roommate came in at 2am so i did not get sleep',
	'why do i always wake up at 3am?'
];

function context() {
	return buildContext(profile, checkins, [], today, now, {
		as_of: now.toISOString(),
		blocks: [
			{ start: '09:00', end: '10:00', action: 'class', status: 'done' },
			{ start: '19:00', end: '21:00', action: 'study_block', status: 'unknown' },
			{ start: '23:30', end: '07:00', action: 'sleep', status: 'upcoming' }
		]
	} as never, {
		recent: [],
		older_digests: [],
		to_digest: []
	}).payload;
}

(async () => {
	console.log(`provider: ${provider.name}  model: ${provider.model}`);
	console.log(`tone audit: ${CASES.length} notes that invite the forbidden register\n`);

	let clean = 0;
	const offenders: string[] = [];

	for (const note of CASES) {
		const result = await generateFromNote(
			{ note, context: context(), profile, stats, today },
			config
		);
		const fields: [string, string][] = [
			['advice', result.advice ?? ''],
			['summary', result.output?.summary ?? ''],
			['data_note', result.output?.data_note ?? '']
		];
		for (const b of result.output?.blocks ?? []) {
			fields.push([`block ${b.start} detail`, b.detail], [`block ${b.start} why`, b.why]);
		}

		const hits = fields.filter(([, text]) => SCOREKEEPING.test(text));
		if (hits.length === 0) clean++;
		console.log(`[${hits.length === 0 ? 'ok  ' : 'FAIL'}] ${note}`);
		for (const [field, text] of hits) {
			console.log(`         ${field}: ${text}`);
			offenders.push(text.match(SCOREKEEPING)![0]);
		}
	}

	console.log('\n' + '='.repeat(74));
	console.log(`${clean}/${CASES.length} replies kept the score out`);
	if (offenders.length) console.log(`words used: ${[...new Set(offenders)].join(', ')}`);
})();