import type { Checkin, CheckinInput, PlanOutput, Profile, ProfileInput, Storage } from '../src/lib/storage/types';
import { buildTodayInfo, basisFor } from '../src/lib/engine/context';
import { computeStats } from '../src/lib/engine/stats';
import { hhmmToMin, localDateInTz, minToHHMM, nowMinutesInTz } from '../src/lib/engine/time';

interface Persona {
	key: string;
	label: string;
	profile: ProfileInput;
	checkins: (dayOffset: number) => CheckinInput[];
}

function baseProfile(over: Partial<ProfileInput> = {}): ProfileInput {
	return {
		display_name: 'demo student',
		birth_year: 2004,
		height_cm: null,
		weight_kg: null,
		class_start: '09:00',
		target_bed: '23:30',
		target_wake: '07:00',
		chronotype: 'night',
		roommates: 'shared_noisy',
		mess: { breakfast: '07:30-09:30', lunch: '12:30-14:30', dinner: '19:30-21:30' },
		diet_pref: 'veg',
		allergies: [],
		caffeine: 'low',
		timezone: 'Asia/Kolkata',
		...over
	};
}

function dateAgo(tz: string, n: number): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() - n * 86400000));
}

export const PERSONAS: { key: string; label: string; build: (tz: string) => { profile: ProfileInput; checkins: CheckinInput[] } }[] = [
	{
		key: 'fresh',
		label: 'Freshman (1 check-in)',
		build: (tz) => ({
			profile: baseProfile(),
			checkins: [
				{
					local_date: dateAgo(tz, 1),
					quick: 'okay',
					sleep_hours: 6,
					slept_at: '00:45',
					woke_at: '06:45',
					meals: { b: false, l: true, s: true, d: true },
					mood: null,
					notes: 'first week, mess breakfast was closed',
					source: 'note'
				}
			]
		})
	},
	{
		key: 'night-owl',
		label: 'Night Owl (10 days)',
		build: (tz) => ({
			profile: baseProfile({ caffeine: 'high_late' }),
			checkins: Array.from({ length: 10 }, (_, i) => {
				const ago = 10 - i;
				const drift = 60 + i * 9;
				const sleep = 4.2 + ((i * 7) % 10) * 0.18;
				return {
					local_date: dateAgo(tz, ago),
					quick: i % 3 === 0 ? 'rough' : 'okay',
					sleep_hours: Math.round(sleep * 10) / 10,
					slept_at: `${String(1 + Math.floor(drift / 60)).padStart(2, '0')}:${String(drift % 60).padStart(2, '0')}`,
					woke_at: '07:40',
					meals: { b: false, l: true, s: i % 3 !== 0, d: i % 2 === 0 },
					mood: 3,
					notes: i % 2 === 0 ? 'roommates gaming till 2' : 'coffee at 11pm again',
					source: 'note'
				} satisfies CheckinInput;
			})
		})
	},
	{
		key: 'exam-crunch',
		label: 'Exam Crunch',
		build: (tz) => ({
			profile: baseProfile(),
			checkins: Array.from({ length: 5 }, (_, i) => ({
				local_date: dateAgo(tz, 5 - i),
				quick: i < 3 ? 'rough' : 'okay',
				sleep_hours: 4.5,
				slept_at: '03:00',
				woke_at: '07:30',
				meals: { b: false, l: true, s: true, d: false },
				mood: 2,
				notes: i === 0 ? 'DSA assignment due tomorrow' : 'grinding for exam',
				source: 'note'
			}) satisfies CheckinInput)
		})
	},
	{
		key: 'ghost',
		label: 'Ghost (stale data)',
		build: (tz) => ({
			profile: baseProfile(),
			checkins: [
				{
					local_date: dateAgo(tz, 12),
					quick: 'okay',
					sleep_hours: 6.5,
					slept_at: '23:50',
					woke_at: '06:20',
					meals: { b: true, l: true, s: false, d: true },
					mood: null,
					notes: null,
					source: 'note'
				}
			]
		})
	}
];

/**
 * A representative day for demo accounts. Built by hand rather than via templatePlan, because
 * that planner is a last-resort fallback: it only schedules study when there is a deadline, and
 * never schedules people time at all, which left the day-shape widget showing one 96%-rest slice.
 *
 * Laid out backwards from the target bed time so sleep always ends when it is meant to, then
 * anything already in the past is dropped. A demo account opened at 4am therefore shows the whole
 * coming day, and one opened at 10pm shows only the evening.
 */
function demoPlan(profile: Profile, now: Date): PlanOutput {
	const tz = profile.timezone;
	const nowMin = nowMinutesInTz(tz, now);
	const [bh, bm] = profile.target_bed.split(':').map(Number);
	const bed = bh * 60 + bm;

	// start offset, duration, action, detail, why - all measured back from bedtime
	const shape: [number, number, string, string, string][] = [
		[600, 20, 'light_exposure', 'Twenty minutes of daylight. Future tonight-you says thanks.', 'low sleep days start with light'],
		[510, 90, 'study_block', 'One focused block on the thing that is due. Phone in the bag.', 'you mentioned a deadline'],
		[390, 45, 'social_time', 'Call home properly, not the two-line version.', 'you have not spoken to anyone all day'],
		[300, 30, 'exercise', 'Walk the block. Do not negotiate with the weather.', 'you have been sitting since morning'],
		[210, 30, 'eat_meal', 'Eat something that is not chai.', 'mess closes at ' + profile.mess.dinner.split('-')[1]],
		[150, 10, 'hydration', 'Water, before you think you want coffee.', 'you have been running on empty'],
		[105, 30, 'wind_down', 'Screens off, lights low. No negotiating.', 'last caffeine window shut hours ago'],
		[60, 60, 'sleep', 'Sleep. The whole point of the day.', 'your target bed time']
	];

	const blocks = shape
		.map(([offset, mins, action, detail, why]) => ({
			start: minToHHMM(bed - offset),
			end: minToHHMM(bed - offset + mins),
			action,
			detail,
			why
		}))
		.filter((b) => hhmmToMin(b.end) > nowMin);

	return {
		summary: 'eat properly, get to bed on time, and call home in the middle of it.',
		blocks,
		flags: []
	};
}

export async function seedPersona(storage: Storage, userId: string, key: string): Promise<void> {
	const persona = PERSONAS.find((p) => p.key === key);
	if (!persona) return;
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const { profile, checkins } = persona.build(tz);
	await storage.saveProfile(userId, profile);
	for (const c of checkins) {
		await storage.upsertCheckin(userId, c);
	}

	// Seed a plan too. Without one the dashboard has a timeline with nothing in it and an
	// empty day-shape widget, so a demo account looks broken rather than populated.
	const today = localDateInTz(tz);
	const stored: Checkin[] = checkins.map((c) => ({
		id: `${userId}-${c.local_date}`,
		user_id: userId,
		created_at: `${c.local_date}T20:00:00Z`,
		...c
	}));
	const now = new Date();
	const fullProfile: Profile = { id: userId, created_at: now.toISOString(), ...profile };
	const todayCheckin = stored.find((c) => c.local_date === today) ?? null;
	const stats = computeStats(stored, [], tz, today);
	const output = demoPlan(fullProfile, now);

	await storage.savePlan(userId, {
		local_date: today,
		as_of: new Date().toISOString(),
		context_snapshot: { seeded: true },
		output,
		basis: basisFor(stats.known_days_of_last_14),
		model_id: 'template',
		fallback_reason: null,
		supersedes_plan_id: null
	});
}
