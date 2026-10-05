import { describe, expect, it } from 'vitest';
import { buildHistory, chatPreview, type ChatEntry } from './history';
import type { Message, Plan } from '../storage/types';

function plan(id: string, created: string): Plan {
	return {
		id,
		user_id: 'u1',
		local_date: '2026-10-03',
		as_of: created,
		context_snapshot: {},
		output: { summary: `plan ${id}`, blocks: [], flags: [] },
		basis: 'full',
		model_id: 'm',
		fallback_reason: null,
		supersedes_plan_id: null,
		created_at: created
	};
}

function msg(
	date: string,
	role: 'user' | 'mom',
	content: string,
	kind: Message['kind'] = 'chat',
	at = '',
	session_id: string | null = null
): Message {
	return {
		id: `${date}-${role}-${content.slice(0, 6)}`,
		user_id: 'u1',
		local_date: date,
		role,
		kind,
		content,
		created_at: at || `${date}T10:00:00.000Z`,
		session_id
	};
}

describe('buildHistory', () => {
	const plans = [plan('p1', '2026-10-03T09:00:00.000Z'), plan('p2', '2026-10-02T09:00:00.000Z')];
	const messages = [
		msg('2026-10-03', 'user', 'how is it going', 'chat', '2026-10-03T20:00:00.000Z'),
		msg('2026-10-03', 'mom', 'going fine', 'chat', '2026-10-03T20:00:10.000Z'),
		msg('2026-10-01', 'user', 'rough night', 'note', '2026-10-01T08:00:00.000Z')
	];

	it('interleaves plans and conversations newest first', () => {
		const { entries } = buildHistory(plans, messages, 'all');
		const kinds = entries.map((e) => e.kind);
		expect(kinds[0]).toBe('chat'); // the 20:00 conversation beats the 09:00 plan
		// 2 plans + 2 grouped days of messages
		expect(entries).toHaveLength(4);
	});

	it('filters down to plans only', () => {
		const { entries } = buildHistory(plans, messages, 'plans');
		expect(entries.every((e) => e.kind === 'plan')).toBe(true);
		expect(entries).toHaveLength(2);
	});

	it('filters down to conversations only', () => {
		const { entries } = buildHistory(plans, messages, 'chats');
		expect(entries.every((e) => e.kind === 'chat')).toBe(true);
	});

	it("groups a day's messages into one conversation", () => {
		const { entries } = buildHistory([], messages, 'chats');
		const first = entries[0];
		expect(first.kind).toBe('chat');
		if (first.kind === 'chat') expect(first.messages).toHaveLength(2);
	});

	it('keeps messages inside a day in the order they were said', () => {
		const { entries } = buildHistory([], messages, 'chats');
		const e = entries.find((x) => x.kind === 'chat' && x.date === '2026-10-03');
		if (e?.kind === 'chat') {
			expect(e.messages.map((m) => m.role)).toEqual(['user', 'mom']);
		}
	});

	it('reports a fresh account as empty on both', () => {
		const { entries, hasAnything, emptyReason } = buildHistory([], [], 'all');
		expect(entries).toEqual([]);
		expect(hasAnything).toBe(false);
		expect(emptyReason).toBe('both');
	});

	it('is not empty when only plans exist', () => {
		const r = buildHistory(plans, [], 'all');
		expect(r.hasAnything).toBe(true);
		expect(r.emptyReason).toBeNull();
	});

	it('treats a note without any chat as not yet a conversation', () => {
		const { hasAnything } = buildHistory([], [msg('2026-10-01', 'user', 'rough night', 'note')], 'all');
		expect(hasAnything).toBe(false);
	});
});

describe('chatPreview', () => {
	it('leads with what the student said', () => {
		expect(chatPreview([msg('2026-10-03', 'mom', 'hi'), msg('2026-10-03', 'user', 'bad day')])).toBe('bad day');
	});

	it('flattens a multi-line note into one line', () => {
		expect(chatPreview([msg('2026-10-03', 'user', 'line one\n  line two')])).toBe('line one line two');
	});

	it('truncates a long note rather than blowing out the row', () => {
		expect(chatPreview([msg('2026-10-03', 'user', 'x'.repeat(200))]).length).toBeLessThanOrEqual(93);
	});

	it('copes with a reply that somehow has no user message', () => {
		expect(chatPreview([msg('2026-10-03', 'mom', 'hello')])).toBe('a conversation');
	});
});

