<script lang="ts">
	import Sunrise from 'lucide-svelte/icons/sunrise';
	import Utensils from 'lucide-svelte/icons/utensils';
	import Cookie from 'lucide-svelte/icons/cookie';
	import Sunset from 'lucide-svelte/icons/sunset';
	import type { Checkin } from '$lib/storage/types';

	let { checkins = [], today }: { checkins?: Checkin[]; today: string } = $props();

	// all four slots the check-in tracks, in the order a day actually runs
	const SLOTS: { key: 'b' | 'l' | 's' | 'd'; label: string; Icon: typeof Sunrise }[] = [
		{ key: 'b', label: 'bfast', Icon: Sunrise },
		{ key: 'l', label: 'lunch', Icon: Utensils },
		{ key: 's', label: 'snack', Icon: Cookie },
		{ key: 'd', label: 'dinner', Icon: Sunset }
	];

	const days = $derived(
		Array.from({ length: 7 }, (_, i) => {
			const d = daysBack(i);
			const c = checkins.find((x) => x.local_date === d);
			return { date: d, meals: c?.meals ?? null, isToday: d === today };
		})
	);

	function daysBack(i: number): string {
		const [y, m, d] = today.split('-').map(Number);
		return new Date(Date.UTC(y, m - 1, d - (6 - i))).toISOString().slice(0, 10);
	}

	function dayLabel(date: string): string {
		return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
			weekday: 'narrow',
			timeZone: 'UTC'
		});
	}
</script>

<section class="card !rounded-2xl p-4 space-y-3">
	<h2 class="text-[11px] font-black uppercase tracking-[0.22em] text-brown">meals, last 7 days</h2>

	<!-- column key: what each column is, so the grid needs no explaining -->
	<div class="flex items-end gap-1.5 pl-9">
		{#each SLOTS as s (s.key)}
			<div class="flex flex-1 flex-col items-center gap-0.5" title={s.label}>
				<s.Icon class="h-3.5 w-3.5 text-brown" strokeWidth={2.5} />
				<span class="text-[9px] font-black uppercase tracking-tight text-mute">{s.label}</span>
			</div>
		{/each}
	</div>

	<div class="space-y-1.5">
		{#each days as d (d.date)}
			<div class="flex items-center gap-2">
				<span class="w-8 shrink-0 text-[10px] font-black uppercase text-mute">{dayLabel(d.date)}</span>
				<div class="flex flex-1 gap-1.5">
					{#each SLOTS as s (s.key)}
						{#if d.meals?.[s.key] === true}
							<div
								class="grid h-5 flex-1 place-items-center rounded-md border-2 border-ink bg-lime"
								title="{d.date} {s.label}: eaten"
							></div>
						{:else if d.meals?.[s.key] === false}
							<div
								class="grid h-5 flex-1 place-items-center rounded-md border-2 border-ink bg-paper"
								title="{d.date} {s.label}: skipped"
							></div>
						{:else}
							<div
								class="h-5 flex-1 rounded-md border-2 border-dashed border-ink/35"
								title="{d.date} {s.label}: unknown"
							></div>
						{/if}
					{/each}
				</div>
				{#if d.isToday}<span class="ml-auto shrink-0 text-[10px] font-black uppercase text-brown">today</span>{/if}
			</div>
		{/each}
	</div>

	<div class="flex flex-wrap gap-2 pt-1">
		<span class="chip !bg-lime !py-0.5 !px-2 !text-[10px] !shadow-[2px_2px_0_var(--color-ink)]">eaten</span>
		<span class="chip !bg-paper !py-0.5 !px-2 !text-[10px] !shadow-[2px_2px_0_var(--color-ink)]">skipped</span>
		<span class="chip !bg-transparent border-dashed !py-0.5 !px-2 !text-[10px] opacity-70">unknown</span>
	</div>
</section>
