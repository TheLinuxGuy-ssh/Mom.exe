export function hhmmToMin(s: string): number {
	const [h, m] = s.split(':').map(Number);
	return h * 60 + m;
}

export function minToHHMM(m: number): string {
	const w = ((Math.round(m) % 1440) + 1440) % 1440;
	const h = Math.floor(w / 60);
	const mm = w % 60;
	return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Whether a timezone string is one the runtime actually understands.
 *
 * A typo here is worth catching at the point of entry: every date in this app is derived from
 * `Intl.DateTimeFormat({ timeZone })`, so a bad value throws a RangeError deep inside a refresh and
 * takes the whole dashboard down rather than showing one wrong date.
 */
export function isValidTimezone(tz: string): boolean {
	if (typeof tz !== 'string' || tz.trim() === '') return false;
	try {
		new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
		return true;
	} catch {
		return false;
	}
}

/**
 * The timezone to actually format with. Settings refuses to save an invalid zone, but a value
 * typed before that check existed is still sitting in somebody's profile, and a dashboard that
 * renders no dates at all is a worse answer than one that renders them in UTC.
 */
function safeTz(tz: string): string {
	return isValidTimezone(tz) ? tz : 'UTC';
}

export function localDateInTz(tz: string, d: Date = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: safeTz(tz),
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(d);
}

export function nowMinutesInTz(tz: string, d: Date = new Date()): number {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: safeTz(tz),
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(d);
	return hhmmToMin(parts);
}

export function weekdayInTz(tz: string, d: Date = new Date()): string {
	return new Intl.DateTimeFormat('en-US', { timeZone: safeTz(tz), weekday: 'long' })
		.format(d)
		.toLowerCase();
}

export function daysAgoLocalDate(tz: string, n: number): string {
	const d = new Date(Date.now() - n * 86400000);
	return localDateInTz(tz, d);
}

export function daysBetween(a: string, b: string): number {
	return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function isCurrentMinute(m: number, start: string, end: string): boolean {
	const s = hhmmToMin(start);
	const e = hhmmToMin(end);
	if (e > s) return m >= s && m < e;
	return m >= s || m < e;
}

export function nowLocalWallClock(tz: string, d: Date = new Date()): string {
	const date = localDateInTz(tz, d);
	const hm = new Intl.DateTimeFormat('en-GB', {
		timeZone: safeTz(tz),
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(d);
	return `${date} ${hm}`;
}

export function tzOffsetLabel(tz: string, d: Date = new Date()): string {
	try {
		const parts = new Intl.DateTimeFormat('en-US', { timeZone: safeTz(tz), timeZoneName: 'shortOffset' })
			.formatToParts(d)
			.find((p) => p.type === 'timeZoneName');
		return parts?.value ?? tz;
	} catch {
		return tz;
	}
}

export function fmtCountdown(min: number): string {
	if (min <= 0) return 'now';
	if (min < 60) return `${min} min left`;
	const h = Math.floor(min / 60);
	const m = min % 60;
	return m === 0 ? `${h} hr left` : `${h} hr ${m} min left`;
}
