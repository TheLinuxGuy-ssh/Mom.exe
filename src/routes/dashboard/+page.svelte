<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import History from 'lucide-svelte/icons/history';
	import Settings from 'lucide-svelte/icons/settings';
	import LogOut from 'lucide-svelte/icons/log-out';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import type { Checkin, Plan, PlanBlock, Profile } from '$lib/storage/types';
	import { getStorage } from '$lib/storage';
	import { getSession, clearSession } from '$lib/auth/session';
	import { getAuthToken, signOut as supabaseSignOut } from '$lib/auth/supabase';
	import { buildContext, buildTodayInfo, type TodayInfo } from '$lib/engine/context';
	import { computeStats } from '$lib/engine/stats';
	import { heuristicExtract } from '$lib/engine/extract';
	import { scrubText } from '$lib/engine/scrub';
	import { daysAgoLocalDate, localDateInTz } from '$lib/engine/time';
	import { generatePlan, extractViaLLM } from '$lib/llm/generate';
	import Composer from '$lib/components/Composer.svelte';
	import Timeline from '$lib/components/Timeline.svelte';
	import SleepStrip from '$lib/components/SleepStrip.svelte';
	import MealStrip from '$lib/components/MealStrip.svelte';
	import Mascot from '$lib/components/Mascot.svelte';
	import { toast } from '$lib/stores/toast';

	let profile = $state<Profile | null>(null);
	let checkins = $state<Checkin[]>([]);
	let plan = $state<Plan | null>(null);
	let marks = $state<Record<string, 'yes' | 'no'>>({});
	let now = $state(new Date());
	let busy = $state(false);
	let loading = $state(true);
	let askReplan = $state<Plan | null>(null);

	const session = getSession();
	const today = $derived(profile ? localDateInTz(profile.timezone, now) : '');
	const todayCheckin = $derived(checkins.find((c) => c.local_date === today) ?? null);

	$effect(() => {
		const timer = setInterval(() => (now = new Date()), 15000);
		return () => clearInterval(timer);
	});

	onMount(async () => {
		if (!session) {
			goto('/login');
			return;
		}
		const storage = getStorage();
		const p = await storage.getProfile(session.userId);
		if (!p) {
			goto('/onboarding');
			return;
		}
		profile = p;
		await refresh();
		loading = false;
	});

	async function refresh(): Promise<void> {
		if (!session || !profile) return;
		const storage = getStorage();
		const tz = profile.timezone;
		const todayStr = localDateInTz(tz);
		checkins = await storage.listCheckins(session.userId, daysAgoLocalDate(tz, 14));
		plan = await storage.getActivePlan(session.userId, todayStr);
		if (plan) await loadMarks(plan.id);
	}

	async function loadMarks(planId: string): Promise<void> {
		if (!session) return;
		const rows = await getStorage().listFollowups(session.userId, [planId]);
		const map: Record<string, 'yes' | 'no'> = {};
		for (const r of rows) {
			if (r.followed !== 'na') map[r.block_ref] = r.followed;
		}
		marks = map;
	}

	function applyRemoved(patch: ReturnType<typeof heuristicExtract>, removedKeys: string[]): ReturnType<typeof heuristicExtract> {
		for (const key of removedKeys) {
			if (key.startsWith('meals.')) {
				const slot = key.split('.')[1] as 'b' | 'l' | 's' | 'd';
				if (patch.meals) patch.meals[slot] = null;
			} else if (key.startsWith('disturbance.')) {
				const d = key.split('.')[1];
				patch.disturbances = patch.disturbances.filter((x) => x !== d);
			} else {
				(patch as unknown as Record<string, unknown>)[key] = null;
			}
		}
		return patch;
	}

	async function generateAndSavePlan(): Promise<boolean> {
		if (!session || !profile || busy) return false;
		busy = true;
		try {
			const storage = getStorage();
			const tz = profile.timezone;
			const todayStr = localDateInTz(tz);
			const allCheckins = await storage.listCheckins(session.userId, daysAgoLocalDate(tz, 14));
			const todayCheck = allCheckins.find((c) => c.local_date === todayStr) ?? null;
			const todayInfo = buildTodayInfo(profile, todayCheck, tz);
			const followups = await storage.listFollowups(
				session.userId,
				await storage.listPlans(session.userId, 10).then((ps) => ps.map((p) => p.id))
			);
			const stats = computeStats(allCheckins, followups, tz, todayStr);
			const { payload: ctxPayload, basis } = buildContext(profile, allCheckins, followups, todayInfo, new Date());

			const authToken = await getAuthToken();
			const result = await generatePlan(ctxPayload, profile, stats, todayInfo, authToken);

			const saved = await storage.savePlan(session.userId, {
				local_date: todayStr,
				as_of: new Date().toISOString(),
				context_snapshot: ctxPayload,
				output: result.output,
				basis,
				model_id: result.model_id,
				fallback_reason: result.fallbackReason ?? null,
				supersedes_plan_id: plan?.id ?? null
			});

			plan = saved;
			marks = {};
			askReplan = null;
			if (result.usedTemplate) {
				toast('planned in offline mode', 'warn');
			} else {
				toast('planned.');
			}
			return true;
		} catch (e) {
			toast(e instanceof Error ? e.message : 'could not reach mom, try again', 'warn');
			return false;
		} finally {
			busy = false;
		}
	}

	async function submitNote(payload: { text: string; quick: string | null; removedKeys: string[] }): Promise<boolean> {
		if (!session || !profile || busy) return false;
		busy = true;
		try {
			const storage = getStorage();
			const tz = profile.timezone;
			const todayStr = localDateInTz(tz);

			const patch = applyRemoved(heuristicExtract(scrubText(payload.text)), payload.removedKeys);
			if (payload.quick) patch.quick = payload.quick as 'rough' | 'okay' | 'great';
			const text = payload.text.trim();
			if (text || payload.quick) {
				await storage.upsertCheckin(session.userId, {
					local_date: todayStr,
					quick: patch.quick,
					sleep_hours: patch.sleep_hours,
					slept_at: patch.slept_at,
					woke_at: patch.woke_at,
					meals: patch.meals ?? { b: null, l: null, s: null, d: null },
					mood: null,
					notes: text || null,
					source: 'note'
				});
				await refresh();
			}
			if (plan) {
				askReplan = plan;
				toast('noted, beta.');
				return true;
			}
			busy = false;
			return await generateAndSavePlan();
		} catch (e) {
			toast(e instanceof Error ? e.message : 'could not reach mom, try again', 'warn');
			return false;
		} finally {
			busy = false;
		}
	}

	async function markBlock(block: PlanBlock, followed: 'yes' | 'no'): Promise<void> {
		if (!session || !plan) return;
		marks = { ...marks, [`${block.start}-${block.end}`]: followed };
		try {
			await getStorage().saveFollowups(session.userId, plan.id, [
				{ action: block.action, block_ref: `${block.start}-${block.end}`, followed }
			]);
		} catch {
			toast('could not save that, but noted on screen', 'warn');
		}
	}

	async function signOut(): Promise<void> {
		await supabaseSignOut();
		clearSession();
		goto('/');
	}
