// Friendly error messages. Maps the technical errors that bubble up from
// fetch / Supabase Edge Functions into one-sentence strings a non-developer
// host can act on. Keep this list short — exotic errors fall through to a
// generic "couldn't reach the server" message rather than leaking jargon.
//
// Usage:
//   try { ... } catch (err) { statusEl.textContent = fmtError(err); }
//
// The raw message is preserved on the returned object as .raw so callers
// can stash it (e.g. in a title attribute) for support / debugging.

export function fmtError(err) {
  const raw = err instanceof Error ? err.message : String(err);
  // Network failure ahead of any HTTP status — typical phone going to sleep,
  // bad wifi, server-side function spin-up timeout.
  if (raw === 'Failed to fetch' || /NetworkError|network ?request failed/i.test(raw)) {
    return makeFriendly("Couldn't reach the server. Check your connection and try again.", raw);
  }
  // The supabase.js client throws errors that start with "Supabase 401:" /
  // "Supabase 403:" etc. — see src/lib/supabase.js request().
  const m = raw.match(/Supabase\s+(\d{3})/);
  const status = m ? Number(m[1]) : null;
  if (status === 401 || status === 403) {
    return makeFriendly('Invalid edit link. Reopen the link from your edit page.', raw);
  }
  if (status === 404) {
    return makeFriendly('Not found — this event or item may have been deleted.', raw);
  }
  if (status === 409) {
    return makeFriendly('Conflict — someone else may have just changed this. Refresh and try again.', raw);
  }
  if (status === 413) {
    return makeFriendly('File too large. Try a smaller image (5MB max).', raw);
  }
  if (status === 429) {
    return makeFriendly('Too many requests right now. Wait a few seconds and try again.', raw);
  }
  if (status && status >= 500) {
    return makeFriendly("The server had a problem. Try again in a moment.", raw);
  }
  // Edge Function generic — Deno surfaces these as FunctionsHttpError /
  // similar wrapping. Don't show the wrapper jargon; show the inner gist.
  if (/FunctionsHttpError|Edge Function/i.test(raw)) {
    return makeFriendly("The server had a problem. Try again in a moment.", raw);
  }
  // Fall through: show the raw message but keep it short.
  return makeFriendly(raw.length > 140 ? raw.slice(0, 140) + '…' : raw, raw);
}

function makeFriendly(text, raw) {
  // Returns a String-like object so old code that does `statusEl.textContent =
  // fmtError(err)` keeps working (textContent stringifies it), AND callers who
  // want the raw message can read .raw.
  const s = new String(text);
  s.raw = raw;
  return s;
}
