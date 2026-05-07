// Replaces the entire set of data_points for a single transformation.
// Body: { slug, edit_token, transformation_id, points: [{ metric, date, value }] }
// 'metric' must be one of: 'weight' | 'bf' | 'lean'.
// 'date' must be ISO YYYY-MM-DD. 'value' must be a finite number.
// Empty points array clears the row's biometric history.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VALID_METRICS = new Set(['weight', 'bf', 'lean']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_POINTS = 1000;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function errResp(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
  const transformation_id = String(body.transformation_id || '');
  const points = body.points;

  if (!slug || !edit_token) return errResp(400, 'slug and edit_token required');
  if (!transformation_id) return errResp(400, 'transformation_id required');
  if (!Array.isArray(points)) return errResp(400, 'points must be an array');
  if (points.length > MAX_POINTS) return errResp(400, `too many points (max ${MAX_POINTS})`);

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p || typeof p !== 'object') return errResp(400, `points[${i}] must be an object`);
    if (!VALID_METRICS.has(p.metric)) return errResp(400, `points[${i}].metric must be weight|bf|lean`);
    if (typeof p.date !== 'string' || !ISO_DATE.test(p.date)) {
      return errResp(400, `points[${i}].date must be YYYY-MM-DD`);
    }
    const v = Number(p.value);
    if (!Number.isFinite(v)) return errResp(400, `points[${i}].value must be a number`);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: ev } = await supabase
    .from('events').select('id, edit_token').eq('slug', slug).maybeSingle();
  if (!ev) return errResp(404, 'event not found');
  if (!timingSafeEqual(ev.edit_token, edit_token)) {
    const { data: cohost } = await supabase
      .from('hosts').select('id')
      .eq('event_id', ev.id).eq('host_token', edit_token).maybeSingle();
    if (!cohost) return errResp(403, 'invalid edit token');
  }

  const { data: t } = await supabase
    .from('transformations').select('id')
    .eq('id', transformation_id).eq('event_id', ev.id).maybeSingle();
  if (!t) return errResp(404, 'transformation not found in this event');

  const { error: delErr } = await supabase
    .from('data_points').delete().eq('transformation_id', transformation_id);
  if (delErr) return errResp(500, 'delete failed: ' + delErr.message);

  if (points.length === 0) return ok({ count: 0 });

  const rows = points.map((p: { metric: string; date: string; value: number }) => ({
    transformation_id,
    metric: p.metric,
    date: p.date,
    value: Number(p.value),
  }));
  const { error: insErr } = await supabase.from('data_points').insert(rows);
  if (insErr) return errResp(500, 'insert failed: ' + insErr.message);

  return ok({ count: rows.length });
});
