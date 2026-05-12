-- Organizer photo: brings the master organizer to parity with co-hosts
-- (which got photo_url today). Closes the lopsided look on /hosts where
-- co-hosts had photos but the master didn't.
--
-- The master's identity already lives in events.organizer_* columns;
-- this adds a matching photo_url to the same row.
--
-- Run once via the Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/moymqihzrcmxmqonpcov/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
--     -H "Content-Type: application/json" \
--     -d @docs/migrations/2026-05-organizer-photo.sql
--
-- Idempotent: safe to re-run.

alter table events
  add column if not exists organizer_photo_url text;
