// Event-level photo upload. Different from upload-photo, which is
// scoped to a transformation.
//
// Body shapes:
//   { slug, edit_token, kind: 'prize',         filename, data }
//     → legacy single-prize photo, patches events.raffle_prize_photo_url
//   { slug, edit_token, kind: 'prize_item',    prize_id, filename, data }
//     → multi-prize: patches raffle_prizes.photo_url for the given row
//   { slug, edit_token, kind: 'organizer',     filename, data }
//     → master organizer headshot, patches events.organizer_photo_url
//   { slug, edit_token, kind: 'coaching',      filename, data }
//     → coaching-program hero image, patches events.coaching_image_url
//   { slug, edit_token, kind: 'agenda_slide',  slide_id, filename, data }
//     → presenter-built sub-slide image, patches agenda_slides.image_url
//   { slug, edit_token, kind: 'coach',         coach_id, filename, data }
//     → curated coach headshot, patches coaches.photo_url for the row
//
// Writes to event-photos/<event_slug>/<kind>-<id>-<ts>.<ext>.
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

// Map of kind → which column to patch on the event row. Only used for
// event-row writes; the 'prize_item' kind targets raffle_prizes instead
// (see below).
const KIND_COLUMN: Record<string, string> = {
  prize: 'raffle_prize_photo_url',
  organizer: 'organizer_photo_url',
  coaching: 'coaching_image_url',
};
const VALID_KINDS = ['prize', 'prize_item', 'organizer', 'agenda_slide', 'coaching', 'coach'];

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errResp(405, 'method not allowed');

  const body = await req.json().catch(() => ({}));
  const kind = String(body.kind || '');
  const filename = String(body.filename || '');
  const data_b64 = String(body.data || '');

  if (!VALID_KINDS.includes(kind)) {
    return errResp(400, `kind must be one of: ${VALID_KINDS.join(', ')}`);
  }
  if (!data_b64) return errResp(400, 'data required');
  // For per-prize uploads, prize_id targets which raffle_prizes row to patch.
  const prize_id = kind === 'prize_item' ? String(body.prize_id || '').trim() : '';
  if (kind === 'prize_item' && !prize_id) return errResp(400, 'prize_id required when kind=prize_item');
  // For sub-slide uploads, slide_id targets which agenda_slides row to patch.
  const slide_id = kind === 'agenda_slide' ? String(body.slide_id || '').trim() : '';
  if (kind === 'agenda_slide' && !slide_id) return errResp(400, 'slide_id required when kind=agenda_slide');
  // For coach uploads, coach_id targets which coaches row to patch.
  const coach_id = kind === 'coach' ? String(body.coach_id || '').trim() : '';
  if (kind === 'coach' && !coach_id) return errResp(400, 'coach_id required when kind=coach');

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
  // Need slug too on the row; re-fetch with id (1 row).
  const { data: ev } = await supabase
    .from('events').select('id, edit_token, slug').eq('id', evStub.id).single();
  if (!ev) return errResp(404, 'event not found');

  // Verify ownership before uploading anything for the per-row cases —
  // prevents a malicious caller from filling storage with photos pinned
  // to prize / slide ids they don't own.
  if (kind === 'prize_item') {
    const { data: prize } = await supabase
      .from('raffle_prizes').select('id')
      .eq('id', prize_id).eq('event_id', ev.id).maybeSingle();
    if (!prize) return errResp(404, 'prize not found in this event');
  }
  if (kind === 'agenda_slide') {
    // Lateral join to confirm the sub-slide's parent agenda item belongs
    // to this event.
    const { data: slide } = await supabase
      .from('agenda_slides')
      .select('id, agenda_items!inner(event_id)')
      .eq('id', slide_id).maybeSingle();
    // deno-lint-ignore no-explicit-any
    if (!slide || (slide as any).agenda_items?.event_id !== ev.id) {
      return errResp(404, 'sub-slide not found in this event');
    }
  }
  if (kind === 'coach') {
    const { data: coach } = await supabase
      .from('coaches').select('id')
      .eq('id', coach_id).eq('event_id', ev.id).maybeSingle();
    if (!coach) return errResp(404, 'coach not found in this event');
  }

  const idSegment = kind === 'prize_item' ? `prize_item-${prize_id}`
    : kind === 'agenda_slide' ? `agenda_slide-${slide_id}`
    : kind === 'coach' ? `coach-${coach_id}`
    : kind;
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
  } else if (kind === 'agenda_slide') {
    const { error: updErr } = await supabase
      .from('agenda_slides').update({ image_url: publicUrl }).eq('id', slide_id);
    if (updErr) return errResp(500, updErr.message);
  } else if (kind === 'coach') {
    const { error: updErr } = await supabase
      .from('coaches').update({ photo_url: publicUrl }).eq('id', coach_id);
    if (updErr) return errResp(500, updErr.message);
  } else {
    const column = KIND_COLUMN[kind];
    const { error: updErr } = await supabase
      .from('events').update({ [column]: publicUrl }).eq('id', ev.id);
    if (updErr) return errResp(500, updErr.message);
  }

  return ok({ url: publicUrl, kind });
});
