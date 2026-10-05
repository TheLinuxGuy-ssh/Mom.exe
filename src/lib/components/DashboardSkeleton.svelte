<script lang="ts">
	const heights = [0.62, 0.85, 0.4, 0.72, 0.55, 0.9, 0.68];
	const railHeights = [0.5, 0.75, 0.35, 0.68, 0.85, 0.45, 0.6, 0.78, 0.4, 0.7, 0.55, 0.88, 0.65, 0.48];
</script>

<div
	class="mx-auto w-[min(1180px,calc(100%-1.5rem))] py-6
		xl:grid xl:grid-cols-[240px_minmax(0,880px)_240px] xl:gap-8 xl:items-start"
	aria-hidden="true"
>
	<aside class="hidden xl:block space-y-5">
		<div class="card !rounded-2xl p-4 space-y-3">
			<div class="flex items-center justify-between gap-2">
				<div class="skeleton h-3 w-20"></div>
				<div class="skeleton h-3 w-12"></div>
			</div>
			<div class="flex items-end gap-1">
				{#each railHeights as h, i (i)}
					<div class="skeleton flex-1 rounded-t-sm" style="height: {Math.round(h * 56)}px"></div>
				{/each}
			</div>
		</div>

		<div class="card !rounded-2xl p-4 space-y-2.5">
			<div class="skeleton h-3 w-24"></div>
			{#each railHeights.slice(0, 7) as _, i (i)}
				<div class="flex items-center gap-1.5">
					<div class="skeleton h-2.5 w-8 shrink-0"></div>
					<div class="grid flex-1 grid-cols-4 gap-1">
						{#each [0, 1, 2, 3] as j (j)}
							<div class="skeleton h-5 rounded-md"></div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</aside>

	<div class="space-y-8 min-w-0">
		<header class="flex items-center justify-between gap-3">
			<div class="space-y-1.5">
				<div class="skeleton h-6 w-24"></div>
				<div class="skeleton h-3 w-20"></div>
			</div>
			<div class="flex items-center gap-2">
				{#each [0, 1, 2] as i (i)}
					<div class="skeleton h-10 w-10 rounded-full"></div>
				{/each}
			</div>
		</header>

		<div class="card !rounded-2xl p-4 sm:p-5 space-y-3.5">
			<div class="flex items-center justify-between gap-3">
				<div class="skeleton h-4 w-32"></div>
				<div class="skeleton h-9 w-40 rounded-full"></div>
			</div>
			<div class="space-y-2.5 py-2">
				<div class="skeleton h-4 w-11/12"></div>
				<div class="skeleton h-4 w-3/5"></div>
			</div>
			<div class="flex items-center gap-2">
				<div class="skeleton h-6 w-24 rounded-full"></div>
				<div class="skeleton h-6 w-28 rounded-full"></div>
				<div class="skeleton h-6 w-20 rounded-full"></div>
			</div>
			<div class="flex justify-center pt-1.5">
				<div class="skeleton h-12 w-44 rounded-full"></div>
			</div>
		</div>

		<div class="w-full max-w-2xl mx-auto space-y-4">
			<div class="skeleton skeleton-note h-24 w-full" style="transform: rotate(-1.5deg)"></div>

			<div class="card p-5 sm:p-6 space-y-4">
				<div class="flex items-center justify-between gap-2">
					<div class="skeleton h-5 w-12 rounded-md"></div>
					<div class="skeleton h-5 w-16 rounded-full"></div>
				</div>
				<div class="flex items-center gap-3">
					<div class="skeleton h-12 w-12 rounded-xl shrink-0"></div>
					<div class="min-w-0 flex-1 space-y-2">
						<div class="skeleton h-6 w-40"></div>
						<div class="skeleton h-3 w-24"></div>
					</div>
				</div>
				<div class="space-y-2 pt-1">
					<div class="skeleton h-4 w-full"></div>
					<div class="skeleton h-4 w-4/5"></div>
				</div>
				<div class="flex items-center gap-2 pt-1">
					<div class="skeleton h-9 w-24 rounded-xl"></div>
					<div class="skeleton h-9 w-20 rounded-xl"></div>
				</div>
			</div>
		</div>

		<div class="card !rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 xl:hidden">
			<div class="flex items-center gap-1.5 flex-wrap">
				<div class="skeleton h-3 w-12 mr-0.5"></div>
				{#each [0, 1, 2, 3] as i (i)}
					<div class="skeleton h-5 w-16 rounded-full"></div>
				{/each}
			</div>
			<div class="flex items-end gap-1.5">
				<div class="skeleton h-3 w-12 mr-0.5"></div>
				{#each heights as h, i (i)}
					<div class="skeleton w-3.5 rounded-t-sm" style="height: {Math.round(h * 28)}px"></div>
				{/each}
			</div>
		</div>

		<p class="text-center text-[11px] font-semibold text-mute opacity-60">
			wellness coach, not medical advice. missing days are unknown, never zero.
		</p>
	</div>

	<aside class="hidden xl:block space-y-5">
		<div class="card !rounded-2xl p-4 space-y-3">
			<div class="flex items-center justify-between gap-2">
				<div class="skeleton h-3 w-28"></div>
				<div class="skeleton h-3 w-14"></div>
			</div>
			<div class="flex gap-0.5">
				{#each [0, 1, 2, 3, 4, 5] as i (i)}
					<div class="skeleton h-3 flex-1" style="border-radius: 2px"></div>
				{/each}
			</div>
			<div class="space-y-2 pt-1">
				{#each [0, 1, 2, 3] as i (i)}
					<div class="flex items-center gap-2">
						<div class="skeleton h-3 w-3 rounded-sm shrink-0"></div>
						<div class="skeleton h-3 w-16"></div>
						<div class="skeleton h-3 w-8 ml-auto"></div>
					</div>
				{/each}
			</div>
		</div>
	</aside>
</div>