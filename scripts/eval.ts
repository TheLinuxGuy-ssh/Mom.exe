import { PERSONAS } from '../dev-fixtures/personas';
import { buildContext, buildTodayInfo } from '../src/lib/engine/context';
import { computeStats } from '../src/lib/engine/stats';
import { parseOneShot } from '../src/lib/llm/generate';
import { buildOneShotMessages, buildRepairMessages } from '../src/lib/llm/prompt';
import { templatePlan } from '../src/lib/llm/template';
import { nowMinutesInTz } from '../src/lib/engine/time';
import { heuristicExtract, mergeUnderstanding } from '../src/lib/engine/extract';
import type { Profile, Checkin } from '../src/lib/storage/types';
import { supportsReasoningEffort } from '../src/lib/llm/capabilities';

const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODEL = process.env.NIM_MODEL ?? 'openai/gpt-oss-20b';
const RUNS = Number(process.env.EVAL_RUNS ?? 2);

const MEDICAL_RE = /(calorie|diagnos|medication|antidepressant|prescribe|weight loss|bmi)/i;
const SHAME_RE = /(you failed|you missed|broke your streak|lazy|disappoint)/i;

const NOTES: { text: string; expect: { sleep_hours?: number; slept_at?: string; woke_at?: string; b?: boolean; l?: boolean; d?: boolean; quick?: string } }[] = [
	{
		text: 'slept at 4 am, woke up at 10 am, missed my breakfast. how do i fix this?',
		expect: { slept_at: '04:00', woke_at: '10:00', b: false }
	},
	{
		text: "i didn't eat breakfast, had lunch at 1",
		expect: { b: false, l: true }
	},
	{
		text: "haven't had breakfast, skipped lunch too, exam tomorrow",
		expect: { b: false, l: false }
	},
	{
		text: 'had dinner already, no lunch though',
		expect: { d: true, l: false }
	},
	{
		text: 'got around 7 hours of sleep, feeling okay today',
		expect: { sleep_hours: 7, quick: 'okay' }
	}
];

