/**
 * She answered "hey ma how are you?" with the same "how did you sleep" line twice in one sitting,
 * for the same student, because the dialogue corpus held exactly one answer to the most common
 * thing anyone types into this app. These tests pin the two halves of the fix: the corpus has to
 * offer more than one way through, and the pipeline has to catch a repeat even when the model ignores
 * every instruction about it.
 */
import { describe, expect, it } from 'vitest';
import { DIALOGUE } from './dialogue';
import { buildClassifyFirstMessages, findRepeatedReply, buildRepairMessages } from './prompt';
import type { ContextPayload } from '../engine/context';

describe('greeting variance', () => {
	const greetings = DIALOGUE.filter((p) => p.move === 'greeting-rebuke');
	const howAreYou = greetings.filter((p) => /how (are|r) you|how you doing/i.test(p.user));

	it('answers "how are you" more than one way', () => {
		// it had exactly one exemplar, and a verbatim script in context beats a prompt rule
		expect(howAreYou.length).toBeGreaterThanOrEqual(4);
	});

	it('gives each of them a different reply', () => {
		const replies = howAreYou.map((p) => p.mom);
		expect(new Set(replies).size).toBe(replies.length);
	});

	it('does not leave one greeting answering for all of them', () => {
		// the specific shipped bug: "how did you sleep" was her answer to everything
		const sleepers = howAreYou.filter((p) => /how did you sleep/i.test(p.mom));
		expect(sleepers.length).toBeLessThan(howAreYou.length);
	});

	it('does not open every greeting the same way', () => {
		const openings = howAreYou.map((p) => p.mom.split(/\s+/).slice(0, 2).join(' ').toLowerCase());
		// a corpus where every line opens the same way is a corpus where every line is the same line
		expect(new Set(openings).size).toBeGreaterThanOrEqual(3);
	});
});

describe('findRepeatedReply', () => {
	const window = [
		{ role: 'user', text: 'hey ma how are you?' },
		{ role: 'mom', text: "I'm fine, you're the one texting at this hour. how did you sleep." },
		{ role: 'user', text: 'just chillin here, what about you!?' }
	];

	it('catches the reply she already gave, ignoring punctuation and case', () => {
		expect(
			findRepeatedReply("i'm fine, you're the one texting at this hour. how did you sleep", window)
		).toBe("I'm fine, you're the one texting at this hour. how did you sleep.");
	});

	it('catches it through the ellipsis and capitalisation she would actually use', () => {
		expect(
			findRepeatedReply('I\'m fine. You\'re the one texting at this hour! How did you sleep?', window)
		).not.toBeNull();
	});

	it('catches the same sentence with a greeting stapled on', () => {
		// this is the exact miss from the live replay: turn one came back "hey, i'm fine. you're
		// the one texting at this hour. how did you sleep?" and turn two came back without the
		// "hey," — the same sentence, and an exact comparison called them different.
		const first = [{ role: 'mom', text: 'hey, i’m fine. you’re the one texting at this hour. how did you sleep?' }];
		expect(findRepeatedReply("i'm fine. you're the one texting at this hour. how did you sleep?", first)).not.toBeNull();
		expect(
			findRepeatedReply('hey, I’m fine. You’re the one texting at this hour. How did you sleep?', [
				{ role: 'mom', text: "i'm fine. you're the one texting at this hour. how did you sleep?" }
			])
		).not.toBeNull();
	});

	it('treats quoting her own last sentence back as a repeat, however it ends', () => {
		// this changed during the session. Restating a line and building on it used to be allowed
		// through as a callback, and a live run used that gap to send the same opening twice in a
		// row. Quoting yourself word for word is repetition whatever you tack on the end.
		const earlier = [{ role: 'mom', text: 'you said the gym is off tonight, and you were right.' }];
		expect(
			findRepeatedReply('you said the gym is off tonight, and you were right. was it the room?', earlier)
		).not.toBeNull();
	});

	it('leaves a genuinely new reply alone', () => {
		expect(findRepeatedReply('Thriving, thanks for asking. You look tired though.', window)).toBeNull();
	});

	it('only ever counts her own earlier replies', () => {
		// the student saying the same thing is not repetition, it is an echo
		expect(findRepeatedReply('hey ma how are you?', window)).toBeNull();
	});

	it('still lets a callback to something further back through', () => {
		// she is supposed to hold receipts on old lines. retrying those would spend the
		// student's wait reworking a line that was working.
		const older = [
			{ role: 'mom', text: 'drink water, eat something, stretch' },
			{ role: 'mom', text: 'now go and sleep, you have had a day' },
			{ role: 'user', text: 'ok' }
		];
		expect(findRepeatedReply('drink water, eat something, stretch', older)).toBeNull();
	});

it('catches her previous sentence quoted back with a clause appended', () => {
		// the live run: the second reply opened with the first reply's whole sentence and then
		// carried on. The length ratio read as a callback and let it through; to the student it was
		// the same two sentences. Opening a reply with the sentence you just sent is repetition
		// whatever follows it.
		const last = [{ role: 'mom', text: "hey, i'm fine. you say you're asking how i am, so tell me how your night is going." }];
		expect(
			findRepeatedReply(
				"hey, i'm fine. you say you're asking how i am, so tell me how your night is going. you're always checking in at 10pm love.",
				last
			)
		).not.toBeNull();
	});

	it('allows a callback that reopens differently', () => {
		const last = [{ role: 'mom', text: 'the gym is optional, love, you have said so all week.' }];
		expect(
			findRepeatedReply('still saying the gym is optional. fine, but go in the morning then.', last)
		).toBeNull();
	});

	it('ignores fragments too short to mean anything', () => {
		expect(findRepeatedReply('good', [{ role: 'mom', text: 'good' }])).toBeNull();
	});

	it('is empty-safe', () => {
		expect(findRepeatedReply('a real reply here', [])).toBeNull();
	});
});

