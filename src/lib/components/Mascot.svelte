<script lang="ts">
	let { size = 240, labels = true } = $props();
</script>

<div class="relative grid place-items-center select-none" style="width: {size}px; height: {size}px" aria-hidden="true">
	<div class="absolute border-2 border-dashed border-ink/45 rounded-full animate-[spin_20s_linear_infinite]" style="width:{size * 0.95}px; height:{size * 0.95}px"></div>
	<div class="absolute border-2 border-dashed border-ink/35 rounded-full animate-[spin_16s_linear_infinite_reverse]" style="width:{size * 0.68}px; height:{size * 0.68}px"></div>

	<div class="wobble relative grid place-items-center" style="width:{size * 0.42}px; height:{size * 0.42}px">
		<span class="steam" style="left:{size * 0.1}px; top:{size * 0.06}px"></span>
		<span class="steam" style="left:{size * 0.18}px; top:{size * 0.04}px; animation-delay:.3s"></span>
		<span class="steam" style="left:{size * 0.26}px; top:{size * 0.06}px; animation-delay:.6s"></span>
		<svg viewBox="0 0 64 64" class="w-full h-full drop-shadow-[6px_6px_0_rgba(33,23,19,0.25)]">
			<path d="M8 16 L56 16 L52 52 a6 6 0 0 1 -6 6 L18 58 a6 6 0 0 1 -6 -6 Z" fill="#ff7a1a" stroke="#211713" stroke-width="4" stroke-linejoin="round" />
			<rect x="9" y="16" width="46" height="9" fill="#fffaf0" stroke="#211713" stroke-width="4" />
			<path d="M56 24 h5 a7 7 0 0 1 0 14 h-6" fill="none" stroke="#211713" stroke-width="4" />
			<path d="M14 66 c0 -6 5 -6 5 -12 M30 68 c0 -6 5 -6 5 -12 M46 66 c0 -6 5 -6 5 -12" fill="none" stroke="#211713" stroke-width="4" stroke-linecap="round" opacity="0.35" />
		</svg>
	</div>

	{#if labels}
		<p class="chip absolute -left-2 top-6 animate-[floaty_3.5s_ease-in-out_infinite] !bg-lime">no streaks</p>
		<p class="chip absolute -right-2 top-1/3 animate-[floaty_3.5s_ease-in-out_infinite] !bg-blue [animation-delay:-1s]">open weights</p>
		<p class="chip absolute left-4 bottom-4 animate-[floaty_3.5s_ease-in-out_infinite] !bg-pink !text-paper [animation-delay:-2s]">plans anyway</p>
	{/if}
</div>
