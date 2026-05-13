// Shared audience-hub popup. Bootstrapped from Base.astro so every
// public-facing page that an attendee might be on (event, speakers,
// stories, journey, science, raffle, raffle/me, hosts, t) receives
// pushes from the presenter's /deck-console/ regardless of which page
// the attendee currently has open.
//
// Skips host pages (/edit/, /live/, /deck/, /deck-console/, /cue/,
// /raffle-poster/) so the master organizer's own browser doesn't pop
// up the audience overlay on their command surfaces.
//
// Realtime channel name (deck:<slug>) and payload shape match the
// presenter console (src/pages/deck-console.astro). When the console
// toggles audience-display off OR advances past a pushed slide, it
// broadcasts { show: false } which dismisses any open popup.

import { createClient } from '@supabase/supabase-js';
import { getConfig, fetchDataPoints } from './supabase.js';
import { drawMultiChart, buildMetricSeries, seriesFromMetrics } from './chart.js';
import { escapeHtml } from './html.js';

type SpeakerSlim = { name: string; photo_url: string | null };
type TransformationLite = {
  id: string;
  name: string;
  before_photo_url: string | null;
  after_photo_url: string | null;
  headline_lb_loss: number | null;
  headline_bf_delta_pts: number | null;
  headline_lean_kept_pct: number | null;
  takeaway_text: string | null;
  before_date: string | null;
  after_date: string | null;
  before_weight: number | null;
  after_weight: number | null;
  before_bf: number | null;
  after_bf: number | null;
  before_lean: number | null;
  after_lean: number | null;
};
type AudiencePayload =
  | { show: false }
  | { show: true; kind: 'speaker'; speaker: SpeakerSlim; topic?: string }
  | { show: true; kind: 'multi'; speakers: SpeakerSlim[]; segment?: string }
  | { show: true; kind: 'transformation'; transformation: TransformationLite };


function dismissAudienceOverlay(): void {
  document.getElementById('audience-overlay')?.remove();
}

