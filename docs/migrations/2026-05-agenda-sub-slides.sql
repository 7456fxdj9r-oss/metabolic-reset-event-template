-- Sub-slides: child slides attached to an agenda item. Each agenda
-- item's projector slide can be followed by 1+ presenter-built content
-- slides (title + body + image, any subset). Lets the presenter add
-- supporting visuals — quote slides, infographics, study screenshots —
-- without inventing fake agenda items.
--
-- Display order is per-parent so sub-slides under one agenda item can
-- be dragged into the order the presenter wants them to appear.
--
-- Cascade on delete: dropping an agenda item drops its sub-slides too.
--
-- Run once via the Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/moymqihzrcmxmqonpcov/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
--     -H "Content-Type: application/json" \
--     -d @docs/migrations/2026-05-agenda-sub-slides.sql
--
-- Idempotent: safe to re-run.

create table if not exists agenda_slides (
  id              uuid primary key default gen_random_uuid(),
  agenda_item_id  uuid not null references agenda_items(id) on delete cascade,
  title           text not null,
  body            text,
  image_url       text,
  display_order   int  not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists idx_agenda_slides_item
  on agenda_slides(agenda_item_id, display_order);
