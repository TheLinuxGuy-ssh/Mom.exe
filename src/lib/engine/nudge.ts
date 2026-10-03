/**
 * The reason this app exists is not the plan, it is the person it keeps in mind. These lines
 * are the app saying so out loud, on a slow rotation, without ever becoming a lecture.
 *
 * Deliberately not model-generated: tone control matters more here than variety, and a
 * fixed pool can be reviewed for how it actually reads.
 */

/** One nudge per this many conversations. */
export const NUDGE_EVERY = 5;

/**
 * Kept short and warm on purpose. No guilt, no urgency, no "you should". Each is a door the
 * student can walk through or ignore without being told off either way.
 */
const NUDGES: string[] = [
	'remember I am just a program. your real mom knows you better than any model ever will.',
	'call her when you get a chance. she would rather hear a tired voice than a polished one.',
	'ask her how her own day is going. she will probably deflect, so ask twice.',
	'tell her about the thing that annoyed you today. she has heard worse.',
	'if you have not spoken to home in a few days, send her one photo. that counts.',
	'send her a voice note of literally nothing. she will be glad to hear it.',
	'ask her to tell you a story from when she was your age.',
	'ask her if she is eating properly. turn the tables on her for once.',
	'she misses you more than she says. a two line message is enough.',
	'ask her what she would tell you if she could see your schedule right now.',
	'tell her one thing you did today that you are actually proud of.',
	'ask her about a recipe you used to make as a kid.',
	'if today was heavy, tell her what it was actually about.',
	'ask her what she hopes you are doing this year.',
	'ask her to remind you to eat. she will absolutely do it twice.',
	'say the thing out loud to her that you have been only thinking.'
];

/**
 * Deterministic pick so a nudge does not flicker between renders, while still moving as the
 * conversation grows.
 */
export function pickNudge(seed: number): string {
	const i = Math.abs(Math.trunc(seed)) % NUDGES.length;
	return NUDGES[i];
}
