<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import Mail from 'lucide-svelte/icons/mail';
	import KeyRound from 'lucide-svelte/icons/key-round';
	import ArrowRight from 'lucide-svelte/icons/arrow-right';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import MousePointerClick from 'lucide-svelte/icons/mouse-pointer-click';
	import { getSession, setSession, clearSession, isHosted, localEmailId } from '$lib/auth/session';
	import { sendOtp, verifyOtpEmail, consumeUrlToken, onAuthEvent, getSessionUser } from '$lib/auth/supabase';
	import { getStorage } from '$lib/storage';
	import { toast } from '$lib/stores/toast';

	let email = $state('');
	let code = $state('');
	let stage = $state<'email' | 'code'>('email');
	let busy = $state(false);
	let resendIn = $state(0);
	let finished = false;
	let resendTimer: ReturnType<typeof setInterval> | null = null;

	function clearResendTimer(): void {
		if (resendTimer) clearInterval(resendTimer);
		resendTimer = null;
	}

	onDestroy(clearResendTimer);

	onMount(() => {
		if (getSession()) {
			goto('/dashboard');
			return;
		}
		if (!isHosted()) return;

		const cleanup = onAuthEvent((_event, session) => {
			if (!session) return;
			// capture the user now, finish the login outside the callback. finishLogin reads the
			// profile, which reads the auth token, and calling back into the auth client from
			// inside onAuthStateChange can deadlock: the student then sits on this screen forever
			// with no error and no way forward.
			const { id, email: userEmail } = session.user;
			queueMicrotask(() => void finishLogin(id, userEmail ?? email));
		});

		void consumeUrlToken()
			.then(async (ok) => {
				if (!ok) return;
				const user = await getSessionUser();
				if (user) await finishLogin(user.id, user.email ?? email);
			})
			.catch(() => {
				// an expired or already-used link lands here. the student can still type a code
				toast('that link did not work. request a new one.', 'warn');
			});

		return cleanup;
	});

	async function finishLogin(userId: string, userEmail: string): Promise<void> {
		if (finished) return;
		finished = true;
		setSession({ userId, email: userEmail || email, mode: 'supabase' });
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
				stage = 'code';
				resendIn = 60;
				// tracked so it can be cleared on unmount. left running it kept ticking a counter
				// for a page nobody was looking at, and stacked a second one on every resend
				clearResendTimer();
				resendTimer = setInterval(() => {
					resendIn--;
					if (resendIn <= 0) clearResendTimer();
				}, 1000);
				toast('sent. check your inbox (and spam, honestly)');
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

<div class="min-h-[80vh] grid place-items-center px-4 py-10">
	<div class="w-full max-w-md space-y-6">
		<div class="text-center">
			<h1 class="font-display text-5xl tracking-tighter uppercase" style="text-shadow: 4px 4px 0 var(--color-pink), 8px 8px 0 var(--color-blue)">
				Welcome back?
			</h1>
			<p class="text-sm font-semibold text-mute mt-2">
				{#if isHosted()}
					one email, no passwords. tap the button in the email, or type the code if it shows one.
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
					placeholder="you@hostel.life"
					bind:value={email}
					onkeydown={(e) => e.key === 'Enter' && void start()}
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
		{:else}
			<div class="card p-5 space-y-4">
				<div class="flex items-center gap-2 text-sm font-bold text-mute">
					<MousePointerClick class="w-4 h-4 shrink-0" />
					<span class="leading-snug">the easiest way: open the email on this device and tap the button. this page catches you automatically.</span>
				</div>
				<div class="border-t-2 border-ink/10 pt-4 space-y-3">
					<label class="text-xs font-black uppercase tracking-widest text-brown flex items-center gap-1.5">
						<KeyRound class="w-3.5 h-3.5" /> or enter the code from your email, digits only
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
							{resendIn > 0 ? `resend in ${resendIn}s` : 'send it again'}
						</button>
						<button type="button" class="underline cursor-pointer" onclick={() => (stage = 'email')}>
							wrong email?
						</button>
					</div>
				</div>
			</div>
		{/if}

		<div class="text-center space-y-2">
			<button type="button" class="text-sm font-black text-brown underline cursor-pointer" onclick={goLocal}>
				or skip all this and use this browser directly
			</button>
			<p class="text-[11px] font-semibold text-mute leading-relaxed max-w-xs mx-auto">
				Mom.exe is a wellness coach, not medical advice. hosted mode sends anonymized context to an
				open-weight model; local mode keeps everything on your machine.
			</p>
		</div>
	</div>
</div>
