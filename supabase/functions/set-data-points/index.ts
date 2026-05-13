// Replaces the entire set of data_points for a single transformation.
// Body: { slug, edit_token, transformation_id, points: [{ metric, date, value }] }
// 'metric' must be one of: 'weight' | 'bf' | 'lean'.
// 'date' must be ISO YYYY-MM-DD. 'value' must be a finite number.
// Empty points array clears the row's biometric history.
import { handleOptions } from '../_shared/cors.ts';
import { errResp, ok } from '../_shared/responses.ts';
import { authEditAccess } from '../_shared/auth.ts';
import { getServiceClient } from '../_shared/client.ts';

const VALID_METRICS = new Set(['weight', 'bf', 'lean']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_POINTS = 1000;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errResp(405, 'method not allowed');

  const body = await req.json().catch(() => ({}));
  const transformation_id = String(body.transformation_id || '');
  const points = body.points;

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

  const supabase = getServiceClient();
  const auth = await authEditAccess(
    supabase,
    String(body.slug || '').trim(),
    String(body.edit_token || '').trim(),
  );
  if (!auth.ok) return auth.response;
  const { ev } = auth;

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
