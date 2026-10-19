<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import Mail from 'lucide-svelte/icons/mail';
	import KeyRound from 'lucide-svelte/icons/key-round';
	import ArrowRight from 'lucide-svelte/icons/arrow-right';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import MousePointerClick from 'lucide-svelte/icons/mouse-pointer-click';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import { getSession, setSession, clearSession, isHosted, localEmailId } from '$lib/auth/session';
	import { sendOtp, verifyOtpEmail, consumeUrlToken, onAuthEvent, getSessionUser } from '$lib/auth/supabase';
	import { getStorage } from '$lib/storage';
	import { toast } from '$lib/stores/toast';

	let email = $state('');
	let code = $state('');
	// 'email' = waiting for user to enter email
	// 'sent' = magic link sent, waiting for user to click it (or code as fallback)
	// 'code' = user explicitly chose to enter a code instead
	let stage = $state<'email' | 'sent' | 'code'>('email');
	let busy = $state(false);
	let resendIn = $state(0);
	let finished = false;
	let resendTimer: ReturnType<typeof setInterval> | null = null;

	// Cross-tab sync: when another tab completes magic link login, this tab hears it and redirects
	const authChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mom-auth') : null;

	function clearResendTimer(): void {
		if (resendTimer) clearInterval(resendTimer);
		resendTimer = null;
	}

	onDestroy(() => {
		clearResendTimer();
		authChannel?.close();
	});

	onMount(() => {
		if (getSession()) {
			goto('/dashboard');
			return;
		}
		if (!isHosted()) return;

		const cleanup = onAuthEvent((_event, session) => {
			if (!session) return;
			const { id, email: userEmail } = session.user;
			queueMicrotask(() => void finishLogin(id, userEmail ?? email));
		});

		// Listen for cross-tab login completion
		if (authChannel) {
			authChannel.onmessage = (event) => {
				if (event.data === 'login-complete') {
					void consumeUrlToken().then(async (ok) => {
						if (ok) {
							const user = await getSessionUser();
							if (user) await finishLogin(user.id, user.email ?? email);
						}
					});
				}
			};
		}

		void consumeUrlToken()
			.then(async (ok) => {
				if (!ok) return;
				const user = await getSessionUser();
				if (user) await finishLogin(user.id, user.email ?? email);
			})
			.catch(() => {
				toast('that link did not work. request a new one.', 'warn');
			});

		return cleanup;
	});

	async function finishLogin(userId: string, userEmail: string): Promise<void> {
		if (finished) return;
		finished = true;
		setSession({ userId, email: userEmail || email, mode: 'supabase' });
		// Notify other tabs that login is complete
		authChannel?.postMessage('login-complete');
		try {
			const profile = await getStorage().getProfile(userId);
			await goto(profile ? '/dashboard' : '/onboarding');
		} catch {
			await goto('/onboarding');
		}
	}

	async function start(): Promise<void> {
		const trimmed = email.trim().toLowerCase();
		if (!trimmed.includes('@')) {
			toast('that email looks off', 'warn');
			return;
		}
		busy = true;
		try {
			if (isHosted()) {
				await sendOtp(trimmed);
				stage = 'sent';
				resendIn = 60;
				clearResendTimer();
				resendTimer = setInterval(() => {
					resendIn--;
					if (resendIn <= 0) clearResendTimer();
				}, 1000);
				toast('sent! check your inbox for a magic link');
			} else {
				setSession({ userId: localEmailId(trimmed), email: trimmed, mode: 'local' });
				goto('/onboarding');
			}
		} catch (e) {
			toast(e instanceof Error ? e.message : 'something went wrong', 'warn');
		} finally {
			busy = false;
		}
	}

	async function checkMagicLink(): Promise<void> {
		busy = true;
		try {
			const ok = await consumeUrlToken();
			if (ok) {
				const user = await getSessionUser();
				if (user) await finishLogin(user.id, user.email ?? email);
			} else {
				toast('no valid link found yet. check your inbox or try again.', 'warn');
			}
		} catch (e) {
			toast(e instanceof Error ? e.message : 'could not check', 'warn');
		} finally {
			busy = false;
		}
	}

	function switchToCodeEntry(): void {
		stage = 'code';
	}

	async function confirm(): Promise<void> {
		const token = code.replace(/\D/g, '');
		if (token.length < 6 || token.length > 10) {
			toast('codes are 6 to 10 digits', 'warn');
			return;
		}
		busy = true;
		try {
			const trimmed = email.trim().toLowerCase();
			const userId = await verifyOtpEmail(trimmed, token);
			await finishLogin(userId, trimmed);
		} catch (e) {
			toast(e instanceof Error ? e.message : 'wrong code?', 'warn');
		} finally {
			busy = false;
		}
	}

	function goLocal(): void {
		clearSession();
		setSession({ userId: 'local', email: null, mode: 'local' });
		goto('/onboarding');
	}
</script>

<svelte:head><title>Check in — Mom.exe</title></svelte:head>

