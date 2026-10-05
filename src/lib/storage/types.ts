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

export type MessageRole = 'user' | 'mom';
export type MessageKind = 'chat' | 'note' | 'replan';

/**
 * The conversation log. Every note sent to mom and every reply she gives, so that chat and
 * planning share one memory. `kind` distinguishes a plain conversation from a planning
 * exchange, which keeps the history page able to filter without parsing text.
 *
 * `session_id` is which app visit the line was written in. One session per opening the app: the
 * chat box starts empty every time, and two chats on the same afternoon are two conversations in
 * the history rather than one long one. It does NOT divide her memory. The context engine still
 * reads the last 20 messages across every session, so closing the app loses the transcript on
 * screen and nothing else. Null on rows written before sessions existed.
 */
export interface Message {
	id: string;
	user_id: string;
	local_date: string;
	role: MessageRole;
	kind: MessageKind;
	content: string;
	created_at: string;
	session_id: string | null;
}

export type MessageInput = Omit<Message, 'id' | 'user_id' | 'created_at' | 'session_id'> & {
	session_id?: string | null;
};

/**
 * A compressed stand-in for messages that have aged out of the context window, so mom keeps
 * a thread on older weeks without every old line being resent each time.
 */
export interface WeekDigest {
	id: string;
	user_id: string;
	week_start: string;
	content: string;
	created_at: string;
}

export type WeekDigestInput = Omit<WeekDigest, 'id' | 'user_id' | 'created_at'>;

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
	appendMessages(userId: string, rows: MessageInput[]): Promise<void>;
	/** Newest first. The context window uses a small limit; the history page uses a large one. */
	listMessages(userId: string, limit: number): Promise<Message[]>;
	saveWeekDigest(userId: string, d: WeekDigestInput): Promise<void>;
	/** Newest week first. */
	listWeekDigests(userId: string, limit: number): Promise<WeekDigest[]>;
	deleteAll(userId: string): Promise<void>;
}
