<script lang="ts">
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import WifiOff from 'lucide-svelte/icons/wifi-off';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import Check from 'lucide-svelte/icons/check';
	import type { Plan, PlanBlock } from '$lib/storage/types';
	import { ACTION_LABEL, FLAG_LABEL, type Action, type Flag } from '$lib/engine/actions';
	import { hhmmToMin, fmtCountdown, isCurrentMinute } from '$lib/engine/time';
	import StickyNote from './StickyNote.svelte';
	import BlockCard from './BlockCard.svelte';
	import GooeyToggle from './GooeyToggle.svelte';
	import ActionIcon from './ActionIcon.svelte';

	let {
		plan,
		now,
		tz,
		marks = {},
		onmark,
		onreplan
	}: {
		plan: Plan;
		now: Date;
		tz: string;
		marks: Record<string, 'yes' | 'no'>;
		onmark: (block: PlanBlock, followed: 'yes' | 'no') => void;
		onreplan: () => void;
	} = $props();

	let view = $state<'plain' | 'code'>('plain');
	let showPast = $state(false);

	const minutes = $derived(hhmmToMin(
		new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
	));

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
			const isNow = isCurrentMinute(minutes, b.start, b.end);
			const overnight = e <= s;
			const ended = overnight ? false : minutes >= e;
			let minutesLeft = 0;
			if (isNow) {
				const effEnd = overnight ? e + 1440 : e;
				minutesLeft = Math.max(0, effEnd - minutes);
			}
			list.push({
				block: b,
				phase: ended ? 'past' : isNow ? 'current' : 'next',
				minutesLeft
			});
		}
		return list;
	});

	const current = $derived(classified.find((c) => c.phase === 'current') ?? null);
	const nexts = $derived(classified.filter((c) => c.phase === 'next').slice(0, 3));
	const later = $derived(classified.filter((c) => c.phase === 'next').slice(3));
	const past = $derived(classified.filter((c) => c.phase === 'past'));
	const doneCount = $derived(past.filter((c) => marks[refOf(c.block)] === 'yes').length);
	const finished = $derived(!current && nexts.length === 0 && later.length === 0);
	const snapshot = $derived((plan.context_snapshot as { data_quality?: { days_since_last_checkin?: number } }) ?? {});
	const daysSince = $derived(snapshot.data_quality?.days_since_last_checkin ?? null);

	const basisText = $derived.by(() => {
		if (plan.basis === 'priors') return 'based on your setup answers, not history yet';
		if (plan.basis === 'partial') {
			if (daysSince != null && daysSince >= 2)
				return `based on your usual pattern, last check-in ${daysSince} days ago`;
			return 'based on your recent check-ins';
		}
		return 'based on your full recent history';
	});

	function refOf(b: PlanBlock): string {
		return `${b.start}-${b.end}`;
	}

	const helpFlag = $derived(plan.output.flags.includes('suggest_professional_help'));
	const otherFlags = $derived(plan.output.flags.filter((f) => f !== 'suggest_professional_help'));
</script>

