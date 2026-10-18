-- Mom.exe — usage metering and abuse telemetry
--
-- Quarantine for the edge function's two new duties: bounding how much model an account may burn
-- (the `plan` function formerly forwarded unlimited calls, so one signed-in account could run the
-- provider key all day) and recording attempted misuse without ever storing raw note text.
--
-- Run this in the Supabase SQL editor (or `supabase db push`) after 0004_profile_situation.sql.
--
-- Inserts are service-role only: the edge function meters its own calls, and a client cannot
-- forge either table. Owners may read their own usage row so the app can show a gentle counter.

create table if not exists usage_events (
	id uuid primary key default gen_random_uuid (),
	user_id uuid not null references auth.users (id) on delete cascade,
	kind text not null check (kind in ('oneshot', 'classify', 'repair')),
	created_at timestamptz not null default now()
);

create index if not exists idx_usage_user_created
	on usage_events (user_id, created_at desc);

create table if not exists abuse_events (
	id uuid primary key default gen_random_uuid (),
	user_id uuid references auth.users (id) on delete cascade,
	verdict text not null check (verdict in ('off_domain', 'meta_probe', 'hard_injection', 'voice_leak')),
	-- a hashed prefix of the note, never the note itself: enough to correlate a repeat
	-- offender, not enough to read what they typed
	note_prefix_hash text,
	created_at timestamptz not null default now()
);

create index if not exists idx_abuse_user_created
	on abuse_events (user_id, created_at desc);

alter table usage_events enable row level security;
alter table abuse_events enable row level security;

drop policy if exists "own usage read" on usage_events;
drop policy if exists "own abuse read" on abuse_events;

create policy "own usage read" on usage_events
	for select using (auth.uid () = user_id);
create policy "own abuse read" on abuse_events
	for select using (auth.uid () = user_id);