function renderAudienceOverlay(payload: AudiencePayload): void {
  if (payload.show !== true) return;
  let body = '';
  if (payload.kind === 'speaker') {
    const sp = payload.speaker;
    const photo = sp.photo_url
      ? `<img class="aud-photo" src="${escapeHtml(sp.photo_url)}" alt="${escapeHtml(sp.name)}" />`
      : '<div class="aud-photo empty">📷</div>';
    body = `
      <p class="aud-eyebrow">Now on stage</p>
      ${photo}
      <p class="aud-name">${escapeHtml(sp.name)}</p>
      ${payload.topic ? `<p class="aud-topic">${escapeHtml(payload.topic)}</p>` : ''}`;
  } else if (payload.kind === 'multi') {
    const tiles = payload.speakers.map((sp) => {
      const ph = sp.photo_url
        ? `<img class="aud-mini-photo" src="${escapeHtml(sp.photo_url)}" alt="${escapeHtml(sp.name)}" />`
        : '<div class="aud-mini-photo empty">📷</div>';
      return `<div class="aud-mini-tile">${ph}<p class="aud-mini-name">${escapeHtml(sp.name)}</p></div>`;
    }).join('');
    body = `
      <p class="aud-eyebrow">Now on stage</p>
      <div class="aud-mini-grid">${tiles}</div>
      ${payload.segment ? `<p class="aud-topic">${escapeHtml(payload.segment)}</p>` : ''}`;
  } else if (payload.kind === 'transformation') {
    const t = payload.transformation;
    const stats: string[] = [];
    if (t.headline_lb_loss != null) stats.push(`−${t.headline_lb_loss} lb`);
    if (t.headline_bf_delta_pts != null) stats.push(`−${t.headline_bf_delta_pts} BF`);
    if (t.headline_lean_kept_pct != null) stats.push(`${t.headline_lean_kept_pct}% lean kept`);
    const before = t.before_photo_url
      ? `<img class="aud-ba-photo" src="${escapeHtml(t.before_photo_url)}" alt="Before" />`
      : '<div class="aud-ba-photo empty">Before</div>';
    const after = t.after_photo_url
      ? `<img class="aud-ba-photo" src="${escapeHtml(t.after_photo_url)}" alt="After" />`
      : '<div class="aud-ba-photo empty">After</div>';
    // SVG drawn after the overlay mounts (drawMultiChart needs the node
    // to be laid out for clientWidth). Unique id prevents collision when
    // a rapid sequence of broadcasts replaces overlays.
    const chartId = 'aud-chart-' + (t.id || Date.now()).toString().slice(-8);
    body = `
      <p class="aud-eyebrow">Transformation story</p>
      <p class="aud-name">${escapeHtml(t.name)}</p>
      ${stats.length ? `<p class="aud-stats">${stats.join(' · ')}</p>` : ''}
      <div class="aud-ba-pair">
        <div class="aud-ba"><span class="aud-ba-label">BEFORE</span>${before}</div>
        <div class="aud-ba"><span class="aud-ba-label">AFTER</span>${after}</div>
      </div>
      <div class="aud-chart-wrap">
        <svg class="aud-chart" id="${chartId}" preserveAspectRatio="none" style="width:100%;height:200px;"></svg>
        <div class="aud-legend">
          <span class="aud-leg-item"><span class="aud-leg-dot" style="background:#f39c12"></span>Weight</span>
          <span class="aud-leg-item"><span class="aud-leg-dot" style="background:#e74c3c"></span>Body Fat</span>
          <span class="aud-leg-item"><span class="aud-leg-dot" style="background:#2ecc71"></span>Lean</span>
        </div>
      </div>
      ${t.takeaway_text ? `<p class="aud-takeaway">${escapeHtml(t.takeaway_text)}</p>` : ''}`;
    // Kick off the chart fetch after the overlay is in the DOM. Wrapped
    // in queueMicrotask so the SVG node exists when drawMultiChart runs.
    queueMicrotask(() => {
      if (!t.id) return;
      fetchDataPoints(t.id).then((pts: unknown) => {
        const svg = document.getElementById(chartId) as unknown as SVGSVGElement | null;
        if (!svg) return; // overlay was dismissed or replaced
        const { byMetric } = buildMetricSeries(t, pts as Array<{ metric: string; date: string; value: number }>);
        const series = seriesFromMetrics(byMetric);
        if (series.length) drawMultiChart(svg, series);
        else svg.parentElement?.remove();
      }).catch(() => {
        const svg = document.getElementById(chartId);
        svg?.parentElement?.remove();
      });
    });
  } else {
    return;
  }
  dismissAudienceOverlay();
  const overlay = document.createElement('div');
  overlay.id = 'audience-overlay';
  overlay.className = 'audience-overlay';
  overlay.innerHTML = `
    <div class="audience-card">
      <button type="button" class="audience-close" aria-label="Dismiss">×</button>
      ${body}
    </div>`;
  overlay.querySelector('.audience-close')!.addEventListener('click', dismissAudienceOverlay);
  document.body.appendChild(overlay);
}

// Paths the popup should NOT install on:
//   - host surfaces (DRIVE the broadcast, not consume it)
//   - attendee SIGN-UP surfaces (raffle entry form, per-entry "your
//     entry" page) — a full-screen modal mid-signup is hostile UX.
//     Attendees who want to follow the presenter can switch back to
//     /event/ or any other public page.
const EXCLUDED_PATH_FRAGMENTS = [
  '/edit/', '/live/', '/cue/', '/deck/', '/deck-console/', '/raffle-poster/',
  '/raffle/',
];

export function installAudiencePopup(): void {
  if (EXCLUDED_PATH_FRAGMENTS.some((p) => location.pathname.includes(p))) return;
  // Slug is the addressing key. Read it from query string (most pages
  // use ?slug=…). If we can't determine which event the page belongs
  // to, nothing to subscribe to.
  const slug = new URLSearchParams(location.search).get('slug');
  if (!slug) return;

  const cfg = getConfig();
  if (!cfg.url || !cfg.anonKey) return;
  try {
    const client = createClient(cfg.url, cfg.anonKey);
    const channel = client.channel(`deck:${slug}`, {
      config: { broadcast: { self: false } },
    });
    channel.on('broadcast', { event: 'audience' }, ({ payload }) => {
      if (!payload || payload.show !== true) {
        dismissAudienceOverlay();
        return;
      }
      renderAudienceOverlay(payload as AudiencePayload);
    });
    channel.subscribe();
  } catch { /* realtime not available — silent no-op */ }
}
