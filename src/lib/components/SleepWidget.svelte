<script lang="ts">
	import type { Checkin } from '$lib/storage/types';
	import { daysBetween } from '$lib/engine/time';
	import { formatDuration } from '$lib/engine/shape';

	let { checkins = [], today, target = 7.5 }: { checkins?: Checkin[]; today: string; target?: number } = $props();

	const days = $derived(
		Array.from({ length: 14 }, (_, i) => {
			const d = daysBack(i);
			const c = checkins.find((x) => x.local_date === d);
			return { date: d, hours: c?.sleep_hours ?? null, isToday: d === today };
		})
	);

	const known = $derived(days.map((d) => d.hours).filter((h): h is number => h != null));
	const avg = $derived(known.length ? known.reduce((s, h) => s + h, 0) / known.length : null);

	function daysBack(i: number): string {
		const [y, m, d] = today.split('-').map(Number);
		return new Date(Date.UTC(y, m - 1, d - (13 - i))).toISOString().slice(0, 10);
	}
</script>

<section class="card !rounded-2xl p-4 space-y-3">
	<div class="flex items-baseline justify-between gap-2">
		<h2 class="text-[11px] font-black uppercase tracking-[0.22em] text-brown">sleep, 2 weeks</h2>
		{#if avg != null}
			<span class="text-[11px] font-bold text-mute">{avg.toFixed(1)}h avg</span>
		{/if}
	</div>

	<div class="flex items-end gap-1" role="img" aria-label="sleep hours for the last 14 days">
		{#each days as d (d.date)}
			{#if d.hours != null}
				<div
					class="flex-1 rounded-t-sm border-2 border-ink {d.hours < 5 ? 'bg-pink' : d.isToday ? 'bg-orange' : 'bg-blue'}"
					style="height: {Math.max(6, Math.min(52, (d.hours / 10) * 52))}px"
					title="{d.date}: {d.hours}h"
				></div>
			{:else}
				<div
					class="flex-1 h-2 rounded-t-sm border-2 border-dashed border-ink/35"
					title="{d.date}: unknown"
				></div>
			{/if}
		{/each}
	</div>

	<div class="flex items-center justify-between text-[10px] font-bold text-mute">
		<span>14 days ago</span>
		<span>target {formatDuration(target * 60)}</span>
		<span>today</span>
	</div>

	{#if avg == null}
		<p class="text-[11px] font-semibold text-mute">nothing logged yet. unknown is not zero.</p>
	{:else if avg < target - 1}
		<p class="text-[11px] font-semibold text-brown">running under target, which is worth a look tonight.</p>
	{/if}
</section>
