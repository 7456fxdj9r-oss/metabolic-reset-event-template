-- Coaches: a curated, per-event list of people who appear on the
-- /coaching/<slug> page. Independent from speakers and hosts so that
-- compound speaker entries like "Annie and David Burgeson" can become
-- a single solo coach entry ("Annie Burgeson") without affecting the
-- slide deck or the speakers page, and so that hosts who happen to be
-- speaking with someone else don't get auto-duplicated. Editor seeds
-- this via the Coaching Program card (with one-click "quick add from
-- speaker/host" buttons) and from there it's full CRUD.
--
-- Idempotent: safe to re-run.

create table if not exists coaches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  photo_url text,
  bio text,
  phone text,
  email text,
  website text,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coaches_event_id_order_idx
  on coaches (event_id, display_order, created_at);

-- The coaching page hits this table via REST with the anon key, so it
-- needs row-level read access. Writes always go through edge functions
-- (manage-coaches) with the service role, so no insert/update/delete
-- policy is necessary.
alter table coaches enable row level security;

drop policy if exists "coaches public read" on coaches;
create policy "coaches public read" on coaches
  for select using (true);
