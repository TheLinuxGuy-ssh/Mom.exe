<script lang="ts">
	let { items = [] as string[] } = $props();
	const doubled = $derived([...items, ...items]);
</script>

<div class="marquee" aria-hidden="true">
	<div>
		{#each doubled as item}
			<span>{item}</span>
		{/each}
	</div>
</div>
