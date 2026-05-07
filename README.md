# metabolic-reset-event-template

A plug-and-play event-page template for fitness/wellness coaches.
Coaches fill a form, click Build, and get a shareable URL with branded
before/after client transformation stories and a dual-axis biometric
chart that auto-renders.

> **Reference implementation:** [Spokane Metabolic Momentum](https://7456fxdj9r-oss.github.io/Spokane-MREvent/)
> ([repo](https://github.com/7456fxdj9r-oss/Spokane-MREvent)). The chart engine
> and story-page styling were lifted directly from that project. The
> reference is left untouched; this template is a separate codebase.

## Stack

- **Astro** static site → GitHub Pages (free hosting)
- **Supabase** Postgres + Storage + Edge Functions (free tier)
- **Auth model:** edit-token URLs (no signup, no password). The Build form
  returns a public URL and a private edit URL with a long random token.
  Anyone with the edit URL can edit; anyone without can't. Same pattern as
  Pastebin / anonymous Imgur.

Estimated cost: **$0/mo** at small/moderate scale.

## Project layout

```
.
├── astro.config.mjs
├── package.json
├── public/                        # static assets served as-is
├── src/
│   ├── layouts/Base.astro         # html/head/body wrapper
│   ├── lib/
│   │   ├── chart.js               # dual-axis SVG chart (lifted from Spokane)
│   │   └── supabase.js            # tiny fetch-based REST + Edge Function client
│   ├── styles/story.css           # mobile-first dark/orange theme
│   └── pages/
│       ├── index.astro            # landing page
│       ├── build/
│       │   ├── index.astro        # Build form
│       │   └── success.astro      # shows public + private URLs, QR, mailto, .txt
│       ├── h.astro                # public event view  (?slug=)
│       ├── t.astro                # transformation view (?slug=&t=)
│       └── edit.astro             # edit page (?slug=&key=) [stub for Phase 3]
├── docs/
│   ├── spec.json                  # original handoff spec
│   ├── SUPABASE_SETUP.md          # DDL + RLS + Edge Function code
│   └── GITHUB_SETUP.md            # repo + Pages + secrets walkthrough
└── .github/workflows/deploy.yml   # build → GitHub Pages on push to main
```

## Phase status

Per `docs/spec.json`:

- ✅ **Phase 0** — decisions locked in (working name `metabolic-reset-event-template`,
  hosting GitHub Pages, free tier everywhere)
- ✅ **Phase 1** — skeleton + Build form scaffolded; success page with
  loud-save UI, QR, mailto, .txt download
- 🟡 **Phase 2** — public event + transformation pages render client-side
  from Supabase REST. Chart engine lifted in.
- ⏳ **Phase 3** — full admin UI (transformation list, photo upload,
  time-series paste box). The edit page is currently a read-only stub.
- ⏳ **Phase 4** — Cloudflare Turnstile, photo quotas, polish
- ⏳ **Phase 5** — raffle (deferred until v0.1 has real users)

## URL conventions (v0.1)

GitHub Pages can't generate dynamic routes for user-created slugs at
build time, so v0.1 uses query strings:

- Public event: `/h?slug=mike`
- Transformation: `/t?slug=mike&t=cearra-story`
- Edit: `/edit?slug=mike&key=<edit_token>`

These scan fine from a QR code. Phase 4 polish can swap to clean URLs
(`/h/mike`) using the standard 404.html SPA-redirect trick.

## Running locally

```bash
npm install
cp .env.example .env
# fill in PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

Without Supabase credentials, the Build form will refuse to submit
(showing a `not configured` notice) but the rest of the site renders.

## Setup walkthroughs

- [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) — create the project,
  run the schema, deploy the `create-event` Edge Function
- [docs/GITHUB_SETUP.md](docs/GITHUB_SETUP.md) — create the repo, enable
  Pages, add secrets

## Lessons carried forward from the reference project

(See spec for the full list. The non-obvious ones:)

- **Store raw values, format at render time.** Rounded numbers caused
  inconsistencies in the Spokane app (40 vs 40.6).
- **Auto-snap-to-nice axis values per chart.** BF ranges differ wildly per
  person; the chart computes ticks from each transformation's data.
- **Edit-token > auth for this audience.** Don't second-guess this; coaches
  won't sign up.
- **Test on real phones constantly.** QR scan is the primary entry point.
