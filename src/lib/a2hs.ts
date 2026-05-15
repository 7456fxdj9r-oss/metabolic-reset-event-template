// Shared "Add to Home Screen" hint banner. Renders a dismissable bottom
// banner on iOS Safari only — Chrome shows its own install prompt and
// other iOS browsers (Chrome/Firefox/Edge on iOS) don't support
// installing. Dismissal is persisted per-key in localStorage so an
// entrant who taps × on /raffle/me?token=… doesn't see it again, while
// /event?slug=… can carry its own per-slug key.
//
// Styles for .a2hs-banner live in src/styles/a2hs.css and are imported
// once by src/layouts/Base.astro, so every page that calls installA2hs()
// automatically picks them up.

export interface A2hsOptions {
  /** Unique localStorage key for "user dismissed this banner" state. */
  dismissKey: string;
  /** Inner HTML for the detail line (after the "Save this to your phone"
   *  headline). Allows each page to tailor the why-you-want-this copy. */
  detailHtml: string;
}

export function installA2hs(opts: A2hsOptions): void {
  try {
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua) && !(/CriOS|FxiOS|EdgiOS/.test(ua));
    const isStandalone = (window.navigator as { standalone?: boolean }).standalone === true
      || window.matchMedia('(display-mode: standalone)').matches;
    if (!isIOS || isStandalone) return;
    if (localStorage.getItem(opts.dismissKey) === '1') return;

    const banner = document.createElement('aside');
    banner.className = 'a2hs-banner';
    banner.innerHTML = `
      <button type="button" class="a2hs-close" aria-label="Dismiss">×</button>
      <p class="a2hs-line">📲 <strong>Save this to your phone</strong></p>
      <p class="a2hs-detail">${opts.detailHtml}</p>
    `;
    document.body.appendChild(banner);
    banner.querySelector('.a2hs-close')!.addEventListener('click', () => {
      try { localStorage.setItem(opts.dismissKey, '1'); } catch { /* non-fatal */ }
      banner.remove();
    });
  } catch { /* non-fatal */ }
}
