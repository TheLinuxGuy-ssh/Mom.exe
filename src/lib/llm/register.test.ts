/**
 * The voice has to survive every prompt edit that was made for a good reason.
 *
 * Two regressions happened in a row here, both from fixing something real, and both of the same
 * shape. The repetition fix recast the dialogue corpus as "never the words", which the model obeyed
 * so thoroughly that it stopped borrowing her voice at all and answered an exam question with
 * flawless, motherless advice. These tests are the tripwire for that: they assert the stance
 * instructions and the stacked exemplars are still in the prompt, so a later edit that tightens the
 * bans has to confront what it is about to cost.
 *
 * The interesting property is that none of it can be checked by reading a reply — a reply is
 * non-deterministic, and the model will sometimes nail the register without being asked. What can be
 * checked is whether the prompt still asks for it.
 */
import { describe, expect, it } from 'vitest';
import { DIALOGUE, MOVES_BY_ID, renderMoves } from './dialogue';
import { MOM_VOICE, SYSTEM_ONESHOT_PROMPT } from './prompt';

/** the prompt is hard-wrapped, so match on flattened text */
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('the prompt still asks for a stance', () => {
	const prompt = flat(SYSTEM_ONESHOT_PROMPT);

	it('requires at least one mum move per chat reply', () => {
		expect(prompt).toMatch(/EVERY CHAT REPLY CARRIES AT LEAST ONE MUM MOVE/);
	});

	it('names the moves she has available', () => {
		for (const move of ['taunt', 'affection-worry', 'verdict', 'pride-deflection', 'receipt']) {
			expect(prompt.toLowerCase()).toContain(move.toLowerCase());
		}
	});

	it('keeps help inside the voice rather than instead of it', () => {
		expect(prompt).toMatch(/HELP IS WELCOME/i);
		expect(prompt).toMatch(/inside her voice, not instead of it/i);
	});

	it('bans taunting the stakes while allowing taunting the circumstance', () => {
		// the line the app already had: taunting is for the small everyday stuff, never for a
		// real failure. This is the chat-side half of the same rule.
		expect(prompt).toMatch(/NEVER THE STAKES/);
		expect(prompt).toMatch(/the hour, the phone, the procrastination/i);
		// the things listed after this colon are the ones she may never go near
		expect(prompt).toMatch(/their ability, their intelligence, the exam result/i);
	});

	it('makes a scared student a soft answer rather than a milder taunt', () => {
		expect(prompt).toMatch(/drop the taunt entirely/);
	});

	it('asks the assistant test directly in the final check', () => {
		// "could an assistant have written this" is the question that would have caught the
		// study-coach reply before it shipped
		expect(prompt).toMatch(/COULD AN ASSISTANT HAVE WRITTEN THIS LINE\?/);
	});

	it('keeps the repetition guards, which the looser exemplar rule now depends on', () => {
		expect(prompt).toMatch(/DO NOT REUSE YOUR OWN EARLIER WORDING/);
		expect(prompt).toMatch(/YOU ARE ALREADY IN A CONVERSATION/);
	});
});

describe('the corpus is allowed to teach the voice', () => {
	it('is framed as shape rather than as forbidden wording', () => {
		// the rule lives in SYSTEM_ONESHOT_PROMPT, which sits alongside the moves block the corpus
		// renders into. renderMoves keeps its own "behaviours, not the exact words" line, which is
		// the same permission stated once more, not a second prohibition.
		expect(flat(SYSTEM_ONESHOT_PROMPT)).toMatch(/TEACH YOU HER SHAPE, NOT A SCRIPT/);
		expect(flat(renderMoves())).not.toMatch(/NEVER THE WORDS/);
		expect(flat(renderMoves())).not.toMatch(/worst thing you can do/);
	});

	it('keeps exactly one prohibition, about word-for-word reuse', () => {
		// this is the rule that caused the regression. "NEVER THE WORDS... worst thing you can do"
		// told the model twice that its only voice material was dangerous to use.
		const p = flat(SYSTEM_ONESHOT_PROMPT);
		expect(p).not.toMatch(/THE EXAMPLES BELOW TEACH YOU THE MOVE, NEVER THE WORDS/);
		expect(p).not.toMatch(/worst thing you can do/);
	});
});

describe('the corpus can stack a taunt with real help', () => {
	const study = DIALOGUE.filter((p) =>
		/exam|tips|studying|focus|sleep|nervous/i.test(p.user)
	);

	it('has examples of the exact moment that lost its voice', () => {
		// "i have my maths exam tomorrow, any tips?" came back as a revision plan with no mother
		// in it, because nothing in the corpus showed her helping and teasing in one breath
		const tips = study.filter((p) => /any tips|im nervous/.test(p.user));
		expect(tips.length).toBeGreaterThanOrEqual(2);
	});

	it('actually gives advice in those replies, not only attitude', () => {
		for (const p of study.filter((q) => /any tips/.test(q.user))) {
			expect(p.mom.length, p.user).toBeGreaterThan(30);
			expect(p.mom, p.user).toMatch(/\b(chapters|phone|water|desk|practice)/i);
		}
	});

	it('keeps the taunt off a student who is scared', () => {
		const scared = study.filter((p) => /nervous/i.test(p.user));
		expect(scared.length).toBeGreaterThan(0);
		for (const p of scared) {
			expect(p.mom, p.user).not.toMatch(/\b(bold|we both know it|drawer|it is the phone)\b/i);
		}
	});

	it('does not let "bold" become the new canned opener', () => {
		// every fix in this file has created a new attractor once. this is the guard for that.
		const bold = DIALOGUE.filter((p) => /^bold\b/i.test(p.mom));
		expect(bold.length).toBeLessThanOrEqual(2);
	});

	it('keeps care-question pointed rather than automatic', () => {
		// "any message at all, and food or sleep has not come up" fired on everything and rendered
		// as checklist care: "keep a glass of water nearby so you stay alert"
		expect(MOVES_BY_ID['care-question'].trigger).not.toMatch(/any message at all/);
		expect(MOVES_BY_ID['care-question'].trigger).toMatch(/late hour|study stretch|empty stomach/);
	});
});

describe('the banned words still do not appear in the new pairs', () => {
	const BANNED =
		/\b(useless|pathetic|worthless|disgusting|idiot|loser|you (missed|failed|skipped|didn'?t|should have|neglected|wasted|were supposed))\b/i;

	it('holds across the whole corpus', () => {
		for (const p of DIALOGUE) expect(p.mom, p.user).not.toMatch(BANNED);
	});
});

describe('MOM_VOICE is untouched by the register work', () => {
	it('still carries the taunt as the memorable part', () => {
		expect(flat(MOM_VOICE)).toMatch(/THE TAUNT/);
		expect(flat(MOM_VOICE)).toMatch(/affection wearing a disguise/);
	});
});
