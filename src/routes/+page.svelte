<script lang="ts">
	import { goto } from '$app/navigation';
	import ArrowRight from 'lucide-svelte/icons/arrow-right';
	import Github from 'lucide-svelte/icons/github';
	import LandingScene from '$lib/components/LandingScene.svelte';
	import Marquee from '$lib/components/Marquee.svelte';
	import { getSession } from '$lib/auth/session';

	const REPO_URL = 'https://github.com/yourname/mom-exe';
</script>

<svelte:head>
	<title>Mom.exe — your mom, but as an executable</title>
</svelte:head>

<div class="blob blob-one" aria-hidden="true"></div>
<div class="blob blob-two" aria-hidden="true"></div>

<header class="w-[min(1180px,calc(100%-2rem))] mx-auto flex items-center justify-between py-5">
	<span class="btn !rounded-full px-4 py-2 font-display text-sm tracking-tight uppercase select-none">Mom.exe</span>
	<a href={REPO_URL} target="_blank" rel="noreferrer" class="btn !rounded-full px-4 py-2 text-xs flex items-center gap-2">
		<Github class="w-4 h-4" /> Code
	</a>
</header>

<section class="w-[min(1180px,calc(100%-2rem))] mx-auto grid lg:grid-cols-[1.05fr_0.95fr] gap-10 items-center pt-6 lg:min-h-[70vh]">
	<div class="pb-14">
		<p class="text-[0.78rem] font-black uppercase tracking-[0.18em] text-brown mb-3">for everyone who</p>
		<h1 class="font-display uppercase leading-[0.88] tracking-tighter max-w-[9ch] text-[clamp(3.5rem,13vw,10rem)]"
			style="text-shadow: 5px 5px 0 var(--color-pink), 10px 10px 0 var(--color-blue)">
			Moved out
		</h1>
		<p class="max-w-[42rem] mt-6 text-[clamp(1.05rem,2vw,1.3rem)] leading-relaxed text-mute font-medium">
			Your mom, but as an executable. Mom.exe looks at your real classes, mess timings, deadlines and sleep,
			and plans the rest of your day and tonight. It works even if you never check in.
		</p>

		<div class="flex flex-wrap items-center gap-4 mt-8">
			<button
				type="button"
				class="btn !bg-lime !rounded-full px-7 py-4 text-sm font-black uppercase tracking-wide flex items-center gap-2"
				onclick={() => goto(getSession() ? '/dashboard' : '/login')}
			>
				Check in with Mom <ArrowRight class="w-4 h-4" />
			</button>
			<span class="text-sm font-black text-brown">no login needed in local mode</span>
		</div>

		<div class="flex flex-wrap gap-2 mt-6 text-[11px] font-extrabold uppercase tracking-wide text-ink/70">
			<span class="chip !shadow-[3px_3px_0_var(--color-ink)] !py-1">no streaks</span>
			<span class="chip !shadow-[3px_3px_0_var(--color-ink)] !py-1">no guilt</span>
			<span class="chip !shadow-[3px_3px_0_var(--color-ink)] !py-1">open weights</span>
			<a href={REPO_URL} target="_blank" rel="noreferrer" class="chip !shadow-[3px_3px_0_var(--color-ink)] !py-1 !bg-blue/50 cursor-pointer">local mode</a>
		</div>
	</div>

	<div class="grid place-items-center min-h-[24rem] h-full">
		<LandingScene />
	</div>
</section>

<Marquee items={[
	'eat something',
	'sleep by 23:30',
	'call home sometimes',
	'no streaks, promise',
	'mess closes at 9:30',
	'beta, log it'
]} />

<footer class="w-[min(1180px,calc(100%-2rem))] mx-auto py-5 flex flex-wrap gap-x-6 gap-y-1 text-xs font-bold text-ink/60">
	<span>wellness coach, not medical advice</span>
	<span>MIT licensed, open weights at the core</span>
	<span>built for a friend, for the Hacktoberfest Weekend Challenge</span>
</footer>
