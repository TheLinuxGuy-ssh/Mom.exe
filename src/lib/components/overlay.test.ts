import { describe, expect, it } from 'vitest';
import { isBackdropClick, shouldDismiss } from './overlay';

describe('telling a backdrop click from a panel click', () => {
	// Stubs rather than real nodes: this suite runs without a DOM and the function only compares
	// identity. `overlayRoot` stands for the element the click handler is attached to, which is what
	// `e.currentTarget` points at during a click.
	it('closes on a click on the empty space around the panel', () => {
		const backdrop = {} as unknown as EventTarget;
		expect(isBackdropClick(backdrop, backdrop)).toBe(true);
	});

	/**
	 * This is the bug, kept as a test.
	 *
	 * The dimmer is a child div covering the overlay's padded box, so clicking the dim reports the
	 * *dim* as the event target. The handler is on the overlay root, so comparing the target against
	 * the root — which is the obvious thing to write, and what this file originally asserted — never
	 * matches, and clicking outside a dialog silently did nothing. Every dismissal in the app was
	 * the Escape key or the Cancel button.
	 */
	it('compares against the dim, not against the element the handler sits on', () => {
		const overlayRoot = {} as unknown as EventTarget;
		const backdrop = {} as unknown as EventTarget;
		expect(isBackdropClick(backdrop, overlayRoot)).toBe(false);
		expect(isBackdropClick(backdrop, backdrop)).toBe(true);
	});

	it('does not close when the click landed inside the panel', () => {
		// pointer events bubble, so a click on a button inside the dialog arrives with that button
		// as its target. Closing here is the classic "I tried to select the text and lost my dialog"
		const backdrop = {} as unknown as EventTarget;
		const buttonInsideThePanel = {} as unknown as EventTarget;
		expect(isBackdropClick(buttonInsideThePanel, backdrop)).toBe(false);
	});

	it('does not close on a click that came from nowhere, or before it is mounted', () => {
		expect(isBackdropClick(null, {} as unknown as EventTarget)).toBe(false);
		expect(isBackdropClick({} as unknown as EventTarget, null)).toBe(false);
	});
});

describe('whether an overlay may be dismissed', () => {
	it('dismisses an open dialog that allows it', () => {
		expect(shouldDismiss({ open: true, dismissible: true })).toBe(true);
	});

	it('refuses while a dialog is mid-reply', () => {
		// closing the conversation then left her bubbles arriving into a closed view
		expect(shouldDismiss({ open: true, dismissible: false })).toBe(false);
	});

	it('refuses when it is not open, however it is called', () => {
		expect(shouldDismiss({ open: false, dismissible: true })).toBe(false);
		expect(shouldDismiss({ open: false, dismissible: false })).toBe(false);
	});
});