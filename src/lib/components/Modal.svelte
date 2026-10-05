<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import { lockScroll } from '$lib/scroll-lock';
	import { isBackdropClick, shouldDismiss } from './overlay';

	/**
	 * Every dialog in the app gets its dimmer from here.
	 *
	 * That is not tidiness, it is a bug fix. Only one dialog in this project was mounted at the top
	 * level of its page, and only that one dimmed the page correctly. The others were nested two
	 * levels deep inside a page container and were cut off partway down the screen. Nothing in the
	 * markup explains it — `position: fixed` inside a plain `<div>` is supposed to behave, there is
	 * no transform, filter or `contain` on any ancestor, and the generated CSS is correct — so rather
	 * than guess at a mechanism, this makes the difference impossible to express: one overlay, one
	 * backdrop, mounted at depth 0 everywhere.
	 *
	 * `align` is the only thing that varies between dialogs, and it is layout of the *panel* around a
	 * backdrop that never changes.
	 */
	let {
		open = false,
		onclose,
		dismissible = true,
		align = 'center',
		children
	}: {
		open?: boolean;
		onclose: () => void;
		/** set false while something must finish first, and Escape and the backdrop both stop working */
		dismissible?: boolean;
		align?: 'center' | 'sheet';
		children: Snippet;
	} = $props();

	// the exact class list the working logout dialog used
	const LAYOUT = {
		center: 'grid place-items-center p-4',
		sheet: 'flex items-end justify-center p-0 sm:items-center sm:p-6'
	} as const;

	/**
	 * The dimmer element itself. The click handler below has to compare against *this* node rather
	 * than the overlay root: the dim is a child div covering the padded box, so a click on the empty
	 * space around the panel reports the dim as its target while the root is the current target. They
	 * were never equal, so clicking the dim did nothing.
	 */
	let backdrop = $state<HTMLElement | null>(null);

	function dismiss(): void {
		if (shouldDismiss({ open, dismissible })) onclose();
	}

	$effect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') dismiss();
		};
		window.addEventListener('keydown', onKey);
		// the page behind must not scroll out from under an open dialog. teardown is the release,
		// so unmounting cannot leave the page locked.
		const unlock = lockScroll();
		return () => {
			window.removeEventListener('keydown', onKey);
			unlock();
		};
	});
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 {LAYOUT[align]}"
		role="presentation"
		transition:fade={{ duration: 120 }}
		onclick={(e) => {
			// The panel is a sibling of the backdrop rather than a descendant, so a click on it, or on
			// any control inside it, is never equal to the backdrop and the dialog stays put.
			if (isBackdropClick(e.target, backdrop)) dismiss();
		}}
	>
		<div bind:this={backdrop} class="absolute inset-0 bg-ink/55" role="presentation"></div>

		{@render children()}
	</div>
{/if}