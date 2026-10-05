import type { Basis, Checkin, Followup, Plan, Profile } from '../storage/types';
import { computeStats, type Stats } from './stats';
import { ageBand, scrubText } from './scrub';
import { disturbanceTheme } from './extract';
import { hhmmToMin, localDateInTz, minToHHMM, nowMinutesInTz, weekdayInTz } from './time';
import type { ContextMessage, DigestBatchMessage } from './memory';

export interface TodayInfo {
	classes: { start: string; end: string }[];
	deadline_notes: string | null;
	sleep_so_far_hours: number | null;
	meals_so_far: { b: boolean | null; l: boolean | null; s: boolean | null; d: boolean | null };
	caffeine_last_at: string | null;
}

export type PriorBlockStatus = 'done' | 'skipped' | 'unknown' | 'in_progress';

export interface PriorBlock {
	start: string;
	end: string;
	action: string;
	status: PriorBlockStatus;
}

export interface ContextPayload {
	as_of_local: string;
	day_of_week: string;
	timezone: string;
	/** The name they asked mom to call them. Deliberate channel, unlike PII found in free text. */
	nickname: string;
	prior_plan: {
		as_of: string;
		blocks: PriorBlock[];
	} | null;
	today: TodayInfo;
	conversation: {
		recent: ContextMessage[];
		older_digests: { week_start: string; text: string }[];
		to_digest: DigestBatchMessage[];
	};
	recent_days: {
		days_ago: number;
		quick: string | null;
		sleep_hours: number | null;
		meals_eaten: number | null;
		mood: number | null;
		notes_theme: string | null;
	}[];
	stats: Stats;
	weekly_summaries: string[];
	profile_anon: {
		age_band: string;
		chronotype: string;
		roommates: string;
		mess: { breakfast: string; lunch: string; dinner: string };
		diet: string;
		allergies: string[];
		caffeine_habit: string;
	};
	targets: { bed: string; wake: string; next_class: string | null };
	data_quality: {
		basis: Basis;
		days_since_last_checkin: number;
		known_days_of_last_14: number;
		note: string;
	};
}

export function basisFor(knownDays: number): Basis {
	if (knownDays === 0) return 'priors';
	if (knownDays < 7) return 'partial';
	return 'full';
}

export function basisNote(basis: Basis, daysSince: number): string {
	if (basis === 'priors') return 'no history yet; rely on onboarding targets and say so';
	if (basis === 'partial')
		return daysSince >= 2
			? `only ${daysSince} days since last check-in; unknown days are unknown, not zero; lean on usual pattern and say so`
			: 'partial history; unknown days are unknown, not zero';
	return 'good recent history available';
}

export function buildTodayInfo(profile: Profile, todayCheckin: Checkin | null, tz: string): TodayInfo {
	const weekday = weekdayInTz(tz);
	const isWeekend = weekday === 'saturday' || weekday === 'sunday';
	const classes =
		!isWeekend && profile.class_start
			? [
					{
						start: profile.class_start,
						end: minToHHMM(Number(profile.class_start.split(':')[0]) * 60 + Number(profile.class_start.split(':')[1]) + 90)
				}
			]
			: [];

	const m = todayCheckin?.meals ?? null;
	return {
		classes,
		deadline_notes:
			todayCheckin?.notes && /\b(due|exam|submission|assignment|quiz|test|project)\b/i.test(todayCheckin.notes)
				? scrubText(todayCheckin.notes).slice(0, 120)
				: null,
		sleep_so_far_hours: todayCheckin?.sleep_hours ?? null,
		meals_so_far: { b: m?.b ?? null, l: m?.l ?? null, s: m?.s ?? null, d: m?.d ?? null },
		caffeine_last_at: todayCheckin?.notes && /caffeine|coffee|tea/i.test(todayCheckin.notes) ? 'recently' : null
	};
}

/**
 * Turns the plan being superseded into "what already happened", so a replan can adjust the
 * remaining day instead of blindly regenerating it. Handles blocks that cross midnight
 * (`end <= start`) the same way Timeline does, so a 23:30-07:00 sleep block is not read as
 * having ended the moment it started.
 */
