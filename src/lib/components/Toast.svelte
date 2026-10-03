<script lang="ts">
	import { toastStore } from '$lib/stores/toast';
	import CircleCheck from 'lucide-svelte/icons/circle-check';
	import CircleAlert from 'lucide-svelte/icons/circle-alert';
</script>

{#if $toastStore.show}
	<div
		class="fixed left-1/2 bottom-6 z-60 -translate-x-1/2 px-5 py-3 border-[3px] border-ink rounded-full shadow-hard-lg font-extrabold text-sm flex items-center gap-2
		{$toastStore.kind === 'ok' ? 'bg-lime' : 'bg-yellow'}"
		role="status"
	>
		{#if $toastStore.kind === 'ok'}
			<CircleCheck class="w-4 h-4" />
		{:else}
			<CircleAlert class="w-4 h-4" />
		{/if}
		{$toastStore.msg}
	</div>
{/if}
