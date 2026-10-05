/**
 * What the model is allowed to see.
 *
 * Notes are scrubbed on the way in, before storage, so anything missed here is not merely hidden
 * from the model later — it never reaches the database at all. That is the strongest promise this
 * app makes about what a student types, and it is worth paying for with a scrubber that leaves
 * ordinary sentences alone. Over-redacting is a real cost: `im tired` turned into `[name removed]`
 * once, which deleted the one word the note was about, and the student saw their own words back
 * mangled in the history with nothing to explain why.
 */

/** Capitalised words that follow "i am" in ordinary writing and are not anybody's name. */
const NOT_A_NAME = new Set([
	'a',
	'about',
	'back',
	'bad',
	'certainly',
	'completely',
	'completelyfine',
	'done',
	'down',
	'eating',
	'en',
	'feeling',
	'fine',
	'free',
	'good',
	'great',
	'here',
	'hungry',
	'in',
	'just',
	'kind',
	'not',
	'okay',
	'ok',
	'on',
	'out',
	'over',
	'really',
	'sick',
	'sleeping',
	'so',
	'still',
	'stressed',
	'studying',
	'sure',
	'tired',
	'trying',
	'up',
	'very',
	'working'
]);

/**
 * A name after an introduction, matched case-sensitively.
 *
 * That is the whole fix for the worst bug here: the pattern used to be case-insensitive, so `[A-Z]`
 * matched a lowercase `t` and every "im tired", "i am in hostel" and "call me back" came out as
 * "[name removed]". A capital letter is the difference between a name and the next ordinary word,
 * and it is the only signal available without a dictionary of every name in the world.
 */
const NAME_INTRO = /\b(?:my name is|i am|i'm|i’m|im|call me)\s+(\S{1,20})\b/gi;

/**
 * "my name is arun" needs no capital at all to be unambiguous, so it is matched loosely. It is also
 * the one phrasing everybody actually uses when they are spelling their name out, which is why it
 * gets its own rule instead of relying on the capital above.
 */
const NAMED_SPELLOUT = /\bmy name(?:'s| is)\s+([\p{L}][\p{L}'-]{0,20})\b/giu;

/**
 * Numbers, but only when they look like a phone number.
 *
 * Counting the digits is what keeps `2026-11-04` — a deadline, the single most useful date in a
 * note about an assignment — from being scrubbed as a phone number because it is a long run of
 * digits and dashes. Time is safe already: colons keep a clock time out of the pattern.
 */
/**
 * Whether the word after an introduction is shaped like a name: capitalised, and not one of the
 * ordinary words that turn up in that position. This is checked here rather than in the pattern so
 * the pronoun can be matched either case while the name itself still has to be capitalised.
 */
function isNameLike(word: string): boolean {
	if (!/^\p{Lu}/u.test(word)) return false;
	if (NOT_A_NAME.has(word.toLowerCase())) return false;
	return /^\p{Lu}\p{Ll}{1,19}$/u.test(word);
}

function maskNumberish(run: string): string {
	if (/[a-z]/i.test(run)) return run;
	const digits = run.replace(/\D/g, '').length;
	return digits >= 9 && digits <= 15 ? '[phone number]' : run;
}

export function scrubText(text: string): string {
	return text
		.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
		.replace(/https?:\/\/\S+/g, '[link]')
		.replace(NAMED_SPELLOUT, '[name removed]')
		.replace(NAME_INTRO, (whole, name: string) =>
			isNameLike(name) ? '[name removed]' : whole
		)
		.replace(/\+?\d[\d\s().-]{7,}\d/g, maskNumberish)
		.trim();
}

export function ageBand(birthYear: number | null, nowYear: number): string {
	if (!birthYear) return 'unknown';
	const age = nowYear - birthYear;
	if (age < 18) return 'under_18';
	if (age <= 21) return '18-21';
	if (age <= 25) return '22-25';
	return '26_plus';
}