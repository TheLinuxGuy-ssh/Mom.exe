/**
 * The reply is graded, not just generated.
 *
 * Two of the three live bugs of the last session were "she answered, but not like herself", and
 * neither would have been caught by asserting on the intent, so the check that notices them lives
 * here with the replies it is graded against rather than inside a script that reports whatever it
 * happens to see.
 */
import { describe, expect, it } from 'vitest';
import { carriesHerVoice, IS_HER, NOT_HER } from './voice-detector';

describe('telling her apart from a coach', () => {
	it('recognises every reply she could have said', () => {
		for (const reply of IS_HER) {
			expect(carriesHerVoice(reply), reply).toBe(true);
		}
	});

	it('rejects every reply a wellness app could have sent', () => {
		for (const reply of NOT_HER) {
			expect(carriesHerVoice(reply), reply).toBe(false);
		}
	});

	it('does not need a joke to pass', () => {
		// the prompt says so explicitly: "most replies carry a move. Not all of them need a taunt: a
		// short reply, a deflection or a one-word answer can stand on its own." A check that demands a
		// taunt flagged "fine. you asking me?" — a textbook deflection — as voiceless.
		expect(carriesHerVoice('fine. you asking me? what\'s up tonight?')).toBe(true);
		expect(carriesHerVoice("i'm fine. you're the one asking. how's your night going?")).toBe(true);
	});

	it('lets a real deflection pass and a real hunch pass', () => {
		expect(carriesHerVoice('k.')).toBe(true);
		expect(carriesHerVoice('hmm.')).toBe(true);
	});

	it('does not let a coach reply in by putting a laugh on the front', () => {
		// this is the failure mode of every marker-word check: the reply opens in her register and then
		// is a paragraph of advice. The coach register has to win over the opener.
		expect(carriesHerVoice('ha. it is important to get enough rest before an exam.')).toBe(false);
		expect(carriesHerVoice('good. consider reviewing your notes and taking a short walk.')).toBe(false);
	});

	it('reads the order verbs as hers only when she is not coaching', () => {
		// "take" and "get" and "start" are the words a wellness app uses to sound caring. Left in the
		// order list, they made "remember to take breaks" register as her.
		expect(carriesHerVoice('remember to take regular breaks throughout the day')).toBe(false);
		expect(carriesHerVoice('you should try to maintain a consistent sleep schedule')).toBe(false);
		expect(carriesHerVoice('eat something now.')).toBe(true);
	});
});
