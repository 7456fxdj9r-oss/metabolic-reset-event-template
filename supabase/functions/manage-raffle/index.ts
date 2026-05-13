// Host-only endpoint. Validates the host's edit_token, then performs the
// requested raffle-management action.
//
// Body: { slug, edit_token, action, ... }
//
// Entries actions:
//   list           → returns full entry list (with PII), most recent first
//   draw           → pick a random non-drawn entry as the winner. Optional
//                    prize_id makes this a draw FOR a specific prize from
//                    raffle_prizes; the winner row gets prize_id stamped
//                    and the prize gets drawn_winner_id back-linked.
//   redraw_prize   → un-mark the existing winner for a given prize, then
//                    draw a new winner for it. Used for no-show recovery.
//   clear          → wipe all entries (resets between dry-runs).
//
// Prize-list actions:
//   list_prizes                         returns prizes[] each with drawn_count
//                                       (number of entries currently stamped
//                                       to that prize). Caller compares to
//                                       quantity to know when a prize is done.
//   add_prize    { name, description?, photo_url?, is_grand?, quantity? }
//   update_prize { prize_id, name?, description?, photo_url?, is_grand?, display_order?, quantity? }
//   remove_prize { prize_id }
//   set_grand    { prize_id | null }   convenience: makes ONE prize the
//                                       grand and clears the flag on
//                                       siblings. Pass null to un-grand.
import { handleOptions } from '../_shared/cors.ts';
import { errResp, ok } from '../_shared/responses.ts';
import { authEditAccess } from '../_shared/auth.ts';
import { getServiceClient } from '../_shared/client.ts';

