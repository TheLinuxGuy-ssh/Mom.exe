import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activeScrollLocks, lockScroll, resetScrollLockForTests } from './scroll-lock';

/**
 * Stands in for the browser. This project runs its suite without a DOM environment on purpose —
 * `engine/` and `llm/` import no Svelte and no browser globals — so rather than adding jsdom for one
 * module, the few DOM reads this file makes are stubbed here. The logic under test is the lock
 * counting and the restore, neither of which needs real layout.
 */
function installDom(options: { scrollbar?: number } = {}): void {
	const gap = options.scrollbar ?? 0;
	// pre-set to '' because a real CSSStyleDeclaration returns '' for an unset property, and a bare
	// object would return undefined and quietly disagree with every browser
	const style: Record<string, string> = { overflow: '', paddingRight: '' };
	(globalThis as Record<string, unknown>)['document'] = {
		documentElement: { style, clientWidth: 1000 - gap }
	};
	(globalThis as Record<string, unknown>)['window'] = { innerWidth: 1000 };
}

function el(): { style: Record<string, string> } {
	return (globalThis as unknown as { document: { documentElement: { style: Record<string, string> } } }).document
		.documentElement;
}

function uninstallDom(): void {
	delete (globalThis as Record<string, unknown>)['document'];
	delete (globalThis as Record<string, unknown>)['window'];
}

beforeEach(() => {
	resetScrollLockForTests();
	installDom();
});

afterEach(() => {
	resetScrollLockForTests();
	uninstallDom();
});

describe('locking scroll behind a dialog', () => {
	it('stops the page behind the dialog from scrolling', () => {
		const release = lockScroll();
		expect(el().style.overflow).toBe('hidden');
		release();
	});

	it('gives back the width of the scrollbar it removed', () => {
		// without this the whole page jumps sideways by the scrollbar width when a dialog opens
		installDom({ scrollbar: 15 });
		const release = lockScroll();
		expect(el().style.paddingRight).toBe('15px');
		release();
	});

	it('adds no padding when the platform has no scrollbar to remove', () => {
		installDom({ scrollbar: 0 });
		const release = lockScroll();
		expect(el().style.paddingRight).toBe('');
		release();
	});

	it('restores whatever was there before, not a blank value', () => {
		// a dialog opening over a page that legitimately set its own overflow must not wipe it
		el().style.overflow = 'auto';
		el().style.paddingRight = '4px';
		const release = lockScroll();
		expect(el().style.overflow).toBe('hidden');
		release();
		expect(el().style.overflow).toBe('auto');
		expect(el().style.paddingRight).toBe('4px');
	});
});

describe('overlapping dialogs', () => {
	it('stays locked until the last one closes', () => {
		// the dashboard can hold the conversation open with the sign-out confirmation on top of it.
		// a plain flag let the first to close unlock the page while the other was still up.
		const releaseChat = lockScroll();
		const releaseConfirm = lockScroll();
		releaseChat();
		expect(el().style.overflow).toBe('hidden');
		expect(activeScrollLocks()).toBe(1);
		releaseConfirm();
		expect(el().style.overflow).toBe('');
		expect(activeScrollLocks()).toBe(0);
	});

	it('counts only the outermost lock for the padding, so widths never add up', () => {
		installDom({ scrollbar: 15 });
		const a = lockScroll();
		const b = lockScroll();
		lockScroll();
		expect(el().style.paddingRight).toBe('15px');
		a();
		b();
		expect(el().style.paddingRight).toBe('15px');
	});

	it('ignores a release called twice', () => {
		// an effect can be torn down twice in some component lifecycles, and an early second release
		// would drop the count below the number of dialogs actually open
		const a = lockScroll();
		const b = lockScroll();
		a();
		a();
		expect(activeScrollLocks()).toBe(1);
		expect(el().style.overflow).toBe('hidden');
		b();
		expect(activeScrollLocks()).toBe(0);
	});
});

describe('when there is no page to lock', () => {
	it('does nothing during server rendering', () => {
		uninstallDom();
		const release = lockScroll();
		expect(activeScrollLocks()).toBe(0);
		expect(() => release()).not.toThrow();
	});
});