declare global {
	interface ImportMetaEnv {
		readonly VITE_SUPABASE_URL?: string;
		readonly VITE_SUPABASE_ANON_KEY?: string;
		readonly VITE_NIM_MODEL?: string;
	}
}

export {};
