<script lang="ts">
	import '../app.css';
	import Toast from '$lib/components/Toast.svelte';

	let { children } = $props();
</script>

<svg width="0" height="0" style="position: absolute" aria-hidden="true">
	<defs>
		<filter id="filter-rough">
			<feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="4" />
			<feDisplacementMap in="SourceGraphic" scale="4" />
		</filter>
		<filter id="gooey">
			<feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
			<feColorMatrix
				in="blur"
				type="matrix"
				values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9"
				result="goo"
			/>
			<feComposite in="SourceGraphic" in2="goo" operator="atop" result="gooey" />
		</filter>
	</defs>
</svg>

{@render children()}

<div class="noise" aria-hidden="true"></div>
<Toast />
