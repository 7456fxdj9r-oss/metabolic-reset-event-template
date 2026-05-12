-- Co-host photos: add photo_url to hosts so co-hosts can have headshots
-- on the public "Connect with the hosts" page, matching speakers.
--
-- Run once via the Management API endpoint (faster than the dashboard):
--   curl -X POST "https://api.supabase.com/v1/projects/moymqihzrcmxmqonpcov/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
--     -H "Content-Type: application/json" \
--     -d @docs/migrations/2026-05-co-host-photos.sql
--
-- Idempotent: safe to re-run.

alter table hosts
  add column if not exists photo_url text;
