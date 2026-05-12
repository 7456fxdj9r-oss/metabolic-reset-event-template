-- Host display_order: lets the master drag co-hosts into the desired
-- order on the /hosts page. Brings hosts to parity with speakers and
-- transformations.
--
-- Backfill: existing rows get sequential display_order based on
-- created_at so the initial visual order matches what was already shown.
--
-- Run once via the Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/moymqihzrcmxmqonpcov/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
--     -H "Content-Type: application/json" \
--     -d @docs/migrations/2026-05-host-display-order.sql
--
-- Idempotent: safe to re-run.

alter table hosts
  add column if not exists display_order int not null default 0;

-- Sequential backfill per event so the new ordering reflects current
-- creation order. Skipped on re-runs because we only touch rows whose
-- display_order is still the 0 default AND there are siblings to order.
with ranked as (
  select id,
         row_number() over (partition by event_id order by created_at) - 1 as rn,
         event_id
  from hosts
)
update hosts h
   set display_order = ranked.rn
  from ranked
 where h.id = ranked.id
   and h.display_order = 0
   and exists (
     select 1 from hosts sib
      where sib.event_id = h.event_id
        and sib.id <> h.id
   );
