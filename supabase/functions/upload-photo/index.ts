// Receives a base64 image blob, validates the edit_token, uploads to the
// event-photos bucket at <event_slug>/<transformation_slug>/<slot>-<ts>.<ext>,
// then writes the resulting public URL into the transformation row.
//
// Client is expected to compress to ~500KB before calling. Server caps at 5MB.
import { handleOptions } from '../_shared/cors.ts';
import { errResp, ok } from '../_shared/responses.ts';
import { authEditAccess } from '../_shared/auth.ts';
import { getServiceClient } from '../_shared/client.ts';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errResp(405, 'method not allowed');

  const body = await req.json().catch(() => ({}));
  const transformation_id = String(body.transformation_id || '');
  const slot = String(body.slot || '');
  const filename = String(body.filename || '');
  const data_b64 = String(body.data || '');

  if (!transformation_id) return errResp(400, 'transformation_id required');
  if (slot !== 'before' && slot !== 'after') return errResp(400, 'slot must be before or after');
  if (!data_b64) return errResp(400, 'data required');

  const ext = (filename.split('.').pop() || 'jpg').toLowerCase();
  const contentType = ALLOWED_EXTS[ext];
  if (!contentType) return errResp(400, 'unsupported file type (jpg, png, webp only)');

  let bytes: Uint8Array;
  try {
    const stripped = data_b64.replace(/^data:[^;]+;base64,/, '');
    const binStr = atob(stripped);
    bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  } catch {
    return errResp(400, 'invalid base64 data');
  }
  if (bytes.byteLength > MAX_BYTES) return errResp(413, 'file too large (5MB max)');

  const supabase = getServiceClient();
  const auth = await authEditAccess(
    supabase,
    String(body.slug || '').trim(),
    String(body.edit_token || '').trim(),
  );
  if (!auth.ok) return auth.response;
  const { ev: evStub } = auth;
  // Need slug too for the storage path; re-fetch with id (1 row).
  const { data: ev } = await supabase
    .from('events').select('id, edit_token, slug').eq('id', evStub.id).single();
  if (!ev) return errResp(404, 'event not found');

  const { data: t } = await supabase
    .from('transformations').select('id, slug')
    .eq('id', transformation_id).eq('event_id', ev.id).maybeSingle();
  if (!t) return errResp(404, 'transformation not found in this event');

  const path = `${ev.slug}/${t.slug}/${slot}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('event-photos')
    .upload(path, bytes, { contentType, upsert: false });
  if (upErr) return errResp(500, 'storage upload failed: ' + upErr.message);

  const { data: pub } = supabase.storage.from('event-photos').getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  const col = slot === 'before' ? 'before_photo_url' : 'after_photo_url';
  const { error: updErr } = await supabase
    .from('transformations').update({ [col]: publicUrl }).eq('id', t.id);
  if (updErr) return errResp(500, updErr.message);

  return ok({ url: publicUrl, slot });
});
