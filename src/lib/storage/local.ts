import type {
	Checkin,
	CheckinInput,
	Followup,
	FollowupInput,
	Message,
	MessageInput,
	Plan,
	PlanInput,
	Profile,
	ProfileInput,
	Storage,
	WeekDigest,
	WeekDigestInput
} from './types';

const memory = new Map<string, string>();

interface KVStore {
	getItem(k: string): string | null;
	setItem(k: string, v: string): void;
	removeItem(k: string): void;
}

function ls(): KVStore {
	try {
		const t = 'momexe::__t';
		localStorage.setItem(t, '1');
		localStorage.removeItem(t);
		return localStorage;
	} catch {
		return {
			getItem: (k: string) => memory.get(k) ?? null,
			setItem: (k: string, v: string) => void memory.set(k, v),
			removeItem: (k: string) => void memory.delete(k)
		};
	}
}

const store = ls();

function key(userId: string, kind: string): string {
	return `momexe:v1:${userId}:${kind}`;
}

function read<T>(k: string, fallback: T): T {
	const raw = store.getItem(k);
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function write(k: string, v: unknown): void {
	store.setItem(k, JSON.stringify(v));
}

function uid(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
	return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class LocalStorage implements Storage {
	async getProfile(userId: string): Promise<Profile | null> {
		return read<Profile | null>(key(userId, 'profile'), null);
	}

	async saveProfile(userId: string, p: ProfileInput): Promise<Profile> {
		const profile: Profile = {
			id: userId,
			created_at: new Date().toISOString(),
			...p
		};
		write(key(userId, 'profile'), profile);
		return profile;
	}

	async upsertCheckin(userId: string, c: CheckinInput): Promise<Checkin> {
		const list = read<Checkin[]>(key(userId, 'checkins'), []);
		const idx = list.findIndex((x) => x.local_date === c.local_date);
		if (idx >= 0) {
			const merged: Checkin = { ...list[idx], ...cleanPatch(c) };
			list[idx] = merged;
			write(key(userId, 'checkins'), list);
			return merged;
		}
		const row: Checkin = {
			id: uid(),
			user_id: userId,
			created_at: new Date().toISOString(),
			...c
		};
		list.push(row);
		list.sort((a, b) => (a.local_date < b.local_date ? -1 : 1));
		write(key(userId, 'checkins'), list);
		return row;
	}

	async listCheckins(userId: string, sinceLocalDate: string): Promise<Checkin[]> {
		return read<Checkin[]>(key(userId, 'checkins'), [])
			.filter((c) => c.local_date >= sinceLocalDate)
			.sort((a, b) => (a.local_date < b.local_date ? -1 : 1));
	}

	async savePlan(userId: string, p: PlanInput): Promise<Plan> {
		const list = read<Plan[]>(key(userId, 'plans'), []);
		const plan: Plan = {
			id: uid(),
			user_id: userId,
			created_at: new Date().toISOString(),
			...p
		};
		list.push(plan);
		write(key(userId, 'plans'), list);
		return plan;
	}

	async getActivePlan(userId: string, localDate: string): Promise<Plan | null> {
		const list = read<Plan[]>(key(userId, 'plans'), [])
			.filter((p) => p.local_date === localDate)
			.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
		return list[0] ?? null;
	}

	async listPlans(userId: string, limit: number): Promise<Plan[]> {
		return read<Plan[]>(key(userId, 'plans'), [])
			.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
			.slice(0, limit);
	}

	async saveFollowups(userId: string, planId: string, rows: Omit<FollowupInput, 'plan_id'>[]): Promise<void> {
		const list = read<Followup[]>(key(userId, 'followups'), []);
		const kept = list.slice();
		for (const r of rows) {
			// one row per (plan, block): marking a second block must not erase the first one's
			// mark, which is what dropping every row for the plan did
			for (let i = kept.length - 1; i >= 0; i--) {
				if (kept[i]!.plan_id === planId && kept[i]!.block_ref === r.block_ref) kept.splice(i, 1);
			}
			const row: Followup = {
				id: uid(),
				user_id: userId,
				plan_id: planId,
				created_at: new Date().toISOString(),
				...r
			};
			kept.push(row);
		}
		write(key(userId, 'followups'), kept);
	}

	async listFollowups(userId: string, planIds: string[]): Promise<Followup[]> {
		const set = new Set(planIds);
		// newest first, matching the hosted backend, so both fold to "the last mark they gave wins"
		return read<Followup[]>(key(userId, 'followups'), [])
			.filter((f) => set.has(f.plan_id))
			.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
	}

	async appendMessages(userId: string, rows: MessageInput[]): Promise<void> {
		if (rows.length === 0) return;
		const list = read<Message[]>(key(userId, 'messages'), []);
		for (const r of rows) {
			list.push({
				id: uid(),
				user_id: userId,
				created_at: new Date().toISOString(),
				// older callers do not know about sessions, and a row without one is a conversation
				// that predates them rather than a broken write
				session_id: null,
				...r
			});
		}
		list.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
		write(key(userId, 'messages'), list);
	}

	async listMessages(userId: string, limit: number): Promise<Message[]> {
		return read<Message[]>(key(userId, 'messages'), [])
			.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
			.slice(0, limit);
	}

	async saveWeekDigest(userId: string, d: WeekDigestInput): Promise<void> {
		const list = read<WeekDigest[]>(key(userId, 'week_digests'), []);
		const existing = list.find((x) => x.week_start === d.week_start);
		if (existing) {
			existing.content = d.content;
		} else {
			list.push({ id: uid(), user_id: userId, created_at: new Date().toISOString(), ...d });
		}
		list.sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
		write(key(userId, 'week_digests'), list);
	}

	async listWeekDigests(userId: string, limit: number): Promise<WeekDigest[]> {
		return read<WeekDigest[]>(key(userId, 'week_digests'), [])
			.sort((a, b) => (a.week_start < b.week_start ? 1 : -1))
			.slice(0, limit);
	}

	async deleteAll(userId: string): Promise<void> {
		for (const kind of ['profile', 'checkins', 'plans', 'followups', 'messages', 'week_digests']) {
			store.removeItem(key(userId, kind));
		}
	}
}

function cleanPatch(c: CheckinInput): Partial<Checkin> {
	const patch: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(c)) {
		if (v !== undefined && v !== null) patch[k] = v;
	}
	return patch as Partial<Checkin>;
}
