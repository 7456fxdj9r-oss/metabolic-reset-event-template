// Sub-slides on an agenda item: title + optional body + optional image,
// ordered per parent. Lets the presenter weave content slides into the
// projector deck after each agenda item's auto-generated slide.
//
//   { action: 'list',   agenda_item_id? }  → all sub-slides for event,
//                                            optionally filtered by parent
//   { action: 'add',    slide: { agenda_item_id, title, body?, image_url? } }
//   { action: 'update', slide: { id, ...patch } }    // patch may include display_order
//   { action: 'delete', slide_id }
//
// Auth: same edit_token model as the rest of the agenda — master or a
// co-host token (authEditAccess).
import { handleOptions } from '../_shared/cors.ts';
import { errResp, ok } from '../_shared/responses.ts';
import { authEditAccess } from '../_shared/auth.ts';
import { getServiceClient } from '../_shared/client.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errResp(405, 'method not allowed');

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');
  const slug = String(body.slug || '').trim();
  const edit_token = String(body.edit_token || '').trim();
  if (!slug || !edit_token) return errResp(400, 'slug and edit_token required');
  if (!['list', 'add', 'update', 'delete'].includes(action)) {
    return errResp(400, 'action must be one of: list, add, update, delete');
  }

  const supabase = getServiceClient();
  const auth = await authEditAccess(supabase, slug, edit_token);
  if (!auth.ok) return auth.response;
  const event_id = auth.ev.id;

  // Helper: confirm a parent agenda item belongs to this event. Required
  // before any write — keeps a malicious caller from attaching sub-slides
  // to someone else's agenda item.
  async function assertParentInEvent(agenda_item_id: string): Promise<string | null> {
    const { data: row } = await supabase
      .from('agenda_items').select('id')
      .eq('id', agenda_item_id).eq('event_id', event_id).maybeSingle();
    return row ? null : 'agenda item not found in this event';
  }

  if (action === 'list') {
    const filterById = body.agenda_item_id ? String(body.agenda_item_id) : null;
    // Lateral join: select agenda_slides whose agenda_item belongs to
    // this event. Cleaner than a two-query approach.
    let q = supabase
      .from('agenda_slides')
      .select('id, agenda_item_id, title, body, image_url, display_order, created_at, agenda_items!inner(event_id)')
      .eq('agenda_items.event_id', event_id)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (filterById) q = q.eq('agenda_item_id', filterById);
    const { data, error } = await q;
    if (error) return errResp(500, error.message);
    // Strip the joined event_id sentinel before returning.
    const slides = (data || []).map((r) => {
      // deno-lint-ignore no-explicit-any
      const { agenda_items: _ai, ...rest } = r as any;
      return rest;
    });
    return ok({ slides });
  }

  if (action === 'add') {
    const slide = body.slide || {};
    const agenda_item_id = String(slide.agenda_item_id || '').trim();
    const title = String(slide.title || '').trim();
    if (!agenda_item_id) return errResp(400, 'agenda_item_id required');
    const parentErr = await assertParentInEvent(agenda_item_id);
    if (parentErr) return errResp(404, parentErr);
    const body_text = slide.body ? String(slide.body).trim() : null;
    const image_url = slide.image_url ? String(slide.image_url).trim() : null;
    // Title/body/image are all optional now — the editor flow uploads
    // the image AFTER the slide row is created (to satisfy the storage
    // path's coach_id/slide_id requirement), so the row exists briefly
    // with image_url=null. The edit-page client validates that the
    // user added something before submitting; a totally empty row is
    // harmless (presenter can delete or fill it later).
    // Append to the end of the parent's sub-slide list.
    const { data: maxRow } = await supabase
      .from('agenda_slides').select('display_order')
      .eq('agenda_item_id', agenda_item_id)
      .order('display_order', { ascending: false }).limit(1).maybeSingle();
    const display_order = (maxRow?.display_order ?? -1) + 1;
    const { data: inserted, error } = await supabase
      .from('agenda_slides')
      .insert({ agenda_item_id, title, body: body_text, image_url, display_order })
      .select('id, agenda_item_id, title, body, image_url, video_url, display_order, created_at')
      .single();
    if (error) return errResp(500, error.message);
    return ok({ slide: inserted });
  }

  if (action === 'update') {
    const slide = body.slide || {};
    const id = String(slide.id || '').trim();
    if (!id) return errResp(400, 'slide.id required');
    // Confirm the slide's parent belongs to this event before patching.
    const { data: existing } = await supabase
      .from('agenda_slides')
      .select('id, agenda_item_id, agenda_items!inner(event_id)')
      .eq('id', id)
      .maybeSingle();
    // deno-lint-ignore no-explicit-any
    const existingItem = (existing as any)?.agenda_items;
    if (!existing || existingItem?.event_id !== event_id) {
      return errResp(404, 'slide not found in this event');
    }
    const patch: Record<string, unknown> = {};
    if ('title' in slide) {
      // Title is optional now — empty string stored, not rejected.
      patch.title = String(slide.title || '').trim();
    }
    if ('body' in slide) patch.body = slide.body ? String(slide.body).trim() : null;
    if ('image_url' in slide) patch.image_url = slide.image_url ? String(slide.image_url).trim() : null;
    if ('video_url' in slide) patch.video_url = slide.video_url ? String(slide.video_url).trim() : null;
    if ('display_order' in slide) {
      const n = Number(slide.display_order);
      patch.display_order = Number.isFinite(n) ? Math.floor(n) : 0;
    }
    if (Object.keys(patch).length === 0) return errResp(400, 'no fields to update');
    const { data: upd, error } = await supabase
      .from('agenda_slides').update(patch).eq('id', id)
      .select('id, agenda_item_id, title, body, image_url, video_url, display_order, created_at')
      .single();
    if (error) return errResp(500, error.message);
    return ok({ slide: upd });
  }

  if (action === 'delete') {
    const slide_id = String(body.slide_id || '').trim();
    if (!slide_id) return errResp(400, 'slide_id required');
    // Same ownership check as update.
    const { data: existing } = await supabase
      .from('agenda_slides')
      .select('id, agenda_items!inner(event_id)')
      .eq('id', slide_id)
      .maybeSingle();
    // deno-lint-ignore no-explicit-any
    if (!existing || (existing as any).agenda_items?.event_id !== event_id) {
      return errResp(404, 'slide not found in this event');
    }
    const { error } = await supabase
      .from('agenda_slides').delete().eq('id', slide_id);
    if (error) return errResp(500, error.message);
    return ok({ ok: true });
  }

  return errResp(400, 'unknown action');
});
