<script lang="ts">
	let {
		text,
		rotate = -1.5,
		class: cls = ''
	}: { text: string; rotate?: number; class?: string } = $props();

	function escapeHtml(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	function highlight(s: string): string {
		return escapeHtml(s)
			.replace(/(\d{1,2}:\d{2})/g, '<mark class="hl hl-blue">$1</mark>')
			.replace(/(\d+(?:\.\d+)?\s*(?:h|hrs?|hours?)\b)/gi, '<mark class="hl hl-lime">$1</mark>');
	}

	const html = $derived(highlight(text));
</script>

<div class="sticky-note {cls}" style="transform: rotate({rotate}deg)">
	{@html html}
</div>
