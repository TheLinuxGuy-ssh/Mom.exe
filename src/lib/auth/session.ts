export interface Session {
	userId: string;
	email: string | null;
	mode: 'local' | 'supabase';
}

const LS_KEY = 'momexe:session';

export function getSession(): Session | null {
	try {
		const raw = localStorage.getItem(LS_KEY);
		if (raw) return JSON.parse(raw) as Session;
	} catch {
		return null;
	}
	return null;
}

export function setSession(s: Session): void {
	localStorage.setItem(LS_KEY, JSON.stringify(s));
}

export function clearSession(): void {
	localStorage.removeItem(LS_KEY);
}

export function isHosted(): boolean {
	return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export function localEmailId(email: string): string {
	const hash = Array.from(email).reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
	return 'local-' + hash.toString(36);
}
