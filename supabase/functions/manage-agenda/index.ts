// Agenda CRUD on an event. Mirrors manage-transformation / manage-speakers.
//   { action: 'list' }
//   { action: 'add',    item: { time_label, segment, speaker?, details?, display_order? } }
//   { action: 'update', item: { id, ...patch } }
//   { action: 'delete', item_id }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function errResp(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function ok(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errResp(405, 'method not allowed');

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');
  const slug = String(body.slug || '').trim();
  const edit_token = String(body.edit_token || '').trim();
  if (!slug || !edit_token) return errResp(400, 'slug and edit_token required');
  if (!['add', 'update', 'delete', 'list', 'replace_all'].includes(action)) {
    return errResp(400, 'action must be one of: add, update, delete, list, replace_all');
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: ev } = await supabase
    .from('events').select('id, edit_token').eq('slug', slug).maybeSingle();
  if (!ev) return errResp(404, 'event not found');
  if (!timingSafeEqual(ev.edit_token, edit_token)) {
    const { data: cohost } = await supabase
      .from('hosts').select('id')
      .eq('event_id', ev.id).eq('host_token', edit_token).maybeSingle();
    if (!cohost) return errResp(403, 'invalid edit token');
  }

  if (action === 'list') {
    const { data: rows, error } = await supabase
      .from('agenda_items').select('id, time_label, segment, speaker, details, display_order, created_at')
      .eq('event_id', ev.id)
      .order('display_order', { ascending: true });
    if (error) return errResp(500, error.message);
    return ok({ items: rows || [] });
  }

  if (action === 'add') {
    const it = body.item || {};
    const time_label = String(it.time_label || '').trim();
    const segment = String(it.segment || '').trim();
    if (!time_label) return errResp(400, 'item.time_label is required');
    if (!segment) return errResp(400, 'item.segment is required');

    const { data: maxOrder } = await supabase
      .from('agenda_items').select('display_order')
      .eq('event_id', ev.id).order('display_order', { ascending: false }).limit(1).maybeSingle();

    const row = {
      event_id: ev.id,
      time_label, segment,
      speaker: it.speaker || null,
      details: it.details || null,
      display_order: numOrNull(it.display_order) ?? ((maxOrder?.display_order ?? -1) + 1),
    };
    const { data: ins, error: insErr } = await supabase
      .from('agenda_items').insert(row).select('*').single();
    if (insErr) return errResp(500, insErr.message);
    return ok({ item: ins });
  }

  if (action === 'update') {
    const it = body.item || {};
    const id = String(it.id || '');
    if (!id) return errResp(400, 'item.id is required');

    const { data: existing } = await supabase
      .from('agenda_items').select('id').eq('id', id).eq('event_id', ev.id).maybeSingle();
    if (!existing) return errResp(404, 'agenda item not found in this event');

    const patch: Record<string, unknown> = {};
    if (typeof it.time_label === 'string') {
      const v = it.time_label.trim();
      if (!v) return errResp(400, 'time_label cannot be empty');
      patch.time_label = v;
    }
    if (typeof it.segment === 'string') {
      const v = it.segment.trim();
      if (!v) return errResp(400, 'segment cannot be empty');
      patch.segment = v;
    }
    if ('speaker' in it) patch.speaker = it.speaker || null;
    if ('details' in it) patch.details = it.details || null;
    if ('display_order' in it) patch.display_order = numOrNull(it.display_order) ?? 0;
    if (Object.keys(patch).length === 0) return errResp(400, 'no fields to update');

    const { data: upd, error } = await supabase
      .from('agenda_items').update(patch).eq('id', id).select('*').single();
    if (error) return errResp(500, error.message);
    return ok({ item: upd });
  }

  if (action === 'replace_all') {
    // Bulk paste workflow: wipes existing rows and re-inserts the supplied
    // list in order. items: [{ time_label, segment, speaker?, details? }, ...]
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items) return errResp(400, 'items array required');
    if (items.length > 100) return errResp(400, 'too many items (max 100)');

    const rows = items.map((it: Record<string, unknown>, idx: number) => {
      const time_label = String(it.time_label || '').trim();
      const segment = String(it.segment || '').trim();
      if (!time_label || !segment) return null;
      return {
        event_id: ev.id,
        time_label,
        segment,
        speaker: it.speaker ? String(it.speaker).trim() || null : null,
        details: it.details ? String(it.details).trim() || null : null,
        display_order: idx,
      };
    }).filter((r): r is Exclude<typeof r, null> => r !== null);

    const { error: delErr } = await supabase
      .from('agenda_items').delete().eq('event_id', ev.id);
    if (delErr) return errResp(500, 'failed to clear existing: ' + delErr.message);

    if (rows.length === 0) return ok({ items: [] });

    const { data: inserted, error: insErr } = await supabase
      .from('agenda_items').insert(rows).select('*').order('display_order', { ascending: true });
    if (insErr) return errResp(500, 'failed to insert: ' + insErr.message);
    return ok({ items: inserted || [] });
  }

  // delete
  const id = String(body.item_id || '');
  if (!id) return errResp(400, 'item_id is required');
  const { data: existing } = await supabase
    .from('agenda_items').select('id').eq('id', id).eq('event_id', ev.id).maybeSingle();
  if (!existing) return errResp(404, 'agenda item not found in this event');
  const { error: delErr } = await supabase.from('agenda_items').delete().eq('id', id);
  if (delErr) return errResp(500, delErr.message);
  return ok({ ok: true });
});
