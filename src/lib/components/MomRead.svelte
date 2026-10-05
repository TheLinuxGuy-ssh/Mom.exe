<script lang="ts">
	import PencilLine from 'lucide-svelte/icons/pencil-line';
	import type { Checkin } from '$lib/storage/types';

	let { checkin, onflip }: { checkin: Checkin; onflip: (slot: 'b' | 'l' | 's' | 'd') => void } = $props();

	const slots = [
		{ k: 'b', label: 'breakfast' },
		{ k: 'l', label: 'lunch' },
		{ k: 's', label: 'snack' },
		{ k: 'd', label: 'dinner' }
	] as const;

	const deadline = $derived(
		checkin.notes ? /\b(due|exam|submission|assignment|quiz|test|project)\b/i.test(checkin.notes) : false
	);

	/**
	 * Whether she understood anything at all. A bare "mom read:" with nothing after it looks like the
	 * app failed to load rather than like a student who has not written anything yet, so the empty
	 * case says so in the same hand as everything else.
	 */
	const heard = $derived(
		Boolean(
			checkin.quick ||
				checkin.sleep_hours != null ||
				checkin.slept_at ||
				checkin.woke_at ||
				checkin.mood != null ||
				deadline ||
				slots.some((s) => checkin.meals?.[s.k] != null)
		)
	);
</script>

<div class="flex flex-wrap items-center gap-1.5">
	<span class="text-[11px] font-black uppercase tracking-widest text-brown flex items-center gap-1">
		<PencilLine class="w-3 h-3" /> mom read:
	</span>
	{#if checkin.quick}<span class="chip !py-0.5 !px-2.5 text-[11px] !bg-yellow/50 !shadow-[2px_2px_0_var(--color-ink)]">{checkin.quick} one</span>{/if}
	{#if checkin.sleep_hours != null}<span class="chip !py-0.5 !px-2.5 text-[11px] !shadow-[2px_2px_0_var(--color-ink)]">{checkin.sleep_hours}h sleep</span>{/if}
	{#if checkin.slept_at}<span class="chip !py-0.5 !px-2.5 text-[11px] !shadow-[2px_2px_0_var(--color-ink)]">slept {checkin.slept_at}</span>{/if}
	{#if checkin.woke_at}<span class="chip !py-0.5 !px-2.5 text-[11px] !shadow-[2px_2px_0_var(--color-ink)]">woke {checkin.woke_at}</span>{/if}
	{#each slots as s}
		{#if checkin.meals?.[s.k] === true}
			<button
				type="button"
				class="chip !py-0.5 !px-2.5 text-[11px] !bg-lime !shadow-[2px_2px_0_var(--color-ink)] cursor-pointer hover:opacity-80"
				title="tap if this is wrong"
				onclick={() => onflip(s.k)}
			>{s.label} eaten</button>
		{:else if checkin.meals?.[s.k] === false}
			<button
				type="button"
				class="chip !py-0.5 !px-2.5 text-[11px] opacity-70 !shadow-[2px_2px_0_var(--color-ink)] cursor-pointer hover:opacity-100"
				title="tap if this is wrong"
				onclick={() => onflip(s.k)}
			>{s.label} missed</button>
		{/if}
	{/each}
	{#if deadline}<span class="chip !py-0.5 !px-2.5 text-[11px] !bg-blue/50 !shadow-[2px_2px_0_var(--color-ink)]">deadline today</span>{/if}
	{#if checkin.mood != null}<span class="chip !py-0.5 !px-2.5 text-[11px] !shadow-[2px_2px_0_var(--color-ink)]">mood {checkin.mood}/5</span>{/if}
	{#if !heard}
		<span class="text-[11px] font-semibold text-mute italic">nothing yet. write her a note.</span>
	{/if}
</div>
