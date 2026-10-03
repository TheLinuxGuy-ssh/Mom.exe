import { writable } from 'svelte/store';

export interface ToastState {
	show: boolean;
	msg: string;
	kind: 'ok' | 'warn';
}

const store = writable<ToastState>({ show: false, msg: '', kind: 'ok' });

let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(msg: string, kind: 'ok' | 'warn' = 'ok'): void {
	store.set({ show: true, msg, kind });
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => store.set({ show: false, msg: '', kind: 'ok' }), 2600);
}

export const toastStore = store;
