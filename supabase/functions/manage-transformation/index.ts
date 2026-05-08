// One Edge Function for the three transformation write operations:
//   { action: 'add',    slug, edit_token, transformation: {...} }
//   { action: 'update', slug, edit_token, transformation: { id, ...patch } }
//   { action: 'delete', slug, edit_token, transformation_id }
// Verifies the edit_token belongs to the event identified by `slug`, then
// performs the operation against the transformations table.
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
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function ok(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function slugify(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'transformation';
}

function randomSuffix(): string {
  const arr = new Uint8Array(3);
  crypto.getRandomValues(arr);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (const b of arr) out += alphabet[b % alphabet.length];
  return out;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Headlines are derived from before/after raw inputs, not stored separately.
// Returns null for any computed value where either side is missing — keeps
// the headline columns honest when one half hasn't been entered yet.
function computeHeadlines(row: {
  before_weight?: number | null;
  after_weight?: number | null;
  before_bf?: number | null;
  after_bf?: number | null;
  before_lean?: number | null;
  after_lean?: number | null;
}) {
  const lbLoss =
    row.before_weight != null && row.after_weight != null
      ? round1(Number(row.before_weight) - Number(row.after_weight))
      : null;
  const bfDelta =
    row.before_bf != null && row.after_bf != null
      ? round1(Number(row.before_bf) - Number(row.after_bf))
      : null;
  const leanKept =
    row.before_lean != null && row.after_lean != null && Number(row.before_lean) > 0
      ? round1((Number(row.after_lean) / Number(row.before_lean)) * 100)
      : null;
  return {
    headline_lb_loss: lbLoss,
    headline_bf_delta_pts: bfDelta,
    headline_lean_kept_pct: leanKept,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errResp(405, 'method not allowed');

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');
  const slug = String(body.slug || '').trim();
  const edit_token = String(body.edit_token || '').trim();
  if (!slug || !edit_token) return errResp(400, 'slug and edit_token required');
  if (!['add', 'update', 'delete'].includes(action)) {
    return errResp(400, 'action must be one of: add, update, delete');
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: ev, error: evErr } = await supabase
    .from('events').select('id, edit_token').eq('slug', slug).maybeSingle();
  if (evErr) return errResp(500, evErr.message);
  if (!ev) return errResp(404, 'event not found');
  if (!timingSafeEqual(ev.edit_token, edit_token)) {
    const { data: cohost } = await supabase
      .from('hosts').select('id')
      .eq('event_id', ev.id).eq('host_token', edit_token).maybeSingle();
    if (!cohost) return errResp(403, 'invalid edit token');
  }

  if (action === 'add') {
    const t = body.transformation || {};
    const name = String(t.name || '').trim();
    if (!name) return errResp(400, 'transformation.name is required');

    // Per-event cap as a safety net. Generous — most real events have
    // 1-5 transformations. Set higher (or remove) if a coach legitimately
    // needs more.
    const MAX_TRANSFORMATIONS = 20;
    const { count } = await supabase
      .from('transformations')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', ev.id);
    if ((count || 0) >= MAX_TRANSFORMATIONS) {
      return errResp(409, `event already has the maximum ${MAX_TRANSFORMATIONS} transformations`);
    }

    const baseSlug = slugify(name);
    let tslug = baseSlug;
    for (let i = 0; i < 6; i++) {
      const { data: ex } = await supabase
        .from('transformations').select('id')
        .eq('event_id', ev.id).eq('slug', tslug).maybeSingle();
      if (!ex) break;
      tslug = `${baseSlug}-${randomSuffix()}`;
    }

    const { data: maxOrder } = await supabase
      .from('transformations').select('display_order')
      .eq('event_id', ev.id).order('display_order', { ascending: false }).limit(1).maybeSingle();

    const beforeWeight = numOrNull(t.before_weight);
    const afterWeight = numOrNull(t.after_weight);
    const beforeBf = numOrNull(t.before_bf);
    const afterBf = numOrNull(t.after_bf);
    const beforeLean = numOrNull(t.before_lean);
    const afterLean = numOrNull(t.after_lean);
    const headlines = computeHeadlines({
      before_weight: beforeWeight, after_weight: afterWeight,
      before_bf: beforeBf, after_bf: afterBf,
      before_lean: beforeLean, after_lean: afterLean,
    });

    const row = {
      event_id: ev.id,
      slug: tslug,
      name,
      before_date: t.before_date || null,
      after_date: t.after_date || null,
      before_weight: beforeWeight,
      after_weight: afterWeight,
      before_bf: beforeBf,
      after_bf: afterBf,
      before_lean: beforeLean,
      after_lean: afterLean,
      ...headlines,
      takeaway_text: t.takeaway_text || null,
      display_order: (maxOrder?.display_order ?? -1) + 1,
    };

    const { data: ins, error: insErr } = await supabase
      .from('transformations').insert(row).select('*').single();
    if (insErr) return errResp(500, insErr.message);
    return ok({ transformation: ins });
  }

  if (action === 'update') {
    const t = body.transformation || {};
    const id = String(t.id || '');
    if (!id) return errResp(400, 'transformation.id is required');

    const { data: existing, error: exErr } = await supabase
      .from('transformations').select('*')
      .eq('id', id).eq('event_id', ev.id).maybeSingle();
    if (exErr) return errResp(500, exErr.message);
    if (!existing) return errResp(404, 'transformation not found in this event');

    const patch: Record<string, unknown> = {};
    if (typeof t.name === 'string') {
      const name = t.name.trim();
      if (!name) return errResp(400, 'name cannot be empty');
      patch.name = name;
    }
    if ('before_date' in t) patch.before_date = t.before_date || null;
    if ('after_date' in t) patch.after_date = t.after_date || null;
    if ('before_weight' in t) patch.before_weight = numOrNull(t.before_weight);
    if ('after_weight' in t) patch.after_weight = numOrNull(t.after_weight);
    if ('before_bf' in t) patch.before_bf = numOrNull(t.before_bf);
    if ('after_bf' in t) patch.after_bf = numOrNull(t.after_bf);
    if ('before_lean' in t) patch.before_lean = numOrNull(t.before_lean);
    if ('after_lean' in t) patch.after_lean = numOrNull(t.after_lean);
    if ('takeaway_text' in t) patch.takeaway_text = t.takeaway_text || null;
    if ('display_order' in t) patch.display_order = numOrNull(t.display_order) ?? 0;
    if ('before_photo_url' in t) patch.before_photo_url = t.before_photo_url || null;
    if ('after_photo_url' in t) patch.after_photo_url = t.after_photo_url || null;

    if (Object.keys(patch).length === 0) return errResp(400, 'no fields to update');

    // Recompute headlines from the merged state so they're always in sync
    // with whatever before/after raw values end up on the row after this patch.
    const merged = { ...existing, ...patch };
    Object.assign(patch, computeHeadlines(merged));

    const { data: upd, error } = await supabase
      .from('transformations').update(patch).eq('id', id).select('*').single();
    if (error) return errResp(500, error.message);
    return ok({ transformation: upd });
  }

  // delete
  const id = String(body.transformation_id || '');
  if (!id) return errResp(400, 'transformation_id is required');

  const { data: existing } = await supabase
    .from('transformations').select('id')
    .eq('id', id).eq('event_id', ev.id).maybeSingle();
  if (!existing) return errResp(404, 'transformation not found in this event');

  const { error: delErr } = await supabase.from('transformations').delete().eq('id', id);
  if (delErr) return errResp(500, delErr.message);
  return ok({ ok: true });
});
