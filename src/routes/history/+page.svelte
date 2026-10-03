<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import type { Plan } from '$lib/storage/types';
	import { getStorage } from '$lib/storage';
	import { getSession } from '$lib/auth/session';
	import { ACTION_LABEL, type Action } from '$lib/engine/actions';
	import ActionIcon from '$lib/components/ActionIcon.svelte';

	let plans = $state<Plan[]>([]);
	let loading = $state(true);
	let open = $state<string | null>(null);

	onMount(async () => {
		const session = getSession();
		if (!session) {
			goto('/login');
			return;
		}
		plans = await getStorage().listPlans(session.userId, 50);
		loading = false;
	});
</script>

<svelte:head><title>History — Mom.exe</title></svelte:head>

<div class="w-[min(760px,calc(100%-1.5rem))] mx-auto py-6 space-y-5">
	<header class="flex items-center gap-3">
		<a href="/dashboard" class="btn !rounded-full p-2.5" title="back"><ArrowLeft class="w-4 h-4" /></a>
		<h1 class="font-display text-3xl uppercase tracking-tight">The fridge door</h1>
	</header>
	<p class="text-sm font-semibold text-mute">every plan mom ever pinned, newest first.</p>

	{#if loading}
		<p class="text-sm font-bold text-mute">loading...</p>
	{:else if plans.length === 0}
		<div class="card p-8 text-center">
			<p class="font-display text-2xl uppercase">NOTHING YET.</p>
			<p class="text-sm font-semibold text-mute mt-1">ask for your first plan on the dashboard.</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each plans as p (p.id)}
				<button
					type="button"
					class="card !rounded-2xl p-4 w-full text-left cursor-pointer"
					onclick={() => (open = open === p.id ? null : p.id)}
				>
					<div class="flex items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="font-black text-sm">{p.local_date}
								<span class="text-mute font-bold text-xs ml-2">{p.basis} data, {p.model_id}</span>
							</p>
							<p class="text-sm font-semibold text-mute truncate mt-0.5">{p.output.summary}</p>
						</div>
						<ChevronDown class="w-4 h-4 shrink-0 transition-transform {open === p.id ? 'rotate-180' : ''}" />
					</div>

					{#if open === p.id}
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
			{/each}
		</div>
	{/if}
</div>
