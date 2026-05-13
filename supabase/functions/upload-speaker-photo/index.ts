// Speaker headshot upload. Same shape as upload-photo, but scoped to a
// speaker row instead of a transformation slot.
//
// Body: { slug, edit_token, speaker_id, filename, data: base64 }
// Path: <event_slug>/speakers/<speaker_id>-<ts>.<ext>
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
  const speaker_id = String(body.speaker_id || '');
  const filename = String(body.filename || '');
  const data_b64 = String(body.data || '');

  if (!speaker_id) return errResp(400, 'speaker_id required');
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
  // Need slug for the storage path; re-fetch with id (1 row).
  const { data: ev } = await supabase
    .from('events').select('id, edit_token, slug').eq('id', evStub.id).single();
  if (!ev) return errResp(404, 'event not found');

  const { data: sp } = await supabase
    .from('speakers').select('id')
    .eq('id', speaker_id).eq('event_id', ev.id).maybeSingle();
  if (!sp) return errResp(404, 'speaker not found in this event');

  const path = `${ev.slug}/speakers/${speaker_id}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('event-photos')
    .upload(path, bytes, { contentType, upsert: false });
  if (upErr) return errResp(500, 'storage upload failed: ' + upErr.message);

  const { data: pub } = supabase.storage.from('event-photos').getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  const { error: updErr } = await supabase
    .from('speakers').update({ photo_url: publicUrl }).eq('id', sp.id);
  if (updErr) return errResp(500, updErr.message);

  return ok({ url: publicUrl });
});
