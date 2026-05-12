// Public read of the raffle pool for the wheel display. Returns just first
// names (the part before the first space) and ids — no email/phone/quiz
// answers — so anyone with the wheel URL can render the wheel without
// exposing the rest of an entrant's PII.
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

function firstName(full: string): string {
  return (full || '').trim().split(/\s+/)[0] || 'Anon';
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
    .from('events').select('id, name, accent_color, raffle_prize, raffle_prize_photo_url')
    .eq('slug', slug).maybeSingle();
  if (!ev) return errResp(404, 'event not found');

  const { data: rows, error } = await supabase
    .from('raffle_entries')
    .select('id, name, drawn, prize_won, prize_id')
    .eq('event_id', ev.id)
    .order('submitted_at', { ascending: true });
  if (error) return errResp(500, error.message);

  const pool = (rows || []).filter((r) => !r.drawn).map((r) => ({
    id: r.id,
    first_name: firstName(r.name),
  }));
  const winners = (rows || []).filter((r) => r.drawn).map((r) => ({
    id: r.id,
    first_name: firstName(r.name),
    prize_won: r.prize_won,
  }));

  // Multi-prize raffle: also return the prize list so the wheel page can
  // show "Spinning for: X" during a draw and a prize ladder between draws.
  // Empty list = single-prize legacy mode (events.raffle_prize text only).
  const { data: prizes } = await supabase
    .from('raffle_prizes')
    .select('id, name, photo_url, is_grand, quantity, drawn_winner_id')
    .eq('event_id', ev.id)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });

  // Per-prize drawn count from the entries we already pulled — no extra
  // round-trip. Caller renders "X of N drawn" without doing math.
  const drawnByPrize: Record<string, number> = {};
  for (const r of rows || []) {
    const row = r as { drawn: boolean; prize_id?: string | null };
    if (row.drawn && row.prize_id) {
      drawnByPrize[row.prize_id] = (drawnByPrize[row.prize_id] || 0) + 1;
    }
  }
  const prizesOut = (prizes || []).map((p) => ({
    ...p, drawn_count: drawnByPrize[p.id] || 0,
  }));

  return ok({
    event: {
      name: ev.name,
      accent_color: ev.accent_color,
      raffle_prize: ev.raffle_prize,
      raffle_prize_photo_url: ev.raffle_prize_photo_url,
    },
    pool,
    winners,
    prizes: prizesOut,
  });
});
