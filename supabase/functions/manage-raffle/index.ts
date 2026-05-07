// Host-only endpoint. Validates the host's edit_token, then performs the
// requested raffle-management action.
//
// Body: { slug, edit_token, action, ... }
//
// Actions for v0.1:
//   { action: 'list' } → returns full entry list (with PII), most recent first
// Actions deferred to a follow-up:
//   draw  — pick a random non-drawn entry as the winner
//   update_entry — host edits lead_status / notes for an entry
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

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
  const edit_token = String(body.edit_token || '').trim();
  const action = String(body.action || '');
  if (!slug || !edit_token) return errResp(400, 'slug and edit_token required');
  if (!['list'].includes(action)) {
    return errResp(400, 'action must be one of: list');
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: ev } = await supabase
    .from('events').select('id, edit_token').eq('slug', slug).maybeSingle();
  if (!ev) return errResp(404, 'event not found');
  if (!timingSafeEqual(ev.edit_token, edit_token)) return errResp(403, 'invalid edit token');

  if (action === 'list') {
    const { data: entries, error } = await supabase
      .from('raffle_entries')
      .select('id, name, email, phone, invited_by, risk_score, quiz_answers, goal_text, newsletter_optin, apprentice_optin, drawn, prize_won, lead_status, notes, submitted_at')
      .eq('event_id', ev.id)
      .order('submitted_at', { ascending: false });
    if (error) return errResp(500, error.message);
    return ok({ entries: entries || [] });
  }

  return errResp(400, 'unknown action');
});
