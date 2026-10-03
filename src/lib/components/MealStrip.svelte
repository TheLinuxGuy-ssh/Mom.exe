<script lang="ts">
	let { meals = null }: { meals: { b: boolean | null; l: boolean | null; s: boolean | null; d: boolean | null } | null } = $props();
	const slots = [
		{ key: 'b', label: 'bfast' },
		{ key: 'l', label: 'lunch' },
		{ key: 's', label: 'snack' },
		{ key: 'd', label: 'dinner' }
	] as const;
</script>

<div class="flex items-center gap-1.5 flex-wrap" aria-label="meals today">
	<span class="text-xs font-black uppercase tracking-widest text-brown mr-0.5">meals</span>
	{#each slots as s}
		{#if meals?.[s.key] === true}
			<span class="chip !bg-lime !py-0.5 !px-2.5 text-[11px]">{s.label} ok</span>
		{:else if meals?.[s.key] === false}
			<span class="chip !bg-paper !py-0.5 !px-2.5 text-[11px] opacity-60">{s.label} missed</span>
		{:else}
			<span class="chip !py-0.5 !px-2.5 text-[11px] !bg-transparent border-dashed opacity-70">{s.label} ?</span>
		{/if}
	{/each}
</div>
