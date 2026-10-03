<script lang="ts">
	import type { Checkin } from '$lib/storage/types';
	import { daysBetween } from '$lib/engine/time';

	let { checkins = [], today }: { checkins: Checkin[]; today: string } = $props();

	const days = $derived(
		Array.from({ length: 7 }, (_, i) => {
			const d = daysBetweenWeek(i);
			const c = checkins.find((x) => x.local_date === d);
			return { date: d, hours: c?.sleep_hours ?? null, isToday: d === today };
		})
	);

	function daysBetweenWeek(i: number): string {
		const [y, m, d] = today.split('-').map(Number);
		const dt = new Date(Date.UTC(y, m - 1, d - (6 - i)));
		return dt.toISOString().slice(0, 10);
	}
</script>

<div class="flex items-end gap-1.5" aria-label="sleep last 7 days">
	<span class="text-xs font-black uppercase tracking-widest text-brown mr-0.5">sleep</span>
	{#each days as day}
		<div class="flex flex-col items-center gap-0.5" title="{day.date}: {day.hours != null ? day.hours + 'h' : 'unknown'}">
			{#if day.hours != null}
				<div
					class="w-3.5 rounded-t-sm border-2 border-ink {day.isToday ? 'bg-orange' : 'bg-blue'}"
					style="height: {Math.max(4, Math.min(28, (day.hours / 10) * 28))}px"
				></div>
			{:else}
				<div class="w-3.5 h-2 border-2 border-dashed border-ink/40 rounded-t-sm"></div>
			{/if}
		</div>
	{/each}
</div>
