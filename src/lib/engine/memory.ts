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
export const DIGEST_BATCH = 40;

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
 *
 * Messages are scrubbed by the time they are stored, so the copy the model reads is the copy the
 * history shows. That is the point of scrubbing: PII the student typed never reaches the database,
 * which is the stronger promise, at the cost of their history reading back with a few things
 * replaced by `[email]` or similar.
 */
export function toContextWindow(messages: Message[], window = MEMORY_WINDOW): ContextMessage[] {
	return messages
		.slice(0, window)
		.reverse()
		.map((m) => ({ role: m.role, text: scrubText(m.content).slice(0, MSG_CHARS) }))
		.filter((m) => m.text.length > 0);
}

/**
 * Messages that have fallen out of the window and belong to a week with no digest yet.
 *
 * Two things this deliberately does not do.
 *
 * It never digests the week that is still running. A digest is a summary of a finished week, and
 * writing one on Monday froze that week at whatever had happened by Monday: everything from
 * Tuesday onward was then excluded as already covered, and a long conversation was permanently
 * remembered as only its first few messages.
 *
 * It never digests a week it already has a digest for, however old. The caller passes the whole
 * digest history here, not just the four newest that go into the model's context, because the four
 * newest do not describe which weeks have been summarized: a week outside that window was
 * re-sent on every single planning call, re-summarized, and overwritten from a partial batch.
 *
 * The cap keeps one request from growing unbounded. Past it, the oldest messages of that week are
 * what falls off, which is the right thing to lose: they are the furthest from today.
 */
export function selectDigestBatches(
	messages: Message[],
	digests: WeekDigest[],
	window = MEMORY_WINDOW,
	limit = DIGEST_BATCH,
	todayLocal: string = ''
): DigestBatchMessage[] {
	const covered = new Set(digests.map((d) => d.week_start));
	const thisWeek = todayLocal ? weekStartOf(todayLocal) : null;
	const stale = messages
		.slice(window)
		.filter((m) => !covered.has(weekStartOf(m.local_date)))
		.filter((m) => weekStartOf(m.local_date) !== thisWeek)
		.slice(0, limit);

	return stale.map((m) => ({
		role: m.role,
		text: scrubText(m.content).slice(0, MSG_CHARS),
		week_start: weekStartOf(m.local_date)
	}));
}
