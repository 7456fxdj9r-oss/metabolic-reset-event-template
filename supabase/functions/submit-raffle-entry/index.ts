// Public endpoint. Creates a raffle entry for an event with raffle_status='open'.
// The quiz mirrors the Spokane MREvent raffle (see raffle.html in that repo):
//   - 3 yes/no health questions (diabetes, high BP, high cholesterol)
//   - 7 self-rated 1–5 lifestyle areas (energy, sleep, weight, cravings,
//     mood, digestion, community)
//   - one tried-before yes/no
// risk_score = number of "yes" health answers (0–3). Ratings and the
// tried-before answer are stored in quiz_answers but not folded into the
// risk score for v0.1.
//
// Body shape:
//   { slug, name, email, phone?, invited_by, quiz_answers, goal_text?,
//     newsletter_optin?, apprentice_optin? }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const HEALTH_KEYS = ['has_diabetes', 'has_high_bp', 'has_high_cholesterol'];
const RATING_KEYS = [
  'rate_energy', 'rate_sleep', 'rate_weight', 'rate_cravings',
  'rate_mood', 'rate_digestion', 'rate_community',
];
const SCALAR_KEYS = ['tried_before'];

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

function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (const b of arr) out += alphabet[b % alphabet.length];
  return out;
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errResp(405, 'method not allowed');

  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || '').trim();
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = body.phone ? String(body.phone).trim() : null;
  const invited_by = String(body.invited_by || '').trim();
  const goal_text = body.goal_text ? String(body.goal_text).trim() : null;
  const newsletter_optin = !!body.newsletter_optin;
  const apprentice_optin = !!body.apprentice_optin;
  const consultation_optin = !!body.consultation_optin;
  const quiz = body.quiz_answers && typeof body.quiz_answers === 'object'
    ? body.quiz_answers
    : {};

  if (!slug) return errResp(400, 'slug required');
  if (!name) return errResp(400, 'name is required');
  if (!email) return errResp(400, 'email is required');
  if (!isEmail(email)) return errResp(400, 'email looks invalid');
  if (!invited_by) return errResp(400, 'invited_by is required');
  if (name.length > 100) return errResp(400, 'name is too long');

  // Normalize: only the keys we know about, only the values we expect.
  const cleanQuiz: Record<string, string | number | null> = {};
  let risk_score = 0;
  for (const k of HEALTH_KEYS) {
    const v = quiz[k];
    if (v === 'yes') {
      cleanQuiz[k] = 'yes';
      risk_score += 1;
    } else if (v === 'no') {
      cleanQuiz[k] = 'no';
    } else {
      cleanQuiz[k] = null;
    }
  }
  for (const k of RATING_KEYS) {
    const n = Number(quiz[k]);
    cleanQuiz[k] = Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  }
  for (const k of SCALAR_KEYS) {
    const v = quiz[k];
    cleanQuiz[k] = v === 'yes' || v === 'no' ? v : null;
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: ev } = await supabase
    .from('events')
    .select('id, raffle_status, event_date')
    .eq('slug', slug).maybeSingle();
  if (!ev) return errResp(404, 'event not found');
  if (ev.raffle_status !== 'open') return errResp(403, 'raffle is not open');
  // Auto-close after the event date. event_date is YYYY-MM-DD; we compare
  // against today in UTC. Anyone trying to enter after the event date —
  // including the event-day's tail end in late timezones — gets rejected.
  if (ev.event_date) {
    const today = new Date().toISOString().slice(0, 10);
    if (today > ev.event_date) return errResp(403, 'raffle is closed (event has ended)');
  }

  const { data: dupe } = await supabase
    .from('raffle_entries').select('id, entry_token')
    .eq('event_id', ev.id).eq('email', email).maybeSingle();
  if (dupe) {
    return ok({ entry_token: dupe.entry_token, already_entered: true });
  }

  // Hard cap on entries per event as a safety net against accidental or
  // malicious flooding. 1000 is way more than any single in-person event
  // would ever pull in.
  const MAX_RAFFLE_ENTRIES = 1000;
  const { count } = await supabase
    .from('raffle_entries')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', ev.id);
  if ((count || 0) >= MAX_RAFFLE_ENTRIES) {
    return errResp(409, 'this raffle has reached its entry limit');
  }

  const entry_token = randomToken(32);
  const { error: insErr } = await supabase.from('raffle_entries').insert({
    event_id: ev.id,
    entry_token,
    name,
    email,
    phone,
    invited_by,
    quiz_answers: cleanQuiz,
    risk_score,
    goal_text,
    newsletter_optin,
    apprentice_optin,
    consultation_optin,
  });
  if (insErr) return errResp(500, 'insert failed: ' + insErr.message);

  return ok({ entry_token, already_entered: false });
});
