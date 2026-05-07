# Supabase setup

You'll do this once, then plug the URL + anon key into `.env`.

## 1. Create a Supabase project

1. Sign up at https://supabase.com (free tier).
2. Click **New Project**. Pick the closest region. Save the database password somewhere safe.
3. Wait ~2 min for provisioning.

## 2. Run the schema

Open **SQL Editor → New query**, paste this, run it:

```sql
-- ===== Tables =====

create table if not exists events (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  edit_token   text not null,
  name         text not null,
  host_line    text,
  accent_color text default '#f39c12',
  email        text,
  created_at   timestamptz default now()
);

create table if not exists transformations (
  id                     uuid primary key default gen_random_uuid(),
  event_id                 uuid not null references events(id) on delete cascade,
  slug                   text not null,
  name                   text not null,
  before_photo_url       text,
  after_photo_url        text,
  before_date            date,
  after_date             date,
  headline_lb_loss       numeric,
  headline_lean_kept_pct numeric,
  headline_bf_delta_pts  numeric,
  takeaway_text          text,
  display_order          int default 0,
  unique (event_id, slug)
);

create table if not exists data_points (
  id                uuid primary key default gen_random_uuid(),
  transformation_id uuid not null references transformations(id) on delete cascade,
  metric            text not null check (metric in ('weight','bf','lean')),
  date              date not null,
  value             numeric not null
);
create index if not exists data_points_lookup
  on data_points (transformation_id, metric, date);

-- ===== Row Level Security =====

alter table events            enable row level security;
alter table transformations enable row level security;
alter table data_points     enable row level security;

-- Public read of everything. Writes are blocked at the table level — only
-- the Edge Functions (running with the service-role key) can write, and
-- they verify the supplied edit_token before doing so.
create policy "public read events"
  on events for select using (true);

create policy "public read transformations"
  on transformations for select using (true);

create policy "public read data_points"
  on data_points for select using (true);
```

## 3. Create the Storage bucket (for photos)

1. **Storage → New bucket**, name `event-photos`, mark **Public**.
2. (Optional, recommended) add a per-object policy or rely on the photo-url
   pattern below to keep things simple. The Edge Functions upload using the
   service-role key, so no Storage RLS write policy is needed.

## 4. Deploy the Edge Functions

Install the Supabase CLI:

```bash
brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>
```

Create the `create-event` function:

```bash
supabase functions new create-event
```

Replace `supabase/functions/create-event/index.ts` with:

```ts
// Deno runtime — runs inside Supabase Edge.
// Generates a unique slug + secret edit_token, then inserts a event row.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (const b of arr) out += alphabet[b % alphabet.length];
  return out;
}

function slugify(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'event';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) {
    return new Response(JSON.stringify({ error: 'name is required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Try a few slug suffixes if the base is taken.
  const baseSlug = slugify(name);
  let slug = baseSlug;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: existing } = await supabase
      .from('events').select('id').eq('slug', slug).maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${randomToken(3).toLowerCase()}`;
  }

  const edit_token = randomToken(32);
  const { error } = await supabase.from('events').insert({
    slug,
    edit_token,
    name,
    host_line: body.host_line || null,
    accent_color: body.accent_color || '#f39c12',
    email: body.email || null,
  });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ slug, edit_token }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
```

Deploy:

```bash
supabase functions deploy create-event --no-verify-jwt
```

> `--no-verify-jwt` lets anonymous coaches call this function without a Supabase
> auth session. The function still validates inputs and uses service-role
> credentials internally.

## 5. Other Edge Functions (Phase 3)

The full v0.1 spec lists these. Stubs to add when you wire up the admin UI:

- `update-event` — verifies `edit_token` matches `events.edit_token`, updates fields
- `delete-event`
- `add-transformation`
- `update-transformation`
- `delete-transformation`
- `set-data-points` — replaces all data_points for a transformation
- `upload-photo` — accepts a base64 blob, writes to Storage, returns the public URL

Each one should:

1. Read `slug` + `edit_token` from the request body.
2. Look up the event by slug.
3. Compare `body.edit_token === event.edit_token` (constant-time compare ideally).
4. Reject 403 if mismatch.
5. Otherwise do the write with the service-role client.

## 6. Wire up the frontend

Copy `.env.example` to `.env` and fill in:

```
PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
PUBLIC_SUPABASE_ANON_KEY=<your anon key from Settings → API>
```

Then `npm run dev` and visit http://localhost:4321/build.
