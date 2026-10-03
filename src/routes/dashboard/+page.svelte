<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import History from 'lucide-svelte/icons/history';
	import Settings from 'lucide-svelte/icons/settings';
	import LogOut from 'lucide-svelte/icons/log-out';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import type { Checkin, Message, Plan, PlanBlock, Profile } from '$lib/storage/types';
	import { getStorage } from '$lib/storage';
	import { getSession, clearSession } from '$lib/auth/session';
	import { getAuthToken, getSessionUser, signOut as supabaseSignOut } from '$lib/auth/supabase';
	import { buildContext, buildTodayInfo, buildPriorPlan } from '$lib/engine/context';
	import { computeStats } from '$lib/engine/stats';
	import {
		heuristicExtract,
		mergeUnderstanding,
		mergeCheckinRow,
		hasAnySignal
	} from '$lib/engine/extract';
	import { scrubText } from '$lib/engine/scrub';
	import { daysAgoLocalDate, localDateInTz } from '$lib/engine/time';
import { DIGEST_WEEKS, MEMORY_WINDOW, selectDigestBatches, toContextWindow } from '$lib/engine/memory';
	import { generateFromNote } from '$lib/llm/generate';
	import Composer from '$lib/components/Composer.svelte';
import ConversationDialog from '$lib/components/ConversationDialog.svelte';
import { NUDGE_EVERY, pickNudge } from '$lib/engine/nudge';
import SleepWidget from '$lib/components/SleepWidget.svelte';
import MealsWidget from '$lib/components/MealsWidget.svelte';
import DayShape from '$lib/components/DayShape.svelte';
import NudgeNote from '$lib/components/NudgeNote.svelte';
	import Timeline from '$lib/components/Timeline.svelte';
	import SleepStrip from '$lib/components/SleepStrip.svelte';
	import MealStrip from '$lib/components/MealStrip.svelte';
	import MomRead from '$lib/components/MomRead.svelte';
	import Mascot from '$lib/components/Mascot.svelte';
	import { toast } from '$lib/stores/toast';

	let profile = $state<Profile | null>(null);
	let checkins = $state<Checkin[]>([]);
	let plan = $state<Plan | null>(null);
	let marks = $state<Record<string, 'yes' | 'no'>>({});
	let messages = $state<Message[]>([]);
	let chatOpen = $state(false);
	let now = $state(new Date());
	let busy = $state(false);
	let loading = $state(true);
	let waited = $state(0);

	const session = getSession();
	const today = $derived(profile ? localDateInTz(profile.timezone, now) : '');
	const todayCheckin = $derived(checkins.find((c) => c.local_date === today) ?? null);

	$effect(() => {
		const timer = setInterval(() => (now = new Date()), 15000);
		return () => clearInterval(timer);
	});

	$effect(() => {
		if (!busy) {
			waited = 0;
			return;
		}
		const timer = setInterval(() => (waited += 1), 1000);
		return () => clearInterval(timer);
	});

	onMount(async () => {
		if (!session) {
			goto('/login');
			return;
		}
		if (session.mode === 'supabase') {
			await getSessionUser();
		}
		const storage = getStorage();
		const p = await storage.getProfile(session.userId).catch(() => null);
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
		messages = await storage.listMessages(session.userId, 200);
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

	function applyRemoved(
		patch: ReturnType<typeof heuristicExtract>,
		removedKeys: string[]
	): ReturnType<typeof heuristicExtract> {
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

	async function runOneShot(note: string | null, quick: string | null, removedKeys: string[]): Promise<boolean> {
		if (!session || !profile || busy) return false;
		busy = true;
		try {
			return await planOnce(note, quick, removedKeys);
		} finally {
			busy = false;
		}
	}

	/**
	 * The actual planning work, with no re-entrancy guard of its own. A chat that hands off to a
	 * replan runs while the chat turn is still marked busy, so going through runOneShot would
	 * bounce off its guard and the replan would silently never happen.
	 */
	async function planOnce(note: string | null, quick: string | null, removedKeys: string[]): Promise<boolean> {
		if (!session || !profile) return false;
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
			const priorPlan = buildPriorPlan(plan, marks, new Date(), tz);

			// conversation memory: recent window verbatim, older weeks as digests, and
			// anything that has aged out of both queued for summarising on this same call
			const stored = await storage.listMessages(session.userId, 200);
			const digests = await storage.listWeekDigests(session.userId, DIGEST_WEEKS);
			const conversation = {
				recent: toContextWindow(stored, MEMORY_WINDOW),
				older_digests: digests.map((d) => ({ week_start: d.week_start, text: d.content })),
				to_digest: selectDigestBatches(stored, digests, MEMORY_WINDOW)
			};

			const { payload: ctxPayload, basis } = buildContext(
				profile,
				allCheckins,
				followups,
				todayInfo,
				new Date(),
				priorPlan,
				conversation
			);

			const authToken = await getAuthToken();
			const result = await generateFromNote({
				note,
				context: ctxPayload,
				profile,
				stats,
				today: todayInfo,
				authToken
			});

			// Facts are worth keeping even when the note was only conversation: if they said
			// they slept four hours mid-chat, today should know that.
			const heur = applyRemoved(heuristicExtract(note ?? ''), removedKeys);
			if (quick) heur.quick = quick as 'rough' | 'okay' | 'great';
			const merged = mergeUnderstanding(heur, result.understanding, quick);
			const hasNewFacts = hasAnySignal(merged);

			if ((note || quick || hasNewFacts) && result.intent === 'plan') {
				const row = mergeCheckinRow(todayCheck, merged, note ?? '', todayStr);
				await storage.upsertCheckin(session.userId, row);
			} else if (hasNewFacts && note) {
				// chat: record the note so the pattern sticks, but do not let the chat itself
				// stand in for a check-in the student did not intend as one
				const row = mergeCheckinRow(todayCheck, merged, '', todayStr);
				await storage.upsertCheckin(session.userId, row);
			}

			await persistDigest(storage, result.digest);

			if (result.intent === 'chat') {
				await logExchange(storage, {
					date: todayStr,
					role: 'user',
					kind: 'chat',
					content: note ?? ''
				});
				if (result.advice) {
					await logExchange(storage, {
						date: todayStr,
						role: 'mom',
						kind: 'chat',
						content: nudgeIfDue(result.advice, messages)
					});
				}
				await refresh();

				if (!result.advice) {
					toast(result.fallbackReason ? 'mom could not reach the model, try again' : 'mom had nothing to say', 'warn');
					return false;
				}

// she decided the day needs redoing: get the chat out of the way first, so the plan
			// lands on a clean dashboard rather than behind a dialog the student has to close
			if (result.handoff === 'replan') {
				closeChat();
				await planOnce(null, null, []);
				return true;
			}

			chatOpen = true;
			return true;
			}

			if (!result.output) {
				toast(result.fallbackReason ?? 'could not plan right now', 'warn');
				return false;
			}

			if (note || quick || hasNewFacts) {
				const row = mergeCheckinRow(todayCheck, merged, note ?? '', todayStr);
				await storage.upsertCheckin(session.userId, row);
			}

			const saved = await storage.savePlan(session.userId, {
				local_date: todayStr,
				as_of: new Date().toISOString(),
				context_snapshot: { ...ctxPayload, note_understanding: result.understanding },
				output: { ...result.output, advice: result.advice ?? undefined },
				basis,
				model_id: result.model_id,
				fallback_reason: result.fallbackReason ?? null,
				supersedes_plan_id: plan?.id ?? null
			});

			await logExchange(storage, {
				date: todayStr,
				role: 'user',
				kind: note ? 'note' : 'replan',
				content: note ?? '(asked for a fresh plan)'
			});
			await logExchange(storage, {
				date: todayStr,
				role: 'mom',
				kind: 'replan',
				content: [result.advice, saved.output.summary].filter(Boolean).join(' ')
			});

			plan = saved;
			marks = {};
			await refresh();
			if (result.usedTemplate) {
				toast('planned in code. the model was unreachable', 'warn');
			} else {
				toast('noted. planned.');
			}
			return true;
		} catch (e) {
			toast(e instanceof Error ? e.message : 'could not reach mom, try again', 'warn');
			return false;
		}
	}

	async function submitNote(payload: { text: string; quick: string | null; removedKeys: string[] }): Promise<boolean> {
		const raw = payload.text.trim();
		return runOneShot(raw ? scrubText(raw) : null, payload.quick, payload.removedKeys);
	}

	/**
	 * One place closes the chat, so the handoff and the close button can never disagree about
	 * whether it is open.
	 */
	function closeChat(): void {
		chatOpen = false;
	}

	/**
	 * A line typed inside the conversation. Same single path as the composer: she decides
	 * whether this is talk or a request to replan, and the dialog opens or hands off on her
	 * answer rather than the student choosing a mode first.
	 */
	async function submitChat(text: string): Promise<boolean> {
		const ok = await runOneShot(scrubText(text.trim()), null, []);
		if (!chatOpen) return ok;
		// she closed it herself to replan, or the exchange is already in the log
		return ok;
	}

	async function flipMeal(slot: 'b' | 'l' | 's' | 'd'): Promise<void> {
		if (!session || !profile || !todayCheckin) return;
		const meals = { ...(todayCheckin.meals ?? { b: null, l: null, s: null, d: null }) };
		meals[slot] = meals[slot] === true ? false : true;
		const { id: _id, user_id: _u, created_at: _c, ...rest } = todayCheckin;
		await getStorage().upsertCheckin(session.userId, { ...rest, meals, source: 'note' });
		await refresh();
		toast('fixed.');
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

	/**
	 * Every fifth conversation, mom points the student back at the person who actually knows
	 * them. Deterministic on purpose: an LLM told to "occasionally" will do it at the wrong
	 * moment, and this line has to land gently rather than become nagging.
	 */
	function nudgeIfDue(reply: string, history: Message[]): string {
		const chats = history.filter((m) => m.kind === 'chat' && m.role === 'user').length;
		if ((chats + 1) % NUDGE_EVERY !== 0) return reply;
		return `${reply} ${pickNudge(history.length)}`;
	}

	/**
	 * Digests are best-effort: if the model call came back with them we store them, and if
	 * saving fails the raw messages are still on disk, so nothing is actually lost and the
	 * next call simply tries again.
	 */
	async function persistDigest(storage: ReturnType<typeof getStorage>, digest: { week: string; text: string }[]): Promise<void> {
		if (!session || digest.length === 0) return;
		for (const d of digest) {
			try {
				await storage.saveWeekDigest(session.userId, { week_start: d.week, content: d.text });
			} catch {
				return;
			}
		}
	}

	async function logExchange(
		storage: ReturnType<typeof getStorage>,
		row: { date: string; role: 'user' | 'mom'; kind: Message['kind']; content: string }
	): Promise<void> {
		if (!session) return;
		const content = row.content.trim();
		if (!content) return;
		try {
			await storage.appendMessages(session.userId, [
				{ local_date: row.date, role: row.role, kind: row.kind, content: content.slice(0, 2000) }
			]);
		} catch {
			/* the conversation log is a convenience, never a blocker for the plan */
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
	<div
		class="mx-auto w-[min(1180px,calc(100%-1.5rem))] py-6
			xl:grid xl:grid-cols-[240px_minmax(0,880px)_240px] xl:gap-8 xl:items-start"
	>
		<aside class="hidden xl:block space-y-5">
			<SleepWidget {checkins} {today} target={7.5} />
			<MealsWidget {checkins} {today} />
		</aside>

		<div class="space-y-8 min-w-0">
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

			<NudgeNote {today} />

		<ConversationDialog
				open={chatOpen}
				{messages}
				{busy}
				{waited}
				onsubmit={submitChat}
				onclose={closeChat}
			/>

			{#if todayCheckin && !busy && (todayCheckin.quick || todayCheckin.notes || todayCheckin.sleep_hours != null || todayCheckin.meals)}
				<MomRead checkin={todayCheckin} onflip={(slot) => void flipMeal(slot)} />
			{/if}

			{#if busy && !plan}
				<div class="max-w-2xl mx-auto card p-6 space-y-4 !bg-paper/80">
					<div class="flex items-center gap-3">
						<LoaderCircle class="w-5 h-5 animate-spin text-brown" />
						<p class="font-black uppercase tracking-wide text-brown text-sm">mom is reading your note... {waited}s</p>
					</div>
					<div class="space-y-2">
						<div class="h-10 bg-ink/5 rounded-xl"></div>
						<div class="h-10 bg-ink/5 rounded-xl w-3/4"></div>
						<div class="h-10 bg-ink/5 rounded-xl w-1/2"></div>
					</div>
					<p class="text-[11px] text-mute font-semibold">
						open-weight models think for 10-25s before answering. if it takes too long, i plan in code instead and you still get a real plan.
					</p>
				</div>
			{:else if plan}
				<Timeline {plan} {now} tz={profile.timezone} {marks} busy={busy} onmark={markBlock} />
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

		<aside class="hidden xl:block space-y-5">
			<DayShape blocks={plan?.output.blocks ?? []} />
		</aside>
	</div>
{/if}