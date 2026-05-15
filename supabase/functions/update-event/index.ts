// Verifies the supplied edit_token, then updates whichever event fields the
// caller sent. Only fields that appear in the request body are touched, so a
// caller can update just the accent_color without resending name/host_line.
import { handleOptions } from '../_shared/cors.ts';
import { errResp, ok } from '../_shared/responses.ts';
import { authEditAccess } from '../_shared/auth.ts';
import { getServiceClient } from '../_shared/client.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errResp(405, 'method not allowed');

  const body = await req.json().catch(() => ({}));
  const supabase = getServiceClient();
  const auth = await authEditAccess(
    supabase,
    String(body.slug || '').trim(),
    String(body.edit_token || '').trim(),
  );
  if (!auth.ok) return auth.response;
  const { ev } = auth;

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return errResp(400, 'name cannot be empty');
    patch.name = name;
  }
  if ('host_line' in body) patch.host_line = body.host_line || null;
  if ('accent_color' in body) patch.accent_color = body.accent_color || '#f39c12';
  if ('event_date' in body) patch.event_date = body.event_date || null;
  if ('raffle_status' in body) {
    const s = String(body.raffle_status || 'closed');
    if (!['open', 'closed'].includes(s)) {
      return errResp(400, 'raffle_status must be open|closed');
    }
    patch.raffle_status = s;
  }
  if ('raffle_prize' in body) patch.raffle_prize = body.raffle_prize || null;
  if ('raffle_prize_photo_url' in body) patch.raffle_prize_photo_url = body.raffle_prize_photo_url || null;
  if ('show_organizer_badge' in body) patch.show_organizer_badge = !!body.show_organizer_badge;
  for (const k of [
    'organizer_name', 'organizer_email', 'organizer_phone', 'organizer_website', 'organizer_bio',
    'organizer_photo_url',
    'coaching_title', 'coaching_body', 'coaching_image_url',
  ]) {
    if (k in body) patch[k] = body[k] || null;
  }

  if (Object.keys(patch).length === 0) return errResp(400, 'no fields to update');

  const { error } = await supabase.from('events').update(patch).eq('id', ev.id);
  if (error) return errResp(500, error.message);

  return ok({ ok: true });
});
