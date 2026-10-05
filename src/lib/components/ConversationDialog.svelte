<script lang="ts">
	import { fade } from 'svelte/transition';
	import { EASE_OUT } from '$lib/engine/easing';
	import Send from 'lucide-svelte/icons/send';
	import X from 'lucide-svelte/icons/x';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import type { Message, MessageRole } from '$lib/storage/types';
	import { chatReady } from '$lib/engine/prompt-rules';
	import { bubbleDelay, splitBubbles } from '$lib/engine/bubbles';

	let {
		open = false,
		messages = [],
		pending = null,
		busy = false,
		waited = 0,
		onsubmit,
		onclose
	}: {
		open?: boolean;
		messages?: Message[];
		/** the student's message, echoed while the model is still reading it */
		pending?: Message | null;
		busy?: boolean;
		waited?: number;
		onsubmit: (text: string) => Promise<boolean>;
		onclose: () => void;
	} = $props();

	let draft = $state('');
	let scroller = $state<HTMLElement | null>(null);

	/**
	 * Staggered delivery. A mother texts in beats, not paragraphs, so her reply arrives as a short
	 * burst with the typing dot showing in between. `deliveryId` is the message being revealed,
	 * `revealed` is how many of its bubbles are on screen, and it counts up on a timer.
	 */
	let deliveryId = $state<string | null>(null);
	let revealed = $state(0);
	let deliveryParts = $state<string[]>([]);

	function beginDelivery(id: string): void {
		const parts = splitBubbles(messages.find((m) => m.id === id)?.content ?? '');
		deliveryParts = parts;
		deliveryId = id;
		revealed = parts.length === 0 ? 0 : 1;
	}

	/** True while her reply is still arriving, so the student cannot talk over her. */
	const settling = $derived(deliveryId !== null && revealed < deliveryParts.length);

	/** What the student sees right now: every settled message, plus the part of the arriving one. */
	const rows = $derived.by(() => {
		const out: { key: string; role: Message['role']; text: string }[] = [];
		// Student rows are keyed by their words, not by message id. When the stored copy replaces
		// the echo the key is unchanged, so the bubble that is already on screen is reused instead
		// of animating in a second time. Repeats of the same words get a suffix so two identical
		// messages in a row still have distinct keys.
		const repeats = new Map<string, number>();
		for (const m of shown) {
			if (m.role === 'user') {
				const seen = (repeats.get(m.content) ?? 0) + 1;
				repeats.set(m.content, seen);
				out.push({
					key: seen === 1 ? `u:${m.content}` : `u:${m.content}#${seen}`,
					role: 'user',
					text: m.content
				});
				continue;
			}
			if (m.id === deliveryId) {
				for (const [i, part] of deliveryParts.slice(0, revealed).entries()) {
					out.push({ key: `${m.id}-${i}`, role: 'mom', text: part });
				}
			} else {
				for (const [i, part] of splitBubbles(m.content).entries()) {
					out.push({ key: `${m.id}-${i}`, role: 'mom', text: part });
				}
			}
		}
		return out;
	});

	// kick off a delivery whenever a new message of ours shows up
	$effect(() => {
		const latestMom = [...shown].reverse().find((m) => m.role === 'mom');
		if (!latestMom || latestMom.id === deliveryId) return;
		if (!busy && deliveryId !== null) {
			// settled: drop the stagger state entirely
			deliveryId = null;
			deliveryParts = [];
			revealed = 0;
		}
		if (busy) return;
		beginDelivery(latestMom.id);
	});

	// count the bubbles up while she is still talking
	$effect(() => {
		if (!deliveryId || revealed >= deliveryParts.length) return;
		const timer = setTimeout(() => (revealed += 1), bubbleDelay(revealed));
		return () => clearTimeout(timer);
	});


	/**
	 * The composer card and this dialog are meant to read as one object changing shape, so the
	 * entrance is a single combined lift-and-settle rather than two stacked transitions.
	 */
	/**
	 * Every bubble arrives rather than blinking into being: a short lift and settle, in the same
	 * easing as the dialog's own entrance so the conversation feels like one object filling up.
	 * Her replies slide a touch further than the student's, because hers is the one being waited on.
	 */
	function appear(node: HTMLElement, { role = 'mom', duration = 200 }: { role?: MessageRole; duration?: number } = {}) {
		const drop = role === 'mom' ? 10 : 6;
		return {
			duration,
			easing: EASE_OUT,
			css: (t: number) =>
				`opacity:${t};` +
				`transform:translateY(${(1 - t) * drop}px) scale(${0.96 + 0.04 * t});` +
				'will-change:transform,opacity;'
		};
	}

	function lift(node: HTMLElement, { duration = 240 }: { duration?: number } = {}) {
		return {
			duration,
			easing: EASE_OUT,
			css: (t: number) =>
				`opacity:${t};` +
				`transform:translateY(${(1 - t) * 28}px) scale(${0.965 + 0.035 * t});` +
				'will-change:transform,opacity;'
		};
	}

	/**
	 * The echo of a message that has not been written to storage yet. It retires itself the moment
	 * the stored copy shows up, matched on text and time so that sending "ok" twice in a row does
	 * not make the second one look like it was never said.
	 */
	const echoed = $derived.by(() => {
		if (!pending) return null;
		const stored = messages.some(
			(m) => m.role === 'user' && m.content === pending.content && m.created_at >= pending.created_at
		);
		return stored ? null : pending;
	});

	// storage hands back newest-first; a conversation reads top-to-bottom, so flip it and keep
	// the newest message at the bottom where the eye already is. The echo goes in front of the
	// list because it is the newest thing in the room.
	const shown = $derived(
		(echoed ? [echoed, ...messages] : messages)
			.filter((m) => m.kind === 'chat' || m.kind === 'note' || m.kind === 'replan')
			.slice()
			.reverse()
	);

	$effect(() => {
		if (open) scrollToEnd(true);
	});

	$effect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent): void => {
			// Escape is ignored while she is mid-reply. closing the dialog then left her bubbles to
			// arrive into a view nobody was looking at, and the student reopened the app to find a
			// conversation that appeared to have swallowed what they said
			if (e.key === 'Escape' && !busy && !settling) onclose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	function scrollToEnd(force = false): void {
		// wait for the new row to lay out before chasing it
		requestAnimationFrame(() => {
			if (!scroller) return;
			// never yank someone back down while they are reading further up. Their own message and
			// the beat of her reply they are waiting on are the exceptions: those are why they are here.
			if (!force && !nearBottom()) return;
			scroller.scrollTop = scroller.scrollHeight;
		});
	}

	function nearBottom(): boolean {
		if (!scroller) return true;
		return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
	}

	// every row that lands gets the eye: the echo, each beat of her reply, the typing bubble
	$effect(() => {
		void rows.length;
		void busy;
		if (open) scrollToEnd();
	});

	// a fresh sentence from them always brings the view back to them
	$effect(() => {
		void pending?.content;
		if (open && pending) scrollToEnd(true);
	});

	async function send(): Promise<void> {
		const text = draft.trim();
		// one letter is enough in a conversation, but blank and whitespace never are
		if (!chatReady(text) || busy) return;
		draft = '';
		const sent = await onsubmit(text);
		// the turn failed: the words come back. clearing the box up front and never restoring it
		// meant one dropped connection cost somebody what they had just typed
		if (!sent) draft = text;
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void send();
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
		transition:fade={{ duration: 160 }}
		onclick={(e) => {
			// clicking the empty space around the conversation is the way out
			if (e.target === e.currentTarget) onclose();
		}}
		role="presentation"
	>
		<div class="absolute inset-0 bg-ink/55" role="presentation"></div>

		<div
			class="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden border-2 border-ink bg-paper shadow-[8px_8px_0_var(--color-ink)] sm:rounded-2xl"
			transition:lift={{ duration: 240 }}
			role="dialog"
			aria-modal="true"
			aria-label="talking to mom"
		>
			<header class="flex items-center justify-between gap-3 border-b-2 border-ink px-4 py-3">
				<div class="flex items-center gap-2 text-brown">
					<span class="text-xs font-black uppercase tracking-[0.18em]">talking to mom</span>
				</div>
				<button
					type="button"
					class="btn !rounded-full p-2"
					title="close"
					aria-label="close conversation"
					onclick={onclose}
				>
					<X class="w-4 h-4" />
				</button>
			</header>

			<div bind:this={scroller} class="flex-1 space-y-3 overflow-y-auto px-4 py-4">
				{#if shown.length === 0}
					<p class="py-6 text-center text-sm font-semibold text-mute">
						tell her how the day is actually going.
					</p>
				{/if}

				{#each rows as r (r.key)}
					<div
						class="flex {r.role === 'mom' ? 'justify-start' : 'justify-end'}"
						in:appear={{ role: r.role }}
						out:fade={{ duration: 90 }}
					>
						<div
							class="max-w-[85%] px-3.5 py-2 text-[15px] leading-snug {r.role === 'mom'
								? 'sticky-note !text-[16px]'
								: 'border-2 border-ink bg-blue/40 font-semibold rounded-2xl rounded-br-sm'}"
						>
							{r.text}
						</div>
					</div>
				{/each}

				{#if busy || (deliveryId !== null && revealed < deliveryParts.length)}
					<div class="flex justify-start" in:appear={{ duration: 160 }}>
						<div class="flex items-center gap-2 border-2 border-ink bg-paper px-3.5 py-2 rounded-2xl rounded-bl-sm">
							<LoaderCircle class="w-4 h-4 animate-spin text-brown" />
							<span class="text-sm font-semibold text-mute"
								>{busy ? `reading it${waited > 2 ? `, ${waited}s` : ''}...` : 'typing...'}</span
							>
						</div>
					</div>
				{/if}
			</div>

			<footer class="border-t-2 border-ink p-3">
				<div class="flex items-end gap-2">
					<textarea
						class="field !min-h-[2.75rem] resize-none !font-hand !text-[19px] flex-1"
						rows="1"
						maxlength="500"
						placeholder="say it how you'd say it."
						bind:value={draft}
						onkeydown={onKeyDown}
					></textarea>
					<button
						type="button"
						class="btn !bg-orange !text-paper !rounded-full px-5 py-3 flex items-center gap-2 shrink-0"
						disabled={busy || settling || draft.trim().length === 0}
						aria-label="send to mom"
						onclick={() => void send()}
					>
						{#if busy}<LoaderCircle class="w-4 h-4 animate-spin" />{:else}<Send class="w-4 h-4" />{/if}
					</button>
				</div>
			</footer>
		</div>
	</div>
{/if}
