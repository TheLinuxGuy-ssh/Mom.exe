<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import MessagesSquare from 'lucide-svelte/icons/messages-square';
	import CalendarDays from 'lucide-svelte/icons/calendar-days';
	import type { Message, Plan } from '$lib/storage/types';
	import { getStorage } from '$lib/storage';
	import { getSession } from '$lib/auth/session';
	import { ACTION_LABEL, type Action } from '$lib/engine/actions';
	import { buildHistory, chatPreview, type ChatEntry, type HistoryEntry, type HistoryTab } from '$lib/engine/history';
	import { splitBubbles } from '$lib/engine/bubbles';
	import ActionIcon from '$lib/components/ActionIcon.svelte';

	let plans = $state<Plan[]>([]);
	let messages = $state<Message[]>([]);
	let loading = $state(true);
	let open = $state<string | null>(null);
	let tab = $state<HistoryTab>('all');

	const TABS: { value: HistoryTab; label: string }[] = [
		{ value: 'all', label: 'everything' },
		{ value: 'plans', label: 'plans' },
		{ value: 'chats', label: 'chats' }
	];

	/**
	 * One key per conversation, used both to identify the row and to remember whether it is
	 * expanded. A day is no longer enough: two chats on the same afternoon are two entries, and
	 * keying both on the date throws a duplicate-key error. Sessions are unique by construction,
	 * and a conversation from before sessions existed falls back to its first message, which is
	 * unique too.
	 */
	function entryKey(e: HistoryEntry): string {
		return e.kind === 'plan' ? `plan-${e.plan.id}` : `chat-${e.sessionId ?? `${e.date}-${e.messages[0]?.id ?? 'x'}`}`;
	}

	/**
	 * Two chats on the same afternoon are two conversations, so the clock time is what tells them
	 * apart. Rendered in the browser's own timezone, which is the one they experienced it in.
	 */
	function sessionTime(e: ChatEntry): string {
		const t = new Date(e.at);
		if (Number.isNaN(t.getTime())) return '';
		return `at ${t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
	}

	const view = $derived(buildHistory(plans, messages, tab));

	onMount(async () => {
		const session = getSession();
		if (!session) {
			goto('/login');
			return;
		}
		try {
			const storage = getStorage();
			// a failed read here used to leave the page permanently blank with no way to retry
			plans = await storage.listPlans(session.userId, 50).catch(() => []);
			messages = await storage.listMessages(session.userId, 300).catch(() => []);
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head><title>History — Mom.exe</title></svelte:head>

<div class="w-[min(760px,calc(100%-1.5rem))] mx-auto py-6 space-y-5">
	<header class="flex items-center gap-3">
		<a href="/dashboard" class="btn !rounded-full p-2.5" title="back"><ArrowLeft class="w-4 h-4" /></a>
		<h1 class="font-display text-3xl uppercase tracking-tight">The fridge door</h1>
	</header>

	<div class="flex flex-wrap gap-2">
		{#each TABS as t (t.value)}
			<button
				type="button"
				class="chip cursor-pointer {tab === t.value ? '!bg-lime' : '!bg-paper hover:!bg-yellow'}"
				aria-pressed={tab === t.value}
				onclick={() => (tab = t.value)}
			>
				{t.label}
			</button>
		{/each}
	</div>

	<p class="text-sm font-semibold text-mute">
		{#if tab === 'chats'}
			everything the two of you have said, newest day first.
		{:else if tab === 'plans'}
			every plan mom ever pinned, newest first.
		{:else}
			plans and conversations together, newest first.
		{/if}
	</p>

	{#if loading}
		<p class="text-sm font-bold text-mute">loading...</p>
	{:else if view.entries.length === 0}
		<div class="card p-8 text-center">
			<p class="font-display text-2xl uppercase">
				{tab === 'chats' ? 'no talking yet.' : 'nothing yet.'}
			</p>
			<p class="text-sm font-semibold text-mute mt-1">
				{#if tab === 'chats'}
					write to her on the dashboard and she will answer back.
				{:else}
					ask for your first plan on the dashboard.
				{/if}
			</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each view.entries as e (entryKey(e))}
				{#if e.kind === 'plan'}
					{@const p = e.plan}
					{@const ref = entryKey(e)}
					<button
						type="button"
						class="card !rounded-2xl p-4 w-full text-left cursor-pointer"
						onclick={() => (open = open === ref ? null : ref)}
					>
						<div class="flex items-center justify-between gap-3">
							<div class="min-w-0">
								<p class="font-black text-sm flex items-center gap-1.5">
									<CalendarDays class="w-3.5 h-3.5 text-brown" />
									plan
									<span class="text-mute font-bold text-xs ml-2">{p.basis} data, {p.model_id}</span>
								</p>
								<p class="text-sm font-semibold text-mute truncate mt-0.5">{p.output.summary}</p>
							</div>
							<ChevronDown class="w-4 h-4 shrink-0 transition-transform {open === ref ? 'rotate-180' : ''}" />
						</div>

						{#if open === ref}
							<div class="mt-4 space-y-2 border-t-2 border-ink/10 pt-3">
								{#each p.output.blocks as b}
									<div class="flex items-center gap-2.5 text-sm">
										<span class="grid place-items-center w-7 h-7 rounded-lg border-2 border-ink bg-paper shrink-0">
											<ActionIcon action={b.action} size={13} />
										</span>
										<span class="font-bold text-xs text-mute w-11 shrink-0">{b.start}</span>
										<span class="font-semibold truncate">{ACTION_LABEL[b.action as Action] ?? b.action}</span>
										<span class="text-xs text-mute truncate hidden sm:block">{b.detail}</span>
									</div>
								{/each}
								{#if p.output.flags.length > 0}
									<p class="text-xs font-bold text-brown pt-1">flags: {p.output.flags.join(', ')}</p>
								{/if}
							</div>
						{/if}
					</button>
				{:else}
					{@const ref = entryKey(e)}
					<button
						type="button"
						class="card !rounded-2xl p-4 w-full text-left cursor-pointer"
						onclick={() => (open = open === ref ? null : ref)}
					>
						<div class="flex items-center justify-between gap-3">
							<div class="min-w-0">
								<p class="font-black text-sm flex items-center gap-1.5">
									{#if e.isPlan}
										<CalendarDays class="w-3.5 h-3.5 text-brown" />
										replan
									{:else}
										<MessagesSquare class="w-3.5 h-3.5 text-brown" />
										conversation
									{/if}
									<span class="text-mute font-bold text-xs ml-2">
										{e.sessionId ? sessionTime(e) : ''}
										{e.messages.length} messages
									</span>
								</p>
								<p class="text-sm font-semibold text-mute truncate mt-0.5">{chatPreview(e.messages)}</p>
							</div>
							<ChevronDown class="w-4 h-4 shrink-0 transition-transform {open === ref ? 'rotate-180' : ''}" />
						</div>

						{#if open === ref}
							<div class="mt-4 space-y-2 border-t-2 border-ink/10 pt-3">
								{#each e.messages as m (m.id)}
									{#if m.role === 'user'}
										<div class="flex justify-end">
											<div
												class="max-w-[85%] px-3 py-1.5 text-sm leading-snug border-2 border-ink bg-blue/40 font-semibold rounded-xl rounded-br-sm"
											>
												{m.content}
											</div>
										</div>
									{:else}
										<!-- split exactly as the conversation does, so a thread reads the same in both places -->
										{#each splitBubbles(m.content) as part, i (i)}
											<div class="flex justify-start">
												<div class="max-w-[85%] px-3 py-1.5 text-sm leading-snug sticky-note !text-[15px]">
													{part}
												</div>
											</div>
										{/each}
									{/if}
								{/each}
							</div>
						{/if}
					</button>
				{/if}
			{/each}
		</div>
	{/if}
</div>
