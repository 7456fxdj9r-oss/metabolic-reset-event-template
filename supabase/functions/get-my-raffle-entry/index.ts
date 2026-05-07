// Public endpoint, but token-gated. Returns ONE raffle entry for the entrant
// who holds the token. The token is scoped to the event slug — passing a
// token from a different event won't reveal anything.
//
// Body: { slug, token }
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
  const token = String(body.token || '').trim();
  if (!slug || !token) return errResp(400, 'slug and token required');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: ev } = await supabase
    .from('events').select('id, name, accent_color, raffle_prize')
    .eq('slug', slug).maybeSingle();
  if (!ev) return errResp(404, 'event not found');

  const { data: entry } = await supabase
    .from('raffle_entries')
    .select('id, name, email, phone, invited_by, quiz_answers, risk_score, goal_text, newsletter_optin, apprentice_optin, drawn, drawn_at, prize_won, submitted_at')
    .eq('event_id', ev.id).eq('entry_token', token).maybeSingle();
  if (!entry) return errResp(404, 'entry not found');

  return ok({
    entry,
    event: {
      name: ev.name,
      accent_color: ev.accent_color,
      raffle_prize: ev.raffle_prize,
    },
  });
});
