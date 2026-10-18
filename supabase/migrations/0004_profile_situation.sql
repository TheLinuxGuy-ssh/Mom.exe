-- Mom.exe — life situations
--
-- Widens the product from "mess and college students" to adulting in general. The profile gains a
-- `situation` — the persona picked at signup (hostel student, student in a flat, student at home,
-- office job, work from home, own schedule, between things). Onboarding wording and the advice
-- context both adapt to it; the `mess` and `class_start` columns keep their names and meaning.
--
-- Run this in the Supabase SQL editor (or `supabase db push`) after 0003_message_sessions.sql.
--
-- Every row stored before this migration was a mess-and-hostel user, so the default is chosen to
-- keep their plans byte-identical to what they had: no behaviour change for existing accounts.

alter table profiles
	add column if not exists situation text not null default 'student_hostel';

alter table profiles
	drop constraint if exists profiles_situation_check;

alter table profiles
	add constraint profiles_situation_check
	check (situation in (
		'student_hostel', 'student_flat', 'student_home',
		'work_office', 'work_remote',
		'own_gig', 'between_things'
	));
