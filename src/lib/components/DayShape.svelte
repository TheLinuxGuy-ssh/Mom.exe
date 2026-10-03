<script lang="ts">
	import { CATEGORY_LABEL, dayShape, formatDuration, type Category } from '$lib/engine/shape';
	import type { PlanBlock } from '$lib/storage/types';

	let { blocks = [] }: { blocks?: PlanBlock[] } = $props();

	const shape = $derived(dayShape(blocks));

	const TONE: Record<Category, string> = {
		work: 'bg-blue',
		body: 'bg-lime',
		people: 'bg-pink',
		rest: 'bg-yellow'
	};
</script>

{#if !shape.empty}
	<section class="card !rounded-2xl p-4 space-y-3">
		<div class="flex items-baseline justify-between gap-2">
			<h2 class="text-[11px] font-black uppercase tracking-[0.22em] text-brown">how today stacks up</h2>
			<span class="text-[11px] font-bold text-mute">{formatDuration(shape.totalMinutes)} planned</span>
		</div>

		<div class="flex h-3 overflow-hidden rounded-full border-2 border-ink" role="img" aria-label="planned time by category">
			{#each shape.slices as s (s.category)}
				<div
					class="{TONE[s.category]} border-r-2 border-ink last:border-r-0"
					style="width: {s.share * 100}%"
					title="{CATEGORY_LABEL[s.category]}: {formatDuration(s.minutes)}"
				></div>
			{/each}
		</div>

		<ul class="space-y-1">
			{#each shape.slices as s (s.category)}
				<li class="flex items-center gap-2 text-[11px] font-bold">
					<span class="w-3 h-3 rounded-sm border-2 border-ink {TONE[s.category]} shrink-0"></span>
					<span class="text-ink/70">{CATEGORY_LABEL[s.category]}</span>
					<span class="ml-auto text-mute">{formatDuration(s.minutes)}</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}
