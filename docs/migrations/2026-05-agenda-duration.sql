-- Agenda items get a duration_minutes column so the editor can cascade
-- time shifts when an item is added, lengthened, or shortened. Existing
-- rows backfill to 15 minutes (the median typical segment); hosts can
-- adjust per row.
--
-- Run once via the Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/moymqihzrcmxmqonpcov/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
--     -H "Content-Type: application/json" \
--     -d @docs/migrations/2026-05-agenda-duration.sql
--
-- Idempotent: safe to re-run.

alter table agenda_items
  add column if not exists duration_minutes int not null default 15;
