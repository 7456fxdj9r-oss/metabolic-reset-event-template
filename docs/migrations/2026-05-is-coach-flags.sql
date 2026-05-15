-- "Is coach" toggles on speakers / hosts / master.
--
-- Faster path than the curated coaches table for the common case: a
-- speaker or host who's also a coach (most of them). Toggle on →
-- they appear on the /coaching/<slug> page. The curated coaches table
-- stays in place for the special cases: compound speakers split into
-- a solo coach (e.g., "Annie" pulled out of "Annie and David
-- Burgeson"), or people who aren't speakers or hosts at all.
--
-- Idempotent: safe to re-run.

alter table speakers
  add column if not exists is_coach boolean not null default false;

alter table hosts
  add column if not exists is_coach boolean not null default false;

alter table events
  add column if not exists organizer_is_coach boolean not null default false;
