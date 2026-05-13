// Auth helper shared across every write-side Edge Function. The
// project supports two equivalent tokens:
//   - events.edit_token  → master / event creator
//   - hosts.host_token   → co-host (added by the master)
// Both grant the same write surface today; only the master can add or
// remove co-hosts. Functions that need to distinguish use isMaster.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { errResp } from './responses.ts';

// Constant-time string comparison — prevents leaking edit_token length /
// content via response-timing side channels.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export type EventStub = { id: string; edit_token: string };
export type AuthOk = { ok: true; ev: EventStub; isMaster: boolean };
export type AuthFail = { ok: false; response: Response };
export type AuthResult = AuthOk | AuthFail;

// Resolves slug → event row and verifies edit_token against the master
// token OR any co-host's host_token. Returns either:
//   { ok: true, ev, isMaster }     — caller proceeds
//   { ok: false, response }        — caller returns response directly
// Functions that need additional event columns should query again
// with `ev.id`; this helper deliberately stays narrow.
export async function authEditAccess(
  supabase: SupabaseClient,
  slug: string,
  edit_token: string,
): Promise<AuthResult> {
  if (!slug || !edit_token) {
    return { ok: false, response: errResp(400, 'slug and edit_token required') };
  }
  const { data: ev } = await supabase
    .from('events').select('id, edit_token')
    .eq('slug', slug).maybeSingle();
  if (!ev) return { ok: false, response: errResp(404, 'event not found') };
  if (timingSafeEqual(ev.edit_token, edit_token)) {
    return { ok: true, ev, isMaster: true };
  }
  const { data: cohost } = await supabase
    .from('hosts').select('id')
    .eq('event_id', ev.id).eq('host_token', edit_token).maybeSingle();
  if (!cohost) return { ok: false, response: errResp(403, 'invalid edit token') };
  return { ok: true, ev, isMaster: false };
}
