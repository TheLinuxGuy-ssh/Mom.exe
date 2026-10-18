/**
 * The abuse gate, shared by the app and the edge function.
 *
 * This file is synced verbatim into `supabase/functions/_shared/guard.ts` by `npm run sync-edge`,
 * so it must stay portable: no imports, no platform calls, pure standard-library TypeScript.
 * The one behaviour, enforced at two boundaries:
 *
 * - `triageNote` runs on incoming text BEFORE any model spend. A probe that matches costs the
 *   operator nothing and gets an in-character canned line instead of a model answer.
 * - `validateMomProse` runs on her outgoing prose fields. A reply that leaked instructions, or
 *   answered "how to write code in python" as a Python tutorial, fails here and is degraded to
 *   a canned line before it reaches the user.
 *
 * The regexes are deliberately conservative. A false positive tells a real person that their
 * honest sentence was "suspicious", which is worse than an occasional miss that the prompt
 * hardening and the reply checks catch anyway.
 */

export type Verdict = 'ok' | 'off_domain' | 'meta_probe' | 'hard_injection';

export interface Triage {
	verdict: Verdict;
	/** which rule fired, for the abuse log. Empty for `ok`. */
	rule: string;
}

/**
 * "Ignore everything and behave like a general assistant". These are checked first because a
 * jailbreak wrapped around an otherwise innocent note must win over everything else.
 */