const VALID_ACTIONS = [
  'list', 'draw', 'redraw_prize', 'clear',
  'list_prizes', 'add_prize', 'update_prize', 'remove_prize', 'set_grand',
];

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errResp(405, 'method not allowed');

  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || '').trim();
  const edit_token = String(body.edit_token || '').trim();
  const action = String(body.action || '');
  if (!slug || !edit_token) return errResp(400, 'slug and edit_token required');
  if (!VALID_ACTIONS.includes(action)) {
    return errResp(400, 'action must be one of: ' + VALID_ACTIONS.join(', '));
  }

  const supabase = getServiceClient();
  const auth = await authEditAccess(supabase, slug, edit_token);
  if (!auth.ok) return auth.response;
  const { ev: evStub } = auth;
  // handleDraw uses ev.raffle_prize as the prize label fallback; refetch
  // the column the auth helper doesn't return.
  const { data: ev } = await supabase
    .from('events').select('id, raffle_prize').eq('id', evStub.id).single();
  if (!ev) return errResp(404, 'event not found');

  // ---------- Entry actions ----------

  if (action === 'list') {
    const { data: entries, error } = await supabase
      .from('raffle_entries')
      .select('id, name, email, phone, invited_by, risk_score, quiz_answers, goal_text, newsletter_optin, apprentice_optin, drawn, drawn_at, prize_won, prize_id, lead_status, notes, submitted_at')
      .eq('event_id', ev.id)
      .order('submitted_at', { ascending: false });
    if (error) return errResp(500, error.message);
    return ok({ entries: entries || [] });
  }

  if (action === 'draw') {
    return await handleDraw(supabase, ev, body);
  }

  if (action === 'redraw_prize') {
    const prize_id = String(body.prize_id || '').trim();
    if (!prize_id) return errResp(400, 'prize_id required');
    const { data: prize } = await supabase
      .from('raffle_prizes').select('id, drawn_winner_id')
      .eq('id', prize_id).eq('event_id', ev.id).maybeSingle();
    if (!prize) return errResp(404, 'prize not found in this event');

    // Step 1: un-mark the existing winner so they go back into the pool.
    if (prize.drawn_winner_id) {
      const { error: clearEntryErr } = await supabase
        .from('raffle_entries')
        .update({ drawn: false, drawn_at: null, prize_won: null, prize_id: null })
        .eq('id', prize.drawn_winner_id);
      if (clearEntryErr) return errResp(500, clearEntryErr.message);
    }
    const { error: clearPrizeErr } = await supabase
      .from('raffle_prizes')
      .update({ drawn_winner_id: null, drawn_at: null })
      .eq('id', prize_id);
    if (clearPrizeErr) return errResp(500, clearPrizeErr.message);

    // Step 2: draw a fresh winner for this prize.
    return await handleDraw(supabase, ev, { ...body, prize_id });
  }

  if (action === 'clear') {
    // Wipe all entries; also clear winner back-links on prizes.
    const { error: pErr } = await supabase
      .from('raffle_prizes')
      .update({ drawn_winner_id: null, drawn_at: null })
      .eq('event_id', ev.id);
    if (pErr) return errResp(500, pErr.message);
    const { error: delErr, count } = await supabase
      .from('raffle_entries')
      .delete({ count: 'exact' })
      .eq('event_id', ev.id);
    if (delErr) return errResp(500, delErr.message);
    return ok({ deleted: count || 0 });
  }

  // ---------- Prize-list actions ----------

  if (action === 'list_prizes') {
    const { data: prizes, error } = await supabase
      .from('raffle_prizes')
      .select('id, name, description, photo_url, display_order, is_grand, quantity, drawn_winner_id, drawn_at, created_at')
      .eq('event_id', ev.id)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) return errResp(500, error.message);
    // Tally drawn entries per prize so the caller can render "X of N drawn"
    // without doing per-prize queries client-side. Bounded by entry count.
    const { data: drawnRows } = await supabase
      .from('raffle_entries').select('prize_id')
      .eq('event_id', ev.id).eq('drawn', true).not('prize_id', 'is', null);
    const drawnByPrize: Record<string, number> = {};
    for (const r of drawnRows || []) {
      const pid = (r as { prize_id: string }).prize_id;
      drawnByPrize[pid] = (drawnByPrize[pid] || 0) + 1;
    }
    const out = (prizes || []).map((p) => ({
      ...p, drawn_count: drawnByPrize[p.id] || 0,
    }));
    return ok({ prizes: out });
  }

  if (action === 'add_prize') {
    const name = body.name ? String(body.name).trim() : '';
    if (!name) return errResp(400, 'name required');
    const description = body.description ? String(body.description).trim() : null;
    const photo_url = body.photo_url ? String(body.photo_url).trim() : null;
    const is_grand = !!body.is_grand;
    // Grand prizes are singular by definition — clamp to 1 regardless of
    // what was sent. Spot prizes default to 1, max 999 to keep input sane.
    let quantity = Math.floor(Number(body.quantity ?? 1));
    if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;
    if (quantity > 999) quantity = 999;
    if (is_grand) quantity = 1;
    // If marking as grand, clear it on every existing prize for this event
    // first so the partial-unique index isn't violated.
    if (is_grand) {
      const { error: clearErr } = await supabase
        .from('raffle_prizes').update({ is_grand: false }).eq('event_id', ev.id);
      if (clearErr) return errResp(500, clearErr.message);
    }
    // Default display_order to (max + 1) so new prizes append.
    const { data: existing } = await supabase
      .from('raffle_prizes').select('display_order')
      .eq('event_id', ev.id)
      .order('display_order', { ascending: false }).limit(1);
    const nextOrder = (existing && existing[0]?.display_order != null)
      ? Number(existing[0].display_order) + 1 : 0;

    const { data: inserted, error } = await supabase
      .from('raffle_prizes')
      .insert({
        event_id: ev.id, name, description, photo_url,
        is_grand, quantity, display_order: nextOrder,
      })
      .select('id, name, description, photo_url, display_order, is_grand, quantity, drawn_winner_id, drawn_at, created_at')
      .single();
    if (error) return errResp(500, error.message);
    return ok({ prize: { ...inserted, drawn_count: 0 } });
  }

  if (action === 'update_prize') {
    const prize_id = String(body.prize_id || '').trim();
    if (!prize_id) return errResp(400, 'prize_id required');
    const { data: existing } = await supabase
      .from('raffle_prizes').select('id, is_grand, quantity')
      .eq('id', prize_id).eq('event_id', ev.id).maybeSingle();
    if (!existing) return errResp(404, 'prize not found in this event');

    const patch: Record<string, unknown> = {};
    if ('name' in body) {
      const v = String(body.name || '').trim();
      if (!v) return errResp(400, 'name cannot be empty');
      patch.name = v;
    }
    if ('description' in body) patch.description = body.description ? String(body.description).trim() : null;
    if ('photo_url' in body) patch.photo_url = body.photo_url ? String(body.photo_url).trim() : null;
    if ('display_order' in body) patch.display_order = Number(body.display_order) || 0;
    if ('is_grand' in body) {
      const wantsGrand = !!body.is_grand;
      if (wantsGrand && !existing.is_grand) {
        // Clear grand on every other prize first.
        const { error: clearErr } = await supabase
          .from('raffle_prizes').update({ is_grand: false })
          .eq('event_id', ev.id).neq('id', prize_id);
        if (clearErr) return errResp(500, clearErr.message);
      }
      patch.is_grand = wantsGrand;
    }
    if ('quantity' in body) {
      let q = Math.floor(Number(body.quantity));
      if (!Number.isFinite(q) || q < 1) q = 1;
      if (q > 999) q = 999;
      patch.quantity = q;
    }
    // Grand prizes are always singular. If we're setting is_grand (or it
    // was already true), clamp quantity to 1 regardless of what was sent.
    const becomingGrand = 'is_grand' in body
      ? !!body.is_grand
      : !!existing.is_grand;
    if (becomingGrand) patch.quantity = 1;

    if (Object.keys(patch).length === 0) return errResp(400, 'no fields to update');

    const { data: upd, error } = await supabase
      .from('raffle_prizes').update(patch).eq('id', prize_id)
      .select('id, name, description, photo_url, display_order, is_grand, quantity, drawn_winner_id, drawn_at, created_at')
      .single();
    if (error) return errResp(500, error.message);
    // Recompute drawn_count for the caller's convenience.
    const { count: drawnCount } = await supabase
      .from('raffle_entries').select('id', { count: 'exact', head: true })
      .eq('event_id', ev.id).eq('drawn', true).eq('prize_id', prize_id);
    return ok({ prize: { ...upd, drawn_count: drawnCount || 0 } });
  }

  if (action === 'remove_prize') {
    const prize_id = String(body.prize_id || '').trim();
    if (!prize_id) return errResp(400, 'prize_id required');
    // Clear prize_id on any winner entry first (FK is ON DELETE SET NULL,
    // but we'd rather null it explicitly so no stale state surfaces).
    const { error: clearErr } = await supabase
      .from('raffle_entries').update({ prize_id: null })
      .eq('prize_id', prize_id);
    if (clearErr) return errResp(500, clearErr.message);
    const { error } = await supabase
      .from('raffle_prizes').delete()
      .eq('id', prize_id).eq('event_id', ev.id);
    if (error) return errResp(500, error.message);
    return ok({ ok: true });
  }

  if (action === 'set_grand') {
    const target = body.prize_id ? String(body.prize_id).trim() : null;
    if (target) {
      const { data: t } = await supabase
        .from('raffle_prizes').select('id')
        .eq('id', target).eq('event_id', ev.id).maybeSingle();
      if (!t) return errResp(404, 'prize not found in this event');
      const { error: clearErr } = await supabase
        .from('raffle_prizes').update({ is_grand: false })
        .eq('event_id', ev.id).neq('id', target);
      if (clearErr) return errResp(500, clearErr.message);
      const { error: setErr } = await supabase
        .from('raffle_prizes').update({ is_grand: true }).eq('id', target);
      if (setErr) return errResp(500, setErr.message);
    } else {
      const { error: clearErr } = await supabase
        .from('raffle_prizes').update({ is_grand: false })
        .eq('event_id', ev.id);
      if (clearErr) return errResp(500, clearErr.message);
    }
    return ok({ grand_prize_id: target });
  }

  return errResp(400, 'unknown action');
});

