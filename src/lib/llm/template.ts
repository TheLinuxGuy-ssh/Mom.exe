import type { Profile } from '../storage/types';
import type { TodayInfo } from '../engine/context';
import type { Stats } from '../engine/stats';
import type { PlanOutput } from './schema';
import type { Action, Flag } from '../engine/actions';
import { hhmmToMin, minToHHMM } from '../engine/time';

interface TBlock {
	start: string;
	end: string;
	action: Action;
	detail: string;
	why: string;
}

/**
 * `now` is the current minute of the day, and it is what makes the overlap check honest: this
 * planner only ever builds a day running forward from now, so a clock time earlier than now means
 * "after midnight tonight" and has to be lifted a day before it can be compared. Without that, a
 * study block ending at 00:45 and a wind-down starting at 00:15 looked like a morning collision,
 * were missed, and both stayed in the plan.
 */
function pushBlock(
	blocks: TBlock[],
	start: number,
	end: number,
	action: TBlock['action'],
	detail: string,
	why: string,
	now: number
): void {
	if (end <= start) return;
	if (start < now) {
		start += 1440;
		end += 1440;
	}
	for (const b of blocks) {
		let bs = hhmmToMin(b.start);
		let be = hhmmToMin(b.end) > bs ? hhmmToMin(b.end) : hhmmToMin(b.end) + 1440;
		if (bs < now) {
			bs += 1440;
			be += 1440;
		}
		if (start < be && end > bs) return;
	}
	blocks.push({ start: minToHHMM(start % 1440), end: minToHHMM(end % 1440), action, detail, why });
}

