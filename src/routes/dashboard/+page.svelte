<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import History from 'lucide-svelte/icons/history';
	import Settings from 'lucide-svelte/icons/settings';
	import LogOut from 'lucide-svelte/icons/log-out';
	import type { Checkin, Message, Plan, PlanBlock, Profile } from '$lib/storage/types';
	import { getStorage } from '$lib/storage';
	import { getSession, clearSession } from '$lib/auth/session';
	import { getAuthToken, getSessionUser, signOut as supabaseSignOut } from '$lib/auth/supabase';
	import { newVisitId } from '$lib/visit';
	import { emptyNoteMessage, hasSomethingToSend, shouldDismissChat } from '$lib/engine/prompt-rules';
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
import {
	DIGEST_BATCH,
	DIGEST_WEEKS,
	MEMORY_WINDOW,
	selectDigestBatches,
	toContextWindow
} from '$lib/engine/memory';
	import { generateFromNote } from '$lib/llm/generate';
	import Composer from '$lib/components/Composer.svelte';
import ConversationDialog from '$lib/components/ConversationDialog.svelte';

import SleepWidget from '$lib/components/SleepWidget.svelte';
import MealsWidget from '$lib/components/MealsWidget.svelte';
import DayShape from '$lib/components/DayShape.svelte';
import CatVisit from '$lib/components/CatVisit.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Timeline from '$lib/components/Timeline.svelte';
	import SleepStrip from '$lib/components/SleepStrip.svelte';
	import MealStrip from '$lib/components/MealStrip.svelte';
	import MomRead from '$lib/components/MomRead.svelte';
	import Mascot from '$lib/components/Mascot.svelte';
	import DashboardSkeleton from '$lib/components/DashboardSkeleton.svelte';
	import PlanSkeleton from '$lib/components/PlanSkeleton.svelte';
	import { toast } from '$lib/stores/toast';

	let profile = $state<Profile | null>(null);
	let checkins = $state<Checkin[]>([]);
	let plan = $state<Plan | null>(null);
	let marks = $state<Record<string, 'yes' | 'no'>>({});
	let messages = $state<Message[]>([]);
	/**
	 * One conversation per opening the app. Reopening starts a clean chat box, which is what
	 * actually happened: they closed it. The transcript is not lost, it is filed under this id in
	 * the history, and the context engine below still reads the last 20 messages across every
	 * session, so mom carries the thread forward even though the screen starts empty.
	 */
	let sessionId = $state(newVisitId());
	let chatOpen = $state(false);
	/** signing out is easy to do by accident from a row of small icon buttons */
	let askSignOut = $state(false);
	let now = $state(new Date());
	let busy = $state(false);
	let loading = $state(true);
	let waited = $state(0);

	const session = getSession();
	const today = $derived(profile ? localDateInTz(profile.timezone, now) : '');
	const todayCheckin = $derived(checkins.find((c) => c.local_date === today) ?? null);

	/**
	 * Only this visit's lines, so reopening the app opens an empty conversation. `messages` still
	 * holds everything, because that is what the context window and the history are built from.
	 * Newest-first, which is what the dialog expects and reverses for display.
	 */
	const sessionMessages = $derived(messages.filter((m) => m.session_id === sessionId));

	/**
	 * What they just typed, shown while she is still reading it. The exchange is only written to
	 * storage once the model has answered, which is 5-15s later, so without this the student's own
	 * message would appear at the same moment as her reply and the wait would look like nothing
	 * happened. This is the echo of a message that already exists; the dialog retires it as soon as
	 * the stored copy arrives, matched by text and time.
	 */
	let pendingChat = $state<Message | null>(null);
	let flipping = $state(false);
	let signingOut = $state(false);

	$effect(() => {
		const timer = setInterval(() => (now = new Date()), 15000);
		return () => clearInterval(timer);
	});

	/**
	 * Midnight, handled. The clock ticks every 15s so `today` moves on, but nothing re-read: the
	 * page went on showing yesterday's plan, yesterday's check-in and a conversation thread about
	 * yesterday, with no way to get to today without a reload. A new day is also a new visit, since
	 * the chat panel is meant to open onto the current sitting and nothing older.
	 */
	let lastDay = $state('');
	$effect(() => {
		const day = today;
		if (!day || !profile) return;
		if (lastDay === '') {
			lastDay = day;
			return;
		}
		if (day === lastDay) return;
		lastDay = day;
		sessionId = newVisitId();
		void refresh();
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
		try {
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
		} finally {
			// loading is cleared whatever happens above. one rejected read used to leave the page on
			// its skeleton forever, which looks exactly like the app is still thinking
			loading = false;
		}
	});

	/**
	 * Each read degrades on its own. The dashboard is assembled from four separate calls, and if
	 * any one of them throws the student gets an empty page with no explanation at all — losing the
	 * chat history is a nuisance, losing the plan while the week strip still renders is confusing,
	 * and neither is worth a blank screen. So a failed read keeps the screen it can still draw.
	 */
	async function refresh(): Promise<void> {
		if (!session || !profile) return;
		const storage = getStorage();
		const tz = profile.timezone;
		const todayStr = localDateInTz(tz);
		checkins = await storage
			.listCheckins(session.userId, daysAgoLocalDate(tz, 14))
			.catch(() => []);
		plan = await storage.getActivePlan(session.userId, todayStr).catch(() => null);
		if (plan) await loadMarks(plan.id);
		messages = await storage.listMessages(session.userId, 200).catch(() => []);
	}

	async function loadMarks(planId: string): Promise<void> {
		if (!session) return;
		const rows = await getStorage()
			.listFollowups(session.userId, [planId])
			.catch(() => []);
		const map: Record<string, 'yes' | 'no'> = {};
		for (const r of rows) {
			// rows come back newest first, so the first row seen for a block is the mark they gave
			// it last. Assigning unconditionally would let an older row win.
			if (r.followed === 'na') continue;
			if (map[r.block_ref] === undefined) map[r.block_ref] = r.followed;
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
	/**
	 * `fromHandoff` means the caller already logged the student's line as chat and is replanning
	 * off the back of it, so the placeholder "asked for a fresh plan" would put their words in the
	 * log twice.
	 */
	async function planOnce(
		note: string | null,
		quick: string | null,
		removedKeys: string[],
		fromHandoff = false
	): Promise<boolean> {
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
			// four weeks go into the model's context; the full history is what says which weeks
			// have already been summarized, and passing only four made old weeks re-digest forever
			const digests = await storage.listWeekDigests(session.userId, DIGEST_WEEKS);
			const knownDigestWeeks = await storage.listWeekDigests(session.userId, 52);
			const conversation = {
				recent: toContextWindow(stored, MEMORY_WINDOW),
				older_digests: digests.map((d) => ({ week_start: d.week_start, text: d.content })),
				to_digest: selectDigestBatches(stored, knownDigestWeeks, MEMORY_WINDOW, DIGEST_BATCH, todayStr)
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
				const row = mergeCheckinRow(todayCheck, merged, note ?? '', todayStr, removedKeys);
				await storage.upsertCheckin(session.userId, row);
			} else if (hasNewFacts && note) {
				// chat: record the note so the pattern sticks, but do not let the chat itself
				// stand in for a check-in the student did not intend as one
				const row = mergeCheckinRow(todayCheck, merged, '', todayStr, removedKeys);
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
				// she decided the day needs redoing: get the chat out of the way first, so the plan
				// lands on a clean dashboard rather than behind a dialog the student has to close.
				// Checked before logging her reply, because the replan logs the plan as the answer and
				// writing this line out as well printed the same answer twice.
				if (result.handoff === 'replan') {
					closeChat();
					await planOnce(null, null, [], true);
					return true;
				}

				if (result.advice) {
					await logExchange(storage, {
						date: todayStr,
						role: 'mom',
						kind: 'chat',
						content: result.advice
					});
				}
				await refresh();

				if (!result.advice) {
					toast(result.fallbackReason ? 'mom could not reach the model, try again' : 'mom had nothing to say', 'warn');
					return false;
				}

				chatOpen = true;
				return true;
			}

			if (!result.output) {
				toast(result.fallbackReason ?? 'could not plan right now', 'warn');
				return false;
			}

			if (note || quick || hasNewFacts) {
				const row = mergeCheckinRow(todayCheck, merged, note ?? '', todayStr, removedKeys);
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

			if (!fromHandoff) {
				await logExchange(storage, {
					date: todayStr,
					role: 'user',
					kind: note ? 'note' : 'replan',
					content: note ?? '(asked for a fresh plan)'
				});
			}

			// One reply in the conversation, never two. Writing advice AND summary into one stored
			// message is what made her look like she was answering twice: the two fields routinely
			// say the same thing in different words, and joined together they pass the length at
			// which a reply is split into bubbles, so a single line came out as two on screen.
			// Take whichever she actually wrote; the plan itself is on the timeline either way.
			const replyInChat = result.advice?.trim() || saved.output.summary.trim();
			if (replyInChat) {
				await logExchange(storage, {
					date: todayStr,
					role: 'mom',
					kind: 'replan',
					content: replyInChat
				});
			}

			plan = saved;
			marks = {};
			await refresh();

			// Get out of the way once the new day is actually on the timeline.
			//
			// Asking for a change from inside the conversation is the ordinary way to use this app,
			// and `intentHint` decides "shift my dinner to 9pm" is a planning request in code, before
			// any model is asked. So this branch, not the handoff one above, is where a chat-submitted
			// replan lands — which left the student staring at a dialog covering the plan she had just
			// rewritten, with no way to tell it had happened. They had to close it themselves.
			//
			// Deliberately not model-driven. A `dismiss` flag would mean a prompt instruction, a schema
			// field, and a new way to fail, all to be told something this function already knows: it
			// is holding the saved plan. The rule itself is `shouldDismissChat`, which is tested,
			// because this component is not.
			if (shouldDismissChat({ chatOpen, planSaved: true })) closeChat();

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
		// The composer already refuses this, and it is checked again here on purpose: this is the
		// only boundary between a student's keystrokes and a paid model round trip, and the composer
		// is a component that can be edited without anyone reading this file.
		if (!hasSomethingToSend(raw, payload.quick)) {
			toast(emptyNoteMessage(), 'warn');
			return false;
		}
		return runOneShot(scrubText(raw) || null, payload.quick, payload.removedKeys);
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
		// punctuation and "idk" are what arrive when someone hits enter without really typing. the
		// classifier sends those to the planner, which would burn a plan generation and overwrite a
		// good one with a reply to nothing
		const trimmed = text.trim();
		if (trimmed === '' || /^[.!?…\s]+$/.test(trimmed) || /^(idk|idc|lol|hmm+|huh)\b/i.test(trimmed)) {
			return false;
		}
		// on screen before the model is even called, so the wait reads as her thinking rather than
		// as a dead button
		pendingChat = {
			id: `pending-${Date.now()}`,
			user_id: session?.userId ?? '',
			local_date: profile ? localDateInTz(profile.timezone, now) : '',
			role: 'user',
			kind: 'chat',
			content: scrubText(trimmed),
			created_at: new Date().toISOString(),
			session_id: sessionId
		};
		try {
			return await runOneShot(scrubText(trimmed), null, []);
		} finally {
			// whatever happened, the echo has done its job: either the stored copy has taken over, or
			// the exchange failed and there is nothing to show for it
			pendingChat = null;
		}
	}

	async function flipMeal(slot: 'b' | 'l' | 's' | 'd'): Promise<void> {
		if (!session || !profile || !todayCheckin || flipping) return;
		const meals = { ...(todayCheckin.meals ?? { b: null, l: null, s: null, d: null }) };
		meals[slot] = meals[slot] === true ? false : true;
		const { id: _id, user_id: _u, created_at: _c, ...rest } = todayCheckin;
		// show the tap immediately, then put it back if the write failed. the tap used to await an
		// unguarded write, so a dropped connection looked exactly like the app ignoring you
		const previous = todayCheckin;
		const shown = { ...previous, meals };
		checkins = checkins.map((c) => (c.local_date === today ? shown : c));
		flipping = true;
		try {
			await getStorage().upsertCheckin(session.userId, { ...rest, meals, source: 'note' });
		} catch (err) {
			console.error(err);
			checkins = checkins.map((c) => (c.local_date === today ? previous : c));
			toast('could not save that. check your connection.', 'warn');
			return;
		} finally {
			flipping = false;
		}
		await refresh();
	}

	async function markBlock(block: PlanBlock, followed: 'yes' | 'no'): Promise<void> {
		if (!session || !plan) return;
		const ref = `${block.start}-${block.end}`;
		const previous = marks[ref];
		marks = { ...marks, [ref]: followed };
		try {
			await getStorage().saveFollowups(session.userId, plan.id, [
				{ action: block.action, block_ref: ref, followed }
			]);
		} catch {
			// put it back. leaving the mark on screen told the planner a block was done or skipped
			// when storage says it never was, and the student could not see that it had not saved
			const rolled = { ...marks };
			if (previous === undefined) delete rolled[ref];
			else rolled[ref] = previous;
			marks = rolled;
			toast('could not save that', 'warn');
		}
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
				// one week failing must not abandon the rest. the raw messages are still on disk and
				// the week is simply uncovered, so it gets picked up on a later call
				continue;
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
				{
					local_date: row.date,
					role: row.role,
					kind: row.kind,
					content: content.slice(0, 2000),
					session_id: sessionId
				}
			]);
		} catch {
			/* the conversation log is a convenience, never a blocker for the plan */
		}
	}

	async function signOut(): Promise<void> {
		askSignOut = false;
		signingOut = true;
		try {
			await supabaseSignOut();
		} catch (err) {
			// the local session is cleared either way. leaving the student on the dashboard because
			// a network call failed is the one outcome worse than an ambiguous server state
			console.error(err);
		} finally {
			signingOut = false;
			clearSession();
			await goto('/');
		}
	}