export function buildPriorPlan(
	plan: Plan | null,
	marks: Record<string, 'yes' | 'no'>,
	now: Date,
	tz: string
): ContextPayload['prior_plan'] {
	if (!plan) return null;

	const minutes = nowMinutesInTz(tz, now);
	// A plan whose local day is already behind us is being read the morning after. Clock time
	// alone cannot tell that apart from tonight-before-it-started: 22:00 and 08:00 both sit
	// "before the start and after the end" of a 23:00 -> 07:00 block, and the two want opposite
	// answers. The plan's own date is what tells them apart.
	const crossedMidnight = localDateInTz(tz, new Date(plan.as_of)) < localDateInTz(tz, now);
	const blocks: PriorBlock[] = [];

	for (const b of plan.output.blocks) {
		const start = hhmmToMin(b.start);
		const end = hhmmToMin(b.end);
		const overnight = end <= start;

		const mark = marks[`${b.start}-${b.end}`];
		const marked: PriorBlockStatus | null =
			mark === 'yes' ? 'done' : mark === 'no' ? 'skipped' : null;

		if (overnight) {
			// running means past its start tonight, or after midnight and before its end
			const running = minutes >= start || minutes < end;
			if (running) {
				blocks.push({ start: b.start, end: b.end, action: b.action, status: marked ?? 'in_progress' });
			} else if (crossedMidnight) {
				// it ran its course overnight
				blocks.push({ start: b.start, end: b.end, action: b.action, status: marked ?? 'unknown' });
			}
			// otherwise it is later tonight and has not started: upcoming, so not prior
			continue;
		}

		// not started yet: the model must treat it as still upcoming
		if (minutes < start) continue;

		blocks.push({
			start: b.start,
			end: b.end,
			action: b.action,
			status: marked ?? (minutes < end ? 'in_progress' : 'unknown')
		});
	}

	if (blocks.length === 0) return null;
	return { as_of: plan.as_of, blocks };
}

export function buildContext(
	profile: Profile,
	checkins: Checkin[],
	followups: Followup[],
	today: TodayInfo,
	now: Date,
	priorPlan?: ContextPayload['prior_plan'],
	conversation?: ContextPayload['conversation']
): { payload: ContextPayload; basis: Basis } {
	const tz = profile.timezone;
	const todayStr = localDateInTz(tz, now);
	const stats = computeStats(checkins, followups, tz, todayStr);

	const recent = checkins
		.filter((c) => c.local_date <= todayStr && c.local_date >= localDateAgo(todayStr, 14))
		.slice(-14)
		.map((c) => {
			const [y, m, d] = todayStr.split('-').map(Number);
			const [cy, cm, cd] = c.local_date.split('-').map(Number);
			const daysAgo = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(cy, cm - 1, cd)) / 86400000);
			return {
				days_ago: daysAgo,
				quick: c.quick,
				sleep_hours: c.sleep_hours,
				meals_eaten: c.meals
					? (['b', 'l', 's', 'd'] as const).filter((k) => c.meals?.[k] === true).length
					: null,
				mood: c.mood,
				notes_theme: c.notes ? disturbanceTheme(c.notes) : null
			};
		});

	const basis = basisFor(stats.known_days_of_last_14);

	const weekly_summaries: string[] = [];
	if (stats.avg_sleep_hours_7d.value != null && stats.avg_sleep_hours_7d.n > 0) {
		weekly_summaries.push(
			`last 7 known days: averaged ${stats.avg_sleep_hours_7d.value}h sleep (${stats.avg_sleep_hours_7d.n} nights known)`
		);
	}
	if (stats.skipped_meal_rate.value != null && stats.skipped_meal_rate.n > 0) {
		weekly_summaries.push(`skipped-meal rate across known days: ${Math.round((stats.skipped_meal_rate.value as number) * 100)}%`);
	}

	const payload: ContextPayload = {
		as_of_local: `${todayStr} ${minToHHMM(nowMinutesInTz(tz, now))}`,
		day_of_week: weekdayInTz(tz, now),
		timezone: tz,
		nickname: profile.display_name || 'beta',
		prior_plan: priorPlan ?? null,
		today,
		conversation: conversation ?? { recent: [], older_digests: [], to_digest: [] },
		recent_days: recent,
		stats,
		weekly_summaries,
		profile_anon: {
			age_band: ageBand(profile.birth_year, now.getFullYear()),
			chronotype: profile.chronotype,
			roommates: profile.roommates,
			mess: profile.mess,
			diet: profile.diet_pref,
			allergies: profile.allergies,
			caffeine_habit: profile.caffeine
		},
		targets: {
			bed: profile.target_bed,
			wake: profile.target_wake,
			next_class: today.classes[0]?.start ?? null
		},
		data_quality: {
			basis,
			days_since_last_checkin: stats.days_since_last_checkin < 0 ? 99 : stats.days_since_last_checkin,
			known_days_of_last_14: stats.known_days_of_last_14,
			note: basisNote(basis, stats.days_since_last_checkin)
		}
	};

	return { payload, basis };
}

function localDateAgo(todayStr: string, n: number): string {
	const [y, m, d] = todayStr.split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d - n));
	return dt.toISOString().slice(0, 10);
}
