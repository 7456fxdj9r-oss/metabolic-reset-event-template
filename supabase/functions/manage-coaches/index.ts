// Coach CRUD on an event. Coaches are the curated list shown on the
// /coaching/<slug> page — independent from speakers and hosts so the
// master can split compound speaker names (e.g., "Annie and David
// Burgeson" → just "Annie Burgeson"), drop duplicates, or add people
// who aren't speakers or hosts.
//
// Body shapes:
//   { action: 'list',   slug, edit_token }
//   { action: 'add',    slug, edit_token, coach: { name, bio?, phone?, email?, website?, photo_url? } }
//   { action: 'update', slug, edit_token, coach: { id, ...patch } }
//   { action: 'delete', slug, edit_token, coach_id }
//
// Photos live in the event-photos bucket and are uploaded via
// upload-event-photo with kind='coach' + coach_id (which patches
// coaches.photo_url directly there). Reorder is done client-side by
// calling update repeatedly with display_order.
import { handleOptions } from '../_shared/cors.ts';
import { errResp, ok } from '../_shared/responses.ts';
import { authEditAccess } from '../_shared/auth.ts';
import { getServiceClient } from '../_shared/client.ts';

const COACH_COLS = 'id, name, photo_url, bio, phone, email, website, display_order, created_at, updated_at';

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errResp(405, 'method not allowed');

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');
  if (!['add', 'update', 'delete', 'list'].includes(action)) {
    return errResp(400, 'action must be one of: add, update, delete, list');
  }

  const supabase = getServiceClient();
  const auth = await authEditAccess(
    supabase,
    String(body.slug || '').trim(),
    String(body.edit_token || '').trim(),
  );
  if (!auth.ok) return auth.response;
  const { ev } = auth;

  if (action === 'list') {
    const { data: rows, error } = await supabase
      .from('coaches').select(COACH_COLS)
      .eq('event_id', ev.id)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) return errResp(500, error.message);
    return ok({ coaches: rows || [] });
  }

  if (action === 'add') {
    const c = body.coach || {};
    const name = String(c.name || '').trim();
    if (!name) return errResp(400, 'coach.name is required');

    const MAX_COACHES = 30;
    const { count } = await supabase
      .from('coaches')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', ev.id);
    if ((count || 0) >= MAX_COACHES) {
      return errResp(409, `event already has the maximum ${MAX_COACHES} coaches`);
    }

    const { data: maxOrder } = await supabase
      .from('coaches').select('display_order')
      .eq('event_id', ev.id).order('display_order', { ascending: false }).limit(1).maybeSingle();

    const row = {
      event_id: ev.id,
      name,
      bio: typeof c.bio === 'string' ? (c.bio.trim() || null) : null,
      phone: typeof c.phone === 'string' ? (c.phone.trim() || null) : null,
      email: typeof c.email === 'string' ? (c.email.trim() || null) : null,
      website: typeof c.website === 'string' ? (c.website.trim() || null) : null,
      photo_url: typeof c.photo_url === 'string' ? (c.photo_url.trim() || null) : null,
      display_order: (maxOrder?.display_order ?? -1) + 1,
    };
    const { data: ins, error: insErr } = await supabase
      .from('coaches').insert(row).select(COACH_COLS).single();
    if (insErr) return errResp(500, insErr.message);
    return ok({ coach: ins });
  }

  if (action === 'update') {
    const c = body.coach || {};
    const id = String(c.id || '');
    if (!id) return errResp(400, 'coach.id is required');

    const { data: existing } = await supabase
      .from('coaches').select('id').eq('id', id).eq('event_id', ev.id).maybeSingle();
    if (!existing) return errResp(404, 'coach not found in this event');

    const patch: Record<string, unknown> = {};
    if (typeof c.name === 'string') {
      const name = c.name.trim();
      if (!name) return errResp(400, 'name cannot be empty');
      patch.name = name;
    }
    if ('bio' in c) patch.bio = (typeof c.bio === 'string' ? c.bio.trim() : '') || null;
    if ('phone' in c) patch.phone = (typeof c.phone === 'string' ? c.phone.trim() : '') || null;
    if ('email' in c) patch.email = (typeof c.email === 'string' ? c.email.trim() : '') || null;
    if ('website' in c) patch.website = (typeof c.website === 'string' ? c.website.trim() : '') || null;
    if ('photo_url' in c) patch.photo_url = (typeof c.photo_url === 'string' ? c.photo_url.trim() : '') || null;
    if ('display_order' in c) patch.display_order = numOrNull(c.display_order) ?? 0;

    if (Object.keys(patch).length === 0) return errResp(400, 'no fields to update');
    patch.updated_at = new Date().toISOString();

    const { data: upd, error } = await supabase
      .from('coaches').update(patch).eq('id', id).select(COACH_COLS).single();
    if (error) return errResp(500, error.message);
    return ok({ coach: upd });
  }

  // delete
  const id = String(body.coach_id || '');
  if (!id) return errResp(400, 'coach_id is required');
  const { data: existing } = await supabase
    .from('coaches').select('id').eq('id', id).eq('event_id', ev.id).maybeSingle();
  if (!existing) return errResp(404, 'coach not found in this event');
  const { error: delErr } = await supabase.from('coaches').delete().eq('id', id);
  if (delErr) return errResp(500, delErr.message);
  return ok({ ok: true });
});
