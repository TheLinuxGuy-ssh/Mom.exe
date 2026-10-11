/**
 * How much of the wait is reading the prompt, and what would removing tokens actually buy.
 *
 * Everything we are waiting for is prefill: pushing ~9,500 tokens through the model before it can
 * write a word. Generation is ~200 tokens, which at Groq's stated 1,000 tok/s is a fifth of a second,
 * so the wait is not the answer being written slowly — it is the prompt being read.
 *
 * The useful number here is not the total. It is the slope: tokens per second of prefill on the
 * provider we actually test against. With that, the value of removing N tokens is N/rate, and the
 * question "is trimming the prompt worth it" stops being a matter of taste.
 *
 * Several lengths, because a single call cannot separate prefill from queueing. NVIDIA's shared free
 * tier queues unpredictably, so each length is repeated and the minimum is taken: the floor is the
 * time the provider spent working, and anything above it was somebody else's turn.
 *
 *   npx tsx scripts/prefill-probe.ts
 *
 * NIM only. Tests do not run on Groq.
 */
import { SYSTEM_ONESHOT_PROMPT, MOM_VOICE } from '../src/lib/llm/prompt';
import { resolveProvider } from './provider';

const provider = resolveProvider();
if (provider.name !== 'NVIDIA NIM') {
	throw new Error(`this probe measures the NIM path and must not be run against ${provider.name}`);
}

const REPEATS = 3;
const MODEL = provider.model;

/** The real prompt is the expensive thing; this is a filler used to grow it on demand. */
const FILLER =
	'the student is in a hostel and the day is ordinary and the routine is mess timings and a class at nine and a walk somewhere between. ';

/**
 * One call at a given system-prompt size.
 *
 * The system prompt itself is what gets truncated, not padding around it. The first version grew the
 * user turn instead and kept the full 9.5k-token system prompt in every probe, so all five points
 * shared the same floor: reported tokens ranged 9,529 to 17,125 no matter how little was sent, and
 * the fitted rate came out at 1,074 tokens/second with a negative intercept, which is a number that
 * means nothing. Prefill has to be measured by actually sending less.
 */
async function probe(systemChars: number): Promise<{ ms: number; promptTokens: number | null }> {
	const system = SYSTEM_ONESHOT_PROMPT.slice(0, systemChars);
	const note = JSON.stringify({ note: 'how are you?', context: {} });

	const t0 = Date.now();
	const res = await fetch(provider.url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${provider.key}`,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: JSON.stringify({
			model: MODEL,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: note }
			],
			// one token of answer, so the measurement is reading the prompt and nothing else
			max_tokens: 1,
			temperature: 0,
			stream: false
		}),
		signal: AbortSignal.timeout(180_000)
	});
	const ms = Date.now() - t0;
	const body: any = await res.json();
	return { ms, promptTokens: body?.usage?.prompt_tokens ?? null };
}

(async () => {
	const realChars = SYSTEM_ONESHOT_PROMPT.length;
	console.log(`provider: ${provider.name}  model: ${MODEL}`);
	console.log(`the real prompt: ${realChars.toLocaleString()} chars (~${Math.round(realChars / 3.8).toLocaleString()} tokens)\n`);
	console.log(`min of ${REPEATS} calls per size, so queueing does not get measured as prefill\n`);
	console.log('size'.padEnd(22) + 'tokens'.padStart(9) + 'min ms'.padStart(10) + 'ms/1k tok'.padStart(12));
	console.log('-'.repeat(53));

	// the real size, then progressively smaller, to get a slope
	const sizes = [realChars, Math.round(realChars * 0.75), Math.round(realChars * 0.5), 12000, 3000];
	const points: { tokens: number; ms: number }[] = [];

	for (const size of sizes) {
		let best = Number.POSITIVE_INFINITY;
		let tokens: number | null = null;
		for (let i = 0; i < REPEATS; i++) {
			try {
				const r = await probe(size);
				if (r.promptTokens) tokens = r.promptTokens;
				best = Math.min(best, r.ms);
			} catch {
				/* a timed-out call is queueing, not a measurement */
			}
		}
		if (!tokens || !Number.isFinite(best)) {
			console.log(`${size.toLocaleString()} chars`.padEnd(22) + '(no reading)');
			continue;
		}
		points.push({ tokens, ms: best });
		console.log(
			`${size.toLocaleString()} chars`.padEnd(22) +
				tokens.toLocaleString().padStart(9) +
				best.toString().padStart(10) +
				(best / (tokens / 1000)).toFixed(0).padStart(12)
		);
	}

	// Least squares over the points, so one noisy reading does not decide the answer.
	const n = points.length;
	if (n < 2) {
		console.log('\nnot enough readings to fit a line. this provider is too busy right now.');
		return;
	}
	const sumX = points.reduce((s, p) => s + p.tokens, 0);
	const sumY = points.reduce((s, p) => s + p.ms, 0);
	const sumXY = points.reduce((s, p) => s + p.tokens * p.ms, 0);
	const sumXX = points.reduce((s, p) => s + p.tokens * p.tokens, 0);
	const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
	const intercept = (sumY - slope * sumX) / n;

	console.log(`\nprefill rate: ${Math.round(1000 / slope).toLocaleString()} tokens/second on this provider`);
	console.log(`fixed overhead per call: ${Math.round(intercept)}ms`);
	if (slope > 0) {
		const atReal = Math.round((realChars / 3.8) * slope + intercept);
		console.log(`\nso at the real prompt size, reading alone accounts for ~${(atReal / 1000).toFixed(1)}s`);
		const savedPer1k = Math.round(slope * 1000);
		console.log(`\nwhat removing tokens is worth here, per 1,000 tokens:`);
		for (const cut of [500, 1000, 2000, 4000]) {
			console.log(`  -${cut.toLocaleString()} tokens: -${(cut * slope / 1000).toFixed(2)}s per call`);
		}
	}
	console.log('\nnote: this is the free tier. The rate on a paid provider will differ, and the');
	console.log('cache behaviour differs more — a cached prefix is not read at all.');
})();