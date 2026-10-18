<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import ArrowRight from 'lucide-svelte/icons/arrow-right';
	import Mascot from '$lib/components/Mascot.svelte';
	import { getStorage } from '$lib/storage';
	import { getSession } from '$lib/auth/session';
	import type { MessTimings, ProfileInput, Roommates, Situation } from '$lib/storage/types';
	import { toast } from '$lib/stores/toast';

	const STEPS = ['you', 'situation', 'age', 'body', 'day', 'sleep', 'people', 'food', 'caffeine'] as const;

	/**
	 * The situation step is the hinge of the whole flow: every step after it re-words itself and
	 * defaults to sane values from the SITUATION_PRESETS table. The data model stays the same —
	 * `mess` still holds three eating windows and `class_start` still anchors the day — these are
	 * only the questions a hostel student and an office worker need to answer differently.
	 */
	const SITUATIONS: { value: Situation; label: string; blurb: string }[] = [
		{ value: 'student_hostel', label: 'hostel student', blurb: 'classes + mess line. the classic setup.' },
		{ value: 'student_flat', label: 'student, own place', blurb: 'flat, PG or tiffin. no mess queue.' },
		{ value: 'student_home', label: 'student, at home', blurb: 'ghar, family, home food.' },
		{ value: 'work_office', label: 'office job', blurb: 'commute, colleagues, lunch break.' },
		{ value: 'work_remote', label: 'work from home', blurb: 'the desk is the home. she knows.' },
		{ value: 'own_gig', label: 'my own schedule', blurb: 'freelance, own venture, own hours.' },
		{ value: 'between_things', label: 'between things', blurb: 'exam prep, job hunt, recharging.' }
	];

	const SITUATION_PRESETS: Record<
		Situation,
		{ class_start: string; mess: MessTimings; roommates: Roommates }
	> = {
		student_hostel: { class_start: '09:00', mess: { breakfast: '07:30-09:30', lunch: '12:30-14:30', dinner: '19:30-21:30' }, roommates: 'shared_noisy' },
		student_flat: { class_start: '09:00', mess: { breakfast: '08:00-09:30', lunch: '13:00-15:00', dinner: '20:00-22:00' }, roommates: 'shared_quiet' },
		student_home: { class_start: '09:00', mess: { breakfast: '07:30-09:00', lunch: '13:00-14:30', dinner: '20:00-21:30' }, roommates: 'shared_quiet' },
		work_office: { class_start: '09:00', mess: { breakfast: '07:30-09:00', lunch: '13:00-14:00', dinner: '20:00-22:00' }, roommates: 'own_room' },
		work_remote: { class_start: '10:00', mess: { breakfast: '08:00-09:30', lunch: '13:00-14:00', dinner: '20:00-22:00' }, roommates: 'own_room' },
		own_gig: { class_start: '', mess: { breakfast: '08:00-10:00', lunch: '13:00-15:00', dinner: '19:00-21:30' }, roommates: 'own_room' },
		between_things: { class_start: '', mess: { breakfast: '08:00-10:00', lunch: '13:00-15:00', dinner: '19:30-21:30' }, roommates: 'own_room' }
	};

	/**
	 * Room labels that fit where they actually live. The stored values are the same three
	 * `roommates` buckets in every case; only the words change, because "shared, loud" is a
	 * hostel sentence and "full house" is a family one.
	 */
	const PEOPLE_OPTIONS: Record<Situation, [Roommates, string][]> = {
		student_hostel: [
			['own_room', 'own room'],
			['shared_quiet', 'shared, quiet'],
			['shared_noisy', 'shared, loud']
		],
		student_flat: [
			['own_room', 'alone in the flat'],
			['shared_quiet', 'flatmates, civil'],
			['shared_noisy', 'flatmates, loud']
		],
		student_home: [
			['own_room', 'own room at home'],
			['shared_quiet', 'family home, quiet'],
			['shared_noisy', 'family home, full house']
		],
		work_office: [
			['own_room', 'live alone'],
			['shared_quiet', 'flatmates, quiet'],
			['shared_noisy', 'flatmates, loud']
		],
		work_remote: [
			['own_room', 'live alone'],
			['shared_quiet', 'flatmates, quiet'],
			['shared_noisy', 'flatmates, loud']
		],
		own_gig: [
			['own_room', 'live alone'],
			['shared_quiet', 'flatmates, quiet'],
			['shared_noisy', 'flatmates, loud']
		],
		between_things: [
			['own_room', 'live alone'],
			['shared_quiet', 'flatmates, quiet'],
			['shared_noisy', 'flatmates, loud']
		]
	};

	const DAY_STEP: Record<Situation, { title: string; hint: string; field: string }> = {
		student_hostel: { title: 'WHEN IS CLASS?', hint: 'usual first class start time.', field: 'first class starts' },
		student_flat: { title: 'WHEN IS CLASS?', hint: 'usual first class start time.', field: 'first class starts' },
		student_home: { title: 'WHEN IS CLASS?', hint: 'usual first class start time.', field: 'first class starts' },
		work_office: { title: 'WHEN DOES WORK START?', hint: 'your usual workday start. she plans around it.', field: 'workday starts' },
		work_remote: { title: 'WHEN DOES WORK START?', hint: 'your usual workday start. she plans around it.', field: 'workday starts' },
		own_gig: { title: 'ANY FIXED START TO THE DAY?', hint: 'a repeating commitment — call, meeting, market run. skip if nothing is fixed.', field: 'any fixed start (optional)' },
		between_things: { title: 'ANY FIXED START TO THE DAY?', hint: 'a repeating commitment — class, work, a standing call. skip if nothing is fixed.', field: 'any fixed start (optional)' }
	};

	const FOOD_STEP: Record<Situation, { title: string; hint: string }> = {
		student_hostel: { title: 'MESS + FOOD', hint: 'mess windows shape the meal blocks.' },
		student_flat: { title: 'FOOD WINDOWS', hint: 'tiffin, kitchen or delivery. windows shape the meal blocks.' },
		student_home: { title: 'GHAR KA KHANA', hint: 'food timings at home. edit them if the house runs on another clock.' },
		work_office: { title: 'FOOD WINDOWS', hint: 'lunch break and dinner timings shape the meal blocks.' },
		work_remote: { title: 'FOOD WINDOWS', hint: 'lunch break and dinner timings shape the meal blocks.' },
		own_gig: { title: 'FOOD WINDOWS', hint: 'when food actually happens. mom nudges before a window shuts.' },
		between_things: { title: 'FOOD WINDOWS', hint: 'when food actually happens. mom nudges before a window shuts.' }
	};

	let step = $state(0);
	let saving = $state(false);

	let draft = $state<ProfileInput>({
		display_name: '',
		situation: 'student_hostel',
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

	const STEP_LABELS: Record<(typeof STEPS)[number], { title: string; hint: string } | null> = {
		you: { title: 'FIRST, A NAME (OR NOT)', hint: 'what should mom call you? any nickname works.' },
		situation: { title: "WHAT'S LIFE LIKE RIGHT NOW?", hint: 'pick the closest one. mom plans around what you actually do.' },
		age: { title: 'WHAT YEAR WERE YOU BORN?', hint: 'birth year is enough. the AI only ever sees your age band.' },
		body: { title: 'OPTIONAL STUFF', hint: 'height and weight, only if you want. no calorie talk, ever.' },
		// `day` and `food` get their words from the situation picked two steps earlier
		day: null,
		sleep: { title: 'BED TIME. YES, AN ACTUAL TIME.', hint: 'targets, not demands.' },
		people: { title: 'ROOM SITUATION', hint: 'be honest, this changes the advice.' },
		food: null,
		caffeine: { title: 'LAST ONE. CAFFEINE?', hint: 'mom is judging, gently.' }
	};

	const stepLabel = $derived.by(() => {
		const key = STEPS[step];
		if (key === 'day') return DAY_STEP[draft.situation];
		if (key === 'food') return FOOD_STEP[draft.situation];
		return STEP_LABELS[key]!;
	});

	function pickSituation(s: Situation): void {
		draft.situation = s;
		draft.class_start = SITUATION_PRESETS[s].class_start;
		draft.mess = { ...SITUATION_PRESETS[s].mess };
		draft.roommates = SITUATION_PRESETS[s].roommates;
	}

	function next(): void {
		if (step === 0 && !draft.display_name.trim()) draft.display_name = 'beta';
		if (step === 2) draft.birth_year = birthYearText ? Number(birthYearText) : null;
		if (step === 3) {
			draft.height_cm = heightText ? Number(heightText) : null;
			draft.weight_kg = weightText ? Number(weightText) : null;
		}
		if (step === 7) draft.allergies = allergiesText.split(',').map((s) => s.trim()).filter(Boolean);
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
					{stepLabel.title}
				</h1>
				<p class="text-sm font-semibold text-mute mt-2">{stepLabel.hint}</p>
			</div>

			{#if step === 0}
				<input class="field" placeholder="what should mom call you?" bind:value={draft.display_name} />
			{:else if step === 1}
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
					{#each SITUATIONS as s (s.value)}
						<button
							type="button"
							class="btn !rounded-xl px-4 py-3 text-left flex flex-col items-start gap-0.5 {draft.situation === s.value ? '!bg-orange !text-paper' : ''}"
							onclick={() => pickSituation(s.value)}
						>
							<span class="text-sm font-black uppercase tracking-wide">{s.label}</span>
							<span class="text-xs font-semibold opacity-75">{s.blurb}</span>
						</button>
					{/each}
				</div>
				<p class="text-[11px] font-semibold text-mute">
					the next questions bend around this one. you can redo the whole setup later from settings.
				</p>
			{:else if step === 2}
				<input class="field" inputmode="numeric" placeholder="e.g. 2004" bind:value={birthYearText} />
			{:else if step === 3}
				<div class="grid grid-cols-2 gap-3">
					<input class="field" inputmode="numeric" placeholder="height cm (optional)" bind:value={heightText} />
					<input class="field" inputmode="numeric" placeholder="weight kg (optional)" bind:value={weightText} />
				</div>
			{:else if step === 4}
				<label class="text-xs font-black uppercase tracking-widest text-brown block space-y-1.5">{DAY_STEP[draft.situation].field}
					<input type="time" class="field" bind:value={draft.class_start} />
				</label>
				{#if draft.situation === 'own_gig' || draft.situation === 'between_things'}
					<button
						type="button"
						class="btn !rounded-xl px-4 py-2 text-sm"
						onclick={() => (draft.class_start = '')}
					>skip — nothing fixed</button>
				{/if}
			{:else if step === 5}
				<div class="grid grid-cols-2 gap-3">
					<label class="text-xs font-black uppercase tracking-widest text-brown block space-y-1.5">target bed
						<input type="time" class="field" bind:value={draft.target_bed} />
					</label>
					<label class="text-xs font-black uppercase tracking-widest text-brown block space-y-1.5">target wake
						<input type="time" class="field" bind:value={draft.target_wake} />
					</label>
				</div>
			{:else if step === 6}
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
							{#each PEOPLE_OPTIONS[draft.situation] as [v, l]}
								<button type="button" class="btn !rounded-xl px-4 py-2 text-sm {draft.roommates === v ? '!bg-orange !text-paper' : ''}" onclick={() => (draft.roommates = v as typeof draft.roommates)}>{l}</button>
							{/each}
						</div>
					</div>
				</div>
			{:else if step === 7}
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
