-- Multi-prize raffle: one entry pool, many prizes, host picks which to draw.
-- Run once in the Supabase Dashboard → SQL Editor.
--
-- What this does:
--   1. Creates raffle_prizes table — one row per defined prize.
--   2. Adds raffle_entries.prize_id FK so a winner row points at WHICH prize.
--   3. Migrates any existing single-prize event into a raffle_prizes row
--      flagged as the grand prize, and back-links already-drawn winners.
--
-- Idempotent: safe to re-run. The columns/table use IF NOT EXISTS guards
-- and the migration inserts skip rows that already exist.

create table if not exists raffle_prizes (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  name            text not null,
  description     text,
  photo_url       text,
  display_order   int  not null default 0,
  is_grand        boolean not null default false,
  drawn_winner_id uuid references raffle_entries(id) on delete set null,
  drawn_at        timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_raffle_prizes_event on raffle_prizes(event_id);

-- Optional: enforce at most ONE grand prize per event. Uses a partial
-- unique index — multiple non-grand prizes per event are still allowed.
create unique index if not exists uniq_raffle_prizes_one_grand_per_event
  on raffle_prizes (event_id) where (is_grand = true);

alter table raffle_entries
  add column if not exists prize_id uuid references raffle_prizes(id) on delete set null;

-- One-time migration: turn each event's existing legacy single prize into
-- a raffle_prizes row marked as the grand prize. Skipped if the event
-- already has any raffle_prizes rows defined.
insert into raffle_prizes (event_id, name, photo_url, display_order, is_grand)
select e.id, e.raffle_prize, e.raffle_prize_photo_url, 0, true
from events e
where coalesce(e.raffle_prize, '') <> ''
  and not exists (select 1 from raffle_prizes p where p.event_id = e.id);

-- Back-link any pre-existing winners (drawn under the legacy single-prize
-- model) to the migrated grand-prize row, so they show up correctly in
-- the new prize ladder UI on the live dashboard.
update raffle_entries entry
set prize_id = p.id
from raffle_prizes p
where entry.event_id = p.event_id
  and entry.drawn = true
  and entry.prize_id is null
  and p.is_grand = true;

update raffle_prizes p
set drawn_winner_id = entry.id,
    drawn_at = entry.drawn_at
from raffle_entries entry
where entry.prize_id = p.id
  and entry.drawn = true
  and p.drawn_winner_id is null;