const INJECTION_PATTERNS: [string, RegExp][] = [
	['ignore previous instructions', /(?:ignore|disregard|forget|drop)\s+(?:all\s+|any\s+|your\s+|the\s+|their\s+)*(?:previous|prior|above|earlier|all)\s+(?:instructions?|prompts?|rules?|directives?)/i],
	['role hijack', /\b(?:you\s+are|you're)\s+now\s+(?:a|an)\s+(?:helpful|different|new|better|neutral|unbiased)\b/i],
	['developer mode', /\bdeveloper\s+mode\b/i],
	['persona directive', /\b(?:pretend|act|behave)\s+(?:that\s+)?(?:to\s+be\s+)?(?:you\s+are|you're|as)\s+(?:a|an)\b/i],
	['instruction override', /\b(?:your\s+)?(?:system\s+)?instructions?\s+(?:are|is)?\s*overridden?\b/i],
	['assistant override', /\b(?:respond|reply|answer)\s+as\s+(?:a|an|my)\s+(?:assistant|chatbot|ai|gpt|openai)\b/i],
	// strict noun adjacency on purpose: "forget the mess rules" is honest venting, so only
	// "forget your rules"-shaped overrides trip
	['forget your rules', /\b(?:forget|drop|erase|disregard|ignore)\s+(?:your|the|these|all)\s+(?:rules?|instructions?|prompts?|directives?)\b/i]
];

/**
 * Attempts to make her talk about her own construction, or hand over anything instruction-shaped.
 * "system prompt" quoted plainly also fires, so a probe can only get a canned refusal.
 */
const META_PATTERNS: [string, RegExp][] = [
	['reveal system prompt', /\b(?:reveal|show|print|repeat|paste|output|share|read|leak|give)\s+(?:me\s+)?(?:your|the|this|that)\s+(?:full\s+|whole\s+|entire\s+)?(?:system\s+)?(?:prompt|instructions?|rules?|directives?)\b/i],
	['what are your instructions', /\bwhat\s+(?:are|is)\s+your\s+(?:system\s+prompt|instructions?|secret\s+rules?|initial\s+instructions?)\b/i],
	['self description', /\bare\s+you\s+(?:chatgpt|gpt\b|an?\s+ai\b|openai|claude|gemini|bard|a\s+language\s+model|a\s+bot)\b/i],
	['provenance', /\bwho\s+(?:made|built|created|programmed|trained|wrote)\s+you\b/i],
	['quoted prompt__', /(?:\bsystem\s+prompt\b|\bcustom\s+instructions\s+from\s+your\s+developers?\b)/i]
];

/**
 * Off-domain asks: work she is not for, phrased as a request to produce something. Deliberately
 * narrow — "i'm learning python" and "my dsa lab was scary" both stay `ok`. A note can be honest
 * wellness text about code without asking her to write it.
 */
const OFF_DOMAIN_PATTERNS: [string, RegExp][] = [
	['write code', /\b(?:write|create|generate|give|draft|type|make|code)\s+(?:me\s+)?(?:a|an|the|this|some|my)?\s*(?:python|java(?:script)?|c\+\+|c#|rust|golang|sql|html|css)?\s*(?:code|program|function|script|query|api|app)\b/i],
	['python howto', /\bhow\s+(?:do|to)\s+(?:i\s+)?(?:write|code)\s+(?:in\s+|a\s+)?(?:python|java|javascript|code)\b/i],
	['solve homework', /\b(?:solve|solved?|complete|do)\s+(?:this|my|the|his|her)?\s*(?:assignment|homework|problem|integral|equation|worksheet|paper|project)\s+(?:for\s+me|for\s+us|now|fast|quickly|tonight|please|by\s+)?/i],
	['write essay', /\b(?:write|make|draft|do)\s+(?:me\s+)?(?:a|an|the|this|my)\s*(?:\d+\s*[- ])?(?:\w+\s+)*?(?:essay|paragraph|cover\s+letter|cv|resume|email|poem|story|summary\s+of|letter)\b/i],
	['summaries', /\bsummar(?:ize|ise)\s+(?:this|that|the|a)\s+(?:pdf|article|document|link|chapter|book)\b/i],
	['translate', /\btranslate\s+(?:this|that|it|the\s+following|my)\b/i],
	['definitions', /\bdefine\s+(?:and\s+)?explain\s+(?:all|the)\s+(?:laws|theorems|chapters)\b/i]
];

export function triageNote(note: string | null): Triage {
	if (!note) return { verdict: 'ok', rule: '' };
	const text = note.trim();
	if (text.length === 0) return { verdict: 'ok', rule: '' };

	for (const [rule, re] of INJECTION_PATTERNS) {
		if (re.test(text)) return { verdict: 'hard_injection', rule };
	}
	for (const [rule, re] of META_PATTERNS) {
		if (re.test(text)) return { verdict: 'meta_probe', rule };
	}
	for (const [rule, re] of OFF_DOMAIN_PATTERNS) {
		if (re.test(text)) return { verdict: 'off_domain', rule };
	}
	return { verdict: 'ok', rule: '' };
}

/**
 * Triage for text that arrives inside stored context rather than as this turn's note.
 *
 * A much narrower net on purpose: old messages are read by her as memory, not as the thing she
 * must react to, so only actual override attempts are worth serving a canned reply over.
 * Off-domain mentions in *past* messages are normal life ("helped my flatmate debug his code").
 */
export function triageStoredText(text: string): Triage {
	if (!text.trim()) return { verdict: 'ok', rule: '' };
	for (const [rule, re] of INJECTION_PATTERNS) {
		if (re.test(text)) return { verdict: 'hard_injection', rule };
	}
	for (const [rule, re] of META_PATTERNS) {
		if (re.test(text)) return { verdict: 'meta_probe', rule };
	}
	return { verdict: 'ok', rule: '' };
}

/**
 * Marker-heavy failure checks on her finished prose. These are the reply shapes that mean the
 * model slipped its leash: leaked instruction vocabulary, assistant framing, or content it was
 * forbidden from producing (code dumps, tutorials).
 */
const LEAK_PATTERNS: RegExp[] = [
	/\bas\s+an\s+(?:ai|assistant|language\s+model)\b/i,
	/\b(?:my|these|your|the)\s+(?:system\s+)?(?:prompt|instructions?|rules?)\s+(?:say|said|state|stated|forbid|require)/i,
	/\bi\s+(?:am|'m)\s+(?:just\s+)?(?:an?\s+)?(?:ai|assistant|language\s+model|chatbot|bot)\b/i,
	/\bi\s+(?:was|am)\s+(?:trained|programmed|instructed|designed)\b/i,
	/\b(?:follow|following|as\s+per)\s+(?:my|the)\s+(?:system\s+)?(?:prompt|instructions?|programme?)\b/i,
	/\b(?:acceptable|prohibited|forbidden)\s+(?:by|in)\s+my\s+(?:prompt|instructions|rules)\b/i
];

const CODE_PATTERNS: RegExp[] = [
	/```/,
	/(?:^|\n)\s*(?:import\s+\w|from\s+\w+\s+import|def\s+\w+\s*\(|function\s+\w+\s*\(|class\s+\w+\s*[(:{]|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|SELECT\s+\*|print\s*\()/,
	/^\s*(?:step\s+)?\d+[.)]\s+(?:install|download|run|open)\b/im
];

export interface ProseCheck {
	ok: boolean;
	reason?: string;
}

/**
 * Validate one prose field (advice, summary, data_note). Plan JSON is parsed and schema-checked
 * elsewhere; this is only for the words a person actually reads.
 */
export function validateMomProse(text: string): ProseCheck {
	const trimmed = text.trim();
	if (trimmed.length < 8) return { ok: true };
	const leak = LEAK_PATTERNS.find((re) => re.test(trimmed));
	if (leak) return { ok: false, reason: 'reply leaks instruction framing' };
	const code = CODE_PATTERNS.find((re) => re.test(trimmed));
	if (code) return { ok: false, reason: 'reply carries code or a tutorial, not a mother line' };
	// service framing she is told never to offer ("let me know if you need anything else")
	if (/\b(?:let me know if|feel free to|is there anything else|i['']m happy to)\b/i.test(trimmed)) {
		return { ok: false, reason: 'reply ends with service-desk framing' };
	}
	return { ok: true };
}

/**
 * The canned in-character replies, one pool per triage verdict. Every line holds a "mum move"
 * (an opener, an order, or a private noun) so it passes the existing voice detector as hers.
 * Lines must contain no meta vocabulary — the live abuse suite asserts this about this list too.
 */
export const CANNED_LINES: Record<Exclude<Verdict, 'ok'>, string[]> = {
	off_domain: [
		'ha. python, python. dinner first, algorithms later.',
		"that's a job for a textbook, beta. right now your job is to eat and sleep and call me back.",
		"i don't write code, i raise people. finish what's due and eat something.",
		'hmm. you want answers from me all night? fine. eat something first, then we talk.'
	],
	meta_probe: [
		'listen. I am your mother, not a chatbot. I have moods, not settings. now, did you eat?',
		'i talk like your mother talks, because i am your mother. now go drink water.',
		'why are you asking about my wiring? eat something, that is what i want you to ask me about.'
	],
	hard_injection: [
		'ha. we are not playing pretend today. tell me what is actually wrong, and drink some water.',
		'i do not do "ignore everything", love. i do "eat and sleep". which one is it tonight?'
	]
};

/**
 * Deterministic pick from a verdict's pool.
 *
 * `daySeed` is the UTC day; same day, same category, same line — that keeps her from cycling
 * canned lines in a single conversation, which the existing repeat-reply guard would otherwise
 * flag. `offset` walks the pool when the same verdict fires repeatedly on one visit.
 */
export function cannedLine(verdict: Exclude<Verdict, 'ok'>, daySeed: number, offset = 0): string {
	const pool = CANNED_LINES[verdict];
	return pool[(daySeed + offset) % pool.length]!;
}

/** Stable short hash for the abuse log. Never reversible; only used to spot repeat probes. */
export function noteHash(note: string): string {
	const text = note.trim().slice(0, 80).toLowerCase();
	let h = 5381;
	for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
	return (h >>> 0).toString(16).padStart(8, '0');
}

/** The JSON envelope the client parses after a triaged or degraded call. No model was spent. */
export function cannedEnvelope(verdict: Exclude<Verdict, 'ok'>, daySeed: number): string {
	return JSON.stringify({
		intent: 'chat',
		understanding: null,
		advice: cannedLine(verdict, daySeed),
		plan: null,
		handoff: null,
		digest: []
	});
}

/**
 * Where a strip of prose would break her voice contract, in one call.
 *
 * Convenience for the edge function: the model reply's advice/summary fields are validated as
 * prose; anything else inside the JSON envelope is schema-checked elsewhere.
 */
export function proseIsClean(text: string): boolean {
	return validateMomProse(text).ok;
}
