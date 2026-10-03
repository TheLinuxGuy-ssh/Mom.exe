<script lang="ts">
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import WifiOff from 'lucide-svelte/icons/wifi-off';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import Check from 'lucide-svelte/icons/check';
	import X from 'lucide-svelte/icons/x';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import ListTree from 'lucide-svelte/icons/list-tree';
	import type { Plan, PlanBlock } from '$lib/storage/types';
	import { ACTION_LABEL, FLAG_LABEL, type Action, type Flag } from '$lib/engine/actions';
	import { fmtCountdown, hhmmToMin, isCurrentMinute } from '$lib/engine/time';
	import StickyNote from './StickyNote.svelte';
	import BlockCard from './BlockCard.svelte';
	import GooeyToggle from './GooeyToggle.svelte';
	import ActionIcon from './ActionIcon.svelte';

	let {
		plan,
		now,
		tz,
		marks = {},
		busy = false,
		onmark
	}: {
		plan: Plan;
		now: Date;
		tz: string;
		marks: Record<string, 'yes' | 'no'>;
		busy?: boolean;
		onmark: (block: PlanBlock, followed: 'yes' | 'no') => void;
	} = $props();

	let expanded = $state(false);
	let showWhy = $state(false);
	let showPast = $state(false);
	let view = $state<'plain' | 'code'>('plain');

	const minutes = $derived(
		hhmmToMin(
			new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
		)
	);

	interface Classified {
		block: PlanBlock;
		phase: 'past' | 'current' | 'next';
		minutesLeft: number;
	}

	const classified = $derived.by(() => {
		const list: Classified[] = [];
		for (const b of plan.output.blocks) {
			const s = hhmmToMin(b.start);
			const e = hhmmToMin(b.end);
			const overnight = e <= s;
			const isNow = isCurrentMinute(minutes, b.start, b.end);
			const ended = overnight ? false : minutes >= e;
			let minutesLeft = 0;
			if (isNow) {
				const effEnd = overnight ? e + 1440 : e;
				minutesLeft = Math.max(0, effEnd - minutes);
			}
			list.push({ block: b, phase: ended ? 'past' : isNow ? 'current' : 'next', minutesLeft });
		}
		return list;
	});

	const current = $derived(classified.find((c) => c.phase === 'current') ?? null);
	const nexts = $derived(classified.filter((c) => c.phase === 'next'));
	const past = $derived(classified.filter((c) => c.phase === 'past'));
	const doneCount = $derived(past.filter((c) => marks[refOf(c.block)] === 'yes').length);
	const finished = $derived(!current && nexts.length === 0);
	const currentMark = $derived(current ? (marks[refOf(current.block)] ?? null) : null);

	const snapshot = $derived((plan.context_snapshot as { data_quality?: { days_since_last_checkin?: number } }) ?? {});
	const daysSince = $derived(snapshot.data_quality?.days_since_last_checkin ?? null);

	const basisText = $derived.by(() => {
		if (plan.basis === 'priors') return 'based on your setup answers, not history yet';
		if (plan.basis === 'partial') {
			if (daysSince != null && daysSince >= 2) return `based on your usual pattern, last check-in ${daysSince} days ago`;
			return 'based on your recent check-ins';
		}
		return 'based on your full recent history';
	});

	const replyText = $derived(
		plan.output.advice ? `${plan.output.advice} ${plan.output.summary}` : plan.output.summary
	);

	const otherFlags = $derived(plan.output.flags.filter((f) => f !== 'suggest_professional_help'));
	const helpFlag = $derived(plan.output.flags.includes('suggest_professional_help'));

	function refOf(b: PlanBlock): string {
		return `${b.start}-${b.end}`;
	}

	function labelOf(action: string): string {
		return ACTION_LABEL[action as Action] ?? action;
	}
</script>

