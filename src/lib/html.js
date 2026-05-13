// Tiny HTML utilities shared across pages. Centralized here because the
// app builds DOM via innerHTML (Astro scoped styles wouldn't apply), so
// every render path needs to escape untrusted strings the same way.

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}
