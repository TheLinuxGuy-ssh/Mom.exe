/**
 * Breaks one reply into the burst of short messages a person would actually send.
 *
 * A mother texts in beats: a jab, a beat, the follow-up. One paragraph in one bubble is how an
 * assistant talks. Splitting on the client rather than asking the model for an array keeps the
 * response shape stable run to run, which a model-controlled segmentation would not be.
 *
 * Pure and deterministic, so the same reply always renders the same way in the conversation and
 * in the history tab.
 */

/** Anything at or under this stays one bubble. Most of what she says is this short. */
const SINGLE_BUBBLE_MAX = 96;

/** Preferred ceiling per bubble. A sentence longer than this keeps its own bubble rather than
 * being cut in half, since half a sentence is worse than a long bubble. */
const BUBBLE_TARGET = 84;

/** Hard ceiling on how many bubbles one reply may become. */
const MAX_BUBBLES = 3;

/** Dots and the like that are a whole reply on their own and must never be split. */
const ABBREVIATIONS = new Set([
	'mr.',
	'mrs.',
	'ms.',
	'dr.',
	'prof.',
	'st.',
	'vs.',
	'e.g.',
	'i.e.',
	'etc.',
	'no.',
	'ok.',
	'p.s.',
	'a.m.',
	'p.m.'
]);

function endsSentence(text: string): boolean {
	const trimmed = text.trimEnd();
	if (!trimmed) return false;
	const last = trimmed[trimmed.length - 1];
	if (last !== '.' && last !== '!' && last !== '?') return false;
	// "no." inside a sentence is an abbreviation, not a full stop
	const word = trimmed.split(/\s+/).pop() ?? '';
	if (ABBREVIATIONS.has(word.toLowerCase())) return false;
	return true;
}

/** Splits into sentences without breaking on abbreviations. */
function sentences(text: string): string[] {
	const parts: string[] = [];
	let current = '';

	for (const chunk of text.split(/(?<=[.!?])\s+/)) {
		current = current ? `${current} ${chunk}` : chunk;
		if (endsSentence(current)) {
			parts.push(current.trim());
			current = '';
		}
	}
	if (current.trim()) parts.push(current.trim());
	return parts.filter((p) => p.length > 0);
}

/**
 * Greedy pack: keep adding sentences while the bubble stays near the target length. An
 * overlong sentence takes a bubble of its own instead of being cut.
 */
function pack(sentencesIn: string[]): string[] {
	const out: string[] = [];
	let current = '';

	for (const sentence of sentencesIn) {
		if (!current) {
			current = sentence;
			continue;
		}
		const candidate = `${current} ${sentence}`;
		if (candidate.length <= BUBBLE_TARGET || current.length >= BUBBLE_TARGET) {
			current = candidate;
		} else {
			out.push(current);
			current = sentence;
		}
	}
	if (current) out.push(current);

	if (out.length <= MAX_BUBBLES) return out;
	// fold the tail into the last bubble rather than sending a fourth message
	const head = out.slice(0, MAX_BUBBLES - 1);
	const tail = out.slice(MAX_BUBBLES - 1).join(' ');
	return [...head, tail];
}

export function splitBubbles(reply: string): string[] {
	const text = reply.replace(/\s+/g, ' ').trim();
	if (!text) return [];
	if (text.length <= SINGLE_BUBBLE_MAX) return [text];

	const packed = pack(sentences(text));
	// a single sentence that happens to be long stays whole: she does not break sentences
	const result = packed.length > 0 ? packed : [text];

	return result.map((b) => b.trim()).filter((b) => b.length > 0);
}

/** Milliseconds to wait before bubble `index` of `total` appears. The last one is immediate. */
export function bubbleDelay(index: number): number {
	return index === 0 ? 0 : 800;
}