<script lang="ts">
	import { DotLottieSvelte } from '@lottiefiles/dotlottie-svelte';
	import { EASE_SOFT } from '$lib/engine/easing';

	type Phase = 'night' | 'day';
	type Fit = 'cover' | 'contain';

	type Scene = {
		sky: string;
		skyFit: Fit;
		body: string;
		lines: string[];
	};

	const SWAP_MS = 560;
	const SAY_MS = 420;
	const SAD_MS = 4000;
	const HAPPY_MS = 8000;

	const SCENES: Record<Phase, Scene> = {
		night: {
			sky: '/sadballs.lottie',
			skyFit: 'cover',
			body: '/catsleeping.lottie',
			lines: ['slept at 4am? missed breakfast? mom has a plan.', 'the moon stole your night. mom plans the morning.']
		},
		day: {
			sky: '/smilingsun.lottie',
			skyFit: 'contain',
			body: '/palmdancing.lottie',
			lines: ["schedule fixed. sun's back. go dance.", 'eat, move, sleep on time. that is the whole trick.']
		}
	};

	let phase = $state<Phase>('night');
	let reduced = $state(false);
	let nightTurn = $state(0);
	let dayTurn = $state(0);

	const scene = $derived(SCENES[phase]);
	const caption = $derived(
		phase === 'night'
			? SCENES.night.lines[nightTurn % SCENES.night.lines.length]
			: SCENES.day.lines[dayTurn % SCENES.day.lines.length]
	);

	type Tone = 'lime' | 'blue' | 'pink';

	const HL_RULES: [RegExp, Tone][] = [
		[/\b4am\b/gi, 'lime'],
		[/\bbreakfast\b/gi, 'pink'],
		[/\bmoon\b/gi, 'blue'],
		[/\bmorning\b/gi, 'lime'],
		[/\bschedule fixed\b/gi, 'lime'],
		[/\bdance\b/gi, 'pink'],
		[/\bsleep on time\b/gi, 'lime'],
		[/\bwhole trick\b/gi, 'blue']
	];

	function escapeHtml(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	function highlight(s: string): string {
		let html = escapeHtml(s);
		for (const [re, tone] of HL_RULES) {
			html = html.replace(new RegExp(re.source, re.flags), `<mark class="hl hl-${tone}">$&</mark>`);
		}
		return html;
	}

	const captionHtml = $derived(highlight(caption));

	$effect(() => {
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduced = mq.matches;
		const settle = (): void => {
			if (mq.matches) phase = 'day';
		};
		settle();
		mq.addEventListener('change', settle);
		return () => mq.removeEventListener('change', settle);
	});

	$effect(() => {
		if (reduced) return;
		const timer = setTimeout(() => {
			if (phase === 'night') {
				nightTurn += 1;
				phase = 'day';
			} else {
				dayTurn += 1;
				phase = 'night';
			}
		}, phase === 'night' ? SAD_MS : HAPPY_MS);
		return () => clearTimeout(timer);
	});

	type MorphParams = { duration?: number; y?: number; scale?: number; blur?: number };

	/**
	 * One bidirectional transition drives both directions. Svelte hands `t = 1` at the resting
	 * state and `t = 0` at the hidden state (t runs 0->1 on intro, 1->0 on outro), so the same
	 * curve serves both. Because the incoming and outgoing layers share an easing and a duration,
	 * their opacities stay complementary (easing(p) + 1 - easing(p) === 1) at every frame, which
	 * is what keeps the swap seamless instead of dipping to an empty frame.
	 */
	function morph(node: HTMLElement, { duration = SWAP_MS, y = 18, scale = 0.96, blur = 0 }: MorphParams = {}) {
		return {
			duration,
			easing: EASE_SOFT,
			css: (t: number) =>
				`opacity:${t};` +
				`transform:translateY(${(1 - t) * y}px) scale(${scale + (1 - scale) * t});` +
				(blur > 0 ? `filter:blur(${(1 - t) * blur}px);` : '') +
				'will-change:transform,opacity;'
		};
	}
</script>

<div class="relative mx-auto flex h-full w-full max-w-lg select-none flex-col justify-end" aria-hidden="true">
	<div class="pointer-events-none absolute right-0 top-0 z-20 h-[40%] w-[52%]">
		{#key phase}
			<div class="absolute inset-0" in:morph={{ y: 16 }} out:morph={{ y: 16 }}>
				<DotLottieSvelte src={scene.sky} autoplay loop layout={{ fit: scene.skyFit, align: [0.5, 0.5] }} />
			</div>
		{/key}
	</div>

	<div class="relative min-h-0 w-full flex-1 overflow-hidden">
		{#key phase}
			<div class="absolute inset-0" in:morph={{ y: 22 }} out:morph={{ y: 22 }}>
				<DotLottieSvelte src={scene.body} autoplay loop layout={{ fit: 'cover', align: [0.5, 0.5] }} />
			</div>
		{/key}

		<div class="absolute inset-x-0 bottom-0 z-10 pb-10">
			<div
				class="quote sticky-note @container relative flex min-h-[3.25rem] w-full items-center justify-center !rounded-t-none !px-2 !py-1 text-brown"
			>
				{#key phase}
					<p
						class="absolute inset-0 flex items-center justify-center whitespace-nowrap text-center text-[4.4cqw] !leading-[1.25]"
						in:morph={{ duration: SAY_MS, y: 10, scale: 0.985, blur: 3 }}
						out:morph={{ duration: SAY_MS, y: 10, scale: 0.985, blur: 3 }}
					>
						{@html captionHtml}
					</p>
				{/key}
			</div>
		</div>
	</div>
</div>

<style>
	/*
	 * The note is already --color-yellow, so the shared 65% wash on `mark.hl` sinks into it and
	 * the highlight reads as nothing. Push the opacity up so the lime/blue/pink land as highlighter.
	 * `:global` is required because the marks come from `{@html}`, which the compiler cannot scope.
	 */
	.quote :global(mark.hl::before) {
		opacity: 0.92;
	}
</style>
