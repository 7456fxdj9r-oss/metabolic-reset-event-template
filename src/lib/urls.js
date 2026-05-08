// URL helpers — let pages emit clean URLs (e.g. /event/mike) for QR codes
// and copy buttons. Static GitHub Pages hosting can't actually serve
// /event/mike, but public/404.html catches it and redirects to
// /event/?slug=mike. Net effect: anything generated through these helpers
// reads cleanly off a poster or message.

export function cleanUrl(base, page, slug, extra) {
  // base looks like '/' (root deploy) or '/repo-name/' (project pages).
  const root = typeof window !== 'undefined' ? window.location.origin : '';
  const b = base || '/';
  return `${root}${b}${page}/${encodeURIComponent(slug)}${extra || ''}`;
}
