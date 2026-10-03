import type { Message, WeekDigest } from '../storage/types';
import { scrubText } from './scrub';

/**
 * How many recent messages are resent verbatim as conversation context. Older ones survive only
 * as weekly digests, which is what keeps the request bounded as the history grows.
 */
export const MEMORY_WINDOW = 20;

/** How many weeks of digests to carry alongside the window. */
export const DIGEST_WEEKS = 4;

/** Per-message cap, so one long vent does not dominate the context. */
const MSG_CHARS = 240;

/** Upper bound on messages handed to the model for digesting in a single call. */
const DIGEST_BATCH = 40;

export interface ContextMessage {
	role: 'user' | 'mom';
	text: string;
}

export interface DigestBatchMessage extends ContextMessage {
	week_start: string;
}

/** Monday-based ISO week start (YYYY-MM-DD) for a local date. */
export function weekStartOf(localDate: string): string {
	const [y, m, d] = localDate.split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	const dow = (dt.getUTCDay() + 6) % 7; // 0 = Monday
	dt.setUTCDate(dt.getUTCDate() - dow);
	return dt.toISOString().slice(0, 10);
}

/**
 * Newest-first storage order in, chronological order out — models read a conversation forwards.
 * Only the outbound copy is scrubbed; what is stored stays as the user wrote it, because the
 * history page shows their own words back to them.
 */
export function toContextWindow(messages: Message[], window = MEMORY_WINDOW): ContextMessage[] {
	return messages
		.slice(0, window)
		.reverse()
		.map((m) => ({ role: m.role, text: scrubText(m.content).slice(0, MSG_CHARS) }))
		.filter((m) => m.text.length > 0);
}

/**
 * Messages that have fallen out of the window and belong to a week that has no digest yet, so
 * each week is only ever summarized once. Capped so the digest request cannot grow unbounded;
 * whatever is left over is picked up on a later call.
 */
export function selectDigestBatches(
	messages: Message[],
	digests: WeekDigest[],
	window = MEMORY_WINDOW,
	limit = DIGEST_BATCH
): DigestBatchMessage[] {
	const covered = new Set(digests.map((d) => d.week_start));
	const stale = messages
		.slice(window)
		.filter((m) => !covered.has(weekStartOf(m.local_date)))
		.slice(0, limit);

	return stale.map((m) => ({
		role: m.role,
		text: scrubText(m.content).slice(0, MSG_CHARS),
		week_start: weekStartOf(m.local_date)
	}));
}
