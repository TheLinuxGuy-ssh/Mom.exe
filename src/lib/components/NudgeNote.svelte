<script lang="ts">
	import { fly } from 'svelte/transition';
	import X from 'lucide-svelte/icons/x';
	import { pickNudge } from '$lib/engine/nudge';

	let { today }: { today: string } = $props();

	// One nudge a day, stable for that whole day so it does not flicker between renders.
	const line = $derived(pickNudge(hash(today)));
	let dismissed = $state(false);

	function hash(s: string): number {
		let h = 0;
		for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
		return h;
	}
</script>

{#if !dismissed}
	<div
		class="pointer-events-none fixed bottom-4 right-4 z-40 hidden w-[16rem] lg:block"
		in:fly={{ y: 18, duration: 320 }}
		out:fly={{ y: 18, duration: 180 }}
	>
		<div class="pointer-events-auto relative">
			<button
				type="button"
				class="absolute -top-2 -right-2 z-10 grid h-6 w-6 place-items-center rounded-full border-2 border-ink bg-paper shadow-[2px_2px_0_var(--color-ink)] hover:bg-yellow cursor-pointer"
				title="not now"
				aria-label="dismiss this reminder"
				onclick={() => (dismissed = true)}
			>
				<X class="h-3 w-3" />
			</button>

			<div class="sticky-note !text-[17px] !leading-[1.4] rotate-[1.5deg]">
				<p class="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-brown/70">
					psst. from mom for the real MOM
				</p>
				{line}
			</div>
		</div>
	</div>
{/if}
