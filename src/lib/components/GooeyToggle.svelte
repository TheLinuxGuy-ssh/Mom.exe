<script lang="ts">
	let {
		options,
		value,
		onchange,
		class: cls = '',
		indicator = 'bg-orange'
	}: {
		options: { value: string; label: string }[];
		value: string | null;
		onchange: (v: string) => void;
		class?: string;
		indicator?: string;
	} = $props();

	const index = $derived(Math.max(0, options.findIndex((o) => o.value === value)));
	const width = $derived(100 / options.length);
</script>

<div class="relative {cls}">
	<!--
		The pill is `h-full` + `rounded-full`, and the caller's `rounded-full overflow-hidden`
		border is exactly one border-width thicker, so both radii resolve to height/2. The pill's
		semicircular ends therefore sit precisely on the container's inner curve: flush against
		the left/right border at rest, still fully rounded.

		`filter: url(#gooey)` was what broke it. feGaussianBlur pulls alpha inward before
		feComposite clips back to the source, eroding a few px off those straight/round edges and
		leaving a visible gap. It bought nothing here anyway: gooey only reads when adjacent blobs
		merge, and there is only ever one pill.
	-->
	<div class="absolute inset-0 overflow-hidden rounded-full pointer-events-none">
		<div
			class="h-full rounded-full {indicator} transition-transform duration-200 ease-out"
			style="width: {width}%; transform: translateX({index * 100}%)"
		></div>
	</div>
	<div class="relative flex">
		{#each options as opt}
			<button
				type="button"
				class="flex-1 px-3 py-2 text-xs font-extrabold z-10 cursor-pointer transition-colors duration-200
					{value === opt.value ? 'text-paper' : 'text-ink/75 hover:text-ink'}"
				onclick={() => onchange(opt.value)}
				aria-pressed={value === opt.value}
			>
				{opt.label}
			</button>
		{/each}
	</div>
</div>
