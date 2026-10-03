import type { Storage } from './types';
import { LocalStorage } from './local';
import { SupabaseStorage } from './supabase';
import { getSession, isHosted } from '../auth/session';

export function getStorage(): Storage {
	if (isHosted()) {
		const session = getSession();
		if (session?.mode === 'supabase') {
			return new SupabaseStorage(
				import.meta.env.VITE_SUPABASE_URL as string,
				import.meta.env.VITE_SUPABASE_ANON_KEY as string
			);
		}
	}
	return new LocalStorage();
}
