<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import ArrowRight from 'lucide-svelte/icons/arrow-right';
	import Mascot from '$lib/components/Mascot.svelte';
	import { getStorage } from '$lib/storage';
	import { getSession } from '$lib/auth/session';
	import type { ProfileInput } from '$lib/storage/types';
	import { toast } from '$lib/stores/toast';

	const STEPS = ['you', 'age', 'body', 'class', 'sleep', 'people', 'food', 'caffeine'] as const;

	let step = $state(0);
	let saving = $state(false);

	let draft = $state<ProfileInput>({
		display_name: '',
		birth_year: null,
		height_cm: null,
		weight_kg: null,
		class_start: '09:00',
		target_bed: '23:30',
		target_wake: '07:00',
		chronotype: 'night',
		roommates: 'shared_noisy',
		mess: { breakfast: '07:30-09:30', lunch: '12:30-14:30', dinner: '19:30-21:30' },
		diet_pref: 'veg',
		allergies: [],
		caffeine: 'low',
		timezone: 'Asia/Kolkata'
	});

	let allergiesText = $state('');
	let birthYearText = $state('');
	let heightText = $state('');
	let weightText = $state('');

	onMount(() => {
		if (!getSession()) {
			goto('/login');
			return;
		}
		try {
			draft.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		} catch {
			draft.timezone = 'Asia/Kolkata';
		}
	});

	const STEP_LABELS: Record<(typeof STEPS)[number], { title: string; hint: string }> = {
		you: { title: 'FIRST, A NAME (OR NOT)', hint: 'what should mom call you? any nickname works.' },
		age: { title: 'WHICH BATCH ARE YOU?', hint: 'birth year is enough. the AI only ever sees your age band.' },
		body: { title: 'OPTIONAL STUFF', hint: 'height and weight, only if you want. no calorie talk, ever.' },
		class: { title: 'WHEN IS CLASS?', hint: 'usual first class start time.' },
		sleep: { title: 'BED TIME. YES, AN ACTUAL TIME.', hint: 'targets, not demands.' },
		people: { title: 'ROOM SITUATION', hint: 'be honest, this changes the advice.' },
		food: { title: 'MESS + FOOD', hint: 'mess windows shape the meal blocks.' },
		caffeine: { title: 'LAST ONE. CAFFEINE?', hint: 'mom is judging, gently.' }
	};

	function next(): void {
		if (step === 0 && !draft.display_name.trim()) draft.display_name = 'beta';
		if (step === 1) draft.birth_year = birthYearText ? Number(birthYearText) : null;
		if (step === 2) {
			draft.height_cm = heightText ? Number(heightText) : null;
			draft.weight_kg = weightText ? Number(weightText) : null;
		}
		if (step === 6) draft.allergies = allergiesText.split(',').map((s) => s.trim()).filter(Boolean);
		if (step < STEPS.length - 1) step++;
	}

	async function finish(): Promise<void> {
		draft.allergies = allergiesText.split(',').map((s) => s.trim()).filter(Boolean);
		const session = getSession();
		if (!session) return;
		saving = true;
		try {
			await getStorage().saveProfile(session.userId, draft);
			toast('all set. she remembers now.');
			goto('/dashboard');
		} catch (e) {
			toast(e instanceof Error ? e.message : 'could not save', 'warn');
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>Setup — Mom.exe</title></svelte:head>

<div class="min-h-[80dvh] px-4 py-10">
	<div class="w-full max-w-lg mx-auto space-y-6">
		<div class="flex items-center justify-center gap-1.5">
			{#each STEPS as s, i}
				<button
					type="button"
					class="w-2.5 h-2.5 rounded-full border-2 border-ink cursor-pointer transition-transform {i === step ? 'bg-orange scale-125' : i < step ? 'bg-ink' : 'bg-paper'}"
					aria-label={s}
					onclick={() => (step = i)}
				></button>
			{/each}
		</div>

		<div class="card p-6 sm:p-8 space-y-5">
			<div>
				<p class="text-xs font-black uppercase tracking-[0.18em] text-brown">setup, {step + 1} of {STEPS.length}</p>
				<h1 class="font-display text-3xl sm:text-4xl uppercase tracking-tight mt-2 leading-none">
					{STEP_LABELS[STEPS[step]].title}
				</h1>
				<p class="text-sm font-semibold text-mute mt-2">{STEP_LABELS[STEPS[step]].hint}</p>
			</div>

			{#if step === 0}
				<input class="field" placeholder="what should mom call you?" bind:value={draft.display_name} />
			{:else if step === 1}
				<input class="field" inputmode="numeric" placeholder="e.g. 2004" bind:value={birthYearText} />
			{:else if step === 2}
				<div class="grid grid-cols-2 gap-3">
					<input class="field" inputmode="numeric" placeholder="height cm (optional)" bind:value={heightText} />
					<input class="field" inputmode="numeric" placeholder="weight kg (optional)" bind:value={weightText} />
				</div>
			{:else if step === 3}
				<label class="text-xs font-black uppercase tracking-widest text-brown block space-y-1.5">first class starts
					<input type="time" class="field" bind:value={draft.class_start} />
				</label>
			{:else if step === 4}
				<div class="grid grid-cols-2 gap-3">
					<label class="text-xs font-black uppercase tracking-widest text-brown block space-y-1.5">target bed
						<input type="time" class="field" bind:value={draft.target_bed} />
					</label>
					<label class="text-xs font-black uppercase tracking-widest text-brown block space-y-1.5">target wake
						<input type="time" class="field" bind:value={draft.target_wake} />
					</label>
				</div>
			{:else if step === 5}
				<div class="space-y-4">
					<div class="space-y-1.5">
						<p class="text-xs font-black uppercase tracking-widest text-brown">you are a...</p>
						<div class="flex gap-2">
							{#each [['morning', 'morning person'], ['neutral', 'depends'], ['night', 'night owl']] as [v, l]}
								<button type="button" class="btn !rounded-xl px-4 py-2 text-sm {draft.chronotype === v ? '!bg-orange !text-paper' : ''}" onclick={() => (draft.chronotype = v as typeof draft.chronotype)}>{l}</button>
							{/each}
						</div>
					</div>
					<div class="space-y-1.5">
						<p class="text-xs font-black uppercase tracking-widest text-brown">room situation</p>
						<div class="flex flex-wrap gap-2">
							{#each [['own_room', 'own room'], ['shared_quiet', 'shared, quiet'], ['shared_noisy', 'shared, loud']] as [v, l]}
								<button type="button" class="btn !rounded-xl px-4 py-2 text-sm {draft.roommates === v ? '!bg-orange !text-paper' : ''}" onclick={() => (draft.roommates = v as typeof draft.roommates)}>{l}</button>
							{/each}
						</div>
					</div>
				</div>
			{:else if step === 6}
				<div class="space-y-3">
					{#each [['breakfast', 'breakfast window'], ['lunch', 'lunch window'], ['dinner', 'dinner window']] as [k, l]}
						<label class="text-xs font-black uppercase tracking-widest text-brown block space-y-1.5">{l}
							<input class="field" placeholder="07:30-09:30" bind:value={draft.mess[k as 'breakfast' | 'lunch' | 'dinner']} />
						</label>
					{/each}
					<div class="grid grid-cols-2 gap-3">
						<label class="text-xs font-black uppercase tracking-widest text-brown block space-y-1.5">diet
							<select class="field" bind:value={draft.diet_pref}>
								<option>veg</option>
								<option>non-veg</option>
								<option>eggetarian</option>
								<option>anything</option>
							</select>
						</label>
						<label class="text-xs font-black uppercase tracking-widest text-brown block space-y-1.5">allergies
							<input class="field" placeholder="peanuts, none..." bind:value={allergiesText} />
						</label>
					</div>
				</div>
			{:else}
				<div class="space-y-1.5">
					<p class="text-xs font-black uppercase tracking-widest text-brown">coffee / chai at night?</p>
					<div class="flex flex-wrap gap-2">
						{#each [['none', 'nope'], ['low', 'sometimes'], ['high_late', 'yes, after 8pm']] as [v, l]}
							<button type="button" class="btn !rounded-xl px-4 py-2 text-sm {draft.caffeine === v ? '!bg-orange !text-paper' : ''}" onclick={() => (draft.caffeine = v as typeof draft.caffeine)}>{l}</button>
						{/each}
					</div>
					<p class="text-[11px] font-semibold text-mute pt-2">timezone: {draft.timezone}</p>
				</div>
			{/if}

			<div class="flex items-center justify-between pt-2">
				<button
					type="button"
					class="btn !rounded-xl px-4 py-2 text-sm flex items-center gap-1.5 {step === 0 ? 'invisible' : ''}"
					onclick={() => (step = Math.max(0, step - 1))}
				>
					<ArrowLeft class="w-4 h-4" /> back
				</button>
				{#if step < STEPS.length - 1}
					<button type="button" class="btn !bg-lime !rounded-xl px-6 py-2.5 text-sm flex items-center gap-1.5" onclick={next}>
						next <ArrowRight class="w-4 h-4" />
					</button>
				{:else}
					<button
						type="button"
						class="btn !bg-orange !text-paper !rounded-xl px-6 py-2.5 text-sm font-black uppercase flex items-center gap-1.5"
						disabled={saving}
						onclick={() => void finish()}
					>
						let her in
					</button>
				{/if}
			</div>
		</div>

		<div class="text-center">
			<p class="text-[11px] font-semibold text-mute max-w-sm mx-auto">
				You do not need to log anything to start. Mom.exe plans from your setup answers alone.
				It is a wellness coach, not medical advice.
			</p>
		</div>

		{#if step === 0}
			<div class="hidden sm:grid place-items-center opacity-90"><Mascot size={180} labels={false} /></div>
		{/if}
	</div>
</div>
