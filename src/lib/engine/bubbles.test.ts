import { describe, expect, it } from 'vitest';
import { bubbleDelay, splitBubbles } from './bubbles';

describe('short replies stay whole', () => {
	it('returns one bubble for a one liner', () => {
		expect(splitBubbles('fine.')).toEqual(['fine.']);
		expect(splitBubbles('k.')).toEqual(['k.']);
		expect(splitBubbles('eat something.')).toEqual(['eat something.']);
	});

	it('does not split a two sentence reply that already fits', () => {
		const out = splitBubbles('drink water. then sleep.');
		expect(out).toHaveLength(1);
	});

	it('handles empty and whitespace input without inventing a bubble', () => {
		expect(splitBubbles('')).toEqual([]);
		expect(splitBubbles('   ')).toEqual([]);
	});
});

describe('long replies break into a burst', () => {
	it('splits the failing case into beats', () => {
		// the real three bubble reply she should have sent that morning
		const reply =
			'hehe. so you wake up and think of me first? or was it the phone. be honest. did you eat anything?';
		const out = splitBubbles(reply);
		expect(out.length).toBeGreaterThan(1);
		expect(out[0]).toContain('hehe');
		expect(out.join(' ')).toContain('did you eat anything?');
	});

	it('leaves a reply that already fits as one bubble', () => {
		const reply = 'did you eat? or did you just wake up and open this.';
		expect(reply.length).toBeLessThanOrEqual(96);
		expect(splitBubbles(reply)).toHaveLength(1);
	});

	it('never loses or invents words', () => {
		const reply = 'first part here. second part follows. third part closes it out. fourth closes.';
		const out = splitBubbles(reply);
		const rejoined = out.join(' ').replace(/\s+/g, ' ').trim();
		expect(rejoined).toBe(reply);
	});

	it('caps at three bubbles, folding the tail in', () => {
		const long = 'one two three. four five six. seven eight. nine ten. eleven twelve.';
		const out = splitBubbles(long);
		expect(out.length).toBeLessThanOrEqual(3);
		expect(out.join(' ')).toContain('eleven twelve');
	});

	it('keeps every bubble non empty', () => {
		const out = splitBubbles(
			'alpha one here now. beta two here now. gamma three here now. delta four here now.'
		);
		for (const b of out) expect(b.trim().length).toBeGreaterThan(0);
	});
});

describe('punctuation handling', () => {
	it('does not break on an abbreviation', () => {
		const out = splitBubbles('I need it done by 9 a.m. tomorrow and then we can talk about it properly.');
		expect(out).toHaveLength(1);
	});

	it('does not break after "no." mid sentence', () => {
		const out = splitBubbles('no. that is not what I asked you at all, not even slightly.');
		expect(out).toHaveLength(1);
	});

	it('splits on a question mark once the reply is long enough', () => {
		const out = splitBubbles(
			'are you actually awake at this hour? good, that is one thing at least. answer the phone right now, please.'
		);
		expect(out.length).toBeGreaterThan(1);
		expect(out[0]).toContain('awake');
	});

	it('leaves a single very long sentence whole rather than cutting it', () => {
		const single =
			'this is one enormous sentence with no full stop anywhere in it at all and it just keeps going and going well past any sensible bubble limit';
		expect(splitBubbles(single)).toEqual([single]);
	});

	it('collapses runs of whitespace inside a bubble', () => {
		expect(splitBubbles('eat   something.\n\nthen sleep.')).toEqual([
			'eat something. then sleep.'
		]);
	});
});

describe('bubbleDelay', () => {
	it('shows the first bubble immediately', () => {
		expect(bubbleDelay(0)).toBe(0);
	});

	it('paces the rest', () => {
		expect(bubbleDelay(1)).toBeGreaterThan(0);
		expect(bubbleDelay(2)).toBeGreaterThan(0);
	});

	it('stays short enough not to feel like a wait', () => {
		expect(bubbleDelay(1)).toBeLessThanOrEqual(1000);
	});
});

describe('determinism', () => {
	it('returns identical output for identical input', () => {
		const reply = 'first beat here. second beat here. third beat right here.';
		expect(splitBubbles(reply)).toEqual(splitBubbles(reply));
	});

	it('round trips back to the original text', () => {
		const replies = [
			'fine.',
			'hehe. so you wake up and think of me first? or was it the phone. be honest.',
			'a. b. c. d. e. f. g.',
			'no. that is not it.'
		];
		for (const r of replies) {
			const joined = splitBubbles(r).join(' ').replace(/\s+/g, ' ').trim();
			expect(joined).toBe(r.replace(/\s+/g, ' ').trim());
		}
	});
});
describe('length, not punctuation, decides the bubble count', () => {
	/**
	 * The mechanism behind "she is replying twice". A reply longer than 96 characters is split, so
	 * concatenating two fields into one stored message reliably renders as two bubbles on screen.
	 * Two short sentences stay in one bubble; the same two sentences padded past the ceiling do
	 * not. Redundant source text therefore has to be fixed where it is written, not hidden here.
	 */
	it('keeps a short reply in one bubble however many sentences it has', () => {
		expect(splitBubbles('fine. eat, then bed. and no laptop.')).toHaveLength(1);
	});

	it('splits a reply that runs past the ceiling', () => {
		const joined =
			'study till midnight, then wind down and sleep. you will get the rest you need. finish your day and get to bed by 23:30. you will feel better after a proper rest.';
		expect(splitBubbles(joined).length).toBeGreaterThan(1);
	});
});
