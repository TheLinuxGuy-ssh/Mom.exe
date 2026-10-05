<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { DotLottieSvelte } from '@lottiefiles/dotlottie-svelte';
	import type { DotLottie } from '@lottiefiles/dotlottie-svelte';
	import {
		AWAY_MS,
		catDate,
		pickCoreLine,
		pickIdea,
		remainingUntilArrival,
		rollGraceDelay,
		rollIdleDelay,
		touchCatDay,
		updateCatDay
	} from '$lib/engine/cat-visit';

	/**
	 * One cat, one visit a day, no catch-up. It arrives once the user has been around for a
	 * minute or two, it peeks, it looks around while you read, and if you ignore it long enough
	 * it drops out of frame for a minute and tries again. Read it and it is gone until tomorrow.
	 */
	type Phase = 'waiting' | 'peek' | 'talking' | 'dipping' | 'away' | 'leaving' | 'gone';

	const TYPE_MS = 18;

	/**
	 * Set true only while tuning the cat's size and placement: it then appears the moment the
	 * dashboard mounts instead of waiting out the day's arrival window, and ignores a dismissal
	 * already recorded for today so there is always something to look at.
	 *
	 * False in normal use, so the cat is a once-a-day visit rather than a permanent fixture.
	 */
	const ALWAYS_ON_LOAD = false;

	let phase = $state<Phase>('waiting');
	let reduced = $state(false);
	let core = $state('');
	let idea = $state('');
	let typed = $state(0);

	let player: DotLottie | null = null;
	let arrivalTimer: ReturnType<typeof setTimeout> | undefined;
	let graceTimer: ReturnType<typeof setTimeout> | undefined;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let awayTimer: ReturnType<typeof setTimeout> | undefined;
	let typeTimer: ReturnType<typeof setInterval> | undefined;

	/** the player stays mounted between peeking and reading, so the rise is never replayed */
	const showPlayer = $derived(phase === 'peek' || phase === 'talking' || phase === 'dipping');
	const full = $derived(core + ' ' + idea);
	const ideaShown = $derived(Math.max(0, typed - core.length - 1));

	function clearTimers(): void {
		for (const t of [arrivalTimer, graceTimer, idleTimer, awayTimer]) clearTimeout(t);
		clearInterval(typeTimer);
		arrivalTimer = graceTimer = idleTimer = awayTimer = undefined;
		typeTimer = undefined;
	}

	function arrive(): void {
		phase = 'peek';
		updateCatDay({ appeared: true });
		armIdle();
	}

	function armIdle(): void {
		clearTimeout(idleTimer);
		idleTimer = setTimeout(dip, rollIdleDelay());
	}

	/** ignored too long: reverse out of frame, come back, try to be noticed again */
	function dip(): void {
		if (phase !== 'peek') return;
		clearTimeout(idleTimer);
		if (reduced) {
			phase = 'away';
			awayTimer = setTimeout(back, AWAY_MS);
			return;
		}
		phase = 'dipping';
		void reverse();
	}

	function back(): void {
		if (phase !== 'away') return;
		phase = 'peek';
		armIdle();
	}

	async function reverse(): Promise<void> {
		if (!player) return onComplete();
		try {
			await player.setFrame(Math.max(0, player.totalFrames - 1));
			await player.setMode('reverse');
			await player.play();
		} catch {
			onComplete();
		}
	}

	function onComplete(): void {
		if (phase === 'dipping') {
			phase = 'away';
			awayTimer = setTimeout(back, AWAY_MS);
		} else if (phase === 'leaving') {
			updateCatDay({ dismissed: true });
			phase = 'gone';
		}
	}

	function bindPlayer(p: DotLottie): void {
		player = p;
		p.addEventListener('complete', onComplete);

		// reduced motion never gets the rise or the sink; it gets the resting pose instantly.
		// totalFrames is 0 until the file has loaded, so wait for the load events before asking.
		const rest = () => {
			if (reduced && p.totalFrames > 0) void p.setFrame(Math.max(0, p.totalFrames - 1));
		};
		p.addEventListener('ready', rest);
		p.addEventListener('load', rest);
	}

	function startTyping(): void {
		typed = 0;
		if (reduced) {
			typed = full.length;
			return;
		}
		typeTimer = setInterval(() => {
			typed += 1;
			if (typed >= full.length) stopTyping();
		}, TYPE_MS);
	}

	function stopTyping(): void {
		clearInterval(typeTimer);
		typeTimer = undefined;
		typed = full.length;
	}

	function toggle(): void {
		if (phase === 'peek') {
			clearTimeout(idleTimer);
			phase = 'talking';
			startTyping();
		} else if (phase === 'talking') {
			stopTyping();
			if (reduced) {
				updateCatDay({ dismissed: true });
				phase = 'gone';
				return;
			}
			phase = 'leaving';
			void reverse();
		}
	}

	function onKey(e: KeyboardEvent): void {
		if (e.key === 'Escape' && phase === 'talking') toggle();
	}

	onMount(() => {
		reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		const today = catDate();
		core = pickCoreLine(today);
		idea = pickIdea(today);

		const day = touchCatDay({ date: today });
		if (!ALWAYS_ON_LOAD && (!day || day.dismissed)) {
			phase = 'gone';
			return;
		}

		window.addEventListener('keydown', onKey);
		const done = () => {
			window.removeEventListener('keydown', onKey);
			clearTimers();
		};

		if (ALWAYS_ON_LOAD) {
			arrive();
			return done;
		}

		// a reload after the cat already visited does not restart the whole waiting game
		if (day?.appeared) graceTimer = setTimeout(arrive, rollGraceDelay());
		else arrivalTimer = setTimeout(arrive, remainingUntilArrival(day!));

		return done;
	});