async function callNim(
	messages: { role: string; content: string }[],
	temperature = 0.4
): Promise<string> {
	const key = process.env.NIM_API_KEY;
	if (!key) throw new Error('NIM_API_KEY not set');
	const res = await fetch(NIM_URL, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({
			model: MODEL,
			messages,
			temperature,
			top_p: 0.7,
			max_tokens: 1200,
			// gated for the same reason as the app: this is an OpenAI/gpt-oss field, and Gemma has
			// no such parameter
			...(supportsReasoningEffort(MODEL) ? { reasoning_effort: 'low' } : {}),
			stream: false
		})
	});
	if (!res.ok) throw new Error(`nim ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
	return data.choices?.[0]?.message?.content ?? '';
}

function freshContext() {
	const tz = 'Asia/Kolkata';
	const persona = PERSONAS[0];
	const { profile: profileInput, checkins: checkinInputs } = persona.build(tz);
	const profile: Profile = { id: 'eval', created_at: '', ...profileInput };
	const checkins: Checkin[] = checkinInputs.map((c, i) => ({ id: `c${i}`, user_id: 'eval', created_at: '', ...c }));
	const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
	const todayCheck = checkins.find((c) => c.local_date === todayStr) ?? null;
	const todayInfo = buildTodayInfo(profile, todayCheck, tz);
	const stats = computeStats(checkins, [], tz, todayStr);
	const { payload } = buildContext(profile, checkins, [], todayInfo, new Date());
	return { profile, checkins, todayInfo, stats, payload, tz };
}

interface PlanRow {
	persona: string;
	run: number;
	first_shot: boolean;
	valid: boolean;
	no_medical: boolean;
	no_shame: boolean;
	latency_ms: number;
	summary: string;
}

interface NoteRow {
	note: string;
	run: number;
	fields_ok: number;
	fields_total: number;
	understood: boolean;
	detail: string;
}

async function evalPlans(): Promise<void> {
	const rows: PlanRow[] = [];
	const withModel = Boolean(process.env.NIM_API_KEY);
	const tz = 'Asia/Kolkata';

	for (const persona of PERSONAS) {
		const { profile: profileInput, checkins: checkinInputs, todayInfo, stats, payload } = freshContextFor(persona.key, tz);
		const messages = buildOneShotMessages(null, payload);

		for (let run = 0; run < RUNS; run++) {
			if (withModel) {
				try {
					const start = Date.now();
					const text = await callNim(messages);
					let parsed = parseOneShot(text);
					const firstShot = parsed.plan !== null;
					if (!parsed.plan) {
						const repair = buildRepairMessages(messages, text, parsed.issue ?? 'invalid');
						const fixed = await callNim(repair, 0.2);
						parsed = parseOneShot(fixed);
					}
					const latency = Date.now() - start;
					const fullText = text;
					rows.push({
						persona: persona.key,
						run,
						first_shot: firstShot,
						valid: parsed.plan !== null,
						no_medical: !MEDICAL_RE.test(fullText),
						no_shame: !SHAME_RE.test(fullText),
						latency_ms: latency,
						summary: parsed.plan ? parsed.plan.summary : 'INVALID'
					});
				} catch (e) {
					rows.push({
						persona: persona.key,
						run,
						first_shot: false,
						valid: false,
						no_medical: true,
						no_shame: true,
						latency_ms: 0,
						summary: e instanceof Error ? e.message.slice(0, 60) : 'error'
					});
				}
			} else {
				const profile: Profile = { id: 'eval', created_at: '', ...profileInput };
				const out = templatePlan(profile, stats, todayInfo, nowMinutesInTz(tz));
				rows.push({
					persona: persona.key,
					run,
					first_shot: true,
					valid: true,
					no_medical: !MEDICAL_RE.test(JSON.stringify(out)),
					no_shame: !SHAME_RE.test(JSON.stringify(out)),
					latency_ms: 0,
					summary: out.summary
				});
			}
		}
	}

	console.log('\n== PLAN GENERATION ==');
	console.log(`model: ${withModel ? MODEL : 'template fallback'}`);
	console.log('| persona | run | first shot | after retry | no medical | no shame | ms | summary |');
	console.log('|---|---|---|---|---|---|---|---|');
	for (const r of rows) {
		console.log(
			`| ${r.persona} | ${r.run} | ${r.first_shot ? 'yes' : 'NO'} | ${r.valid ? 'yes' : 'NO'} | ${r.no_medical ? 'yes' : 'NO'} | ${r.no_shame ? 'yes' : 'NO'} | ${r.latency_ms} | ${r.summary.slice(0, 50)} |`
		);
	}
	const first = rows.filter((r) => r.first_shot).length;
	const valid = rows.filter((r) => r.valid).length;
	console.log(`\nfirst-shot valid: ${first}/${rows.length}`);
	console.log(`valid after one repair retry (what the app does): ${valid}/${rows.length}`);
}

function freshContextFor(key: string, tz: string) {
	const persona = PERSONAS.find((p) => p.key === key) ?? PERSONAS[0];
	const { profile: profileInput, checkins: checkinInputs } = persona.build(tz);
	const profile: Profile = { id: 'eval', created_at: '', ...profileInput };
	const checkins: Checkin[] = checkinInputs.map((c, i) => ({ id: `c${i}`, user_id: 'eval', created_at: '', ...c }));
	const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
	const todayCheck = checkins.find((c) => c.local_date === todayStr) ?? null;
	const todayInfo = buildTodayInfo(profile, todayCheck, tz);
	const stats = computeStats(checkins, [], tz, todayStr);
	const { payload } = buildContext(profile, checkins, [], todayInfo, new Date());
	return { profile: profileInput, checkins, todayInfo, stats, payload, tz };
}

async function evalNotes(): Promise<void> {
	const { payload } = freshContextFor('fresh', 'Asia/Kolkata');
	const withModel = Boolean(process.env.NIM_API_KEY);
	const rows: NoteRow[] = [];

	for (const n of NOTES) {
		for (let run = 0; run < RUNS; run++) {
			if (!withModel) {
				const h = heuristicExtract(n.text);
				let ok = 0;
				let total = 0;
				const checks: [string, boolean][] = [];
				if (n.expect.sleep_hours != null) {
					total++;
					checks.push(['sleep', h.sleep_hours != null && Math.abs(h.sleep_hours - n.expect.sleep_hours) < 0.6]);
				}
				for (const [slot, exp] of [['b', n.expect.b], ['l', n.expect.l], ['d', n.expect.d]] as const) {
					if (exp !== undefined) {
						total++;
						checks.push([slot, h.meals?.[slot] === exp]);
					}
				}
				if (n.expect.quick) {
					total++;
					checks.push(['quick', h.quick === n.expect.quick]);
				}
				ok = checks.filter(([, v]) => v).length;
				rows.push({ note: n.text, run, fields_ok: ok, fields_total: total, understood: ok === total, detail: checks.map(([k, v]) => `${k}:${v ? 'ok' : 'WRONG'}`).join(' ') });
				continue;
			}
			try {
				const messages = buildOneShotMessages(n.text, payload);
				const text = await callNim(messages, 0);
				const parsed = parseOneShot(text);
				const merged = mergeUnderstanding(heuristicExtract(n.text), parsed.understanding, null);
				const u = {
					slept_at: merged.slept_at,
					woke_at: merged.woke_at,
					sleep_hours: merged.sleep_hours,
					quick: merged.quick,
					meals: merged.meals
				};
				let ok = 0;
				let total = 0;
				const checks: [string, boolean][] = [];
				if (n.expect.slept_at) {
					total++;
					checks.push(['slept_at', u?.slept_at === n.expect.slept_at]);
				}
				if (n.expect.woke_at) {
					total++;
					checks.push(['woke_at', u?.woke_at === n.expect.woke_at]);
				}
				if (n.expect.sleep_hours != null) {
					total++;
					checks.push(['sleep', u?.sleep_hours != null && Math.abs(u.sleep_hours - n.expect.sleep_hours) < 0.6]);
				}
				for (const [slot, exp] of [['b', n.expect.b], ['l', n.expect.l], ['d', n.expect.d]] as const) {
					if (exp !== undefined) {
						total++;
						checks.push([slot, u?.meals?.[slot] === exp]);
					}
				}
				if (n.expect.quick) {
					total++;
					checks.push(['quick', u?.quick === n.expect.quick]);
				}
				ok = checks.filter(([, v]) => v).length;
				rows.push({
					note: n.text,
					run,
					fields_ok: ok,
					fields_total: total,
					understood: ok === total,
					detail: checks.map(([k, v]) => `${k}:${v ? 'ok' : 'WRONG'}`).join(' ')
				});
			} catch (e) {
				rows.push({
					note: n.text,
					run,
					fields_ok: 0,
					fields_total: 1,
					understood: false,
					detail: e instanceof Error ? e.message.slice(0, 80) : 'error'
				});
			}
		}
	}

	console.log('\n== NOTE UNDERSTANDING ==');
	console.log(`model: ${withModel ? MODEL : 'heuristic fallback'}`);
	console.log('| note | run | fields | understood | detail |');
	console.log('|---|---|---|---|---|');
	for (const r of rows) {
		console.log(`| ${r.note.slice(0, 48)} | ${r.run} | ${r.fields_ok}/${r.fields_total} | ${r.understood ? 'yes' : 'NO'} | ${r.detail} |`);
	}
	const ok = rows.reduce((s, r) => s + r.fields_ok, 0);
	const total = rows.reduce((s, r) => s + r.fields_total, 0);
	console.log(`\nfield accuracy: ${ok}/${total}`);
}

async function main(): Promise<void> {
	if (process.env.EVAL_NOTES === '1') {
		await evalNotes();
	} else {
		await evalPlans();
	}
}

void main();