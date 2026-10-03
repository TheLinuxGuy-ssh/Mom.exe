import { describe, expect, it } from 'vitest';
import { parseOneShot, isContentFree } from './generate';

const plan = {
	summary: 'eat properly and sleep on time tonight',
	blocks: [{ start: '20:00', end: '20:30', action: 'eat_meal', detail: 'eat something real', why: '' }],
	flags: []
};

function envelope(extra: Record<string, unknown>): string {
	return JSON.stringify(extra);
}

describe('parseOneShot intent routing', () => {
	it('reads a chat as chat and keeps it planless', () => {
		const r = parseOneShot(
			envelope({
				intent: 'chat',
				understanding: null,
				advice: 'that sounds like a lot. im here.',
				plan: null
			})
		);
		expect(r.intent).toBe('chat');
		expect(r.plan).toBeNull();
		expect(r.advice).toContain('here');
		expect(r.issue).toBeUndefined();
	});

	it('reads a normal planning note as plan', () => {
		const r = parseOneShot(envelope({ intent: 'plan', understanding: null, advice: null, plan }));
		expect(r.intent).toBe('plan');
		expect(r.plan).not.toBeNull();
	});

	it('believes a declared chat and drops the schedule she attached out of habit', () => {
		// this is the vent case: a reply plus a stray plan must still read as a conversation,
		// otherwise venting turns into a wall of blocks and they stop talking to her
		const r = parseOneShot(envelope({ intent: 'chat', understanding: null, advice: 'that sounds rough.', plan }));
		expect(r.intent).toBe('chat');
		expect(r.plan).toBeNull();
	});

	it('infers plan only when the model declared nothing usable', () => {
		const r = parseOneShot(envelope({ intent: 'sideways', understanding: null, advice: null, plan }));
		expect(r.intent).toBe('plan');
		expect(r.plan).not.toBeNull();
	});

	it('defaults to plan when the model forgets to declare intent', () => {
		const r = parseOneShot(envelope({ understanding: null, advice: null, plan }));
		expect(r.intent).toBe('plan');
	});

	it('refuses a chat that carries no reply, so we never show an empty dialog', () => {
		const r = parseOneShot(envelope({ intent: 'chat', understanding: null, advice: null, plan: null }));
		expect(r.intent).toBe('plan');
		expect(r.issue).toBe('chat intent carried no reply');
	});

	it('rejects a blank chat reply the same way', () => {
		const r = parseOneShot(envelope({ intent: 'chat', understanding: null, advice: '   ', plan: null }));
		expect(r.intent).toBe('plan');
	});

	it('flags a planning request that produced no plan, so a repair can fire', () => {
		const r = parseOneShot(envelope({ intent: 'plan', understanding: null, advice: null, plan: null }));
		expect(r.intent).toBe('plan');
		expect(r.plan).toBeNull();
		expect(r.issue).toBeTruthy();
	});

	it('keeps facts mentioned during a chat', () => {
		const r = parseOneShot(
			envelope({
				intent: 'chat',
				understanding: { sleep_hours: 4, meals: null, disturbances: [] },
				advice: 'four hours is rough.',
				plan: null
			})
		);
		expect(r.intent).toBe('chat');
		expect(r.understanding?.sleep_hours).toBe(4);
	});
});

describe('parseOneShot handoff', () => {
	it('carries a replan handoff out of a chat', () => {
		const r = parseOneShot(
			envelope({ intent: 'chat', understanding: null, advice: 'on it, closing this.', plan: null, handoff: 'replan' })
		);
		expect(r.intent).toBe('chat');
		expect(r.handoff).toBe('replan');
	});

	it('ignores a nonsense handoff rather than trusting it', () => {
		const r = parseOneShot(
			envelope({ intent: 'chat', understanding: null, advice: 'hi', plan: null, handoff: 'something_else' })
		);
		expect(r.handoff).toBeNull();
	});

	it('never lets a planning reply hand off', () => {
		const r = parseOneShot(envelope({ intent: 'plan', understanding: null, advice: null, plan, handoff: 'replan' }));
		expect(r.intent).toBe('plan');
	});
});

describe('parseOneShot digest', () => {
	it('reads digests alongside a plan', () => {
		const r = parseOneShot(
			envelope({
				intent: 'plan',
				understanding: null,
				advice: null,
				plan,
				digest: [{ week: '2026-09-28', text: 'settling in, running late on sleep' }]
			})
		);
		expect(r.digest).toEqual([{ week: '2026-09-28', text: 'settling in, running late on sleep' }]);
	});

	it('drops a malformed digest instead of failing the whole call', () => {
		const r = parseOneShot(
			envelope({
				intent: 'plan',
				understanding: null,
				advice: null,
				plan,
				digest: [{ week: 'not-a-date', text: 'x' }, { week: '2026-09-28', text: 'good week' }]
			})
		);
		expect(r.digest).toHaveLength(1);
		expect(r.digest[0].week).toBe('2026-09-28');
	});

	it('survives a digest that is not an array at all', () => {
		const r = parseOneShot(envelope({ intent: 'plan', understanding: null, advice: null, plan, digest: 'oops' }));
		expect(r.digest).toEqual([]);
		expect(r.plan).not.toBeNull();
	});
});

describe('parseOneShot resilience', () => {
	it('still recovers a plan through normalize', () => {
		const r = parseOneShot(
			envelope({
				intent: 'plan',
				understanding: null,
				advice: null,
				plan: { summary: 'a reasonable summary here', blocks: plan.blocks, flags: [], extra: 'ignored' }
			})
		);
		expect(r.plan?.summary).toBe('a reasonable summary here');
	});

	it('returns a usable shape when the model returns prose', () => {
		const r = parseOneShot('I think you should eat dinner');
		expect(r.intent).toBe('plan');
		expect(r.plan).toBeNull();
		expect(r.issue).toBeTruthy();
	});
});

describe('isContentFree', () => {
	it('treats no note as a request to just plan', () => {
		expect(isContentFree(null)).toBe(true);
	});

	it('treats empty and punctuation-only notes as a request to just plan', () => {
		expect(isContentFree('')).toBe(true);
		expect(isContentFree('   ')).toBe(true);
		expect(isContentFree('.')).toBe(true);
		expect(isContentFree('??')).toBe(true);
	});

	it('recognises the things a person types when they cannot be bothered', () => {
		for (const t of ['idk', 'idk?', 'idk what to do', 'hm', 'hmm', 'idk.', 'whatever', 'k']) {
			expect(isContentFree(t)).toBe(true);
		}
	});

	it('still recognises greetings as empty, since they are not a scheduling request', () => {
		expect(isContentFree('hey')).toBe(true);
		expect(isContentFree('ok')).toBe(true);
	});

	it('never swallows a real note', () => {
		for (const t of [
			'could not drink water at 9:30, friends were in',
			'slept like 4 hrs skipped dinner too',
			'why do i keep waking at 3am',
			'idk what to do about tomorrow, lab until 7',
			'i feel stuck, nothing is working'
		]) {
			expect(isContentFree(t)).toBe(false);
		}
	});
});