describe('repair for a repeated line', () => {
	it('names the line she already said and asks for different words', () => {
		const messages = buildRepairMessages(
			[{ role: 'user', content: 'hey ma how are you?' }],
			'{"advice":"how did you sleep"}',
			'you already said: how did you sleep',
			'repeat'
		);
		const last = messages[messages.length - 1]!.content;
		expect(last).toContain('how did you sleep');
		expect(last).toMatch(/different words/i);
		// and it must not send the model back to the examples it copied from
		expect(last).toMatch(/do not reuse any line from the examples/i);
	});
});

describe('classifier sees the conversation it is routing', () => {
	const payload = {
		conversation: {
			recent: [
				{ role: 'user', text: 'hey ma how are you' },
				{ role: 'mom', text: "I'm fine, you're the one texting at this hour. how did you sleep." },
				{ role: 'user', text: 'just chillin here, what about you!?' }
			]
		}
	} as unknown as ContextPayload;

	const sent = JSON.parse(buildClassifyFirstMessages('lets just talk for a while', payload)[1]!.content);

	it('is given the recent messages, not just the note', () => {
		// "leave the schedule for a bit, lets talk" read as a plan mutation because the classifier
		// had never seen that this turn is the middle of a conversation
		expect(Array.isArray(sent.recent)).toBe(true);
		expect(sent.recent.length).toBe(3);
		expect(sent.recent[0].role).toBe('user');
	});

	it('keeps the window small, because a late verdict is a dropped verdict', () => {
		const long = {
			conversation: {
				recent: Array.from({ length: 20 }, (_, i) => ({
					role: i % 2 ? 'mom' : 'user',
					text: 'x'.repeat(600)
				}))
			}
		} as unknown as ContextPayload;
		const out = JSON.parse(buildClassifyFirstMessages('hi', long)[1]!.content);
		// four messages at 160 chars is about 170 tokens; the classifier has to land inside the
		// grace window or the model decides intent alone and chats start turning into plans
		expect(out.recent.length).toBe(4);
		expect(JSON.stringify(out).length).toBeLessThan(1200);
	});

	it('still sends the note', () => {
		expect(sent.note).toBe('lets just talk for a while');
	});

	it('works with no conversation at all', () => {
		const none = buildClassifyFirstMessages('hi', {} as ContextPayload)[1]!.content;
		expect(JSON.parse(none).recent).toEqual([]);
	});
});
