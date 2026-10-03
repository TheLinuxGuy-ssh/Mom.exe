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
		class="pointer-events-none fixed bottom-5 right-5 z-40 hidden w-[15rem] lg:block"
		in:fly={{ y: 14, duration: 320 }}
		out:fly={{ y: 14, duration: 180 }}
	>
		<div class="pointer-events-auto relative">
			<button
				type="button"
				class="absolute -top-2 -right-2 z-10 grid h-5 w-5 place-items-center rounded-full border border-ink/25 bg-paper/90 text-ink/50 hover:text-ink hover:border-ink/50 cursor-pointer transition-colors"
				title="not now"
				aria-label="dismiss this reminder"
				onclick={() => (dismissed = true)}
			>
				<X class="h-2.5 w-2.5" />
			</button>

			<!--
				.whisper-note, not .sticky-note: this one has to sit under the dashboard's own
				sticky note without competing, so it is deliberately low contrast, untaped and
				almost transparent. If it reads as loud as the real one, it has stopped working.
			-->
			<div class="whisper-note !text-[16px] !leading-[1.45] -rotate-[1deg]">
				<p class="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-brown/45">
					psst
				</p>
				{line}
			</div>
		</div>
	</div>
{/if}
