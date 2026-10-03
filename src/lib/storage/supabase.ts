import type { SupabaseClient } from '@supabase/supabase-js';
import type {
	Checkin,
	CheckinInput,
	Followup,
	Plan,
	PlanInput,
	Profile,
	ProfileInput,
	Storage
} from './types';

export class SupabaseStorage implements Storage {
	private client: SupabaseClient;

	constructor(client: SupabaseClient) {
		this.client = client;
	}

	async getProfile(userId: string): Promise<Profile | null> {
		const { data, error } = await this.client.from('profiles').select('*').eq('id', userId).maybeSingle();
		if (error) throw new Error(error.message);
		return (data as Profile | null) ?? null;
	}

	async saveProfile(userId: string, p: ProfileInput): Promise<Profile> {
		const row = { id: userId, ...p };
		const { data, error } = await this.client.from('profiles').upsert(row).select().single();
		if (error) throw new Error(error.message);
		return data as Profile;
	}

	async upsertCheckin(userId: string, c: CheckinInput): Promise<Checkin> {
		const { data, error } = await this.client
			.from('checkins')
			.upsert({ user_id: userId, ...c }, { onConflict: 'user_id,local_date' })
			.select()
			.single();
		if (error) throw new Error(error.message);
		return data as Checkin;
	}

	async listCheckins(userId: string, sinceLocalDate: string): Promise<Checkin[]> {
		const { data, error } = await this.client
			.from('checkins')
			.select('*')
			.eq('user_id', userId)
			.gte('local_date', sinceLocalDate)
			.order('local_date', { ascending: true });
		if (error) throw new Error(error.message);
		return (data as Checkin[]) ?? [];
	}

	async savePlan(userId: string, p: PlanInput): Promise<Plan> {
		const { data, error } = await this.client
			.from('plans')
			.insert({ user_id: userId, ...p })
			.select()
			.single();
		if (error) throw new Error(error.message);
		return data as Plan;
	}

	async getActivePlan(userId: string, localDate: string): Promise<Plan | null> {
		const { data, error } = await this.client
			.from('plans')
			.select('*')
			.eq('user_id', userId)
			.eq('local_date', localDate)
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as Plan | null) ?? null;
	}

	async listPlans(userId: string, limit: number): Promise<Plan[]> {
		const { data, error } = await this.client
			.from('plans')
			.select('*')
			.eq('user_id', userId)
			.order('created_at', { ascending: false })
			.limit(limit);
		if (error) throw new Error(error.message);
		return (data as Plan[]) ?? [];
	}

	async saveFollowups(userId: string, planId: string, rows: Omit<Followup, 'id' | 'user_id' | 'created_at' | 'plan_id'>[]): Promise<void> {
		const { error } = await this.client.from('followups').insert(
			rows.map((r) => ({ user_id: userId, plan_id: planId, ...r }))
		);
		if (error) throw new Error(error.message);
	}

	async listFollowups(userId: string, planIds: string[]): Promise<Followup[]> {
		if (planIds.length === 0) return [];
		const { data, error } = await this.client
			.from('followups')
			.select('*')
			.eq('user_id', userId)
			.in('plan_id', planIds);
		if (error) throw new Error(error.message);
		return (data as Followup[]) ?? [];
	}

	async deleteAll(userId: string): Promise<void> {
		for (const table of ['followups', 'plans', 'checkins', 'profiles']) {
			const { error } = await this.client.from(table).delete().eq('user_id', userId);
			if (error && table !== 'profiles') throw new Error(error.message);
		}
		const { error } = await this.client.from('profiles').delete().eq('id', userId);
		if (error) throw new Error(error.message);
	}
}