export function templatePlan(
	profile: Profile,
	stats: Stats,
	today: TodayInfo,
	nowMinutes: number
): PlanOutput {
	const blocks: TBlock[] = [];
	const flags: Flag[] = [];

	const bed = hhmmToMin(profile.target_bed);
	const wake = hhmmToMin(profile.target_wake);
	const avgSleep = stats.avg_sleep_hours_7d.value as number | null;
	const debt = stats.sleep_debt_hours_7d.value as number | null;
	const skippedRate = stats.skipped_meal_rate.value as number | null;

	// The wind-down-to-sleep window is the one part of the day that is never negotiable, so it is
	// reserved first and every optional block has to fit above it. If bedtime has already passed,
	// the window happens now instead, shifted forward by however late it is.
	const tailShift = Math.max(0, nowMinutes + 5 - (bed - 45));
	const tailStart = bed - 45 + tailShift;

	const messWindows: { meal: 'b' | 'l' | 'd'; window: string; eaten: boolean | null }[] = [
		{ meal: 'b', window: profile.mess.breakfast, eaten: today.meals_so_far.b },
		{ meal: 'l', window: profile.mess.lunch, eaten: today.meals_so_far.l },
		{ meal: 'd', window: profile.mess.dinner, eaten: today.meals_so_far.d }
	];

	for (const m of messWindows) {
		const [ws, we] = m.window.split('-').map(hhmmToMin);
		if (m.eaten === false && nowMinutes >= we - 45 && nowMinutes <= we - 5) {
			const start = Math.max(ws, nowMinutes);
			const label = m.meal === 'b' ? 'breakfast' : m.meal === 'l' ? 'lunch' : 'dinner';
			pushBlock(
				blocks,
				start,
				Math.min(start + 30, we),
				'eat_meal',
				`Head to the mess for ${label} before the window closes at ${minToHHMM(we)}.`,
				skippedRate != null && skippedRate > 0.3 ? 'meals keep slipping this week' : 'you have not eaten this meal yet',
				nowMinutes
			);
		}
	}

	if (today.deadline_notes) {
		flags.push('deadline_crunch');
		const start = nowMinutes + 15;
		pushBlock(
			blocks,
			start,
			start + 90,
			'study_block',
			'One focused 90-minute block on the thing that is due. Library or quiet corner, phone in the bag.',
			'you mentioned a deadline',
			nowMinutes
		);
	} else if (today.classes.length > 0 && nowMinutes < hhmmToMin(today.classes[0].start)) {
		pushBlock(
			blocks,
			Math.max(nowMinutes + 15, hhmmToMin(today.classes[0].start) - 60),
			hhmmToMin(today.classes[0].start) - 10,
			'study_block',
			'Quick revision block before class starts.',
			'class at ' + today.classes[0].start,
			nowMinutes
		);
	}

	if (
		debt != null &&
		debt >= 3 &&
		nowMinutes >= 13 * 60 &&
		nowMinutes <= 17 * 60 &&
		nowMinutes + 55 < tailStart
	) {
		pushBlock(
			blocks,
			nowMinutes + 30,
			nowMinutes + 55,
			'nap',
			'A short 25-minute nap. Set an alarm, do not negotiate with the pillow.',
			`sleep debt is about ${debt}h this week`,
			nowMinutes
		);
	}

	if ((avgSleep != null && avgSleep < 6.5) || (debt != null && debt > 0)) {
		// daylight is worth suggesting, but not at the cost of the sleep block. It used to be
		// scheduled at or after bedtime, where pushBlock's first-wins behaviour silently dropped
		// sleep instead, so a tired evening produced a plan with no sleep in it at all.
		const lightStart = Math.min(nowMinutes + 60, bed - 150);
		if (lightStart >= nowMinutes + 10 && lightStart + 20 <= tailStart) {
			pushBlock(
				blocks,
				lightStart,
				lightStart + 20,
				'light_exposure',
				'Twenty minutes of daylight and a short walk. Future tonight-you says thanks.',
				'low sleep days brighten with morning or evening light',
				nowMinutes
			);
		}
	}

	if (profile.caffeine === 'high_late' && bed - 210 >= nowMinutes && bed - 195 < tailStart) {
		flags.push('high_caffeine_evening');
		pushBlock(
			blocks,
			bed - 210,
			bed - 195,
			'caffeine_cutoff',
			`Last coffee or tea of the day now. Water after this.`,
			'late caffeine is stealing your nights',
			nowMinutes
		);
	}

	// Uses the tailShift computed above: the window moves as a unit, never block by block, so a
	// late-night plan cannot lose its sleep to a wind-down with nothing before it.
	pushBlock(
		blocks,
		bed - 45 + tailShift,
		bed - 15 + tailShift,
		'wind_down',
		'Wind down: dim the lights, chat with friends, no new tasks.',
		'target bedtime is ' + profile.target_bed,
		nowMinutes
	);
	pushBlock(
		blocks,
		bed - 15 + tailShift,
		bed + tailShift,
		'screen_off',
		'Phone on silent and across the room or face-down.',
		'screens push bedtime past ' + profile.target_bed,
		nowMinutes
	);
	pushBlock(
		blocks,
		bed + tailShift,
		(wake <= bed ? wake + 1440 : wake) + tailShift,
		'sleep',
		'Lights out. Sleep in is not on the menu, tomorrow is.',
		'target wake time is ' + profile.target_wake,
		nowMinutes
	);

	const under5 = stats.nights_under_5h_14d.value as number;
	if (typeof under5 === 'number' && under5 >= 3) flags.push('persistent_late_sleep');
	if (skippedRate != null && skippedRate >= 0.4) flags.push('meal_skipping_risk');

	if (flags.includes('persistent_late_sleep') && (skippedRate ?? 0) >= 0.5) {
		flags.push('suggest_professional_help');
	}

	const basis = stats.known_days_of_last_14 === 0 ? 'priors' : stats.known_days_of_last_14 < 7 ? 'partial' : 'full';
	const data_note =
		basis === 'priors'
			? 'Based on what you told me in setup, not history yet.'
			: basis === 'partial'
				? `Based on your usual pattern, ${stats.known_days_of_last_14} check-ins in the last two weeks.`
				: 'Based on your full recent history.';

	const summary =
		flags.includes('persistent_late_sleep')
			? 'Okay. Rough week of sleep, so today is about steady meals and an early, honest bedtime.'
			: basis === 'priors'
				? 'Fresh start. Here is your day planned around your classes, mess timings and bedtime.'
				: 'Here is the rest of your day, planned around what I know about your week.';

	return { summary, data_note, blocks, flags };
}
