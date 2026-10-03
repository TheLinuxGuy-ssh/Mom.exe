import type { CheckinInput, ProfileInput, Storage } from '../src/lib/storage/types';

export interface Persona {
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
					meals: { b: false, l: true, s: null, d: true },
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
					meals: { b: false, l: true, s: null, d: i % 2 === 0 },
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
				meals: { b: false, l: true, s: null, d: false },
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
					meals: { b: true, l: true, s: null, d: true },
					mood: null,
					notes: null,
					source: 'note'
				}
			]
		})
	}
];

export async function seedPersona(storage: Storage, userId: string, key: string): Promise<void> {
	const persona = PERSONAS.find((p) => p.key === key);
	if (!persona) return;
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const { profile, checkins } = persona.build(tz);
	await storage.saveProfile(userId, profile);
	for (const c of checkins) {
		await storage.upsertCheckin(userId, c);
	}
}
