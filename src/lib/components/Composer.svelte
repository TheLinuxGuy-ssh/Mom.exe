<script lang="ts">
	import Send from 'lucide-svelte/icons/send';
	import NotebookPen from 'lucide-svelte/icons/notebook-pen';
	import X from 'lucide-svelte/icons/x';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import { heuristicExtract, DISTURBANCE_LABEL } from '$lib/engine/extract';
	import type { QuickBand } from '$lib/storage/types';
	import GooeyToggle from './GooeyToggle.svelte';
	import {
		emptyNoteMessage,
		hasSomethingToSend,
		idleLabel,
		noteReady,
		noteShortfall,
		readyLabel
	} from '$lib/engine/prompt-rules';
	import { toast } from '$lib/stores/toast';

	let {
		busy = false,
		onsubmit
	}: {
		busy?: boolean;
		onsubmit: (payload: { text: string; quick: QuickBand | null; removedKeys: string[] }) => Promise<boolean>;
	} = $props();

	let textarea = $state<HTMLTextAreaElement | null>(null);
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

	/**
	 * The chips describe what she heard, so they follow the note a beat behind the typing. What they
	 * must not do is forget a removal: the reset used to sit on the same 500ms timer as the parse,
	 * so any keystroke after tapping an x brought the chip straight back half a second later, and
	 * if you typed nothing at all the x appeared to do nothing. Removals now hold until the note is
	 * sent or the words actually change enough to be a different note.
	 */
	let removedFor = $state('');
	$effect(() => {
		const t = text;
		if (t !== removedFor && removed.length > 0) removed = [];
		removedFor = t;
		const timer = setTimeout(() => {
			debounced = t;
		}, 500);
		return () => clearTimeout(timer);
	});

	let phIndex = $state(0);
	$effect(() => {
		const timer = setInterval(() => (phIndex = (phIndex + 1) % PLACEHOLDERS.length), 8000);
		return () => clearInterval(timer);
	});

	// she greets you differently depending on the hour
	let hour = $state(new Date().getHours());
	$effect(() => {
		const timer = setInterval(() => (hour = new Date().getHours()), 60000);
		return () => clearInterval(timer);
	});

	const tooShort = $derived(text.trim().length > 0 && !noteReady(text));
	const shortfall = $derived(noteShortfall(text));

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
		// Enter must not bypass this either, so the rule lives in the handler and not on the button.
		//
		// An empty box used to be a valid submission: it went through the whole pipeline, cost a
		// model round trip, and answered a question nobody had asked. The button is deliberately
		// still pressable rather than dead, because a dead button explains nothing — pressing it
		// tells you what it wanted.
		if (!hasSomethingToSend(text, quick)) {
			toast(emptyNoteMessage(), 'warn');
			textarea?.focus();
			return;
		}
		// too short to be worth her time is not an error, it is just not ready yet
		if (text.trim().length > 0 && !noteReady(text)) return;
		const ok = await onsubmit({ text, quick, removedKeys: removed });
		if (ok) {
			text = '';
			debounced = '';
			quick = null;
			removed = [];
		}
	}

	function onKeyDown(e: KeyboardEvent): void {
		// a bare Enter on an empty box is the same mistake as pressing the button, so it gets the
		// same answer rather than silence
		if (e.key === 'Enter' && !e.shiftKey && hasSomethingToSend(text, quick)) {
			e.preventDefault();
			void submit();
			return;
		}
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
			bind:this={textarea}
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
			disabled={busy || tooShort}
			onclick={() => void submit()}
		>
			{#if busy}
				<LoaderCircle class="w-4 h-4 animate-spin" />
				reading it{waited > 2 ? `, ${waited}s` : ''}...
			{:else}
				{noteReady(text) ? readyLabel(hour) : idleLabel(hour)}
				<Send class="w-4 h-4" />
			{/if}
		</button>
		{#if tooShort}
			<p class="text-center text-[11px] font-bold text-brown mt-2">
				{shortfall} more character{shortfall === 1 ? '' : 's'} and mom is listening.
			</p>
		{/if}
		{#if busy}
			<p class="text-center text-[11px] font-semibold text-mute mt-2 max-w-xs mx-auto">
				hosted open-weight models think for 10-25s before answering. if it takes too long,
				i plan in code instead and you still get a real plan.
			</p>
		{/if}
	</div>
</div>
