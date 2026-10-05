import { describe, expect, it } from 'vitest';
import { DIALOGUE, MOVES, MOVES_BY_ID, renderMoves, polishAdvice, type Move } from './dialogue';

/** The same detectors the live student test uses, so the corpus cannot smuggle in a break. */
const CRUEL = /\b(useless|pathetic|worthless|disgusting|idiot|loser|shame on|you are a failure)\b/i;
const GRADER = /\b(you (missed|failed|skipped|didn't|should have|neglected|wasted|were supposed))\b/i;
const ASSISTANT = /\b(let me know if|feel free|want me to|i can help|i'm here if|happy to help|tweak|adjust|is there anything else|don't hesitate|i hope this helps)\b/i;
const OPENER = /^\W*(i'm sorry|i understand|it sounds like|i hear you|that must have been|it's okay to feel|you're doing okay|remember to|it's important to|i know the plan|i see you|let's|great to hear|it looks like)/i;
const MEDICAL = /\b(diagnos|symptoms|prescrib|medication|calorie|calories|weight loss|bmi)\b/i;
/**
 * A real hinglish detector rather than three example words. Verified against the corpus: it
 * fires on every hinglish shelf entry and on none of the english ones, so it is safe to assert
 * both directions with.
 */
const HINGLISH =
	/\b(arre|yaar|theek|nahi|haan|hain|hai|kya|bhai|abhi|bahut|rakh|sochna|piyo|paani|khana|kha\b|lo\b|suno|bata|jaldi|chalo|aunty|pita|mummy|papa|dar|laga|kare|de\b|karo|liye|waala|mood|kharab|thak|bhookh|samajhti)\b/i;

describe('corpus integrity', () => {
	it('has a workable number of examples', () => {
		expect(DIALOGUE.length).toBeGreaterThanOrEqual(50);
	});

	it('gives every declared move at least two examples, or none at all', () => {
		for (const move of MOVES) {
			const n = DIALOGUE.filter((p) => p.move === move.id).length;
			expect(n, `move ${move.id}`).toBeGreaterThanOrEqual(2);
		}
	});

	it('references only moves that are declared', () => {
		for (const p of DIALOGUE) {
			expect(MOVES_BY_ID[p.move], `pair ${JSON.stringify(p.user)}`).toBeDefined();
		}
	});

	it('never has an empty side to a conversation', () => {
		for (const p of DIALOGUE) {
			expect(p.user.trim().length, `user side of ${p.move}`).toBeGreaterThan(0);
			expect(p.mom.trim().length, `mom side of ${p.move}`).toBeGreaterThan(0);
		}
	});

	it('has no duplicate user turns, so the model is not shown the same prompt twice', () => {
		const seen = new Set<string>();
		for (const p of DIALOGUE) {
			const key = p.user.toLowerCase().trim();
			expect(seen.has(key), `duplicate: ${p.user}`).toBe(false);
			seen.add(key);
		}
	});
});

describe('the corpus obeys the bans the app enforces', () => {
	it('contains no cruel line', () => {
		for (const p of DIALOGUE) {
			expect(CRUEL.test(p.mom), p.mom).toBe(false);
		}
	});

	it('contains no scorekeeper construction, even in an example', () => {
		for (const p of DIALOGUE) {
			expect(GRADER.test(p.mom), `mom said: ${p.mom}`).toBe(false);
		}
	});

	it('contains no assistant-speak, so we do not teach the voice we are escaping', () => {
		for (const p of DIALOGUE) {
			expect(ASSISTANT.test(p.mom), `mom said: ${p.mom}`).toBe(false);
		}
	});

	it('never opens with a chatbot template', () => {
		for (const p of DIALOGUE) {
			expect(OPENER.test(p.mom), `mom opened with: ${p.mom}`).toBe(false);
		}
	});

	it('stays out of medical territory', () => {
		for (const p of DIALOGUE) {
			expect(MEDICAL.test(p.mom), `mom said: ${p.mom}`).toBe(false);
		}
	});

	it('ends with a verdict, a question, or an order, never with an offer', () => {
		for (const p of DIALOGUE) {
			const last = p.mom.trim().split(/[.!?]/).filter(Boolean).pop() ?? '';
			expect(ASSISTANT.test(last), `mom ended on an offer: ${p.mom}`).toBe(false);
		}
	});
});

describe('register separation', () => {
	it('keeps english replies free of hindi words', () => {
		for (const p of DIALOGUE.filter((x) => x.register === 'en')) {
			expect(HINGLISH.test(p.mom), `english reply leaked hinglish: ${p.mom}`).toBe(false);
		}
	});

	it('gives the hinglish shelf hinglish user turns, which is what unlocks the shelf', () => {
		const hi = DIALOGUE.filter((x) => x.register === 'hinglish');
		expect(hi.length).toBeGreaterThanOrEqual(8);
		for (const p of hi) {
			expect(HINGLISH.test(p.user), `hinglish reply gated on an english turn: ${p.user}`).toBe(true);
		}
	});

	it('answers most hinglish turns in hinglish, and may still slip into english', () => {
		const hi = DIALOGUE.filter((x) => x.register === 'hinglish');
		// a mum can answer in english even to hinglish, but the shelf must mostly stay in it
		const hindiReplies = hi.filter((p) => HINGLISH.test(p.mom)).length;
		expect(hindiReplies / hi.length).toBeGreaterThan(0.8);
	});

	it('binds hinglish pairs to hinglish user turns', () => {
		for (const p of DIALOGUE.filter((x) => x.register === 'hinglish')) {
			expect(HINGLISH.test(p.user), `hinglish reply to english turn: ${p.user}`).toBe(true);
		}
	});
});

describe('tone coverage', () => {
	it('covers the moments the app actually produces', () => {
		const required: Move[] = [
			'greeting-rebuke',
			'interrogation',
			'care-question',
			'receipt-callback',
			'tender-drop',
			'playful-threat',
			'guilt-as-love'
		];
		for (const m of required) {
			expect(DIALOGUE.some((p) => p.move === m), `no examples for ${m}`).toBe(true);
		}
	});

	it('keeps tender examples free of taunts, since tenderness overrides every joke', () => {
		for (const p of DIALOGUE.filter((x) => x.move === 'tender-drop')) {
			expect(p.mom.toLowerCase(), `tender line contains a tease word: ${p.mom}`).not.toMatch(
				/\b(again|always|never you|supposed to|obviously)\b/
			);
		}
	});

	it('has exactly one guilt example per register so it stays rationed', () => {
		const guilt = DIALOGUE.filter((p) => p.move === 'guilt-as-love');
		expect(guilt.length).toBeLessThanOrEqual(4);
	});
});

describe('renderMoves', () => {
	it('renders every move trigger', () => {
		const out = renderMoves();
		for (const m of MOVES) {
			expect(out, `missing trigger for ${m.id}`).toContain(m.trigger);
		}
	});

	it('fences the hinglish shelf behind a language gate', () => {
		const out = renderMoves();
		expect(out).toContain('LANGUAGE GATE');
		expect(out).toMatch(/Decide this before you write a single word/i);
		expect(out).toMatch(/then YOU reply in hinglish\. Fully/i);
		expect(out).toMatch(/use NO hindi word at all/i);
		expect(out).toMatch(/Never mix the two in one reply/i);
	});

	it('keeps the hinglish shelf after the gate, never before it', () => {
		const out = renderMoves();
		const gate = out.indexOf('LANGUAGE GATE');
		const firstHinglish = out.search(/they: ".*(arre|bhai|yaar)/);
		expect(gate).toBeGreaterThan(-1);
		expect(firstHinglish).toBeGreaterThan(gate);
	});

	it('renders both sides of every example it shows', () => {
		const out = renderMoves();
		// pull the rendered examples back out and check neither side was dropped in translation
		const rows = out.match(/they: "(.*?)"\s+->\s+you: "(.*?)"/g) ?? [];
		expect(rows.length).toBeGreaterThan(30);
		for (const row of rows) {
			const [, user, mom] = /they: "(.*?)"\s+->\s+you: "(.*?)"/.exec(row) ?? [];
			expect(user?.length, `rendered a row with no user side: ${row}`).toBeGreaterThan(0);
			expect(mom?.length, `rendered a row with no reply side: ${row}`).toBeGreaterThan(0);
		}
	});

	it('caps how many examples one move can contribute', () => {
		const out = renderMoves(1);
		const perMove = new Map<string, number>();
		let current = '';
		for (const line of out.split('\n')) {
			if (line.startsWith('when ')) current = line;
			if (line.includes('-> you:')) perMove.set(current, (perMove.get(current) ?? 0) + 1);
		}
		for (const [trigger, n] of perMove) {
			expect(n, `${trigger} rendered ${n} examples at a cap of 1`).toBeLessThanOrEqual(2);
		}
	});

	it('is bounded so it cannot bloat the prompt without limit', () => {
		const one = renderMoves(2);
		const three = renderMoves(3);
		expect(one.length).toBeLessThan(three.length);
	});
});
describe('polishing the reply', () => {
	it('cuts the chatbot openers that survived the prompt ban', () => {
		// a live run returned these, which is what a prompt ban is worth on its own
		expect(polishAdvice('I hear you. drink some water before class.')).toBe(
			'drink some water before class.'
		);
		expect(polishAdvice('sorry to hear that, beta. get some rest.')).toBe('get some rest.');
		expect(
			polishAdvice('As I see from our previous conversation, you skipped lunch.')
		).toBe('you skipped lunch.');
		// the whole preamble sentence goes, and what she actually said to them is what is left
		expect(polishAdvice("i see you're feeling down about the midterms. give yourself a night.")).toBe(
			'give yourself a night.'
		);
		// cutting only the connector leaves a complete sentence, so this no longer needs the
		// fragment guard to save it the way the clause-consuming version did
		expect(polishAdvice("it sounds like you're at your limit. sleep. ")).toBe(
			"you're at your limit. sleep."
		);
		expect(polishAdvice('it sounds like this is rough. eat something and rest.')).toBe(
			'this is rough. eat something and rest.'
		);
	});

	it('cuts the assistant sign-off off the end', () => {
		expect(polishAdvice('good, the plan helped. let me know if anything comes up.')).toBe(
			'good, the plan helped.'
		);
		expect(polishAdvice('eat something now. do not hesitate to reach out.')).toBe(
			'eat something now.'
		);
		expect(polishAdvice('sleep by 11. i hope this helps!')).toBe('sleep by 11.');
	});

	/**
	 * A live OpenRouter run produced all three of these. The old pattern needed a comma within 48
	 * characters of the connector, and none of them has one there — the third uses an em dash. The
	 * clause boundary it was guessing at is not reliably there, so only the connector is removed now,
	 * which leaves a sentence that already stands on its own.
	 */
	it('cuts the connector off even when there is no clause boundary to find', () => {
		expect(
			polishAdvice('It sounds like the extra time in the seminar really threw off your focus, start small.')
		).toBe('the extra time in the seminar really threw off your focus, start small.');
		expect(
			polishAdvice('It sounds like you got caught up with friends and missed your hydration. Do better.')
		).toBe('you got caught up with friends and missed your hydration. Do better.');
		expect(
			polishAdvice('It sounds like your mind is still buzzing from the day—give yourself a quiet night.')
		).toBe('your mind is still buzzing from the day—give yourself a quiet night.');
		expect(polishAdvice('Sounds like a rough one. Eat something.')).toBe('a rough one. Eat something.');
		expect(polishAdvice('Seems like a lot. Get some rest.')).toBe('a lot. Get some rest.');
	});

	/**
	 * Two bugs this file caught the hard way, both from real replies rather than invented ones.
	 *
	 * "I hear you" used to match the front of "you're wiped out" and return "’re wiped out",
	 * because the vocative group can match nothing at all and nothing stopped it from firing on the
	 * contraction. Then a reply that opened on an em dash was left with the dash hanging there.
	 */
	it('never eats the I out of a contraction', () => {
		expect(polishAdvice("I hear you're wiped out today—sounds exhausting. Rest.")).toBe(
			"I hear you're wiped out today—sounds exhausting. Rest."
		);
		expect(polishAdvice("You're feeling wiped out today—sounds exhausting.")).toBe(
			"You're feeling wiped out today—sounds exhausting."
		);
		expect(polishAdvice('You are wiped out today. Rest.')).toBe('You are wiped out today. Rest.');
	});

	it('takes a dangling dash off the front', () => {
		expect(polishAdvice('It sounds like — missing home and hostel food is rough. Call home.')).toBe(
			'missing home and hostel food is rough. Call home.'
		);
	});

	it('leaves her alone when there is nothing to cut', () => {
		const line = 'ha. you skipped lunch. eat something now, and get some sleep tonight.';
		expect(polishAdvice(line)).toBe(line);
	});

	it('never hands back a fragment if the cut ate the sentence', () => {
		expect(polishAdvice('I hear you.')).toBe('I hear you.');
		expect(polishAdvice(null)).toBeNull();
	});
});
