<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import MessagesSquare from 'lucide-svelte/icons/messages-square';
	import type { Message, Plan } from '$lib/storage/types';
	import { getStorage } from '$lib/storage';
	import { getSession } from '$lib/auth/session';
	import { ACTION_LABEL, type Action } from '$lib/engine/actions';
	import { buildHistory, chatPreview, type HistoryTab } from '$lib/engine/history';
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

	const view = $derived(buildHistory(plans, messages, tab));

	onMount(async () => {
		const session = getSession();
		if (!session) {
			goto('/login');
			return;
		}
		const storage = getStorage();
		plans = await storage.listPlans(session.userId, 50);
		messages = await storage.listMessages(session.userId, 300);
		loading = false;
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
			{#each view.entries as e (e.kind === 'plan' ? `plan-${e.plan.id}` : `chat-${e.date}`)}
				{#if e.kind === 'plan'}
					{@const p = e.plan}
					{@const ref = `plan-${p.id}`}
					<button
						type="button"
						class="card !rounded-2xl p-4 w-full text-left cursor-pointer"
						onclick={() => (open = open === ref ? null : ref)}
					>
						<div class="flex items-center justify-between gap-3">
							<div class="min-w-0">
								<p class="font-black text-sm">
									pinned
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
					{@const ref = `chat-${e.date}`}
					<button
						type="button"
						class="card !rounded-2xl p-4 w-full text-left cursor-pointer"
						onclick={() => (open = open === ref ? null : ref)}
					>
						<div class="flex items-center justify-between gap-3">
							<div class="min-w-0">
								<p class="font-black text-sm flex items-center gap-1.5">
									<MessagesSquare class="w-3.5 h-3.5 text-brown" />
									you two
									<span class="text-mute font-bold text-xs ml-2">{e.messages.length} messages</span>
								</p>
								<p class="text-sm font-semibold text-mute truncate mt-0.5">{chatPreview(e.messages)}</p>
							</div>
							<ChevronDown class="w-4 h-4 shrink-0 transition-transform {open === ref ? 'rotate-180' : ''}" />
						</div>

						{#if open === ref}
							<div class="mt-4 space-y-2 border-t-2 border-ink/10 pt-3">
								{#each e.messages as m (m.id)}
									<div class="flex {m.role === 'mom' ? 'justify-start' : 'justify-end'}">
										<div
											class="max-w-[85%] px-3 py-1.5 text-sm leading-snug {m.role === 'mom'
												? 'sticky-note !text-[15px]'
												: 'border-2 border-ink bg-blue/40 font-semibold rounded-xl rounded-br-sm'}"
										>
											{m.content}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</button>
				{/if}
			{/each}
		</div>
	{/if}
</div>
