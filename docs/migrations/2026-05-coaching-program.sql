-- Coaching Program: a new public-facing page (button on /event/) where
-- attendees can read the host's coaching pitch + tap one of the coaches
-- (any speaker, co-host, or the master organizer) to text / email /
-- visit their website. Three columns on events: a title, body copy, and
-- an optional graphic. Coaches themselves come from existing speakers +
-- hosts tables, so no separate "coaches" model.
--
-- Title defaults to the canonical name so the editor form is pre-filled
-- the moment the host opens the new card.
--
-- Run once via the Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/moymqihzrcmxmqonpcov/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
--     -H "Content-Type: application/json" \
--     -d @docs/migrations/2026-05-coaching-program.sql
--
-- Idempotent: safe to re-run.

alter table events
  add column if not exists coaching_title text not null default 'Metabolic Coaching Program',
  add column if not exists coaching_body text,
  add column if not exists coaching_image_url text;
