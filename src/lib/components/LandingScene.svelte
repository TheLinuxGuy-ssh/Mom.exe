<script lang="ts">
	import { untrack } from 'svelte';
	import { DotLottieSvelte } from '@lottiefiles/dotlottie-svelte';

	type Phase = 'night' | 'day';
	type Dir = 'up' | 'down' | 'left' | 'right';

	const SAD_MS = 4000;
	const HAPPY_MS = 8000;

	const NIGHT_CAPTIONS = [
		'slept at 4am? missed breakfast? mom has a plan.',
		'the moon stole your night. mom plans the morning.'
	];
	const DAY_CAPTIONS = [
		"schedule fixed. sun's back. go dance.",
		'eat, move, sleep on time. that is the whole trick.'
	];

	let phase = $state<Phase>('night');
	let reduced = $state(false);
	let caption = $state(NIGHT_CAPTIONS[0]);
	let nightIdx = $state(0);
	let dayIdx = $state(0);

	$effect(() => {
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduced = mq.matches;
		if (reduced) {
			phase = 'day';
			caption = DAY_CAPTIONS[0];
		}
		const onChange = (e: MediaQueryListEvent): void => {
			reduced = e.matches;
			if (e.matches) {
				phase = 'day';
				caption = DAY_CAPTIONS[0];
			}
		};
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	$effect(() => {
		if (reduced) return;
		let timer: ReturnType<typeof setTimeout>;
		const cycle = (): void => {
			const wait = phase === 'night' ? SAD_MS : HAPPY_MS;
			timer = setTimeout(() => {
				phase = phase === 'night' ? 'day' : 'night';
				cycle();
			}, wait);
		};
		cycle();
		return () => clearTimeout(timer);
	});

	$effect(() => {
		const p = phase;
		untrack(() => {
			if (p === 'night') {
				caption = NIGHT_CAPTIONS[nightIdx % NIGHT_CAPTIONS.length];
				nightIdx += 1;
			} else {
				caption = DAY_CAPTIONS[dayIdx % DAY_CAPTIONS.length];
				dayIdx += 1;
			}
		});
	});

	const EASE_OUT = cubicBezier(0.16, 1, 0.3, 1);
	const EASE_IN = cubicBezier(0.7, 0, 0.84, 0);

	function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
		const cx = 3 * x1;
		const bx = 3 * (x2 - x1) - cx;
		const ax = 1 - cx - bx;
		const cy = 3 * y1;
		const by = 3 * (y2 - y1) - cy;
		const ay = 1 - cy - by;
		const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
		const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
		return (t: number): number => {
			if (t <= 0) return 0;
			if (t >= 1) return 1;
			let x = t;
			for (let i = 0; i < 8; i++) {
				const err = sampleX(x) - t;
				if (Math.abs(err) < 1e-6) break;
				const d = sampleDX(x);
				if (Math.abs(d) < 1e-6) break;
				x -= err / d;
			}
			return ((ay * x + by) * x + cy) * x;
		};
	}

	function slide(node: HTMLElement, params: { dir?: Dir; duration?: number; delay?: number; out?: boolean } = {}) {
		const { dir = 'up', duration = 450, delay = 0, out = false } = params;
		const axis = dir === 'up' || dir === 'down' ? 'Y' : 'X';
		const magnitude = dir === 'up' || dir === 'left' ? -110 : 110;
		return {
			duration,
			delay,
			easing: out ? EASE_IN : EASE_OUT,
			css: (t: number) => `transform: translate${axis}(${(1 - t) * magnitude}%); will-change: transform;`
		};
	}
</script>

<div class="relative mx-auto w-full max-w-lg select-none h-full flex items-end" aria-hidden="true">

		<div class={`absolute right-0 top-0 h-[40%] w-[60%]`}>
			{#if phase === 'night'}
				<div
					class="h-full w-full"
					in:slide={{ dir: 'left', duration: 500 }}
					out:slide={{ dir: 'right', duration: 380, out: true }}
				>
					<DotLottieSvelte src="/sadballs.lottie" autoplay loop layout={{ fit: 'cover', align: [0.5, 0.5] }} />
				</div>
			{:else}
				<div
					class="h-full w-full"
					in:slide={{ dir: 'left', duration: 500, delay: 150 }}
					out:slide={{ dir: 'right', duration: 380, out: true }}
				>
					<DotLottieSvelte src="/smilingsun.lottie" autoplay loop layout={{ fit: 'contain', align: [0.5, 0.5] }} />
				</div>
			{/if}
		</div>
	<div class="relative aspect-[5/4] w-full overflow-hidden h-[65%]">
		<div class="absolute inset-0">
			{#if phase === 'night'}
				<div
					class="h-full w-full"
					in:slide={{ dir: 'up', duration: 500 }}
					out:slide={{ dir: 'down', duration: 380, out: true }}
				>
					<DotLottieSvelte src="/catsleeping.lottie" autoplay loop layout={{ fit: 'cover', align: [0.3,0.3] }} />
				</div>
			{:else}
				<div
					class="h-full w-full"
					in:slide={{ dir: 'up', duration: 500, delay: 150 }}
					out:slide={{ dir: 'down', duration: 380, out: true }}
				>
					<DotLottieSvelte src="/palmdancing.lottie" autoplay loop layout={{ fit: 'cover', align: [0.3,0.3] }} />
				</div>
			{/if}
			<div class="relative -mt-1 h-11 overflow-hidden">
		{#if phase === 'night'}
			<p
				class="absolute inset-0 px-4 text-center font-hand text-[26px] font-bold leading-tight text-brown"
				in:slide={{ dir: 'up', duration: 320, delay: 140 }}
				out:slide={{ dir: 'down', duration: 240, out: true }}
			>
				{caption}
			</p>
		{:else}
			<p
				class="absolute inset-0 px-4 text-center font-hand text-[26px] font-bold leading-tight text-brown"
				in:slide={{ dir: 'up', duration: 320, delay: 280 }}
				out:slide={{ dir: 'down', duration: 240, out: true }}
			>
				{caption}
			</p>
		{/if}
	</div>
		</div>
	</div>
</div>