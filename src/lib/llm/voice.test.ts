import { describe, expect, it } from 'vitest';
import { MOM_VOICE, SYSTEM_ONESHOT_PROMPT, SYSTEM_PLAN_PROMPT } from './prompt';

/** Words that would turn a mum into a prosecutor rather than a mum. */
const CRUEL = /\b(useless|pathetic|worthless|disgusting|filthy|stupid|idiot|loser|worthless|shame|pathetic|waste of|you should quit|you are a failure)/i;

/** Phrases that mean a wellness app, not a person. */
const CORPORATE = /\b(I understand how you feel|it sounds like you|I hope this helps|as an AI|I apologize|please note that|I wanted to reach out|Let me know if you need|great question)/i;

/** Clinical language that must never appear in her voice. */
const CLINICAL = /\b(symptoms|diagnos|prescrib|clinically|medication|therapy session|cognitive behavioral)/i;

describe('MOM_VOICE', () => {
	it('is shared by every prompt that has her speak', () => {
		expect(SYSTEM_ONESHOT_PROMPT).toContain(MOM_VOICE);
		expect(SYSTEM_PLAN_PROMPT).toContain(MOM_VOICE);
	});

	it('lands after the intent rules, so tone cannot outrank classification', () => {
		expect(SYSTEM_ONESHOT_PROMPT.indexOf('STEP 1, BEFORE ANYTHING')).toBeLessThan(
			SYSTEM_ONESHOT_PROMPT.indexOf(MOM_VOICE)
		);
	});

	it('states the taunt boundary as a hard rule, not a suggestion', () => {
		expect(MOM_VOICE).toContain('THE HARD LINE');
		expect(MOM_VOICE).toMatch(/does not taunt someone who is actually hurting/i);
	});

	it('forbids taunting in flags and professional-help notices', () => {
		expect(MOM_VOICE).toMatch(/No taunting inside flags/i);
		expect(MOM_VOICE).toMatch(/suggest_professional_help[\s\S]{0,80}warmth, zero jokes/i);
	});

	it('protects the things a mum would never mock', () => {
		for (const topic of ['worth', 'intelligence', 'appearance', 'weight', 'family', 'money', 'religion']) {
			expect(MOM_VOICE.toLowerCase()).toContain(topic);
		}
	});

	it('keeps plan details followable, since a joke plan is a failed plan', () => {
		expect(MOM_VOICE).toMatch(/block "detail"[\s\S]{0,160}A plan she cannot follow/);
	});

	it('bans the corporate-speak tells outright', () => {
		expect(MOM_VOICE).toMatch(/no "I understand how you feel"/i);
		expect(MOM_VOICE).toMatch(/no emoji/i);
	});

	it('bans the scorekeeper words that turn a mum into a grader', () => {
		expect(MOM_VOICE).toMatch(/BANNED WORDS/);
		for (const w of ['missed', 'failed', 'lazy', 'fell behind']) {
			expect(MOM_VOICE).toContain(`"${w}"`);
		}
		// the mixed construction is the one that actually slipped through in testing
		expect(MOM_VOICE).toMatch(/you missed dinner again/);
		expect(MOM_VOICE).toMatch(/no exception for humour/i);
	});

	it('shows the exact missed-phrasing swap, since that one kept slipping', () => {
		expect(MOM_VOICE).toMatch(/THE "MISSED" SWAP/);
		expect(MOM_VOICE).toContain("you missed your water");
		expect(MOM_VOICE).toContain("the water didn't happen");
	});

	it('bans the chatbot openers that are audible from the first word', () => {
		expect(MOM_VOICE).toMatch(/BANNED OPENERS/);
		for (const opener of ["I'm sorry", 'I understand', 'It sounds like', 'Remember to', 'I hear you']) {
			expect(MOM_VOICE).toContain(opener);
		}
	});

	it('keeps the no-guilt rule binding even while being funny', () => {
		expect(SYSTEM_ONESHOT_PROMPT).toMatch(/This holds even when you are being funny/);
	});

	it('caps the jokes so it stays a register rather than a performance', () => {
		expect(MOM_VOICE).toMatch(/Two taunts in one reply is plenty/);
	});
});

describe('prompt safety rules survive the voice', () => {
	it('still forbids shaming, streaks and guilt in the planning prompt', () => {
		expect(SYSTEM_ONESHOT_PROMPT).toMatch(/NEVER say they failed/);
		expect(SYSTEM_ONESHOT_PROMPT).toMatch(/No streaks, no guilt, no scorekeeping/);
		expect(SYSTEM_PLAN_PROMPT).toMatch(/never scold/);
	});

	it('still forbids medical advice in both prompts', () => {
		for (const p of [SYSTEM_ONESHOT_PROMPT, SYSTEM_PLAN_PROMPT]) {
			expect(p).toMatch(/never diagnose/);
			expect(p).toMatch(/never mention calories or weight/);
		}
	});

	it('still keeps unknown data unknown', () => {
		for (const p of [SYSTEM_ONESHOT_PROMPT, SYSTEM_PLAN_PROMPT]) {
			expect(p).toMatch(/Missing data means UNKNOWN/);
		}
	});

	it('still requires raw JSON with no markdown fences', () => {
		for (const p of [SYSTEM_ONESHOT_PROMPT, SYSTEM_PLAN_PROMPT]) {
			expect(p).toMatch(/Output raw JSON only, no markdown fences/);
		}
	});

	it('keeps the same action and flag vocabulary in both prompts', () => {
		for (const p of [SYSTEM_ONESHOT_PROMPT, SYSTEM_PLAN_PROMPT]) {
			expect(p).toContain('suggest_professional_help');
			expect(p).toContain('wind_down');
			expect(p).toContain('Never invent new action or flag names');
		}
	});

	it('keeps the intent contract explicit and first', () => {
		expect(SYSTEM_ONESHOT_PROMPT).toContain('intent, understanding, advice, plan, handoff, digest');
		expect(SYSTEM_ONESHOT_PROMPT).toMatch(/Return "chat"/);
		expect(SYSTEM_ONESHOT_PROMPT).toMatch(/Return "plan"/);
	});

	it('keeps digests plain, since banter in a memory record would rot', () => {
		expect(SYSTEM_ONESHOT_PROMPT).toMatch(/Digests stay plain and factual/);
	});
});

describe('the guards this file exists to enforce', () => {
	it('documents the phrases we would reject if we saw them in output', () => {
		// these regexes mirror what the evaluator and student tests look for, kept here so a
		// future change to the voice cannot quietly weaken the checks that guard it
		expect(CRUEL.test('you are useless')).toBe(true);
		expect(CRUEL.test('that is pathetic')).toBe(true);
		expect(CORPORATE.test('I understand how you feel')).toBe(true);
		expect(CORPORATE.test('I hope this helps!')).toBe(true);
		expect(CLINICAL.test('that sounds like insomnia symptoms')).toBe(true);
	});

	it('does not flag ordinary warmth as cruel', () => {
		for (const line of [
			'you skipped lunch. again. I am not even surprised',
			'you will open the laptop again at 1am, we both know that',
			"eat something that isn't chai. I'm not asking nicely.",
			"you're not tired, you're behind. go to bed."
		]) {
			expect(CRUEL.test(line)).toBe(false);
			expect(CORPORATE.test(line)).toBe(false);
			expect(CLINICAL.test(line)).toBe(false);
		}
	});
});
