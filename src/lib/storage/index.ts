import type { Storage } from './types';
import { LocalStorage } from './local';
import { SupabaseStorage } from './supabase';
import { getSession, isHosted } from '../auth/session';
import { getSupabase } from '../auth/supabase';

export function getStorage(): Storage {
	if (isHosted()) {
		const session = getSession();
		const client = getSupabase();
		if (session?.mode === 'supabase' && client) {
			return new SupabaseStorage(client);
		}
	}
	return new LocalStorage();
}