</script>

<svelte:head><title>Today — Mom.exe</title></svelte:head>

{#if loading}
	<div class="min-h-[70vh] grid place-items-center">
		<LoaderCircle class="w-8 h-8 animate-spin text-brown" />
	</div>
{:else if profile}
	<div class="w-[min(880px,calc(100%-1.5rem))] mx-auto py-6 space-y-8">
		<header class="flex items-center justify-between gap-3">
			<div>
				<p class="font-display text-xl tracking-tight uppercase select-none">Mom.exe</p>
				<p class="text-[11px] font-bold text-mute">hi {profile.display_name || 'beta'}</p>
			</div>
			<div class="flex items-center gap-2">
				<a href="/history" class="btn !rounded-full p-2.5" title="plan history"><History class="w-4 h-4" /></a>
				<a href="/settings" class="btn !rounded-full p-2.5" title="settings"><Settings class="w-4 h-4" /></a>
				<button type="button" class="btn !rounded-full p-2.5" title="log out" onclick={() => void signOut()}><LogOut class="w-4 h-4" /></button>
			</div>
		</header>

		<Composer busy={busy} onsubmit={submitNote} />

		{#if askReplan && plan}
			<div class="sticky-note max-w-md mx-auto rotate-1">
				<p class="font-sans text-sm font-bold mb-2">noted. want me to replan the rest of today around it?</p>
				<button
					type="button"
					class="btn !bg-orange !text-paper !rounded-full px-4 py-1.5 text-xs font-black uppercase"
					onclick={() => void generateAndSavePlan()}
				>
					replan from now
				</button>
			</div>
		{/if}

		{#if plan}
			<Timeline {plan} {now} tz={profile.timezone} {marks} onmark={markBlock} onreplan={() => void generateAndSavePlan()} />
		{:else}
			<div class="grid place-items-center gap-4 py-8 text-center">
				<Mascot size={220} labels={false} />
				<div class="max-w-sm">
					<p class="font-display text-2xl uppercase tracking-tight">NO PLAN YET.</p>
					<p class="text-sm font-semibold text-mute mt-1 leading-relaxed">
						You do not need to log anything first. Write a note above, or just hit the button and mom
						plans around your setup answers.
					</p>
				</div>
			</div>
		{/if}

		<footer class="card !rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
			<MealStrip meals={todayCheckin?.meals ?? null} />
			<SleepStrip {checkins} {today} />
		</footer>

		<p class="text-center text-[11px] font-semibold text-mute">
			wellness coach, not medical advice. missing days are unknown, never zero.
		</p>
	</div>
{/if}
