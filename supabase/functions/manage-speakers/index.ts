// Speaker CRUD on an event. Same shape as manage-transformation:
//   { action: 'add',    slug, edit_token, speaker: { name, bio?, ... } }
//   { action: 'update', slug, edit_token, speaker: { id, ...patch } }
//   { action: 'delete', slug, edit_token, speaker_id }
// list is public (RLS allows it) so /speakers can fetch via REST directly,
// but we expose 'list' here too for consistency with how the edit page
// already speaks to its other manage-* functions.
import { handleOptions } from '../_shared/cors.ts';
import { errResp, ok } from '../_shared/responses.ts';
import { authEditAccess } from '../_shared/auth.ts';
import { getServiceClient } from '../_shared/client.ts';

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
      .from('speakers').select('id, name, photo_url, bio, phone, email, display_order, created_at')
      .eq('event_id', ev.id)
      .order('display_order', { ascending: true });
    if (error) return errResp(500, error.message);
    return ok({ speakers: rows || [] });
  }

  if (action === 'add') {
    const sp = body.speaker || {};
    const name = String(sp.name || '').trim();
    if (!name) return errResp(400, 'speaker.name is required');

    const MAX_SPEAKERS = 15;
    const { count } = await supabase
      .from('speakers')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', ev.id);
    if ((count || 0) >= MAX_SPEAKERS) {
      return errResp(409, `event already has the maximum ${MAX_SPEAKERS} speakers`);
    }

    const { data: maxOrder } = await supabase
      .from('speakers').select('display_order')
      .eq('event_id', ev.id).order('display_order', { ascending: false }).limit(1).maybeSingle();

    const row = {
      event_id: ev.id,
      name,
      bio: sp.bio || null,
      phone: sp.phone || null,
      email: sp.email || null,
      display_order: (maxOrder?.display_order ?? -1) + 1,
    };
    const { data: ins, error: insErr } = await supabase
      .from('speakers').insert(row).select('*').single();
    if (insErr) return errResp(500, insErr.message);
    return ok({ speaker: ins });
  }

  if (action === 'update') {
    const sp = body.speaker || {};
    const id = String(sp.id || '');
    if (!id) return errResp(400, 'speaker.id is required');

    const { data: existing } = await supabase
      .from('speakers').select('id').eq('id', id).eq('event_id', ev.id).maybeSingle();
    if (!existing) return errResp(404, 'speaker not found in this event');

    const patch: Record<string, unknown> = {};
    if (typeof sp.name === 'string') {
      const name = sp.name.trim();
      if (!name) return errResp(400, 'name cannot be empty');
      patch.name = name;
    }
    if ('bio' in sp) patch.bio = sp.bio || null;
    if ('phone' in sp) patch.phone = sp.phone || null;
    if ('email' in sp) patch.email = sp.email || null;
    if ('display_order' in sp) patch.display_order = numOrNull(sp.display_order) ?? 0;
    if ('photo_url' in sp) patch.photo_url = sp.photo_url || null;

    if (Object.keys(patch).length === 0) return errResp(400, 'no fields to update');

    const { data: upd, error } = await supabase
      .from('speakers').update(patch).eq('id', id).select('*').single();
    if (error) return errResp(500, error.message);
    return ok({ speaker: upd });
  }

  // delete
  const id = String(body.speaker_id || '');
  if (!id) return errResp(400, 'speaker_id is required');
  const { data: existing } = await supabase
    .from('speakers').select('id').eq('id', id).eq('event_id', ev.id).maybeSingle();
  if (!existing) return errResp(404, 'speaker not found in this event');
  const { error: delErr } = await supabase.from('speakers').delete().eq('id', id);
  if (delErr) return errResp(500, delErr.message);
  return ok({ ok: true });
});
