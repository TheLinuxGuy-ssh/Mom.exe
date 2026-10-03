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

	const chatEntries: ChatEntry[] =
		tab === 'plans'
			? []
			: groupChats(messages.filter((m) => m.kind === 'chat' || m.kind === 'note'));

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

function groupChats(messages: Message[]): ChatEntry[] {
	const byDate = new Map<string, Message[]>();
	for (const m of messages) {
		const list = byDate.get(m.local_date) ?? [];
		list.push(m);
		byDate.set(m.local_date, list);
	}
	return [...byDate.entries()]
		.map(([date, list]) => ({
			kind: 'chat' as const,
			at: list[0]?.created_at ?? `${date}T00:00:00.000Z`,
			date,
			messages: list.sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
		}))
		.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** First line of what the student said, for a one-line summary of a conversation. */
export function chatPreview(messages: Message[]): string {
	const first = messages.find((m) => m.role === 'user');
	if (!first) return 'a conversation';
	const oneLine = first.content.replace(/\s+/g, ' ').trim();
	return oneLine.length > 90 ? `${oneLine.slice(0, 90)}...` : oneLine;
}
