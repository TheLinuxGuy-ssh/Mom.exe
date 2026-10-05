/**
 * One visit is one sitting with the app: the conversation she is part of right now. It changes
 * when the app is reopened and when the day rolls over, which is what keeps the chat panel from
 * reopening onto yesterday's thread.
 */

/**
 * A v4 uuid, with a fallback for the places the real one does not exist.
 *
 * `crypto.randomUUID` only exists in a secure context. Opening the dev server on a phone over
 * `http://192.168.x.x:5173` is not one, and there the constructor is simply undefined — which threw
 * while the dashboard was still initializing, leaving a blank page with no error anywhere. The id
 * only has to be unique enough to group a conversation, so a hand-built v4 is a fair substitute.
 */
export function newVisitId(): string {
	const c: Crypto | undefined = globalThis.crypto;
	if (c && typeof c.randomUUID === 'function') return c.randomUUID();
	const bytes = new Uint8Array(16);
	if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
	else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}