<div class="w-full max-w-2xl mx-auto space-y-4">
	<div class="flex items-center justify-between gap-3 flex-wrap">
		<p class="text-xs font-black uppercase tracking-[0.18em] text-brown">{basisText}</p>
		<div class="w-56 border-2 border-ink rounded-full overflow-hidden bg-paper">
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

	<StickyNote text={plan.output.summary + (plan.output.data_note ? ' ' + plan.output.data_note : '')} />

	{#if plan.model_id === 'template'}
		<div class="card !rounded-xl p-3 flex items-start gap-2 text-sm font-semibold !border-orange !bg-yellow/40">
			<WifiOff class="w-4 h-4 shrink-0 mt-0.5" />
			<div>
				<p class="font-black uppercase text-xs tracking-widest">planned in code, not by the model</p>
				<p class="mt-1 leading-snug">
					{plan.fallback_reason ?? 'the model was unreachable'}
				</p>
				<p class="mt-1 text-xs text-mute">
					the plan below is still a real plan, built from your data in code. check settings -> the brain to fix the connection.
				</p>
			</div>
		</div>
	{/if}

	{#if helpFlag}
		<div class="card !rounded-2xl p-4 border-warn">
			<div class="flex items-start gap-2.5">
				<TriangleAlert class="w-5 h-5 text-warn shrink-0 mt-0.5" />
				<div>
					<p class="font-black text-sm">Worth talking to someone</p>
					<p class="text-sm font-semibold mt-1">
						Sleep and meals have been rough for a while and that is a lot to carry alone. A campus counselor or
						doctor can actually help. This is a wellness app, not a medical one.
					</p>
				</div>
			</div>
		</div>
	{/if}

	{#if otherFlags.length > 0}
		<div class="flex flex-wrap gap-2">
			{#each otherFlags as f}
				<span class="chip !bg-yellow/70 text-[12px]">
					<TriangleAlert class="w-3.5 h-3.5" />
					{FLAG_LABEL[f as Flag] ?? f}
				</span>
			{/each}
		</div>
	{/if}

	{#if view === 'plain'}
		{#if current}
			<div class="space-y-3">
				<p class="text-xs font-black uppercase tracking-[0.22em] text-ink/50">now</p>
				<BlockCard
					block={current.block}
					phase="current"
					minutesLeft={current.minutesLeft}
					mark={marks[refOf(current.block)] ?? null}
					onmark={(f) => onmark(current.block, f)}
				/>
			</div>
		{:else if finished}
			<div class="card p-5 text-center">
				<p class="font-display text-2xl">DAY DONE.</p>
				<p class="text-sm font-semibold text-mute mt-1">
					{doneCount} of {past.length} done. Sleep well, tomorrow we go again.
				</p>
			</div>
		{/if}

		{#if nexts.length > 0}
			<div class="space-y-2">
				<p class="text-xs font-black uppercase tracking-[0.22em] text-ink/50">next</p>
				{#each nexts as n}
					<div class="card !rounded-xl p-3 flex items-center gap-3 {marks[refOf(n.block)] === 'yes' ? 'opacity-60' : ''}">
						<span class="grid place-items-center w-8 h-8 rounded-lg border-2 border-ink bg-paper shrink-0">
							<ActionIcon action={n.block.action} size={15} />
						</span>
						<div class="min-w-0 flex-1">
							<p class="font-extrabold text-sm">{ACTION_LABEL[n.block.action as Action] ?? n.block.action}
								<span class="text-mute font-bold">, {n.block.start}</span></p>
							<p class="text-xs text-mute font-semibold truncate">{n.block.detail}</p>
						</div>
						{#if marks[refOf(n.block)] === 'yes'}
							<Check class="w-4 h-4 shrink-0" />
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if later.length > 0}
			<p class="text-xs font-semibold text-mute pl-1">later: {later.map((l) => `${l.block.start} ${ACTION_LABEL[l.block.action as Action] ?? l.block.action}`).join(' / ')}</p>
		{/if}

		{#if past.length > 0}
			<button
				type="button"
				class="w-full flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-widest text-ink/45 hover:text-ink cursor-pointer pt-1"
				onclick={() => (showPast = !showPast)}
			>
				earlier today ({past.length}, {doneCount} done)
				<ChevronDown class="w-3.5 h-3.5 transition-transform {showPast ? 'rotate-180' : ''}" />
			</button>
			{#if showPast}
				<div class="space-y-2">
					{#each past as p}
						<BlockCard
							block={p.block}
							phase="next"
							mark={marks[refOf(p.block)] ?? null}
							onmark={(f) => onmark(p.block, f)}
						/>
					{/each}
				</div>
			{/if}
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

	<div class="flex justify-center pt-1">
		<button
			type="button"
			class="btn !rounded-full px-5 py-2.5 text-xs flex items-center gap-2"
			onclick={onreplan}
		>
			<RotateCcw class="w-3.5 h-3.5" />
			Replan from now
		</button>
	</div>
</div>
