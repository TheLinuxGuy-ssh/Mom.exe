<script lang="ts">
	import Check from 'lucide-svelte/icons/check';
	import X from 'lucide-svelte/icons/x';
	import type { PlanBlock } from '$lib/storage/types';
	import { ACTION_LABEL, type Action } from '$lib/engine/actions';
	import ActionIcon from './ActionIcon.svelte';

	let {
		block,
		phase,
		minutesLeft = 0,
		mark = null,
		onmark
	}: {
		block: PlanBlock;
		phase: 'current' | 'next';
		minutesLeft?: number;
		mark?: 'yes' | 'no' | null;
		onmark?: (followed: 'yes' | 'no') => void;
	} = $props();

	const label = $derived(ACTION_LABEL[block.action as Action] ?? block.action);
</script>

<div
	class="card !rounded-2xl p-4 transition-all
		{phase === 'current' ? '' : 'opacity-80'}
		{mark === 'yes' ? 'opacity-60 rotate-1' : ''}
		{mark === 'no' ? 'opacity-50' : ''}"
>
	<div class="flex items-start justify-between gap-3">
		<div class="flex items-center gap-2.5 min-w-0">
			<span class="grid place-items-center w-9 h-9 rounded-xl border-2 border-ink {phase === 'current' ? 'bg-orange text-paper' : 'bg-paper'}">
				<ActionIcon action={block.action} />
			</span>
			<div class="min-w-0">
				<p class="font-black uppercase text-sm tracking-tight truncate">{label}</p>
				<p class="text-xs font-bold text-mute">{block.start} - {block.end}</p>
			</div>
		</div>
		{#if phase === 'current'}
			<span class="chip !bg-yellow shrink-0">{minutesLeft > 0 ? `${minutesLeft} min left` : 'wrapping up'}</span>
		{:else}
			{#if mark === 'yes'}<span class="chip !bg-lime shrink-0"><Check class="w-3 h-3" /> done</span>{/if}
		{/if}
	</div>

	<p class="mt-2 text-[15px] font-semibold leading-snug">{block.detail}</p>
	{#if block.why}
		<p class="mt-1 text-xs font-semibold text-brown">because {block.why}</p>
	{/if}

	{#if onmark && mark === null}
		<div class="flex gap-2 mt-3">
			<button
				type="button"
				class="btn !shadow-[3px_3px_0_var(--color-ink)] !rounded-xl px-4 py-1.5 text-xs flex items-center gap-1.5 {phase === 'current' ? '!bg-lime' : ''}"
				onclick={() => onmark?.('yes')}
			>
				<Check class="w-3.5 h-3.5" /> done
			</button>
			<button
				type="button"
				class="btn !shadow-[3px_3px_0_var(--color-ink)] !rounded-xl px-4 py-1.5 text-xs flex items-center gap-1.5"
				onclick={() => onmark?.('no')}
			>
				<X class="w-3.5 h-3.5" /> skip
			</button>
		</div>
	{/if}
</div>
