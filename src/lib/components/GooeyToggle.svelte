<script lang="ts">
	let {
		options,
		value,
		onchange,
		class: cls = ''
	}: {
		options: { value: string; label: string; icon?: unknown }[];
		value: string | null;
		onchange: (v: string) => void;
		class?: string;
	} = $props();

	const index = $derived(Math.max(0, options.findIndex((o) => o.value === value)));
</script>

<div class="gooey-track {options.length === 2 ? 'two' : ''} {cls}">
	<div class="gooey-indicator" style="transform: translateX({index * 100}%)"></div>
	<div class="relative flex">
		{#each options as opt}
			<button
				type="button"
				class="flex-1 px-4 py-2 font-extrabold text-sm z-10 transition-colors cursor-pointer
					{value === opt.value ? 'text-paper' : 'text-ink/60'}"
				onclick={() => onchange(opt.value)}
			>
				{opt.label}
			</button>
		{/each}
	</div>
</div>
