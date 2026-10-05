/**
 * The two decisions an overlay makes that are worth testing on their own.
 *
 * Both live here rather than inline in `Modal.svelte` because a Svelte component cannot be unit
 * tested in this project — the suite deliberately runs without a DOM — and these are exactly the
 * branches where being wrong is user-visible. Clicking the panel must not close a dialog, and a
 * dialog that is mid-reply must refuse to be dismissed.
 */

/**
 * Whether a click landed on the backdrop rather than on the panel.
 *
 * The comparison is against the backdrop element specifically, and that detail is the whole reason
 * click-to-dismiss worked. The dimmer is a child div covering the overlay's padded box, so a click on
 * the empty space around the panel reports the *backdrop* as its target. Comparing that against the
 * overlay root — which is where the handler lives, and which `e.currentTarget` points at — never
 * matches, and clicking the dim did nothing.
 *
 * The panel is a sibling of the backdrop rather than a descendant, so this stays false for a click on
 * the panel and for a click on any control inside it, which is what stops a dialog from vanishing
 * the moment you touch anything in it.
 */
export function isBackdropClick(target: EventTarget | null, backdrop: EventTarget | null): boolean {
	return target !== null && backdrop !== null && target === backdrop;
}

/**
 * Whether the overlay should render and respond to a request to close.
 *
 * `dismissible` exists because one dialog here refuses to be dismissed while she is mid-reply.
 * Closing then left her bubbles arriving into a view nobody was looking at, and the student came
 * back to a conversation that looked like it had swallowed what they said. The rule lives in one
 * tested place so the refusal cannot be forgotten when a dialog is wired up.
 */
export function shouldDismiss(input: { open: boolean; dismissible: boolean }): boolean {
	return input.open && input.dismissible;
}