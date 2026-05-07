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
    .select('id, organizer_name, organizer_email, organizer_phone, organizer_website, organizer_bio')
    .eq('slug', slug).maybeSingle();
  if (!ev) return errResp(404, 'event not found');

  const { data: cohosts, error } = await supabase
    .from('hosts').select('name, phone')
    .eq('event_id', ev.id)
    .order('created_at', { ascending: true });
  if (error) return errResp(500, error.message);

  const hosts: Array<{
    name: string | null;
    phone: string | null;
    email?: string | null;
    website?: string | null;
    bio?: string | null;
    primary?: boolean;
  }> = [];

  if (ev.organizer_name || ev.organizer_phone || ev.organizer_email) {
    hosts.push({
      name: ev.organizer_name,
      phone: ev.organizer_phone,
      email: ev.organizer_email,
      website: ev.organizer_website,
      bio: ev.organizer_bio,
      primary: true,
    });
  }
  for (const c of cohosts || []) {
    if (!c.name && !c.phone) continue;
    hosts.push({ name: c.name, phone: c.phone });
  }

  return ok({ hosts });
});
