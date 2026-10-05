<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Download from 'lucide-svelte/icons/download';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import type { Profile } from '$lib/storage/types';
	import { getStorage } from '$lib/storage';
	import { isValidTimezone } from '$lib/engine/time';
	import { getSession } from '$lib/auth/session';
	import { toast } from '$lib/stores/toast';
	import { seedPersona, PERSONAS } from '../../../dev-fixtures/personas';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

	let profile = $state<Profile | null>(null);

	// destructive actions need an explicit go-ahead, and must not be re-enterable while running
	let seeding = $state<string | null>(null);
	let wiping = $state(false);
	let saving = $state(false);
	let exporting = $state(false);
	let askSeed = $state<string | null>(null);
	let askWipe = $state(false);
	let busy = $derived(seeding !== null || wiping || saving);
	const busyReason = $derived(seeding !== null ? 'demo data' : wiping ? 'wipe' : null);

	onMount(async () => {
		const session = getSession();
		if (!session) {
			goto('/login');
			return;
		}
		profile = await getStorage()
			.getProfile(session.userId)
			.catch(() => null);
		if (!profile) toast('could not load your profile. check your connection.', 'warn');
	});

	async function saveProfile(): Promise<void> {
		const session = getSession();
		if (!session || !profile || saving) return;
		// every date in the app is formatted through this string, so a typo here would throw inside
		// the next dashboard refresh and take the whole page down. refuse it here, where it is fixable
		if (!isValidTimezone(profile.timezone)) {
			toast(`"${profile.timezone}" is not a timezone. try Asia/Kolkata.`, 'warn');
			return;
		}
		saving = true;
		try {
			const { id: _id, created_at: _c, ...input } = profile;
			await getStorage().saveProfile(session.userId, input);
			toast('profile saved');
		} catch (err) {
			console.error(err);
			toast('could not save. try again.', 'warn');
		} finally {
			saving = false;
		}
	}

	async function exportData(): Promise<void> {
		const session = getSession();
		if (!session || exporting) return;
		exporting = true;
		try {
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
			toast('exported');
		} catch (err) {
			// previously this ran fire and forget, so a rejected read was an unhandled rejection and
			// the button silently did nothing at all
			console.error(err);
			toast('export failed. try again.', 'warn');
		} finally {
			exporting = false;
		}
	}

	async function deleteAll(): Promise<void> {
		const session = getSession();
		if (!session || busy) return;
		wiping = true;
		try {
			await getStorage().deleteAll(session.userId);
			toast('wiped. fresh start.');
			await goto('/onboarding');
		} catch (err) {
			console.error(err);
			toast('wipe failed, nothing changed');
			wiping = false;
		}
	}

	async function loadPersona(key: string): Promise<void> {
		const session = getSession();
		if (!session || busy) return;
		seeding = key;
		try {
			await seedPersona(getStorage(), session.userId, key);
			toast('synthetic history loaded. write her a note to see what she plans.');
			askSeed = null;
			await goto('/dashboard');
		} catch (err) {
			console.error(err);
			toast('could not load demo data');
			seeding = null;
		}
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
			<button type="button" class="btn !bg-lime !rounded-xl px-5 py-2 text-sm" onclick={() => void saveProfile()} disabled={saving}>
				{saving ? 'saving...' : 'save profile'}
			</button>
			<button type="button" class="btn !rounded-xl px-5 py-2 text-sm ml-2" onclick={() => void gotoOnboarding()}>full setup again</button>
		</section>
	{:else}
		<p class="text-sm font-bold text-mute">loading profile...</p>
	{/if}

	<section class="card p-5 space-y-4">
		<div class="flex items-center justify-between gap-3">
			<h2 class="font-black uppercase text-sm tracking-widest text-brown">demo data</h2>
			{#if busyReason}
				<span class="chip !bg-yellow !py-1 !text-xs">working: {busyReason}...</span>
			{/if}
		</div>
		<div class="flex flex-wrap gap-2">
			{#each PERSONAS as p}
				<button
					type="button"
					class="btn !rounded-xl px-4 py-2 text-xs !bg-blue/40"
					disabled={busy}
					onclick={() => (askSeed = p.key)}
				>
					{p.label}
				</button>
			{/each}
		</div>
		<p class="text-[11px] font-semibold text-mute">
			These are made-up students, not anyone you know: loading one replaces this account's
			check-ins with a synthetic history, so you can judge the plans she writes without typing
			out a week of your own. Everything after that — your notes, her replies — is yours.
		</p>
	</section>

	<section class="card p-5 space-y-3">
		<h2 class="font-black uppercase text-sm tracking-widest text-brown">your data</h2>
		<div class="flex flex-wrap gap-2">
			<button type="button" class="btn !rounded-xl px-4 py-2 text-xs flex items-center gap-1.5" onclick={exportData} disabled={exporting}>
				<Download class="w-3.5 h-3.5" /> export json
			</button>
			<button
				type="button"
				class="btn !rounded-xl px-4 py-2 text-xs flex items-center gap-1.5 !bg-pink !text-paper"
				disabled={busy}
				onclick={() => (askWipe = true)}
			>
				<Trash2 class="w-3.5 h-3.5" /> wipe everything
			</button>
		</div>
	</section>

	<p class="text-[11px] font-semibold text-mute text-center leading-relaxed max-w-md mx-auto">
		Mom.exe is a wellness coach, not medical advice. anonymized context (no name, email or birth date) is
		sent to an open-weight model. MIT licensed.
	</p>
</div>

<!--
	Mounted at the top level of the page rather than inside the container above. Nested one level
	deep, this dimmer was cut off partway down the screen. They render nothing while closed, so
	sitting them out here costs nothing and keeps every dialog in the app on the same footing.
-->
<ConfirmDialog
	open={askSeed !== null}
	title="overwrite your data?"
	confirmLabel="overwrite"
	busy={seeding !== null}
	onconfirm={() => {
		if (askSeed !== null) void loadPersona(askSeed);
	}}
	oncancel={() => (askSeed = null)}
>
	Loading <strong>{PERSONAS.find((p) => p.key === askSeed)?.label ?? 'this persona'}</strong> replaces this
	account's check-ins and profile with synthetic demo history. Anything you tracked here is
	gone for good.
</ConfirmDialog>

<ConfirmDialog
	open={askWipe}
	title="wipe everything?"
	tone="danger"
	confirmLabel="wipe it all"
	busy={wiping}
	onconfirm={() => void deleteAll()}
	oncancel={() => (askWipe = false)}
>
	This deletes every check-in and plan on this account and sends you back to setup. There is no
	undo, so export your data first if you want a copy.
</ConfirmDialog>
