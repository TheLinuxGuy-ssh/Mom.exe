/**
 * Small, shared rules for the two ways of talking to her. Kept out of the components so the
 * thresholds are testable and so the dashboard composer and the chat dialog cannot drift
 * apart on what counts as "something worth sending".
 */

/** A note to the composer is a real thought, so it has to be at least this long. */
export const NOTE_MIN = 10;

/** In a live conversation one letter is enough, because she is already listening. */
export const CHAT_MIN = 1;

export function noteLength(text: string): number {
	return text.trim().length;
}

/** Whitespace never counts. A student who typed three spaces has not said anything. */
export function noteReady(text: string): boolean {
	return noteLength(text) >= NOTE_MIN;
}

export function chatReady(text: string): boolean {
	return noteLength(text) >= CHAT_MIN;
}

/** How many more characters are needed, for the gentle nudge under the button. */
export function noteShortfall(text: string): number {
	return Math.max(0, NOTE_MIN - noteLength(text));
}

/**
 * What the send button asks for, when it has nothing typed yet. She greets you differently
 * depending on the hour, because that is what a person who has been up all night with you
 * would do. Chosen by time band rather than randomly, so the label matches the moment.
 */
export function idleLabel(hour: number): string {
	if (hour < 5) return 'still up? talk to me';
	if (hour < 11) return 'help me MOM!';
	if (hour < 14) return 'what do I do now?';
	if (hour < 17) return 'sort my afternoon?';
	if (hour < 20) return 'evening, already?';
	if (hour < 23) return 'get me to bed';
	return 'tomorrow, already?';
}

/** What the button says once there is something real to send. */
export function readyLabel(hour: number): string {
	return hour < 5 ? 'tell me' : 'Ask Mom';
}

/**
 * Whether there is anything here to send.
 *
 * The composer is the only place a student starts a conversation, and until this existed an empty
 * box was a valid submission: pressing the button with nothing typed went straight through to the
 * model, burned a full planning round trip, and answered a question nobody asked. The button's own
 * idle label invited it, which is worse.
 *
 * A quick band counts on its own, because choosing "rough" over three words is a real answer about
 * the day. Whitespace, and punctuation typed by someone who hit enter without thinking, do not.
 */
export function hasSomethingToSend(text: string, quick: string | null): boolean {
	if (quick !== null && quick.trim() !== '') return true;
	const t = text.trim();
	if (t === '') return false;
	return !/^[\s.!?…]+$/.test(t);
}

/** Why the press did nothing, in her voice rather than the browser's. */
export function emptyNoteMessage(): string {
	return 'nothing to read, love. write something first, or pick rough/okay/great.';
}

/**
 * Whether a turn that just wrote a new plan should close the conversation.
 *
 * Asking her to change the day from inside the chat is the ordinary way to use this app, and the
 * mutation detector decides "shift my dinner to 9pm" is a planning request in code, before any model
 * is asked. That means a chat-submitted replan arrives here as a plain plan save rather than as the
 * conversational handoff, and the dialog used to stay open covering the day it had just rewritten.
 *
 * Two conditions, both deliberate:
 *
 * - `chatOpen`, so the composer path is untouched. Someone who never opened the conversation must not
 *   have anything happen to it.
 * - after the save, not before. A plan that failed to write leaves the dialog open with the error
 *   showing, instead of dismissing into nothing.
 *
 * Named rather than inlined because the wiring that uses it lives in a Svelte component with no tests,
 * and this is the rule that wiring is easy to break: the handoff branch closes the dialog too, so the
 * two paths must keep agreeing about when.
 */
export function shouldDismissChat(input: { chatOpen: boolean; planSaved: boolean }): boolean {
	return input.chatOpen && input.planSaved;
}
