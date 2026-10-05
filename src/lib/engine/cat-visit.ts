/**
 * The cat at the bottom of the screen is the app saying one thing out loud: this is a warm
 * place, but the warmest voice you have is not in here.
 *
 * Deliberately not model-generated, same reasoning as the nudges: tone matters more than
 * variety, and a fixed pool can be read out loud to check how it actually lands.
 *
 * All the timing lives here as pure functions over an injectable clock, storage and rng so the
 * behaviour can be tested without a browser, a fake cat or a real afternoon.
 */

/** How long the user has been around before the cat shows up. */
export const ARRIVAL_MIN_MS = 60_000;
export const ARRIVAL_MAX_MS = 120_000;

/** How long the cat tolerates being ignored before it dips out and tries again. */
export const IDLE_MIN_MS = 10 * 60_000;
export const IDLE_MAX_MS = 20 * 60_000;

/** How long it stays out of frame before coming back. */
export const AWAY_MS = 60_000;

/**
 * Grace period when the user reloads after the cat already visited today: it does not wait the
 * full arrival window again, it just needs a moment before it reappears.
 */
export const GRACE_MIN_MS = 15_000;
export const GRACE_MAX_MS = 30_000;

const LS_KEY = 'momexe:cat-visit';

export type CatDay = {
	/** local YYYY-MM-DD */
	date: string;
	/** when the platform was first opened today */
	firstSeen: number;
	/** rolled once per day so the arrival time does not move between reloads */
	delayMs: number;
	appeared: boolean;
	dismissed: boolean;
};

export type CatStorage = {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
};

export type CatDeps = {
	/** pass null to simulate storage being unavailable */
	storage?: CatStorage | null;
	now?: () => number;
	rand?: () => number;
	date?: string;
};

/** local date, because "today" for a cat looking at its owner is their today, not UTC's */
export function catDate(d: Date = new Date()): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return h;
}

function band(rand: () => number, min: number, max: number): number {
	return Math.round(min + rand() * (max - min));
}

export function rollArrivalDelay(rand: () => number = Math.random): number {
	return band(rand, ARRIVAL_MIN_MS, ARRIVAL_MAX_MS);
}

export function rollIdleDelay(rand: () => number = Math.random): number {
	return band(rand, IDLE_MIN_MS, IDLE_MAX_MS);
}

export function rollGraceDelay(rand: () => number = Math.random): number {
	return band(rand, GRACE_MIN_MS, GRACE_MAX_MS);
}

/**
 * Private browsing and storage-disabled browsers get null instead of an exception, and the cat
 * simply lives for the length of the visit.
 */
export function safeStorage(): CatStorage | null {
	try {
		const probe = `${LS_KEY}:probe`;
		localStorage.setItem(probe, '1');
		localStorage.removeItem(probe);
		return localStorage;
	} catch {
		return null;
	}
}

function resolveStorage(deps: CatDeps): CatStorage | null {
	return deps.storage === undefined ? safeStorage() : deps.storage;
}

/** Same day is stable, a new day starts over. Never throws. */
export function readCatDay(deps: CatDeps = {}): CatDay | null {
	const st = resolveStorage(deps);
	const date = deps.date ?? catDate();
	if (!st) return null;
	try {
		const raw = st.getItem(LS_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as CatDay;
		if (!parsed || parsed.date !== date) return null;
		return parsed;
	} catch {
		return null;
	}
}

function writeCatDay(st: CatStorage, day: CatDay): void {
	try {
		st.setItem(LS_KEY, JSON.stringify(day));
	} catch {
		/* nothing to do: the cat just forgets */
	}
}

/**
 * Stamps the day's first sighting and rolls its arrival delay once. Called from the root layout,
 * so time spent anywhere in the app counts as time on the platform.
 */
export function touchCatDay(deps: CatDeps = {}): CatDay | null {
	const st = resolveStorage(deps);
	const now = deps.now ?? Date.now;
	const rand = deps.rand ?? Math.random;
	const date = deps.date ?? catDate();
	if (!st) return null;

	const existing = readCatDay({ ...deps, storage: st });
	if (existing) return existing;

	const day: CatDay = {
		date,
		firstSeen: now(),
		delayMs: rollArrivalDelay(rand),
		appeared: false,
		dismissed: false
	};
	writeCatDay(st, day);
	return day;
}

export function updateCatDay(patch: Partial<CatDay>, deps: CatDeps = {}): CatDay | null {
	const st = resolveStorage(deps);
	if (!st) return null;
	const existing = readCatDay({ ...deps, storage: st });
	if (!existing) return null;
	const next = { ...existing, ...patch };
	writeCatDay(st, next);
	return next;
}

/** 0 means the cat is overdue and should be here already. */
export function remainingUntilArrival(day: CatDay, now: number = Date.now()): number {
	return Math.max(0, day.firstSeen + day.delayMs - now);
}

/**
 * The core line is the thesis; the idea is the thing to actually do today. Both are picked from
 * the date so the cat says the same thing all day and a different thing tomorrow.
 */
export function pickCoreLine(date: string): string {
	return CORE_LINES[Math.abs(hash(date)) % CORE_LINES.length];
}

export function pickIdea(date: string): string {
	return IDEAS[Math.abs(hash(`${date}:idea`)) % IDEAS.length];
}

export const CORE_LINES: string[] = [
	'this place might feel warm. your mum feels warmer. go talk to her.',
	'we care about you here. but the one who cares most is at home. talk to her.',
	'i can do the plan. she can do the rest. that is the division of labour.',
	'i am just a program. your real mum knows you better than i ever will. call her.',
	'she is the original version of caring about you. go find her today.',
	'i am good at reminding you to eat. she is better at it. let her.'
];

export const IDEAS: string[] = [
	'ask her what she almost named you.',
	'send her the photo you almost deleted.',
	'call her at the time she usually calls you, not yours.',
	'ask what her first job paid, and whether she liked it.',
	'ask her what she was like at your age.',
	'ask her for a voice note of her morning.',
	'tell her one true thing about this week. not the edited version.',
	'ask what she would buy if money was not a thing.',
	'ask which song she danced to. play it for her.',
	'ask her what she worries about. she has one too.',
	'ask for a photo of a recipe she cooked a hundred times.',
	'tell her something you still do because she told you to.',
	'ask how she and your dad met. the full version.',
	'ask what she would do with a free afternoon.',
	'ask her to read something out loud. out loud is the point.',
	'ask what she was afraid of at your age.',
	'thank her for one specific thing. not a general thank you.',
	'ask what she looks forward to when you call.',
	'ask her to teach you one thing she can do and you cannot.',
	'send the voice memo of a moment you two would have laughed at.',
	'ask what she dreamed of doing before she had to be practical.',
	'ask which of your habits she quietly worries about.',
	'ask the name of her first best friend.',
	'ask what she was wearing the day she met you. she will remember.',
	'ask her to send her morning routine, unedited.',
	'ask if she has eaten. turn the tables for once.',
	'ask her something you have never asked. anything works.',
	'ask what she would say to you on your worst day.',
	'ask her to tell you about the day you were born, in detail.',
	'ask what she would change if she could redo one decision.',
	'ask for the photo from your worst haircut year.',
	'ask what she hopes you are doing this year.',
	'ask her to remind you to eat. she will do it twice.',
	'say the thing out loud to her that you have been only thinking.',
	'ask what she is looking forward to about next month.',
	'ask her to tell you a story about when she was your age.'
];