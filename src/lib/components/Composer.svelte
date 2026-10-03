<script lang="ts">
	import Send from 'lucide-svelte/icons/send';
	import NotebookPen from 'lucide-svelte/icons/notebook-pen';
	import X from 'lucide-svelte/icons/x';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import { heuristicExtract, DISTURBANCE_LABEL } from '$lib/engine/extract';
	import type { QuickBand } from '$lib/storage/types';
	import GooeyToggle from './GooeyToggle.svelte';

	let {
		busy = false,
		onsubmit
	}: {
		busy?: boolean;
		onsubmit: (payload: { text: string; quick: QuickBand | null; removedKeys: string[] }) => Promise<boolean>;
	} = $props();

	let text = $state('');
	let quick: QuickBand | null = $state(null);
	let focused = $state(false);
	let removed = $state<string[]>([]);
	let debounced = $state('');
	let waited = $state(0);

	const PLACEHOLDERS = [
		'how did you sleep?',
		'what does today look like?',
		'anything to plan around? just tell me.',
		'no log needed, but I am listening.'
	];

	$effect(() => {
		const t = text;
		const timer = setTimeout(() => {
			debounced = t;
			removed = [];
		}, 500);
		return () => clearTimeout(timer);
	});

	let phIndex = $state(0);
	$effect(() => {
		const timer = setInterval(() => (phIndex = (phIndex + 1) % PLACEHOLDERS.length), 8000);
		return () => clearInterval(timer);
	});

	const patch = $derived(heuristicExtract(debounced));

	const chips = $derived.by(() => {
		const out: { key: string; label: string }[] = [];
		if (patch.sleep_hours != null) out.push({ key: 'sleep_hours', label: `~${patch.sleep_hours}h sleep` });
		if (patch.slept_at) out.push({ key: 'slept_at', label: `slept at ${patch.slept_at}` });
		if (patch.woke_at) out.push({ key: 'woke_at', label: `woke at ${patch.woke_at}` });
		const m = patch.meals;
		if (m) {
			for (const [k, word] of [['b', 'breakfast'], ['l', 'lunch'], ['d', 'dinner']] as const) {
				if (m[k] === false) out.push({ key: `meals.${k}`, label: `skipped ${word}` });
				else if (m[k] === true) out.push({ key: `meals.${k}`, label: `had ${word}` });
			}
			if (m.s === true) out.push({ key: 'meals.s', label: 'snacked' });
		}
		if (patch.deadline_notes) out.push({ key: 'deadline_notes', label: `deadline: ${patch.deadline_notes.slice(0, 24)}` });
		for (const d of patch.disturbances) out.push({ key: `disturbance.${d}`, label: DISTURBANCE_LABEL[d] ?? d });
		return out.filter((c) => !removed.includes(c.key));
	});

	const suggestions = ['rough night', 'skipped breakfast', 'deadline tomorrow', 'roommates were loud'];

	function removeChip(key: string): void {
		removed = [...removed, key];
	}

	$effect(() => {
		if (!busy) {
			waited = 0;
			return;
		}
		const timer = setInterval(() => (waited += 1), 1000);
		return () => clearInterval(timer);
	});

	async function submit(): Promise<void> {
		if (busy) return;
		const ok = await onsubmit({ text, quick, removedKeys: removed });
		if (ok) {
			text = '';
			debounced = '';
			quick = null;
			removed = [];
		}
	}

	function onKeyDown(e: KeyboardEvent): void {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			void submit();
		}
	}
</script>

<div class="w-full max-w-2xl mx-auto transition-transform duration-200 {focused ? 'rotate-0' : '-rotate-[1.2deg]'}">
	<div class="card !rounded-2xl p-4 sm:p-5">
		<div class="flex items-center justify-between gap-3 mb-3">
			<div class="flex items-center gap-2 text-brown">
				<NotebookPen class="w-4 h-4" />
				<span class="text-xs font-black uppercase tracking-[0.18em]">Write mom a note</span>
			</div>
			<div class="w-44 sm:w-52 border-2 border-ink rounded-full overflow-hidden bg-paper">
				<GooeyToggle
					options={[
						{ value: 'rough', label: 'rough' },
						{ value: 'okay', label: 'okay' },
						{ value: 'great', label: 'great' }
					]}
					value={quick}
					onchange={(v) => (quick = v as QuickBand | null)}
				/>
			</div>
		</div>

		<textarea
			class="field !border-0 !shadow-none !bg-transparent !font-hand !text-[22px] !leading-[1.6] min-h-16 resize-y"
			style="background-image: repeating-linear-gradient(transparent, transparent 34px, rgba(33,23,19,0.08) 34px, rgba(33,23,19,0.08) 35px)"
			rows="2"
			maxlength="500"
			placeholder={PLACEHOLDERS[phIndex]}
			bind:value={text}
			onfocus={() => (focused = true)}
			onblur={() => (focused = false)}
			onkeydown={onKeyDown}
		></textarea>

		{#if chips.length > 0}
			<div class="flex flex-wrap gap-2 mt-2">
				{#each chips as chip (chip.key)}
					<button
						type="button"
						class="chip !bg-blue/60 hover:!bg-blue cursor-pointer"
						onclick={() => removeChip(chip.key)}
						title="remove"
					>
						{chip.label}
						<X class="w-3 h-3" />
					</button>
				{/each}
			</div>
		{/if}

		<div class="flex flex-wrap gap-2 mt-3">
			{#each suggestions as s}
				<button
					type="button"
					class="chip !bg-paper hover:!bg-yellow cursor-pointer font-semibold"
					onclick={() => (text = text ? text.trimEnd() + ', ' + s : s)}
				>
					{s}
				</button>
			{/each}
		</div>
	</div>

	<div class="flex justify-center mt-3">
		<button
			type="button"
			class="btn !bg-orange !text-paper !rounded-full px-7 py-3 flex items-center gap-2 text-sm font-black uppercase tracking-wide"
			disabled={busy}
			onclick={() => void submit()}
		>
			{#if busy}
				<LoaderCircle class="w-4 h-4 animate-spin" />
				reading it{waited > 2 ? `, ${waited}s` : ''}...
			{:else}
				{#if text.trim().length === 0}
					no notes? just plan my day
				{:else}
					Ask Mom
				{/if}
				<Send class="w-4 h-4" />
			{/if}
		</button>
		{#if busy}
			<p class="text-center text-[11px] font-semibold text-mute mt-2 max-w-xs mx-auto">
				hosted open-weight models think for 10-25s before answering. if it takes too long,
				i plan in code instead and you still get a real plan.
			</p>
		{/if}
	</div>
</div>
