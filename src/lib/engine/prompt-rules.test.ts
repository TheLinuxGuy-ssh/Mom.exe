import { describe, expect, it } from 'vitest';
import {
	CHAT_MIN,
	NOTE_MIN,
	chatReady,
	idleLabel,
	noteLength,
	noteReady,
	noteShortfall,
	readyLabel
} from './prompt-rules';

describe('note minimum', () => {
	it('is ten characters', () => {
		expect(NOTE_MIN).toBe(10);
	});

	it('rejects an empty or whitespace-only note', () => {
		for (const t of ['', ' ', '   ', '\n', '\t\n  ']) {
			expect(noteReady(t)).toBe(false);
			expect(noteLength(t)).toBe(0);
		}
	});

	it('rejects anything shorter than ten real characters', () => {
		expect(noteReady('rough')).toBe(false);
		expect(noteReady('slept 4')).toBe(false);
		expect(noteLength('slept 4')).toBe(7);
	});

	it('accepts exactly ten', () => {
		expect(noteReady('slept four')).toBe(true);
		expect(noteLength('slept four')).toBe(10);
		expect(noteReady('rough day ok')).toBe(true);
		expect(noteShortfall('rough day ok')).toBe(0);
	});

	it('does not count padding as content', () => {
		expect(noteReady('   rough   ')).toBe(false);
		expect(noteLength('   rough   ')).toBe(5);
		expect(noteReady('   totally fine   ')).toBe(true);
	});

	it('tells the student exactly how much more is needed', () => {
		expect(noteShortfall('')).toBe(10);
		expect(noteShortfall('   ')).toBe(10);
		expect(noteShortfall('rough')).toBe(5);
		expect(noteShortfall('slept four')).toBe(0);
	});
});

describe('chat minimum', () => {
	it('is one character, because she is already listening', () => {
		expect(CHAT_MIN).toBe(1);
		expect(chatReady('k')).toBe(true);
		expect(chatReady('ok')).toBe(true);
	});

	it('still refuses whitespace and nothing', () => {
		for (const t of ['', ' ', '  \n ']) {
			expect(chatReady(t)).toBe(false);
		}
	});
});

describe('idle labels', () => {
	it('speaks differently across the day', () => {
		const labels = [0, 3, 8, 12, 15, 18, 21].map(idleLabel);
		expect(new Set(labels).size).toBeGreaterThan(4);
	});

	it('has something for every hour of the day', () => {
		for (let h = 0; h < 24; h++) {
			expect(idleLabel(h).length).toBeGreaterThan(0);
		}
	});

	it('does not shout for help in the middle of the night', () => {
		expect(idleLabel(2)).toBe('still up? talk to me');
		expect(idleLabel(4)).toBe('still up? talk to me');
	});

	it('asks for help normally in the morning', () => {
		expect(idleLabel(9)).toBe('help me MOM!');
	});

	it('shortens once there is something to send', () => {
		expect(readyLabel(9)).toBe('Ask Mom');
		expect(readyLabel(2)).toBe('tell me');
	});

	it('never leaves the button blank at any hour', () => {
		for (let h = 0; h < 24; h++) {
			expect(readyLabel(h).trim().length).toBeGreaterThan(0);
		}
	});
});
