// Public read of the team for an event: the primary organizer (from
// events.organizer_*) plus every co-host (from the hosts table). Returns
// only public-safe fields — no host_token, no edit_token. Used by
// /event to render the "Connect with the team" panel at the bottom.
//
// Body: { slug }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function errResp(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function ok(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errResp(405, 'method not allowed');

  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || '').trim();
  if (!slug) return errResp(400, 'slug required');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: ev } = await supabase
    .from('events')
    .select('id, primary_host_id, show_organizer_badge, organizer_name, organizer_email, organizer_phone, organizer_website, organizer_bio')
    .eq('slug', slug).maybeSingle();
  if (!ev) return errResp(404, 'event not found');

  const { data: cohosts, error } = await supabase
    .from('hosts').select('id, name, phone, email, bio, website, photo_url')
    .eq('event_id', ev.id)
    .order('created_at', { ascending: true });
  if (error) return errResp(500, error.message);

  type Entry = {
    name: string | null;
    phone: string | null;
    email?: string | null;
    website?: string | null;
    bio?: string | null;
    photo_url?: string | null;
    primary?: boolean;
    _is_master?: boolean;
    _id?: string;
  };

  // The master's organizer_* fields might be empty; only include the
  // master entry if there's something to show.
  const masterEntry: Entry | null =
    (ev.organizer_name || ev.organizer_phone || ev.organizer_email)
      ? {
          name: ev.organizer_name,
          phone: ev.organizer_phone,
          email: ev.organizer_email,
          website: ev.organizer_website,
          bio: ev.organizer_bio,
          _is_master: true,
        }
      : null;

  const cohostEntries: Entry[] = (cohosts || [])
    .filter((c) => c.name || c.phone)
    .map((c) => ({
      _id: c.id, name: c.name, phone: c.phone, email: c.email,
      bio: c.bio, website: c.website, photo_url: c.photo_url,
    }));

  // Pick the public organizer. If primary_host_id matches a co-host, that
  // co-host wears the ORGANIZER badge and ranks first. Otherwise the master
  // does. Either way the chosen entry goes first; everyone else follows in
  // their original order with the master immediately after the organizer.
  let primary: Entry | null = masterEntry;
  if (ev.primary_host_id) {
    const overridden = cohostEntries.find((c) => c._id === ev.primary_host_id);
    if (overridden) primary = overridden;
  }

  // If the master has hidden the organizer badge globally, surface every
  // host as a peer with no primary. Order stays the same (chosen primary
  // still leads if set), the badge just doesn't render.
  const showBadge = ev.show_organizer_badge !== false;

  const ordered: Entry[] = [];
  if (primary) ordered.push({ ...primary, primary: showBadge });
  if (primary !== masterEntry && masterEntry) ordered.push({ ...masterEntry, primary: false });
  for (const c of cohostEntries) {
    if (c === primary) continue;
    ordered.push({ ...c, primary: false });
  }

  // Surface internal identity hints in the response so the public page
  // can render an inline organizer toggle when viewed with a host key:
  //   id (cohost UUID, undefined for the master)
  //   is_master (true only for the master entry)
  // No tokens are returned. Names + contact info were already public.
  const clean = ordered.map(({ _id, _is_master, ...rest }) => ({
    ...rest,
    id: _id,
    is_master: !!_is_master,
  }));
  return ok({ hosts: clean });
});
