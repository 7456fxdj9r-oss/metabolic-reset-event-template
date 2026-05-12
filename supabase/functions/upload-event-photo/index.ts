// Event-level photo upload. Different from upload-photo, which is
// scoped to a transformation.
//
// Body shapes:
//   { slug, edit_token, kind: 'prize',      filename, data }
//     → legacy single-prize photo, patches events.raffle_prize_photo_url
//   { slug, edit_token, kind: 'prize_item', prize_id, filename, data }
//     → multi-prize: patches raffle_prizes.photo_url for the given row
//
// Writes to event-photos/<event_slug>/<kind>-<id>-<ts>.<ext>.
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

// Map of kind → which column to patch on the event row. Only used for
// event-row writes; the 'prize_item' kind targets raffle_prizes instead
// (see below).
const KIND_COLUMN: Record<string, string> = {
  prize: 'raffle_prize_photo_url',
};
const VALID_KINDS = ['prize', 'prize_item'];

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
  if (!VALID_KINDS.includes(kind)) {
    return errResp(400, `kind must be one of: ${VALID_KINDS.join(', ')}`);
  }
  if (!data_b64) return errResp(400, 'data required');
  // For per-prize uploads, prize_id targets which raffle_prizes row to patch.
  const prize_id = kind === 'prize_item' ? String(body.prize_id || '').trim() : '';
  if (kind === 'prize_item' && !prize_id) return errResp(400, 'prize_id required when kind=prize_item');

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

  // Verify prize ownership before uploading anything for the per-prize
  // case — prevents a malicious caller from filling storage with photos
  // pinned to prize_ids they don't own.
  if (kind === 'prize_item') {
    const { data: prize } = await supabase
      .from('raffle_prizes').select('id')
      .eq('id', prize_id).eq('event_id', ev.id).maybeSingle();
    if (!prize) return errResp(404, 'prize not found in this event');
  }

  const idSegment = kind === 'prize_item' ? `prize_item-${prize_id}` : kind;
  const path = `${ev.slug}/${idSegment}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('event-photos')
    .upload(path, bytes, { contentType, upsert: false });
  if (upErr) return errResp(500, 'storage upload failed: ' + upErr.message);

  const { data: pub } = supabase.storage.from('event-photos').getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  if (kind === 'prize_item') {
    const { error: updErr } = await supabase
      .from('raffle_prizes').update({ photo_url: publicUrl }).eq('id', prize_id);
    if (updErr) return errResp(500, updErr.message);
  } else {
    const column = KIND_COLUMN[kind];
    const { error: updErr } = await supabase
      .from('events').update({ [column]: publicUrl }).eq('id', ev.id);
    if (updErr) return errResp(500, updErr.message);
  }

  return ok({ url: publicUrl, kind });
});
