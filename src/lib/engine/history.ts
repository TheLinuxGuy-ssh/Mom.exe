import type { Message, Plan } from '../storage/types';

export type HistoryTab = 'all' | 'plans' | 'chats';

export interface PlanEntry {
	kind: 'plan';
	at: string;
	plan: Plan;
}

export interface ChatEntry {
	kind: 'chat';
	at: string;
	date: string;
	/** null for conversations written before sessions existed, which group by day */
	sessionId: string | null;
	/**
	 * True when the session contains a planning exchange rather than only talking. A session where
	 * the day got rearranged is a different thing on the fridge door from a conversation, and it
	 * was being labelled and drawn as one.
	 */
	isPlan: boolean;
	messages: Message[];
}

export type HistoryEntry = PlanEntry | ChatEntry;

/**
 * The fridge door in one list: plans and conversations interleaved by when they happened, so
 * "what did mom and I get up to" reads as a single thread rather than two separate logs.
 */
export function buildHistory(
	plans: Plan[],
	messages: Message[],
	tab: HistoryTab
): { entries: HistoryEntry[]; hasAnything: boolean; emptyReason: 'plans' | 'chats' | 'both' | null } {
	const planEntries: PlanEntry[] =
		tab === 'chats' ? [] : plans.map((plan) => ({ kind: 'plan' as const, at: plan.created_at, plan }));

	// 'replan' belongs in here too. It was left out, which meant a planning exchange showed only
	// the student's side of it, because her answer is the line logged as the replan.
	const chatEntries: ChatEntry[] =
		tab === 'plans'
			? []
			: groupChats(messages.filter((m) => m.kind === 'chat' || m.kind === 'note' || m.kind === 'replan'));

	const entries: HistoryEntry[] = [...planEntries, ...chatEntries].sort((a, b) =>
		a.at < b.at ? 1 : a.at > b.at ? -1 : 0
	);

	const hasAnything = plans.length > 0 || messages.some((m) => m.kind === 'chat');
	const emptyReason: 'plans' | 'chats' | 'both' | null = hasAnything
		? null
		: plans.length > 0
			? 'plans'
			: messages.length > 0
				? 'chats'
				: 'both';

	return { entries, hasAnything, emptyReason };
}

/**
 * One entry per session, not per day. Someone who opens the app twice in an evening had two
 * conversations, and reading them as a single unbroken one is a lie about what happened: the
 * second chat started with the screen empty. Rows from before sessions existed have no session
 * id, so they fall back to grouping by day, which is how they were already being read.
 */
function groupChats(messages: Message[]): ChatEntry[] {
	const bySession = new Map<string, Message[]>();
	for (const m of messages) {
		const key = m.session_id ?? `date:${m.local_date}`;
		const list = bySession.get(key) ?? [];
		list.push(m);
		bySession.set(key, list);
	}
	return [...bySession.values()]
		.map((list) => {
			const sorted = list.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
			const first = sorted[0];
			return {
				kind: 'chat' as const,
				at: first?.created_at ?? `${first?.local_date ?? ''}T00:00:00.000Z`,
				date: first?.local_date ?? '',
				sessionId: first?.session_id ?? null,
				isPlan: sorted.some((m) => m.kind === 'note' || m.kind === 'replan'),
				messages: sorted
			};
		})
		.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** First line of what the student said, for a one-line summary of a conversation. */
export function chatPreview(messages: Message[]): string {
	const first = messages.find((m) => m.role === 'user');
	if (!first) return 'a conversation';
	const oneLine = first.content.replace(/\s+/g, ' ').trim();
	return oneLine.length > 90 ? `${oneLine.slice(0, 90)}...` : oneLine;
}
