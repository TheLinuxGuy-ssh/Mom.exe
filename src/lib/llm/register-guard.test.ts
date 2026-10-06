/**
 * The mechanical half of the register fix.
 *
 * Every prompt rule about tone is in `prompt.ts` and every one of them is currently in the prompt.
 * The reply that motivated this guard still came back as four instructions ending on "do you want
 * to set a short break after each hour?", which is why this file exists: an instruction does not beat
 * a shape, a check does. Same reasoning as `findRepeatedReply`, and the tests here are mostly the
 * real replies that shipped.
 */
import { describe, expect, it } from 'vitest';
import { findSoftRegister, buildRepairMessages } from './prompt';
import { polishAdvice } from './dialogue';

describe('the worksheet reply', () => {
	// verbatim from the live run that prompted the guard
	const checklist =
		"you're awake at 10pm, good. focus on the toughest chapter first, then skim the rest. keep the phone off while you study. do you want to set a short 5-minute break after each hour?";

	it('is caught, and says why', () => {
		const why = findSoftRegister(checklist);
		expect(why).not.toBeNull();
		expect(why).toMatch(/instructions/);
	});

	it('catches the soft tail even on its own', () => {
		expect(findSoftRegister('sleep now. do you want me to set an alarm?')).toMatch(/asking whether/);
		expect(findSoftRegister('go to bed. let me know if you need anything.')).toMatch(
			/asking whether/
		);
	});
});

describe('the replies that should pass', () => {
	const good = [
		// the shape the exemplars teach: one taunt, one order, verdict last
		"maths tomorrow and you're telling me at 10pm. bold. shaky chapters first, phone in the bag. go.",
		// no advice at all, which is allowed — a taunt and a verdict is a complete reply
		"ha. you're still up. that's exactly what I'd expect at this hour.",
		// two instructions is the ceiling, not one
		"phone in the drawer and laptop shut. you're welcome.",
		// a question that is not an offer of service
		'which chapter is the one you hate? we start there.',
		// warm, no orders
		'you have prepared for this all term. chai, early night, and go in steady. I will be here after.'
	];

	for (const [i, reply] of good.entries()) {
		it(`passes: ${reply.slice(0, 46)}`, () => {
			expect(findSoftRegister(reply), reply).toBeNull();
		});
	}
});

describe('boundaries', () => {
	it('ignores fragments and empties', () => {
		expect(findSoftRegister('')).toBeNull();
		expect(findSoftRegister('k.')).toBeNull();
	});

	it('does not count a long descriptive sentence as an order', () => {
		// the head is long enough that it is talking, not instructing, even though it opens with a verb
		expect(
			findSoftRegister(
				'going back to the last time you mentioned the elective you were worried about dropping, because I have been thinking about it all evening.'
			)
		).toBeNull();
	});

	it('ignores a question in the middle when the ending is a verdict', () => {
		expect(
			findSoftRegister('so the gym again, then? fine. I will set it up myself.')
		).toBeNull();
	});
});

describe('the register retry tells it what is wrong', () => {
	it('names the counts and the tail, and asks for one order', () => {
		const messages = buildRepairMessages(
			[{ role: 'user', content: 'any tips for my exam?' }],
			'{"advice":"four instructions here"}',
			'4 instructions in one reply (max 2); it ends by asking whether they want something',
			'register'
		);
		const last = messages[messages.length - 1]!.content;
		expect(last).toContain('4 instructions');
		expect(last).toMatch(/ONE order/);
		expect(last).toMatch(/never by asking whether they want something/i);
		expect(last).toMatch(/worksheet/);
	});
});
describe('the surplus is cut without asking the model again', () => {
	/**
	 * The whole point of doing this in `polishAdvice` is that it costs nothing. Asking the model for a
	 * shorter reply works too, and spends three to six seconds of the student's wait doing it, so the
	 * tests below are as much about latency as they are about tone.
	 */
	const trims = [
		{
			in: "maths tomorrow, start with the toughest chapter, then do a quick recap of the easy ones. keep your phone off while you're at the desk, and finish with a short walk to stretch.",
			keeps: ['maths tomorrow', 'start with the toughest chapter'],
			drops: ['short walk']
		},
		{
			in: "you're awake at 10pm, good. focus on the toughest chapter first, then skim the rest. keep the phone off while you study. do you want to set a short 5-minute break after each hour?",
			keeps: ['10pm', 'focus on the toughest chapter'],
			drops: ['5-minute break', 'glass of water']
		},
		{
			in: 'ha. maths tomorrow, start with the toughest chapter, then take a quick walk, keep the phone off during study. phone is still buzzing, you know it.',
			keeps: ['ha.', 'maths tomorrow'],
			drops: ['keep the phone off during study']
		}
	];

	for (const [i, t] of trims.entries()) {
		it(`cuts the third order: case ${i + 1}`, () => {
			const out = polishAdvice(t.in) ?? '';
			for (const k of t.keeps) expect(out, k).toContain(k);
			for (const d of t.drops) expect(out, d).not.toContain(d);
		});
	}

	it('keeps the punctuation, because a reply without it reads as a transcript', () => {
		const out = polishAdvice(trims[0]!.in) ?? '';
		expect(out).toMatch(/[.!?]$/);
		expect(out).not.toMatch(/[a-z]\.[A-Z]/); // no two sentences slammed together
		expect(out).not.toMatch(/\s,|,,/);
	});

	it('leaves a reply that was already her alone', () => {
		for (const reply of [
			'maths tomorrow and you are telling me at 10pm. bold. shaky chapters first, phone in the bag. go.',
			'you have prepared for this all term. chai, early night, and go in steady. I will be here after.',
			'which chapter is the one you hate? we start there.',
			'ha. youre still up. thats exactly what id expect at this hour.',
			'eat, then bed. go.'
		]) {
			expect(polishAdvice(reply), reply).toBe(reply);
		}
	});

	it('never cuts the closing question, however many orders came before it', () => {
		// she is told to ask one thing back, and that is the most her-shaped part of any reply. It is
		// not an order, so it never counts against the two — and it must not be what gets cut when the
		// surplus goes.
		const out =
			polishAdvice(
				'go to bed. close the laptop. set your alarm. read one chapter. which chapter is the hard one?'
			) ?? '';
		expect(out).toContain('which chapter is the hard one');
		expect(out).not.toContain('read one chapter');
	});

	it('cuts a service offer even when it is phrased as a question', () => {
		// "do you want a short break?" is a question and a question is what she ends on, so this is
		// the case where rescuing the closing question must not rescue the chatbot
		const out =
			polishAdvice(
				"you're up late. start with the hardest chapter, then skim the rest, and keep a glass of water nearby. do you want to set a short 5-minute break after each hour?"
			) ?? '';
		expect(out).not.toContain('5-minute break');
		expect(out).not.toMatch(/do you want/i);
	});
});
