import { describe, expect, it } from 'vitest';
import {
	hhmmToMin,
	isCurrentMinute,
	minToHHMM,
	daysBetween,
	localDateInTz,
	nowMinutesInTz,
	nowLocalWallClock,
	weekdayInTz,
	tzOffsetLabel,
	isValidTimezone,
	fmtCountdown
} from './time';

describe('time', () => {
	it('converts hh:mm to minutes and back', () => {
		expect(hhmmToMin('00:00')).toBe(0);
		expect(hhmmToMin('23:30')).toBe(1410);
		expect(minToHHMM(1410)).toBe('23:30');
		expect(minToHHMM(1500)).toBe('01:00');
	});

	it('detects the current block including overnight blocks', () => {
		expect(isCurrentMinute(700, '11:00', '12:00')).toBe(true);
		expect(isCurrentMinute(659, '11:00', '12:00')).toBe(false);
		expect(isCurrentMinute(120, '23:30', '07:00')).toBe(true);
		expect(isCurrentMinute(400, '23:30', '07:00')).toBe(true);
		expect(isCurrentMinute(500, '23:30', '07:00')).toBe(false);
		expect(isCurrentMinute(1430, '23:30', '07:00')).toBe(true);
	});

	it('computes local dates in a timezone', () => {
		const utc = new Date('2026-10-03T20:00:00Z');
		expect(localDateInTz('Asia/Kolkata', utc)).toBe('2026-10-04');
		expect(localDateInTz('UTC', utc)).toBe('2026-10-03');
		expect(nowMinutesInTz('Asia/Kolkata', utc)).toBe(90);
	});

	it('counts days between local dates', () => {
		expect(daysBetween('2026-10-01', '2026-10-04')).toBe(3);
		expect(daysBetween('2026-10-04', '2026-10-01')).toBe(-3);
	});

	it('formats countdowns', () => {
		expect(fmtCountdown(45)).toBe('45 min left');
		expect(fmtCountdown(90)).toBe('1 hr 30 min left');
		expect(fmtCountdown(0)).toBe('now');
	});
});

describe('timezones', () => {
	it('accepts zones the runtime knows and rejects typos', () => {
		// a typo used to throw a RangeError deep inside a dashboard refresh, taking the whole page
		// down instead of showing one wrong date
		expect(isValidTimezone('Asia/Kolkata')).toBe(true);
		expect(isValidTimezone('UTC')).toBe(true);
		expect(isValidTimezone('Asia/Kolkat')).toBe(false);
		expect(isValidTimezone('not a zone')).toBe(false);
		expect(isValidTimezone('')).toBe(false);
	});

	it('still formats dates when the stored zone is unusable', () => {
		// a profile written before settings validated the field should degrade to UTC, not to a
		// blank page
		expect(localDateInTz('nonsense/zone', new Date('2026-10-05T12:00:00Z'))).toBe('2026-10-05');
		expect(nowLocalWallClock('nonsense/zone', new Date('2026-10-05T12:00:00Z'))).toBe(
			'2026-10-05 12:00'
		);
		expect(weekdayInTz('nonsense/zone', new Date('2026-10-05T12:00:00Z'))).toBe('monday');
		expect(tzOffsetLabel('nonsense/zone')).toBeTruthy();
	});
});
