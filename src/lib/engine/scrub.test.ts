import { describe, expect, it } from 'vitest';
import { scrubText, ageBand } from './scrub';

describe('scrubbing names', () => {
	it('takes out a name that is spelled out', () => {
		expect(scrubText('my name is priya and i skipped lunch')).toBe(
			'[name removed] and i skipped lunch'
		);
		expect(scrubText("my name's Arjun")).toBe('[name removed]');
		expect(scrubText("i'm Arun and roommates were loud")).toBe(
			'[name removed] and roommates were loud'
		);
		expect(scrubText('i am Priya')).toBe('[name removed]');
	});

	/**
	 * These four are the regression this file exists for. The pattern used to be case-insensitive,
	 * so `[A-Z]` matched a lowercase `t` and the mood word — the entire content of the note — was
	 * replaced. Messages are stored scrubbed, so this was permanent, and the student saw their own
	 * words mangled in the history with nothing to explain it.
	 */
	it('leaves ordinary sentences exactly as they were written', () => {
		expect(scrubText('im tired again, slept at 2')).toBe('im tired again, slept at 2');
		expect(scrubText('i am so tired, woke at 5')).toBe('i am so tired, woke at 5');
		expect(scrubText('im stressed about the exam')).toBe('im stressed about the exam');
		expect(scrubText('call me back when you can')).toBe('call me back when you can');
		expect(scrubText('i am in hostel block c')).toBe('i am in hostel block c');
		expect(scrubText('i am fine honestly')).toBe('i am fine honestly');
	});

	it('does not treat a capitalised ordinary word as a name', () => {
		expect(scrubText('I am Tired')).toBe('I am Tired');
		expect(scrubText('I am Fine, thanks')).toBe('I am Fine, thanks');
	});

	it('is honest about the gap it cannot close', () => {
		// no capital, no "my name is", and no dictionary of given names: "im arun" reads the same
		// as "im tired". this is the documented limit of scrubbing by pattern
		expect(scrubText('im arun')).toBe('im arun');
	});
});

describe('scrubbing numbers', () => {
	it('takes out phone numbers', () => {
		expect(scrubText('my phone is 9876543210')).toBe('my phone is [phone number]');
		expect(scrubText('reach me on +91 98765 43210')).toBe('reach me on [phone number]');
	});

	it('keeps dates, which are the most useful thing in a note about an assignment', () => {
		// 2026-11-04 is a long run of digits and dashes, and used to be scrubbed as a phone number
		expect(scrubText('deadline is 2026-11-04 for the dsa assignment')).toBe(
			'deadline is 2026-11-04 for the dsa assignment'
		);
		expect(scrubText('submitted on 2026-09-30')).toBe('submitted on 2026-09-30');
	});

	it('keeps clock times', () => {
		expect(scrubText('slept at 23:30, woke at 07:15')).toBe('slept at 23:30, woke at 07:15');
		expect(scrubText('roommates were loud till 3am')).toBe('roommates were loud till 3am');
	});

	it('keeps short numbers that cannot be phone numbers', () => {
		expect(scrubText('room 214, block c')).toBe('room 214, block c');
		expect(scrubText('slept about 6 hours, ate at 9')).toBe('slept about 6 hours, ate at 9');
	});
});

describe('scrubbing everything else', () => {
	it('takes out email addresses and links', () => {
		expect(scrubText('email me at priya@iiit.ac.in')).toBe('email me at [email]');
		expect(scrubText('sketch is at https://drive.google.com/x')).toBe('sketch is at [link]');
	});

	it('leaves a plain note completely untouched', () => {
		const note = 'slept at 1, had a messy breakfast, roommates were loud till 3am, dsa due friday';
		expect(scrubText(note)).toBe(note);
	});
});

describe('age bands', () => {
	it('bands by year, and says so when it cannot', () => {
		expect(ageBand(null, 2026)).toBe('unknown');
		expect(ageBand(2010, 2026)).toBe('under_18');
		expect(ageBand(2005, 2026)).toBe('18-21');
		expect(ageBand(2001, 2026)).toBe('22-25');
		expect(ageBand(1990, 2026)).toBe('26_plus');
	});
});