<div class="min-h-[80dvh] grid place-items-center px-4 py-10">
	<div class="w-full max-w-md space-y-6">
		<div class="text-center">
			<h1 class="font-display text-4xl sm:text-5xl tracking-tighter uppercase" style="text-shadow: 4px 4px 0 var(--color-pink), 8px 8px 0 var(--color-blue)">
				Welcome back?
			</h1>
			<p class="text-sm font-semibold text-mute mt-2 sm:text-base">
				{#if isHosted()}
					one email, no passwords. we'll send a magic link to sign you in.
				{:else}
					demo mode: your data stays in this browser. no email sent, promise.
				{/if}
			</p>
		</div>

		{#if stage === 'email'}
			<div class="card p-5 space-y-3">
				<label class="text-xs font-black uppercase tracking-widest text-brown flex items-center gap-1.5">
					<Mail class="w-3.5 h-3.5" /> email
				</label>
				<input
					type="email"
					class="field"
					placeholder="you@adulting.life"
					bind:value={email}
					onkeydown={(e) => e.key === 'Enter' && void start()}
					autocomplete="email"
				/>
				<button
					type="button"
					class="btn !bg-orange !text-paper !rounded-xl w-full py-3 text-sm font-black uppercase flex items-center justify-center gap-2"
					disabled={busy}
					onclick={() => void start()}
				>
					{#if busy}<LoaderCircle class="w-4 h-4 animate-spin" />{/if}
					Check in
					<ArrowRight class="w-4 h-4" />
				</button>
			</div>

		{:else if stage === 'sent'}
			<div class="card p-5 space-y-4">
				<div class="flex items-center gap-2 text-sm font-bold text-mute">
					<MousePointerClick class="w-4 h-4 shrink-0" />
					<span class="leading-snug">we sent a magic link to <strong>{email}</strong>. tap it in your email and you'll be signed in automatically.</span>
				</div>
				<div class="border-t-2 border-ink/10 pt-4 space-y-3">
					<button
						type="button"
						class="btn !rounded-xl w-full py-3 text-sm font-black uppercase flex items-center justify-center gap-2"
						disabled={busy}
						onclick={checkMagicLink}
					>
						{#if busy}<LoaderCircle class="w-4 h-4 animate-spin" />{/if}
						<RefreshCw class="w-4 h-4" /> i clicked the link, check now
					</button>
					<button
						type="button"
						class="btn !rounded-xl w-full py-3 text-sm font-black uppercase flex items-center justify-center gap-2"
						onclick={switchToCodeEntry}
					>
						<KeyRound class="w-4 h-4" /> didn't get the link? enter a code instead
					</button>
					<div class="flex items-center justify-between text-xs font-bold text-mute">
						<button
							type="button"
							class="underline cursor-pointer disabled:opacity-50 disabled:no-underline"
							disabled={resendIn > 0 || busy}
							onclick={() => void start()}
						>
							{resendIn > 0 ? `resend in ${resendIn}s` : 'send link again'}
						</button>
						<button type="button" class="underline cursor-pointer" onclick={() => (stage = 'email')}>
							wrong email?
						</button>
					</div>
				</div>
			</div>

		{:else}
			<div class="card p-5 space-y-4">
				<div class="flex items-center gap-2 text-sm font-bold text-mute">
					<KeyRound class="w-4 h-4 shrink-0" />
					<span class="leading-snug">enter the 6-digit code from your email.</span>
				</div>
				<div class="border-t-2 border-ink/10 pt-4 space-y-3">
					<label class="text-xs font-black uppercase tracking-widest text-brown flex items-center gap-1.5">
						<KeyRound class="w-3.5 h-3.5" /> code
					</label>
					<input
						type="text"
						inputmode="numeric"
						autocomplete="one-time-code"
						maxlength="10"
						pattern="[0-9]*"
						class="field text-center text-xl tracking-[0.4em]"
						placeholder="_ _ _ _ _ _"
						bind:value={code}
						oninput={(e) => (code = e.currentTarget.value.replace(/\D/g, '').slice(0, 10))}
						onkeydown={(e) => e.key === 'Enter' && void confirm()}
					/>
					<button
						type="button"
						class="btn !bg-lime !rounded-xl w-full py-3 text-sm font-black uppercase flex items-center justify-center gap-2"
						disabled={busy}
						onclick={() => void confirm()}
					>
						{#if busy}<LoaderCircle class="w-4 h-4 animate-spin" />{/if}
						Enter
					</button>
					<div class="flex items-center justify-between text-xs font-bold text-mute">
						<button
							type="button"
							class="underline cursor-pointer disabled:opacity-50 disabled:no-underline"
							disabled={resendIn > 0 || busy}
							onclick={() => void start()}
						>
							{resendIn > 0 ? `resend in ${resendIn}s` : 'send new code'}
						</button>
						<button type="button" class="underline cursor-pointer" onclick={() => (stage = 'sent')}>
							back to magic link
						</button>
					</div>
				</div>
			</div>
		{/if}

		<div class="text-center space-y-2">
			<!-- <button type="button" class="text-sm font-black text-brown underline cursor-pointer" onclick={goLocal}>
				or skip all this and use this browser directly
			</button> -->
			<p class="text-[11px] font-semibold text-mute leading-relaxed max-w-xs mx-auto">
				Mom.exe is a wellness coach, not medical advice. hosted mode sends anonymized context to an
				open-weight model; local mode keeps everything on your machine.
			</p>
		</div>
	</div>
</div>
