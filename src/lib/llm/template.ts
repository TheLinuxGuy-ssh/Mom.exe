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

function pushBlock(
	blocks: TBlock[],
	start: number,
	end: number,
	action: TBlock['action'],
	detail: string,
	why: string
): void {
	if (end <= start) return;
	for (const b of blocks) {
		const bs = hhmmToMin(b.start);
		const be = hhmmToMin(b.end) > bs ? hhmmToMin(b.end) : hhmmToMin(b.end) + 1440;
		if (start < be && end > bs) return;
	}
	blocks.push({ start: minToHHMM(start), end: minToHHMM(end), action, detail, why });
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

	const messWindows: { meal: 'b' | 'l' | 'd'; window: string; eaten: boolean | null }[] = [
		{ meal: 'b', window: profile.mess.breakfast, eaten: today.meals_so_far.b },
		{ meal: 'l', window: profile.mess.lunch, eaten: today.meals_so_far.l },
		{ meal: 'd', window: profile.mess.dinner, eaten: today.meals_so_far.d }
	];

	for (const m of messWindows) {
		const [ws, we] = m.window.split('-').map(hhmmToMin);
		if (m.eaten === false && nowMinutes <= we - 15 && we >= nowMinutes - 30) {
			const start = Math.max(ws, nowMinutes);
			const label = m.meal === 'b' ? 'breakfast' : m.meal === 'l' ? 'lunch' : 'dinner';
			pushBlock(
				blocks,
				start,
				Math.min(start + 30, we),
				'eat_meal',
				`Head to the mess for ${label} before the window closes at ${minToHHMM(we)}.`,
				skippedRate != null && skippedRate > 0.3 ? 'meals keep slipping this week' : 'you have not eaten this meal yet'
			);
		}
	}

	if (today.deadline_notes) {
		flags.push('deadline_crunch');
		const start = Math.max(nowMinutes + 15, nowMinutes);
		pushBlock(
			blocks,
			start,
			start + 90,
			'study_block',
			'One focused 90-minute block on the thing that is due. Library or quiet corner, phone in the bag.',
			'you mentioned a deadline'
		);
	} else if (today.classes.length > 0 && nowMinutes < hhmmToMin(today.classes[0].start)) {
		pushBlock(
			blocks,
			Math.max(nowMinutes + 15, hhmmToMin(today.classes[0].start) - 60),
			hhmmToMin(today.classes[0].start) - 10,
			'study_block',
			'Quick revision block before class starts.',
			'class at ' + today.classes[0].start
		);
	}

	if (debt != null && debt >= 3 && nowMinutes >= 13 * 60 && nowMinutes <= 17 * 60) {
		pushBlock(
			blocks,
			nowMinutes + 30,
			nowMinutes + 55,
			'nap',
			'A short 25-minute nap. Set an alarm, do not negotiate with the pillow.',
			`sleep debt is about ${debt}h this week`
		);
	}

	if ((avgSleep != null && avgSleep < 6.5) || debt != null && debt > 0) {
		pushBlock(
			blocks,
			Math.min(nowMinutes + 60, bed - 120 > nowMinutes ? bed - 150 : nowMinutes + 60),
			Math.min(nowMinutes + 60, bed - 120 > nowMinutes ? bed - 150 : nowMinutes + 60) + 20,
			'light_exposure',
			'Twenty minutes of daylight and a short walk. Future tonight-you says thanks.',
			'low sleep days brighten with morning or evening light'
		);
	}

	if (profile.caffeine === 'high_late') {
		flags.push('high_caffeine_evening');
		pushBlock(
			blocks,
			bed - 210,
			bed - 195,
			'caffeine_cutoff',
			`Last coffee or tea of the day now. Water after this.`,
			'late caffeine is stealing your nights'
		);
	}

	pushBlock(
		blocks,
		bed - 45,
		bed - 15,
		'wind_down',
		'Wind down: dim the lights, chat with friends, no new tasks.',
		'target bedtime is ' + profile.target_bed
	);
	pushBlock(
		blocks,
		bed - 15,
		bed,
		'screen_off',
		'Phone on silent and across the room or face-down.',
		'screens push bedtime past ' + profile.target_bed
	);
	pushBlock(
		blocks,
		bed,
		wake <= bed ? wake + 1440 : wake,
		'sleep',
		'Lights out. Sleep in is not on the menu, tomorrow is.',
		'target wake time is ' + profile.target_wake
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
