// Event-level photo upload (currently just the raffle prize). Different
// from upload-photo, which is scoped to a transformation.
//
// Body: { slug, edit_token, kind: 'prize', filename, data: base64 }
// Writes to event-photos/<event_slug>/<kind>-<ts>.<ext> and patches the
// matching column on the event row.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

// Map of kind → which column to patch on the event row.
const KIND_COLUMN: Record<string, string> = {
  prize: 'raffle_prize_photo_url',
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errResp(405, 'method not allowed');

  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || '').trim();
  const edit_token = String(body.edit_token || '').trim();
  const kind = String(body.kind || '');
  const filename = String(body.filename || '');
  const data_b64 = String(body.data || '');

  if (!slug || !edit_token) return errResp(400, 'slug and edit_token required');
  const column = KIND_COLUMN[kind];
  if (!column) return errResp(400, `kind must be one of: ${Object.keys(KIND_COLUMN).join(', ')}`);
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: ev } = await supabase
    .from('events').select('id, edit_token, slug')
    .eq('slug', slug).maybeSingle();
  if (!ev) return errResp(404, 'event not found');
  if (!timingSafeEqual(ev.edit_token, edit_token)) {
    const { data: cohost } = await supabase
      .from('hosts').select('id')
      .eq('event_id', ev.id).eq('host_token', edit_token).maybeSingle();
    if (!cohost) return errResp(403, 'invalid edit token');
  }

  const path = `${ev.slug}/${kind}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('event-photos')
    .upload(path, bytes, { contentType, upsert: false });
  if (upErr) return errResp(500, 'storage upload failed: ' + upErr.message);

  const { data: pub } = supabase.storage.from('event-photos').getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  const { error: updErr } = await supabase
    .from('events').update({ [column]: publicUrl }).eq('id', ev.id);
  if (updErr) return errResp(500, updErr.message);

  return ok({ url: publicUrl, kind });
});