</script>

{#if phase !== 'gone'}
	<div class="pointer-events-none fixed right-14 bottom-0 z-40">
		{#if phase === 'talking'}
			<div
				class="absolute right-[50%] bottom-[40%] mb-3 w-[min(17rem,calc(100vw-2.5rem))]"
				role="status"
				in:fly={{ y: 10, duration: 260 }}
				out:fly={{ y: 10, duration: 150 }}
			>
				<div
					class="cloud relative -rotate-[0.8deg] border-2 border-ink bg-paper px-4 py-3
						shadow-[5px_5px_0_var(--color-ink)]"
				>
					<span class="absolute -bottom-[9px] right-5 h-4 w-4 rotate-45 border-r-2 border-b-2 border-ink bg-paper"></span>
					<p class="mb-1 text-[10px] font-semibold tracking-[0.22em] text-brown/50 uppercase">psst</p>
					<p class="sr-only">{full}</p>
					<div class="font-hand text-[16px] leading-snug font-bold" aria-hidden="true">
						<p>{core.slice(0, typed)}</p>
						{#if ideaShown > 0}
							<p class="mt-2 border-t border-ink/15 pt-2 text-ink/75">{idea.slice(0, ideaShown)}</p>
						{/if}
					</div>
				</div>
			</div>
		{/if}

		<!--
			Geometry. Two things have to hold for the cat to sit welded to the bottom-right corner.

			First, the stage takes its aspect ratio from the asset itself. `contain` letterboxes any
			box that does not match it, which shrinks the drawing and leaves dead space beside it, and
			deriving the width from the ratio means the box cannot drift out of sync at any height.
			Change the ratio when the asset changes; nothing else here needs to know the size.

			Second, the player sizes its canvas with height:100% of its own wrapper div, whose
			height is auto, which cannot resolve - so the styles below give both the wrapper div and
			the canvas a definite size. Without them the canvas falls back to its intrinsic size and
			the whole layout collapses. Both must match the stage exactly: a canvas forced to a
			fixed width inside a narrower box overflows sideways and clips the cat against the
			viewport edge.
		-->
		<div class="cat-stage relative h-[300px]" style="aspect-ratio: 940 / 1625">
			{#if showPlayer}
				<DotLottieSvelte
					src="/catpeeking.lottie"
					autoplay={!reduced}
					loop={false}
					layout={{ fit: 'contain', align: [0.5, 1] }}
					dotLottieRefCallback={bindPlayer}
				/>
			{/if}

			{#if phase === 'peek' || phase === 'talking'}
				<button
					type="button"
					class="absolute inset-0 outline-0 border-0 cursor-pointer pointer-events-auto"
					aria-expanded={phase === 'talking'}
					aria-label={phase === 'talking' ? 'close mum note' : 'a cat wants to tell you something'}
					onclick={toggle}
				></button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.cat-stage > :global(div),
	.cat-stage :global(canvas) {
		width: 100%;
		height: 100%;
	}

	.cat-stage :global(canvas) {
		display: block;
	}
</style>