<div class="w-full max-w-2xl mx-auto space-y-4">
	<div class="flex items-center justify-between gap-3">
		<p class="text-[11px] font-black uppercase tracking-[0.18em] text-brown">{basisText}</p>
		<button
			type="button"
			class="text-[11px] font-black uppercase tracking-widest text-ink/40 hover:text-ink cursor-pointer flex items-center gap-1"
			onclick={() => (expanded = !expanded)}
		>
			<ListTree class="w-3.5 h-3.5" />
			{expanded ? 'less' : 'full day'}
		</button>
	</div>

	<StickyNote text={replyText + (plan.output.data_note ? ' ' + plan.output.data_note : '')} />

	{#if plan.model_id === 'template'}
		<p class="text-[12px] font-bold text-brown leading-snug flex items-start gap-1.5">
			<WifiOff class="w-3.5 h-3.5 shrink-0 mt-0.5" />
			<span>planned in code, not by the model. {plan.fallback_reason ?? 'the model was unreachable'}</span>
		</p>
	{/if}

	{#if helpFlag}
		<div class="card !rounded-2xl p-4 border-warn">
			<div class="flex items-start gap-2.5">
				<TriangleAlert class="w-5 h-5 text-warn shrink-0 mt-0.5" />
				<div>
					<p class="font-black text-sm">Worth talking to someone</p>
					<p class="text-sm font-semibold mt-1 leading-snug">
						Sleep and meals have been rough for a while and that is a lot to carry alone. A campus
						counselor or doctor can actually help. Wellness app, not a medical one.
					</p>
				</div>
			</div>
		</div>
	{/if}

	{#if otherFlags.length > 0}
		<div class="flex flex-wrap gap-1.5">
			{#each otherFlags as f}
				<span class="chip !bg-yellow/70 text-[11px] !py-0.5 !px-2.5 !shadow-[2px_2px_0_var(--color-ink)]">
					{FLAG_LABEL[f as Flag] ?? f}
				</span>
			{/each}
		</div>
	{/if}

	{#if busy}
		<div class="card !rounded-2xl p-5 flex items-center gap-3 !bg-paper/80">
			<LoaderCircle class="w-5 h-5 animate-spin text-brown" />
			<p class="text-sm font-black uppercase tracking-wide text-brown">mom is replanning from now...</p>
		</div>
	{/if}

	<div class="space-y-4 {busy ? 'opacity-40 pointer-events-none' : ''}">
		{#if finished}
			<div class="card p-6 text-center">
				<p class="font-display text-2xl">DAY DONE.</p>
				<p class="text-sm font-semibold text-mute mt-1">
					{doneCount} of {past.length} done. Tomorrow we go again.
				</p>
			</div>
		{:else if current}
			<div class="card p-5 sm:p-6 {currentMark === 'yes' ? 'opacity-70 rotate-1' : ''} {currentMark === 'no' ? 'opacity-60' : ''}">
				<div class="flex items-center justify-between gap-2">
					<span class="chip !bg-orange !text-paper text-[11px] font-black tracking-widest">NOW</span>
					{#if currentMark === 'yes'}
						<span class="chip !bg-lime text-[11px]"><Check class="w-3 h-3" /> did it</span>
					{:else if currentMark === 'no'}
						<span class="chip text-[11px] opacity-60"><X class="w-3 h-3" /> skipped</span>
					{:else}
						<span class="chip !bg-yellow text-[12px] font-black">{fmtCountdown(current.minutesLeft)}</span>
					{/if}
				</div>

				<div class="flex items-center gap-3 mt-4">
					<span class="grid place-items-center w-12 h-12 rounded-xl border-2 border-ink bg-orange text-paper shrink-0">
						<ActionIcon action={current.block.action} size={22} />
					</span>
					<div class="min-w-0">
						<p class="font-display text-2xl sm:text-3xl uppercase leading-none tracking-tight truncate">
							{labelOf(current.block.action)}
						</p>
						<p class="text-xs font-bold text-mute mt-1">{current.block.start} – {current.block.end}</p>
					</div>
				</div>

				<p class="mt-3 text-[15px] font-semibold leading-snug">{current.block.detail}</p>

				{#if showWhy && current.block.why}
					<p class="text-xs font-semibold text-brown mt-2">because {current.block.why}</p>
				{/if}

				<div class="flex items-center gap-2 mt-4 flex-wrap">
					{#if currentMark === null}
						<button
							type="button"
							class="btn !bg-lime !shadow-[3px_3px_0_var(--color-ink)] !rounded-xl px-4 py-2 text-xs flex items-center gap-1.5"
							onclick={() => onmark(current!.block, 'yes')}
						>
							<Check class="w-4 h-4" /> did it
						</button>
						<button
							type="button"
							class="btn !shadow-[3px_3px_0_var(--color-ink)] !rounded-xl px-4 py-2 text-xs flex items-center gap-1.5"
							onclick={() => onmark(current!.block, 'no')}
						>
							<X class="w-4 h-4" /> skip
						</button>
					{/if}
					{#if current.block.why}
						<button
							type="button"
							class="text-[11px] font-black uppercase tracking-widest text-ink/40 hover:text-ink cursor-pointer ml-1"
							onclick={() => (showWhy = !showWhy)}
						>
							{showWhy ? 'hide why' : 'why?'}
						</button>
					{/if}
				</div>
			</div>
		{/if}

		{#if nexts.length > 0}
			<div class="flex items-baseline flex-wrap gap-x-2.5 gap-y-1 text-sm px-1">
				<span class="text-[11px] font-black uppercase tracking-widest text-brown self-center">then</span>
				{#each nexts.slice(0, 5) as n, i}
					<span class="font-bold">
						<span class="text-mute text-xs">{n.block.start}</span>
						{labelOf(n.block.action)}
						{#if marks[refOf(n.block)] === 'yes'}<Check class="w-3 h-3 inline text-lime" />{/if}
					</span>
					{#if i < Math.min(nexts.length, 5) - 1}<span class="text-ink/25">·</span>{/if}
				{/each}
				{#if nexts.length > 5}<span class="text-mute text-xs font-bold">+{nexts.length - 5} more</span>{/if}
			</div>
		{/if}

		{#if expanded}
			<div class="space-y-3 pt-1">
				<div class="flex items-center justify-between gap-3">
					<p class="text-[11px] font-black uppercase tracking-[0.22em] text-ink/50">the whole day</p>
					<div class="w-44 border-2 border-ink rounded-full overflow-hidden bg-paper">
						<GooeyToggle
							options={[
								{ value: 'plain', label: 'plain' },
								{ value: 'code', label: 'mom.js' }
							]}
							value={view}
							onchange={(v) => (view = v as 'plain' | 'code')}
						/>
					</div>
				</div>

				{#if view === 'plain'}
					{#each classified as c}
						<BlockCard
							block={c.block}
							phase={c.phase === 'current' ? 'current' : 'next'}
							minutesLeft={c.minutesLeft}
							mark={marks[refOf(c.block)] ?? null}
							onmark={(f) => onmark(c.block, f)}
						/>
					{/each}
					{#if past.length > 0}
						<button
							type="button"
							class="w-full flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-widest text-ink/45 hover:text-ink cursor-pointer"
							onclick={() => (showPast = !showPast)}
						>
							earlier today ({past.length}, {doneCount} done)
							<ChevronDown class="w-3.5 h-3.5 transition-transform {showPast ? 'rotate-180' : ''}" />
						</button>
					{/if}
				{:else}
					<div class="card !rounded-2xl p-4 font-mono text-[13px] leading-relaxed overflow-x-auto">
						<p class="text-ink/40">// mom.js, {plan.local_date}</p>
						{#each plan.output.blocks as b}
							<p>
								<span class="text-mute">at {b.start}</span> → {b.action}{b.detail ? `("${b.detail}")` : ''}
								{#if b.why}<span class="text-brown"> // {b.why}</span>{/if}
							</p>
						{/each}
						{#if plan.output.flags.length > 0}
							<p class="text-warn mt-2">flags: {plan.output.flags.join(', ')}</p>
						{/if}
					</div>
				{/if}
			</div>
		{/if}

	</div>
</div>