</script>

<svelte:head><title>Today — Mom.exe</title></svelte:head>

{#if loading}
	<DashboardSkeleton />
{:else if profile}
<CatVisit />
	<div
		class="mx-auto w-[min(1180px,calc(100%-1.5rem))] py-6
			xl:grid xl:grid-cols-[240px_minmax(0,880px)_240px] xl:gap-8 xl:items-start h-full"
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
					<button
						type="button"
						class="btn !rounded-full p-2.5"
						title="log out"
						aria-label="log out"
						onclick={() => (askSignOut = true)}
					><LogOut class="w-4 h-4" /></button
					>
				</div>
			</header>

			<Composer busy={busy} onsubmit={submitNote} />


			{#if todayCheckin && (todayCheckin.quick || todayCheckin.notes || todayCheckin.sleep_hours != null || todayCheckin.meals)}
				<div class="{busy ? 'opacity-25 pointer-events-none' : ''} transition-opacity">
					<MomRead checkin={todayCheckin} onflip={(slot) => void flipMeal(slot)} />
				</div>
			{/if}

			{#if busy && !plan}
				<PlanSkeleton
					counter={waited}
					note="open-weight models think for 10-25s before answering. if it takes too long, i plan in code instead and you still get a real plan."
				/>
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

			<footer class="card !rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 xl:hidden">
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

	<!--
		Both dialogs sit out here at the top level of the page, never inside the grid above. Mounted
		nested, the dimmer was cut off partway down the screen; at depth 0 — where the logout dialog
		already lived — it covers the page. Nothing in the CSS explains the difference, so rather than
		guess, every dialog in the app is mounted at depth 0 and shares one backdrop via `Modal`.
	-->
	<ConversationDialog
		open={chatOpen}
		messages={sessionMessages}
		pending={pendingChat}
		{busy}
		{waited}
		onsubmit={submitChat}
		onclose={closeChat}
	/>

	<ConfirmDialog
		open={askSignOut}
		title="log out?"
		confirmLabel="log out"
		busy={signingOut}
		onconfirm={() => void signOut()}
		oncancel={() => (askSignOut = false)}
	>
		Your check-ins and plans will be here when you return.
	</ConfirmDialog>
{/if}