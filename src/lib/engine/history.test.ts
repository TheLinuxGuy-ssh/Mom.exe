import { describe, expect, it } from 'vitest';
import { buildHistory, chatPreview } from './history';
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

function msg(date: string, role: 'user' | 'mom', content: string, kind: Message['kind'] = 'chat', at = ''): Message {
	return {
		id: `${date}-${role}-${content.slice(0, 6)}`,
		user_id: 'u1',
		local_date: date,
		role,
		kind,
		content,
		created_at: at || `${date}T10:00:00.000Z`
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
