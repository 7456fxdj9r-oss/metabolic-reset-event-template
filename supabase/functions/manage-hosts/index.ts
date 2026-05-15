// Manage co-hosts for an event. The original event creator's edit_token is
// the "master" — only it can add/remove co-hosts. Existing co-hosts can list
// who else has access but can't promote/remove others (keeps the org chart
// clean and prevents a co-host from booting the original creator).
//
// Body: { slug, edit_token, action, ... }
// Actions:
//   list                                       → returns hosts for the event
//   add { name, email? } (master only)         → returns { host: {...} } incl. host_token
//   remove { host_id } (master only)           → returns { ok: true }
import { handleOptions } from '../_shared/cors.ts';
import { errResp, ok } from '../_shared/responses.ts';
import { authEditAccess } from '../_shared/auth.ts';
import { getServiceClient } from '../_shared/client.ts';

function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (const b of arr) out += alphabet[b % alphabet.length];
  return out;
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errResp(405, 'method not allowed');

  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || '').trim();
  const token = String(body.edit_token || '').trim();
  const action = String(body.action || '');
  if (!slug || !token) return errResp(400, 'slug and edit_token required');
  if (!['list', 'add', 'update', 'remove', 'set_primary'].includes(action)) {
    return errResp(400, 'action must be one of: list, add, update, remove, set_primary');
  }

  const supabase = getServiceClient();
  const auth = await authEditAccess(supabase, slug, token);
  if (!auth.ok) return auth.response;
  const { ev: evStub, isMaster } = auth;
  // Need primary_host_id too; re-fetch the extra column (cheap; one row by id).
  const { data: ev } = await supabase
    .from('events').select('id, edit_token, primary_host_id').eq('id', evStub.id).single();
  if (!ev) return errResp(404, 'event not found');

  if (action === 'list') {
    const { data: rows, error } = await supabase
      .from('hosts')
      .select('id, name, email, phone, bio, website, photo_url, is_coach, display_order, host_token, created_at')
      .eq('event_id', ev.id)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) return errResp(500, error.message);
    // Co-hosts see other host names but never their tokens.
    const sanitized = (rows || []).map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      bio: row.bio,
      website: row.website,
      photo_url: row.photo_url,
      is_coach: !!row.is_coach,
      display_order: row.display_order,
      created_at: row.created_at,
      host_token: isMaster ? row.host_token : null,
    }));
    return ok({
      hosts: sanitized,
      you_are_master: isMaster,
      primary_host_id: ev.primary_host_id, // null = master is organizer
    });
  }

  if (action === 'add') {
    if (!isMaster) return errResp(403, 'only the master host can add co-hosts');
    const name = body.name ? String(body.name).trim() : null;
    const email = body.email ? String(body.email).trim().toLowerCase() : null;
    const phone = body.phone ? String(body.phone).trim() : null;
    const bio = body.bio ? String(body.bio).trim() : null;
    const website = body.website ? String(body.website).trim() : null;
    // 16 chars from a 62-symbol alphabet ≈ 95 bits of entropy. Matches
    // the master edit_token format and keeps cohost edit links short.
    const host_token = randomToken(16);
    // Auto-set display_order to (max + 1) so new co-hosts append.
    const { data: maxOrder } = await supabase
      .from('hosts').select('display_order')
      .eq('event_id', ev.id)
      .order('display_order', { ascending: false }).limit(1).maybeSingle();
    const display_order = (maxOrder?.display_order ?? -1) + 1;
    const is_coach = !!body.is_coach;
    const { data: inserted, error } = await supabase
      .from('hosts')
      .insert({ event_id: ev.id, host_token, name, email, phone, bio, website, is_coach, display_order })
      .select('id, name, email, phone, bio, website, photo_url, is_coach, display_order, host_token, created_at')
      .single();
    if (error) return errResp(500, error.message);
    return ok({ host: inserted });
  }

  if (action === 'update') {
    if (!isMaster) return errResp(403, 'only the master host can edit co-hosts');
    const host_id = String(body.host_id || '');
    if (!host_id) return errResp(400, 'host_id required');

    const { data: existing } = await supabase
      .from('hosts').select('id')
      .eq('id', host_id).eq('event_id', ev.id).maybeSingle();
    if (!existing) return errResp(404, 'host not found in this event');

    const patch: Record<string, unknown> = {};
    if ('name' in body) {
      const v = body.name == null ? null : String(body.name).trim();
      patch.name = v || null;
    }
    if ('email' in body) {
      const v = body.email == null ? null : String(body.email).trim().toLowerCase();
      patch.email = v || null;
    }
    if ('phone' in body) {
      const v = body.phone == null ? null : String(body.phone).trim();
      patch.phone = v || null;
    }
    if ('bio' in body) {
      const v = body.bio == null ? null : String(body.bio).trim();
      patch.bio = v || null;
    }
    if ('website' in body) {
      const v = body.website == null ? null : String(body.website).trim();
      patch.website = v || null;
    }
    if ('photo_url' in body) {
      const v = body.photo_url == null ? null : String(body.photo_url).trim();
      patch.photo_url = v || null;
    }
    if ('display_order' in body) {
      const n = Number(body.display_order);
      patch.display_order = Number.isFinite(n) ? Math.floor(n) : 0;
    }
    if ('is_coach' in body) patch.is_coach = !!body.is_coach;
    if (Object.keys(patch).length === 0) return errResp(400, 'no fields to update');

    const { data: upd, error } = await supabase
      .from('hosts').update(patch).eq('id', host_id)
      .select('id, name, email, phone, bio, website, photo_url, is_coach, display_order, host_token, created_at').single();
    if (error) return errResp(500, error.message);
    return ok({ host: upd });
  }

  if (action === 'remove') {
    if (!isMaster) return errResp(403, 'only the master host can remove co-hosts');
    const host_id = String(body.host_id || '');
    if (!host_id) return errResp(400, 'host_id required');
    const { error } = await supabase
      .from('hosts').delete()
      .eq('id', host_id).eq('event_id', ev.id);
    if (error) return errResp(500, error.message);
    return ok({ ok: true });
  }

  if (action === 'set_primary') {
    // Master can pass the public "ORGANIZER" title to any co-host, or
    // claim it back themselves. Null clears the override and the master
    // (organizer_* fields) is treated as the public organizer again.
    if (!isMaster) return errResp(403, 'only the master host can change the organizer');
    const target = body.host_id ? String(body.host_id).trim() : null;
    if (target) {
      const { data: t } = await supabase
        .from('hosts').select('id')
        .eq('id', target).eq('event_id', ev.id).maybeSingle();
      if (!t) return errResp(404, 'host not found in this event');
    }
    const { error } = await supabase
      .from('events').update({ primary_host_id: target }).eq('id', ev.id);
    if (error) return errResp(500, error.message);
    return ok({ primary_host_id: target });
  }

  return errResp(400, 'unknown action');
});
