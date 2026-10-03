<script lang="ts">
	import type { Snippet } from 'svelte';

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

	$effect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape' && !busy) oncancel();
		};
		window.addEventListener('keydown', onKey);
		panel?.focus();
		return () => window.removeEventListener('keydown', onKey);
	});
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 grid place-items-center p-4"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget && !busy) oncancel();
		}}
	>
		<div class="absolute inset-0 bg-ink/55" role="presentation"></div>

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
	</div>
{/if}