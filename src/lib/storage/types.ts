export type QuickBand = 'rough' | 'okay' | 'great';
export type Chrono = 'morning' | 'neutral' | 'night';
export type Roommates = 'own_room' | 'shared_quiet' | 'shared_noisy';
export type CaffeineHabit = 'none' | 'low' | 'high_late';
export type Basis = 'priors' | 'partial' | 'full';
export type CheckinSource = 'quick' | 'full' | 'note' | 'followup';

export interface MessTimings {
	breakfast: string;
	lunch: string;
	dinner: string;
}

export interface Profile {
	id: string;
	display_name: string;
	birth_year: number | null;
	height_cm: number | null;
	weight_kg: number | null;
	class_start: string;
	target_bed: string;
	target_wake: string;
	chronotype: Chrono;
	roommates: Roommates;
	mess: MessTimings;
	diet_pref: string;
	allergies: string[];
	caffeine: CaffeineHabit;
	timezone: string;
	created_at: string;
}

export type ProfileInput = Omit<Profile, 'id' | 'created_at'>;

export interface Meals {
	b: boolean | null;
	l: boolean | null;
	s: boolean | null;
	d: boolean | null;
}

export interface Checkin {
	id: string;
	user_id: string;
	local_date: string;
	quick: QuickBand | null;
	sleep_hours: number | null;
	slept_at: string | null;
	woke_at: string | null;
	meals: Meals | null;
	mood: number | null;
	notes: string | null;
	source: CheckinSource;
	created_at: string;
}

export type CheckinInput = Omit<Checkin, 'id' | 'user_id' | 'created_at'>;

export interface PlanBlock {
	start: string;
	end: string;
	action: string;
	detail: string;
	why: string;
}

export interface PlanOutput {
	summary: string;
	data_note?: string;
	advice?: string;
	blocks: PlanBlock[];
	flags: string[];
}

export interface Plan {
	id: string;
	user_id: string;
	local_date: string;
	as_of: string;
	context_snapshot: unknown;
	output: PlanOutput;
	basis: Basis;
	model_id: string;
	fallback_reason: string | null;
	supersedes_plan_id: string | null;
	created_at: string;
}

export type PlanInput = Omit<Plan, 'id' | 'user_id' | 'created_at'>;

export interface Followup {
	id: string;
	plan_id: string;
	user_id: string;
	action: string;
	block_ref: string;
	followed: 'yes' | 'no' | 'na';
	created_at: string;
}

export type FollowupInput = Omit<Followup, 'id' | 'user_id' | 'created_at'>;

export interface Storage {
	getProfile(userId: string): Promise<Profile | null>;
	saveProfile(userId: string, p: ProfileInput): Promise<Profile>;
	upsertCheckin(userId: string, c: CheckinInput): Promise<Checkin>;
	listCheckins(userId: string, sinceLocalDate: string): Promise<Checkin[]>;
	savePlan(userId: string, p: PlanInput): Promise<Plan>;
	getActivePlan(userId: string, localDate: string): Promise<Plan | null>;
	listPlans(userId: string, limit: number): Promise<Plan[]>;
	saveFollowups(userId: string, planId: string, rows: Omit<FollowupInput, 'plan_id'>[]): Promise<void>;
	listFollowups(userId: string, planIds: string[]): Promise<Followup[]>;
	deleteAll(userId: string): Promise<void>;
}
