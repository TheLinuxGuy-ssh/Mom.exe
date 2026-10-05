/**
 * Stops the page behind a dialog from scrolling, and puts the scrollbar's width back afterwards.
 *
 * Two details make this less trivial than setting `overflow: hidden`.
 *
 * The scrollbar. Hiding overflow on a desktop browser removes the scrollbar, and the content
 * underneath jumps sideways by its width — which reads to the student as the whole page shifting
 * when a dialog opens. Compensating with padding-right keeps everything where it was.
 *
 * The count. The dashboard can have the conversation open *and* the sign-out confirmation on top
 * of it. A plain boolean would let whichever dialog closed first unlock the page while the other
 * was still up, so the background would scroll away underneath an open dialog. Counting the locks
 * means the last release is the one that unlocks.
 */

let locks = 0;
let savedPaddingRight = '';
let savedOverflow = '';

/** How wide the scrollbar is, so removing it can be made up. Zero on overlay-scrollbar platforms. */
function scrollbarWidth(): number {
	if (typeof window === 'undefined') return 0;
	return window.innerWidth - document.documentElement.clientWidth;
}

/**
 * Lock scrolling. Call the returned function to release; it is safe to call more than once, so it
 * drops straight into a Svelte `$effect` as its cleanup.
 */
export function lockScroll(): () => void {
	if (typeof document === 'undefined') return () => undefined;

	locks += 1;
	// only the first lock touches the DOM, so nested dialogs cannot capture a blank baseline and
	// then restore it over the top of somebody else's value
	if (locks === 1) {
		const el = document.documentElement;
		// `?? ''` rather than trusting the read. A CSSStyleDeclaration returns '' for an unset
		// property, but assigning undefined back into one coerces to the string "undefined", which is
		// an invalid value and would be silently ignored — leaving overflow hidden with no way out.
		savedPaddingRight = el.style.paddingRight ?? '';
		savedOverflow = el.style.overflow ?? '';
		const gap = scrollbarWidth();
		if (gap > 0) el.style.paddingRight = `${gap}px`;
		el.style.overflow = 'hidden';
	}

	let released = false;
	return () => {
		// an effect can be torn down twice in some component lifecycles, and an early unlock here
		// would drop the count below the number of dialogs actually open
		if (released) return;
		released = true;
		locks = Math.max(0, locks - 1);
		if (locks > 0) return;
		const el = document.documentElement;
		el.style.paddingRight = savedPaddingRight;
		el.style.overflow = savedOverflow;
		savedPaddingRight = '';
		savedOverflow = '';
	};
}

/** How many locks are held. Exported for tests, which need to observe the count directly. */
export function activeScrollLocks(): number {
	return locks;
}

/** Force the lock state clear. Only for tests, so one failing case cannot poison the next. */
export function resetScrollLockForTests(): void {
	locks = 0;
	savedPaddingRight = '';
	savedOverflow = '';
	if (typeof document !== 'undefined') {
		document.documentElement.style.paddingRight = '';
		document.documentElement.style.overflow = '';
	}
}