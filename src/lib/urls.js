// URL helpers — every share/copy/QR/internal link in the app routes
// through here so all URLs use the clean path form (e.g. /event/mike,
// /edit/mike/sMMF…) instead of /event/?slug=mike&key=sMMF….
//
// Static hosts (GitHub Pages) can't actually serve /event/mike directly,
// so:
//   • public/404.html — catches the 404, parses the path, redirects to
//     the matching /page/?slug=… form. Two-step (visible URL flicker).
//   • public/_redirects — used by Cloudflare Pages to rewrite at request
//     time (200, not 302), so the clean URL stays in the address bar.
//
// Existing pages still read URL params off URLSearchParams, so the old
// /event/?slug=mike form keeps working in parallel.
//
// All helpers return path form like '/repo/event/mike' or '/event/mike'.
// For full URLs (QR codes, copy buttons), prepend window.location.origin
// at the call site.

function enc(s) {
  return encodeURIComponent(s);
}

// Old helper kept for backward compat. Prefer the named helpers below.
export function cleanUrl(base, page, slug, extra) {
  const root = typeof window !== 'undefined' ? window.location.origin : '';
  const b = base || '/';
  return `${root}${b}${page}/${enc(slug)}${extra || ''}`;
}

// Public event pages — slug-only.
export const eventUrl    = (base, slug) => `${base}event/${enc(slug)}`;
export const scienceUrl  = (base, slug) => `${base}science/${enc(slug)}`;
export const speakersUrl = (base, slug) => `${base}speakers/${enc(slug)}`;
export const hostsUrl    = (base, slug, key) =>
  key ? `${base}hosts/${enc(slug)}/${enc(key)}` : `${base}hosts/${enc(slug)}`;
export const storiesUrl  = (base, slug) => `${base}stories/${enc(slug)}`;
export const journeyUrl  = (base, slug) => `${base}journey/${enc(slug)}`;
export const raffleUrl   = (base, slug) => `${base}raffle/${enc(slug)}`;
export const coachingUrl = (base, slug) => `${base}coaching/${enc(slug)}`;

// Transformation deep-dive — slug + transformation-slug.
export const tUrl = (base, slug, tslug) =>
  `${base}t/${enc(slug)}/${enc(tslug)}`;

// Wheel — viewer mode is slug only; host mode appends the key.
export const wheelUrl = (base, slug, key) =>
  key ? `${base}wheel/${enc(slug)}/${enc(key)}` : `${base}wheel/${enc(slug)}`;

// Per-participant raffle "your entry" page — slug + token.
export const raffleMeUrl = (base, slug, token) =>
  `${base}raffle/me/${enc(slug)}/${enc(token)}`;

// Host-only pages — always require key.
export const editUrl         = (base, slug, key) => `${base}edit/${enc(slug)}/${enc(key)}`;
export const liveUrl         = (base, slug, key) => `${base}live/${enc(slug)}/${enc(key)}`;
export const rafflePosterUrl = (base, slug, key) => `${base}raffle-poster/${enc(slug)}/${enc(key)}`;
export const cueUrl          = (base, slug, key) => `${base}cue/${enc(slug)}/${enc(key)}`;
// Slide deck — projector display and the presenter's phone controller.
// Same realtime channel name: deck:<slug>. Both URLs require the key.
export const deckUrl         = (base, slug, key) => `${base}deck/${enc(slug)}/${enc(key)}`;
export const deckConsoleUrl  = (base, slug, key) => `${base}deck-console/${enc(slug)}/${enc(key)}`;
