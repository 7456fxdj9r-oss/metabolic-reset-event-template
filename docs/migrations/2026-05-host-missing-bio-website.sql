-- Catch-up migration: the bio + website columns were supposed to land
-- with commit f75543c ("Stories index + Hosts card restructure +
-- co-host bio/website") on 2026-05-11, but the ALTER was a manual step
-- noted in the commit message and never got applied to this project.
-- Surfaced today via "column hosts.bio does not exist" on /hosts.
--
-- Run once via the Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/moymqihzrcmxmqonpcov/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
--     -H "Content-Type: application/json" \
--     -d @docs/migrations/2026-05-host-missing-bio-website.sql
--
-- Idempotent: safe to re-run.

alter table hosts
  add column if not exists bio text,
  add column if not exists website text;
