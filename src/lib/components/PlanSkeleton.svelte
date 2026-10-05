<script lang="ts">
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';

	let { counter = null, note = '' }: { counter?: number | null; note?: string } = $props();
</script>

<div class="w-full max-w-2xl mx-auto space-y-4">
	{#if counter !== null}
		<div class="flex items-center gap-3">
			<LoaderCircle class="w-5 h-5 animate-spin text-brown shrink-0" />
			<p class="font-black uppercase tracking-wide text-brown text-sm">mom is reading your note... {counter}s</p>
		</div>
	{/if}

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

	{#if note}
		<p class="text-[11px] font-bold text-mute text-center leading-snug">{note}</p>
	{/if}
</div>