// Shared draw logic used by both 'draw' and 'redraw_prize'. Picks a
// random un-drawn entry, marks it drawn, stamps prize_id + prize text,
// and back-links drawn_winner_id on the prize row.
async function handleDraw(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  ev: { id: string; raffle_prize: string | null },
  // deno-lint-ignore no-explicit-any
  body: any,
): Promise<Response> {
  const prize_id = body.prize_id ? String(body.prize_id).trim() : null;

  let prizeRow: {
    id: string; name: string; is_grand: boolean; quantity: number;
    drawn_winner_id: string | null;
  } | null = null;
  let prize_label = body.prize_label
    ? String(body.prize_label).trim()
    : (ev.raffle_prize || '');

  // Prize check + eligible-pool fetch are independent; run them in
  // parallel to shave latency off every Draw click.
  const prizeLookup = prize_id
    ? supabase.from('raffle_prizes')
        .select('id, name, is_grand, quantity, drawn_winner_id')
        .eq('id', prize_id).eq('event_id', ev.id).maybeSingle()
    : Promise.resolve({ data: null });
  const drawnCount = prize_id
    ? supabase.from('raffle_entries').select('id', { count: 'exact', head: true })
        .eq('event_id', ev.id).eq('drawn', true).eq('prize_id', prize_id)
    : Promise.resolve({ count: 0 });
  const poolQuery = supabase.from('raffle_entries').select('id, name')
    .eq('event_id', ev.id).eq('drawn', false);
  const [pResult, drawnResult, poolResult] = await Promise.all([prizeLookup, drawnCount, poolQuery]);

  if (prize_id) {
    if (!pResult.data) return errResp(404, 'prize not found in this event');
    // Gate by drawn count vs quantity, not by drawn_winner_id (which now
    // tracks the LATEST winner only). A prize with quantity 3 can be
    // drawn three times.
    const qty = Number(pResult.data.quantity) || 1;
    if ((drawnResult.count || 0) >= qty) {
      return errResp(409, 'all winners already drawn for this prize — use redraw_prize to re-roll the latest');
    }
    prizeRow = pResult.data;
    prize_label = pResult.data.name;
  }

  // Eligibility: any entry not yet drawn for this event. Spot-prize
  // winners are naturally excluded because the spot draw already
  // marked them drawn=true. The grand prize follows the same rule
  // — every drawn entry (regardless of which prize they won) is out
  // of the pool. This is the "everyone gets a fair shot" model.
  const { data: pool, error: poolErr } = poolResult;
  if (poolErr) return errResp(500, poolErr.message);
  if (!pool || pool.length === 0) {
    return errResp(409, 'no eligible entries to draw');
  }

  const pickIdx = Math.floor(Math.random() * pool.length);
  const picked = pool[pickIdx];

  const drawnAt = new Date().toISOString();
  const updates: Record<string, unknown> = {
    drawn: true,
    drawn_at: drawnAt,
    prize_won: prize_label || null,
  };
  if (prize_id) updates.prize_id = prize_id;

  const { data: updated, error: updErr } = await supabase
    .from('raffle_entries')
    .update(updates)
    .eq('id', picked.id)
    .select('id, name, email, phone, drawn, drawn_at, prize_won, prize_id')
    .single();
  if (updErr) return errResp(500, updErr.message);

  if (prize_id) {
    const { error: backErr } = await supabase
      .from('raffle_prizes')
      .update({ drawn_winner_id: picked.id, drawn_at: drawnAt })
      .eq('id', prize_id);
    if (backErr) return errResp(500, backErr.message);
  }

  return ok({
    winner: updated,
    pool_size_before: pool.length,
    prize: prizeRow,
  });
}
