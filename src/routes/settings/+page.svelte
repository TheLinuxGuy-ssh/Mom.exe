<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Download from 'lucide-svelte/icons/download';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Check from 'lucide-svelte/icons/check';
	import X from 'lucide-svelte/icons/x';
	import type { Profile } from '$lib/storage/types';
	import { getStorage } from '$lib/storage';
	import { getSession } from '$lib/auth/session';
	import { getLLMConfig, setLLMConfig, defaultLLMConfig, type LLMConfig } from '$lib/llm/config';
	import { testConnection } from '$lib/llm/client';
	import { getSessionUser } from '$lib/auth/supabase';
	import { toast } from '$lib/stores/toast';
	import GooeyToggle from '$lib/components/GooeyToggle.svelte';
	import { seedPersona, PERSONAS } from '../../../dev-fixtures/personas';

	let profile = $state<Profile | null>(null);
	let cfg = $state<LLMConfig>(defaultLLMConfig());
	let connState = $state<'unknown' | 'testing' | 'ok' | 'fail'>('unknown');
	let connDetail = $state('');
	let signedInSupabase = $state<boolean | null>(null);

	onMount(async () => {
		const session = getSession();
		if (!session) {
			goto('/login');
			return;
		}
		profile = await getStorage().getProfile(session.userId);
		cfg = getLLMConfig();
		const user = await getSessionUser();
		signedInSupabase = user !== null;
		if (session.mode === 'local') signedInSupabase = false;
	});

	async function saveProfile(): Promise<void> {
		const session = getSession();
		if (!session || !profile) return;
		const { id: _id, created_at: _c, ...input } = profile;
		await getStorage().saveProfile(session.userId, input);
		toast('profile saved');
	}

	function updateCfg<K extends keyof LLMConfig>(key: K, value: LLMConfig[K]): void {
		cfg = { ...cfg, [key]: value };
		setLLMConfig(cfg);
		connState = 'unknown';
		connDetail = '';
	}

	async function checkConn(): Promise<void> {
		connState = 'testing';
		connDetail = 'asking the server...';
		const token = cfg.mode === 'proxy' ? await getSessionUserToken() : undefined;
		const res = await testConnection(cfg, token ?? undefined);
		connState = res.ok ? 'ok' : 'fail';
		connDetail = res.detail;
	}

	async function getSessionUserToken(): Promise<string | null> {
		const supabase = (await import('$lib/auth/supabase')).getSupabase();
		if (!supabase) return null;
		const { data } = await supabase.auth.getSession();
		return data.session?.access_token ?? null;
	}

	function exportData(): void {
		const session = getSession();
		if (!session) return;
		void (async () => {
			const storage = getStorage();
			const data = {
				profile: await storage.getProfile(session.userId),
				checkins: await storage.listCheckins(session.userId, '1970-01-01'),
				plans: await storage.listPlans(session.userId, 1000)
			};
			const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = 'mom-exe-export.json';
			a.click();
			URL.revokeObjectURL(a.href);
		})();
	}

	async function deleteAll(): Promise<void> {
		const session = getSession();
		if (!session) return;
		await getStorage().deleteAll(session.userId);
		toast('wiped. fresh start.');
		goto('/onboarding');
	}

	async function loadPersona(key: string): Promise<void> {
		const session = getSession();
		if (!session) return;
		await seedPersona(getStorage(), session.userId, key);
		toast('demo data loaded, go ask for a plan');
		goto('/dashboard');
	}

	async function gotoOnboarding(): Promise<void> {
		goto('/onboarding');
	}
</script>

<svelte:head><title>Settings — Mom.exe</title></svelte:head>

