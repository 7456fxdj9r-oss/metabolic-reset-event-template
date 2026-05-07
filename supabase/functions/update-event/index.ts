// Verifies the supplied edit_token, then updates whichever event fields the
// caller sent. Only fields that appear in the request body are touched, so a
// caller can update just the accent_color without resending name/host_line.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function errResp(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errResp(405, 'method not allowed');

  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || '').trim();
  const edit_token = String(body.edit_token || '').trim();
  if (!slug || !edit_token) return errResp(400, 'slug and edit_token required');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: ev, error: lookupErr } = await supabase
    .from('events').select('id, edit_token').eq('slug', slug).maybeSingle();
  if (lookupErr) return errResp(500, lookupErr.message);
  if (!ev) return errResp(404, 'event not found');
  if (!timingSafeEqual(ev.edit_token, edit_token)) return errResp(403, 'invalid edit token');

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return errResp(400, 'name cannot be empty');
    patch.name = name;
  }
  if ('host_line' in body) patch.host_line = body.host_line || null;
  if ('accent_color' in body) patch.accent_color = body.accent_color || '#f39c12';
  if ('email' in body) patch.email = body.email || null;
  if ('science_url' in body) patch.science_url = body.science_url || null;
  if ('raffle_status' in body) {
    const s = String(body.raffle_status || 'closed');
    if (!['open', 'closed'].includes(s)) {
      return errResp(400, 'raffle_status must be open|closed');
    }
    patch.raffle_status = s;
  }
  if ('raffle_prize' in body) patch.raffle_prize = body.raffle_prize || null;
  if ('raffle_prize_photo_url' in body) patch.raffle_prize_photo_url = body.raffle_prize_photo_url || null;
  for (const k of [
    'organizer_name', 'organizer_email', 'organizer_phone', 'organizer_website', 'organizer_bio',
    'social_instagram', 'social_facebook', 'social_tiktok', 'social_youtube', 'social_linkedin',
  ]) {
    if (k in body) patch[k] = body[k] || null;
  }

  if (Object.keys(patch).length === 0) return errResp(400, 'no fields to update');

  const { error } = await supabase.from('events').update(patch).eq('id', ev.id);
  if (error) return errResp(500, error.message);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