describe('sessions', () => {
	it('files two chats on the same day as two conversations', () => {
		// one evening, app opened twice: the second chat started on an empty screen, so reading
		// them as one continuous thread would be a lie about what happened
		const entries = buildHistory(
			[],
			[
				msg('2026-10-03', 'user', 'hey ma', 'chat', '2026-10-03T18:00:00.000Z', 's1'),
				msg('2026-10-03', 'mom', 'ha. what is it', 'chat', '2026-10-03T18:00:30.000Z', 's1'),
				msg('2026-10-03', 'user', 'you around?', 'chat', '2026-10-03T21:10:00.000Z', 's2'),
				msg('2026-10-03', 'mom', 'I am always around', 'chat', '2026-10-03T21:10:20.000Z', 's2')
			],
			'chats'
		).entries as ChatEntry[];

		expect(entries).toHaveLength(2);
		expect(entries.map((e) => e.sessionId)).toEqual(['s2', 's1']);
		expect(entries[0].messages[0].content).toBe('you around?');
		expect(entries[1].messages).toHaveLength(2);
	});

	it('keeps each session in chronological order inside itself', () => {
		const entries = buildHistory(
			[],
			[
				msg('2026-10-03', 'mom', 'second', 'chat', '2026-10-03T18:05:00.000Z', 's1'),
				msg('2026-10-03', 'user', 'first', 'chat', '2026-10-03T18:00:00.000Z', 's1')
			],
			'chats'
		).entries as ChatEntry[];

		expect(entries[0].messages.map((m) => m.content)).toEqual(['first', 'second']);
	});

	it('reads rows written before sessions as one conversation per day', () => {
		// no backfill on purpose: inventing ids would split chats that were genuinely continuous
		const entries = buildHistory(
			[],
			[
				msg('2026-10-02', 'user', 'morning', 'chat', '2026-10-02T09:00:00.000Z'),
				msg('2026-10-02', 'mom', 'morning?', 'chat', '2026-10-02T09:00:10.000Z'),
				msg('2026-10-03', 'user', 'morning', 'chat', '2026-10-03T09:00:00.000Z')
			],
			'chats'
		).entries as ChatEntry[];

		expect(entries).toHaveLength(2);
		expect(entries.map((e) => e.sessionId)).toEqual([null, null]);
		expect(entries[1].messages).toHaveLength(2);
	});

	it('does not let sessions merge two different days into one', () => {
		const entries = buildHistory(
			[],
			[
				msg('2026-10-02', 'user', 'a', 'chat', '2026-10-02T23:00:00.000Z', 's1'),
				msg('2026-10-03', 'user', 'b', 'chat', '2026-10-03T07:00:00.000Z', 's2')
			],
			'chats'
		).entries as ChatEntry[];

		expect(entries).toHaveLength(2);
	});
});

describe('entry identity', () => {
	/**
	 * The rows on the history page are a keyed each block. Keying a conversation on its date made
	 * two chats on the same afternoon collide, and the page died with each_key_duplicate. These
	 * cover the shape that broke it: same day, different sessions.
	 */
	function keysFor(messages: Message[]): string[] {
		return (buildHistory([], messages, 'chats').entries as ChatEntry[]).map(
			(e) => `chat-${e.sessionId ?? `${e.date}-${e.messages[0]?.id ?? 'x'}`}`
		);
	}

	it('gives two sessions on the same day different keys', () => {
		const keys = keysFor([
			msg('2026-10-04', 'user', 'first', 'chat', '2026-10-04T18:00:00.000Z', 's1'),
			msg('2026-10-04', 'user', 'second', 'chat', '2026-10-04T21:00:00.000Z', 's2')
		]);
		expect(keys).toHaveLength(2);
		expect(new Set(keys).size).toBe(2);
	});

	it('keeps pre-session rows as one conversation per day, so they cannot collide', () => {
		// without a session id the fallback key is the date, which is only safe because rows that
		// predate sessions are grouped by day in the first place: exactly one entry per date
		const sameDay = keysFor([
			msg('2026-10-04', 'user', 'a', 'chat', '2026-10-04T18:00:00.000Z'),
			msg('2026-10-04', 'mom', 'b', 'chat', '2026-10-04T21:00:00.000Z')
		]);
		expect(sameDay).toHaveLength(1);

		const twoDays = keysFor([
			msg('2026-10-03', 'user', 'a', 'chat', '2026-10-03T18:00:00.000Z'),
			msg('2026-10-04', 'user', 'b', 'chat', '2026-10-04T18:00:00.000Z')
		]);
		expect(new Set(twoDays).size).toBe(2);
	});

	it('keeps a session key stable across rebuilds, so an expanded row stays expanded', () => {
		const rows = [
			msg('2026-10-04', 'user', 'a', 'chat', '2026-10-04T18:00:00.000Z', 's1'),
			msg('2026-10-04', 'mom', 'b', 'chat', '2026-10-04T18:00:20.000Z', 's1')
		];
		expect(keysFor(rows)).toEqual(keysFor(rows.slice().reverse()));
	});
});

describe('telling a planning exchange apart from a conversation', () => {
	it('includes her side of a replan, which used to be missing entirely', () => {
		// her answer to a planning request is logged as the replan. Leaving that kind out of the
		// history showed the student talking into a void with no reply on the fridge door.
		const entries = buildHistory(
			[],
			[
				msg('2026-10-04', 'user', 'shift my study to midnight', 'note', '2026-10-04T20:10:00.000Z', 's1'),
				msg('2026-10-04', 'mom', 'study till midnight then wind down.', 'replan', '2026-10-04T20:10:30.000Z', 's1')
			],
			'chats'
		).entries as ChatEntry[];

		expect(entries).toHaveLength(1);
		expect(entries[0].messages).toHaveLength(2);
	});

	it('marks a session that rearranged the day as a plan, not a conversation', () => {
		const entries = buildHistory(
			[],
			[
				msg('2026-10-04', 'user', 'hey ma', 'chat', '2026-10-04T18:00:00.000Z', 's1'),
				msg('2026-10-04', 'mom', 'ha. what is it', 'chat', '2026-10-04T18:00:30.000Z', 's1'),
				msg('2026-10-04', 'user', 'shift my study', 'note', '2026-10-04T20:10:00.000Z', 's1'),
				msg('2026-10-04', 'mom', 'done. midnight then bed.', 'replan', '2026-10-04T20:10:30.000Z', 's1')
			],
			'chats'
		).entries as ChatEntry[];

		// one session, one row on the fridge door, and it is a planning one
		expect(entries).toHaveLength(1);
		expect(entries[0].isPlan).toBe(true);
	});

	it('leaves a session that was only talking marked as a conversation', () => {
		const entries = buildHistory(
			[],
			[
				msg('2026-10-04', 'user', 'hey ma', 'chat', '2026-10-04T18:00:00.000Z', 's1'),
				msg('2026-10-04', 'mom', 'ha. what is it', 'chat', '2026-10-04T18:00:30.000Z', 's1')
			],
			'chats'
		).entries as ChatEntry[];

		expect(entries[0].isPlan).toBe(false);
	});
});