<div class="w-[min(720px,calc(100%-1.5rem))] mx-auto py-6 space-y-5">
	<header class="flex items-center gap-3">
		<a href="/dashboard" class="btn !rounded-full p-2.5" title="back"><ArrowLeft class="w-4 h-4" /></a>
		<h1 class="font-display text-3xl uppercase tracking-tight">Kitchen settings</h1>
	</header>

	{#if profile}
		<section class="card p-5 space-y-4">
			<h2 class="font-black uppercase text-sm tracking-widest text-brown">profile</h2>
			<div class="grid grid-cols-2 gap-3">
				<label class="text-xs font-black uppercase tracking-widest text-brown space-y-1">name
					<input class="field" bind:value={profile.display_name} />
				</label>
				<label class="text-xs font-black uppercase tracking-widest text-brown space-y-1">timezone
					<input class="field" bind:value={profile.timezone} />
				</label>
				<label class="text-xs font-black uppercase tracking-widest text-brown space-y-1">target bed
					<input type="time" class="field" bind:value={profile.target_bed} />
				</label>
				<label class="text-xs font-black uppercase tracking-widest text-brown space-y-1">target wake
					<input type="time" class="field" bind:value={profile.target_wake} />
				</label>
				<label class="text-xs font-black uppercase tracking-widest text-brown space-y-1">class starts
					<input type="time" class="field" bind:value={profile.class_start} />
				</label>
				<label class="text-xs font-black uppercase tracking-widest text-brown space-y-1">caffeine
					<select class="field" bind:value={profile.caffeine}>
						<option value="none">nope</option>
						<option value="low">sometimes</option>
						<option value="high_late">yes, after 8pm</option>
					</select>
				</label>
			</div>
			<button type="button" class="btn !bg-lime !rounded-xl px-5 py-2 text-sm" onclick={() => void saveProfile()}>save profile</button>
			<button type="button" class="btn !rounded-xl px-5 py-2 text-sm ml-2" onclick={() => void gotoOnboarding()}>full setup again</button>
		</section>
	{:else}
		<p class="text-sm font-bold text-mute">loading profile...</p>
	{/if}

	<section class="card p-5 space-y-4">
		<div class="flex items-center justify-between">
			<h2 class="font-black uppercase text-sm tracking-widest text-brown">the brain (open weights)</h2>
			<div class="w-40 border-2 border-ink rounded-full overflow-hidden bg-paper">
				<GooeyToggle
					options={[
						{ value: 'proxy', label: 'hosted' },
						{ value: 'direct', label: 'local' }
					]}
					value={cfg.mode}
					onchange={(v) => updateCfg('mode', v as 'proxy' | 'direct')}
				/>
			</div>
		</div>
		<p class="text-xs font-semibold text-mute leading-relaxed">
			{#if cfg.mode === 'proxy'}
				hosted: anonymized context goes to the Supabase proxy, which forwards to an open-weight model on NVIDIA NIM. nothing identifying ever leaves.
			{:else}
				local: point at Ollama on this machine (start it with `OLLAMA_ORIGINS=* ollama serve`). nothing leaves this computer.
			{/if}
		</p>
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
			<label class="text-xs font-black uppercase tracking-widest text-brown space-y-1">base url
				<input class="field" value={cfg.url} oninput={(e) => updateCfg('url', e.currentTarget.value)} />
			</label>
			<label class="text-xs font-black uppercase tracking-widest text-brown space-y-1">model
				<input class="field" value={cfg.model} oninput={(e) => updateCfg('model', e.currentTarget.value)} />
			</label>
			{#if cfg.mode === 'direct'}
				<label class="text-xs font-black uppercase tracking-widest text-brown space-y-1">api key (optional)
					<input type="password" class="field" value={cfg.apiKey} oninput={(e) => updateCfg('apiKey', e.currentTarget.value)} />
				</label>
			{/if}
			<div class="flex items-end gap-2">
				<button type="button" class="btn !rounded-xl px-4 py-2 text-xs" onclick={() => void checkConn()}>check connection</button>
				{#if connState === 'testing'}<span class="text-xs font-bold text-mute">testing...</span>
				{:else if connState === 'ok'}<span class="chip !bg-lime !py-0.5"><Check class="w-3 h-3" /> reachable</span>
				{:else if connState === 'fail'}<span class="chip !bg-yellow !py-0.5"><X class="w-3 h-3" /> not reachable</span>
				{/if}
			</div>
		</div>
		{#if connDetail}
			<p class="text-xs font-semibold leading-relaxed {connState === 'ok' ? 'text-mute' : 'text-brown'}">{connDetail}</p>
		{/if}
		{#if cfg.mode === 'proxy' && signedInSupabase === false}
			<p class="text-xs font-bold text-brown leading-relaxed">
				you are in browser-local mode, so there is no account token for the hosted model to accept. hosted mode
				needs one sign-in: log out, then check in with email. want to stay local? point the base url at Ollama instead.
			</p>
		{/if}
		<p class="text-[11px] font-semibold text-mute">
			swapping models is a config change: try llama3.1:8b, qwen2.5:7b or mistral. same app, different brain.
		</p>
	</section>

	<section class="card p-5 space-y-4">
		<h2 class="font-black uppercase text-sm tracking-widest text-brown">demo data</h2>
		<div class="flex flex-wrap gap-2">
			{#each PERSONAS as p}
				<button type="button" class="btn !rounded-xl px-4 py-2 text-xs !bg-blue/40" onclick={() => void loadPersona(p.key)}>{p.label}</button>
			{/each}
		</div>
		<p class="text-[11px] font-semibold text-mute">overwrites this account's check-ins with synthetic histories for testing plan quality.</p>
	</section>

	<section class="card p-5 space-y-3">
		<h2 class="font-black uppercase text-sm tracking-widest text-brown">your data</h2>
		<div class="flex flex-wrap gap-2">
			<button type="button" class="btn !rounded-xl px-4 py-2 text-xs flex items-center gap-1.5" onclick={exportData}>
				<Download class="w-3.5 h-3.5" /> export json
			</button>
			<button type="button" class="btn !rounded-xl px-4 py-2 text-xs flex items-center gap-1.5 !bg-pink !text-paper" onclick={() => void deleteAll()}>
				<Trash2 class="w-3.5 h-3.5" /> wipe everything
			</button>
		</div>
	</section>

	<p class="text-[11px] font-semibold text-mute text-center leading-relaxed max-w-md mx-auto">
		Mom.exe is a wellness coach, not medical advice. hosted mode sends anonymized context (no name, email or
		birth date) to an open-weight model; local mode keeps everything on this machine. MIT licensed.
	</p>
</div>
