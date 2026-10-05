-- Mom.exe — chat sessions
--
-- One session per opening the app. The chat box starts empty on a new visit, and two chats on the
-- same afternoon are two conversations in the history rather than one long thread.
--
-- This divides the transcript, not her memory: the context engine still reads the last 20
-- messages across every session, so nothing is forgotten just because the app was closed.
--
-- Run this in the Supabase SQL editor (or `supabase db push`) after 0002_messages.sql.
--
-- Until this is applied, inserting a session_id fails and chat lines are dropped, so hosted chat
-- history is silently empty. That is the reason this file is worth keeping in the repo.

alter table messages add column if not exists session_id text;

-- the chat box reads one session at a time; history lists them newest first
create index if not exists idx_messages_user_session
	on messages (user_id, session_id, created_at desc);

-- Rows from before sessions existed keep a null session_id and are read as one conversation per
-- day, which is exactly how the history used to group them. No backfill: inventing session ids
-- for old rows would split conversations that were genuinely continuous.