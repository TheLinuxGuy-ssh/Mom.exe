-- Mom.exe — conversation memory
--
-- Adds the long-term memory substrate: every note sent to mom plus every reply she gave, and a
-- weekly digest that stands in for messages too old to keep resending as raw context.
--
-- Run this in the Supabase SQL editor (or `supabase db push`) after the base schema.

-- conversation log: one row per message, both directions
create table if not exists messages (
	id uuid primary key default gen_random_uuid (),
	user_id uuid not null references auth.users (id) on delete cascade,
	local_date text not null,
	role text not null check (role in ('user', 'mom')),
	kind text not null check (kind in ('chat', 'note', 'replan')),
	content text not null,
	created_at timestamptz not null default now()
);

-- weekly digests: context compression for messages that aged out of the recent window
create table if not exists week_digests (
	id uuid primary key default gen_random_uuid (),
	user_id uuid not null references auth.users (id) on delete cascade,
	week_start text not null,
	content text not null,
	created_at timestamptz not null default now(),
	unique (user_id, week_start)
);

-- indexes
create index if not exists idx_messages_user_created on messages (user_id, created_at desc);
create index if not exists idx_week_digests_user_week on week_digests (user_id, week_start desc);

-- row level security
alter table messages enable row level security;
alter table week_digests enable row level security;

drop policy if exists "own messages" on messages;
drop policy if exists "own week digests" on week_digests;

create policy "own messages" on messages
	for all using (auth.uid () = user_id) with check (auth.uid () = user_id);
create policy "own week digests" on week_digests
	for all using (auth.uid () = user_id) with check (auth.uid () = user_id);
