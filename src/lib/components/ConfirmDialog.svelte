<script lang="ts">
	import type { Snippet } from 'svelte';
	import Modal from './Modal.svelte';

	let {
		open = false,
		title,
		children,
		confirmLabel = 'confirm',
		cancelLabel = 'cancel',
		tone = 'default',
		busy = false,
		onconfirm,
		oncancel
	}: {
		open?: boolean;
		title: string;
		children: Snippet;
		confirmLabel?: string;
		cancelLabel?: string;
		tone?: 'default' | 'danger';
		busy?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();

	let panel = $state<HTMLElement | null>(null);

	// busy means an action is in flight, and cancelling halfway through would leave the app in a
	// state the student did not ask for
	$effect(() => {
		if (open && !busy) panel?.focus();
	});
</script>

<!--
	The dimmer, the backdrop, Escape, click-outside and the scroll lock all belong to Modal, which is
	the single place they are defined. This component is only the panel and its two buttons.
-->
<Modal
	{open}
	onclose={oncancel}
	dismissible={!busy}
>
	<div
		bind:this={panel}
		class="card relative w-full max-w-md space-y-4 p-5 outline-none"
		role="alertdialog"
		aria-modal="true"
		aria-labelledby="confirm-title"
		tabindex="-1"
	>
		<h2 id="confirm-title" class="font-display text-2xl uppercase leading-none tracking-tight">{title}</h2>

		<div class="text-sm font-semibold leading-relaxed text-mute">
			{@render children()}
		</div>

		<div class="flex flex-wrap justify-end gap-3 pt-1">
			<button type="button" class="btn !rounded-full px-5 py-2.5 text-xs" disabled={busy} onclick={oncancel}>
				{cancelLabel}
			</button>
			<button
				type="button"
				class="btn !rounded-full px-5 py-2.5 text-xs font-black uppercase tracking-wide
					{tone === 'danger' ? '!bg-pink !text-paper' : '!bg-lime'}"
				disabled={busy}
				onclick={onconfirm}
			>
				{busy ? 'working...' : confirmLabel}
			</button>
		</div>
	</div>
</Modal>