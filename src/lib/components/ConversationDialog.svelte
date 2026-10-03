<script lang="ts">
	import { fade } from 'svelte/transition';
	import { EASE_OUT } from '$lib/engine/easing';
	import Send from 'lucide-svelte/icons/send';
	import X from 'lucide-svelte/icons/x';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import type { Message } from '$lib/storage/types';
	import { chatReady } from '$lib/engine/prompt-rules';

	let {
		open = false,
		messages = [],
		busy = false,
		waited = 0,
		onsubmit,
		onclose
	}: {
		open?: boolean;
		messages?: Message[];
		busy?: boolean;
		waited?: number;
		onsubmit: (text: string) => Promise<boolean>;
		onclose: () => void;
	} = $props();

	let draft = $state('');
	let scroller = $state<HTMLElement | null>(null);


	/**
	 * The composer card and this dialog are meant to read as one object changing shape, so the
	 * entrance is a single combined lift-and-settle rather than two stacked transitions.
	 */
	function lift(node: HTMLElement, { duration = 240 }: { duration?: number } = {}) {
		return {
			duration,
			easing: EASE_OUT,
			css: (t: number) =>
				`opacity:${t};` +
				`transform:translateY(${(1 - t) * 28}px) scale(${0.965 + 0.035 * t});` +
				'will-change:transform,opacity;'
		};
	}

	// storage hands back newest-first; a conversation reads top-to-bottom, so flip it and keep
	// the newest message at the bottom where the eye already is
	const shown = $derived(
		messages
			.filter((m) => m.kind === 'chat' || m.kind === 'note' || m.kind === 'replan')
			.slice()
			.reverse()
	);

	$effect(() => {
		if (open) scrollToEnd();
	});

	$effect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') onclose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	function scrollToEnd(): void {
		// wait for the new message to lay out before chasing it
		requestAnimationFrame(() => {
			if (scroller) scroller.scrollTop = scroller.scrollHeight;
		});
	}

	async function send(): Promise<void> {
		const text = draft.trim();
		// one letter is enough in a conversation, but blank and whitespace never are
		if (!chatReady(text) || busy) return;
		draft = '';
		await onsubmit(text);
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void send();
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
		transition:fade={{ duration: 160 }}
		onclick={(e) => {
			// clicking the empty space around the conversation is the way out
			if (e.target === e.currentTarget) onclose();
		}}
		role="presentation"
	>
		<div class="absolute inset-0 bg-ink/55" role="presentation"></div>

		<div
			class="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden border-2 border-ink bg-paper shadow-[8px_8px_0_var(--color-ink)] sm:rounded-2xl"
			transition:lift={{ duration: 240 }}
			role="dialog"
			aria-modal="true"
			aria-label="talking to mom"
		>
			<header class="flex items-center justify-between gap-3 border-b-2 border-ink px-4 py-3">
				<div class="flex items-center gap-2 text-brown">
					<span class="text-xs font-black uppercase tracking-[0.18em]">talking to mom</span>
				</div>
				<button
					type="button"
					class="btn !rounded-full p-2"
					title="close"
					aria-label="close conversation"
					onclick={onclose}
				>
					<X class="w-4 h-4" />
				</button>
			</header>

			<div bind:this={scroller} class="flex-1 space-y-3 overflow-y-auto px-4 py-4">
				{#if shown.length === 0}
					<p class="py-6 text-center text-sm font-semibold text-mute">
						tell her how the day is actually going.
					</p>
				{/if}

				{#each shown as m (m.id)}
					<div class="flex {m.role === 'mom' ? 'justify-start' : 'justify-end'}">
						<div
							class="max-w-[85%] px-3.5 py-2 text-[15px] leading-snug {m.role === 'mom'
								? 'sticky-note !text-[16px]'
								: 'border-2 border-ink bg-blue/40 font-semibold rounded-2xl rounded-br-sm'}"
						>
							{m.content}
						</div>
					</div>
				{/each}

				{#if busy}
					<div class="flex justify-start">
						<div class="flex items-center gap-2 border-2 border-ink bg-paper px-3.5 py-2 rounded-2xl rounded-bl-sm">
							<LoaderCircle class="w-4 h-4 animate-spin text-brown" />
							<span class="text-sm font-semibold text-mute">reading it{waited > 2 ? `, ${waited}s` : ''}...</span>
						</div>
					</div>
				{/if}
			</div>

			<footer class="border-t-2 border-ink p-3">
				<div class="flex items-end gap-2">
					<textarea
						class="field !min-h-[2.75rem] resize-none !font-hand !text-[19px] flex-1"
						rows="1"
						maxlength="500"
						placeholder="say it how you'd say it."
						bind:value={draft}
						onkeydown={onKeyDown}
					></textarea>
					<button
						type="button"
						class="btn !bg-orange !text-paper !rounded-full px-5 py-3 flex items-center gap-2 shrink-0"
						disabled={busy || draft.trim().length === 0}
						aria-label="send to mom"
						onclick={() => void send()}
					>
						{#if busy}<LoaderCircle class="w-4 h-4 animate-spin" />{:else}<Send class="w-4 h-4" />{/if}
					</button>
				</div>
			</footer>
		</div>
	</div>
{/if}
