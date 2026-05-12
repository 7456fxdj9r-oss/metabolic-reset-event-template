# Cloudflare Pages setup

Alternative deploy target to GitHub Pages. Two reasons to prefer Cloudflare:

1. **Cleaner URLs.** GH Pages serves a project site at
   `https://<user>.github.io/<repo>/event/<slug>` — the `/<repo>/`
   prefix shows up in every share link and QR code. Cloudflare Pages
   serves the same site at `https://<project>.pages.dev/event/<slug>`
   (or your custom domain) with no prefix.
2. **Server-side rewrites.** Cloudflare honors `public/_redirects` so
   clean URLs are real 200 responses, not a 404 → SPA-fallback flicker
   like on GH Pages.

You can run both in parallel during the cutover — both deploys read
from the same `main` branch.

## 1. Create the Cloudflare Pages project

[dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages
→ Create application → Pages → Connect to Git**.

Pick the `metabolic-reset-event-template` repo. First-time only:
authorize the Cloudflare Pages GitHub app for this repo.

## 2. Build settings

| Setting | Value |
|---|---|
| Framework preset | None (or "Astro" if offered — same result) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | (leave blank) |

## 3. Environment variables

Add these under **Settings → Variables and Secrets** for both
Production and Preview:

| Name | Value |
|---|---|
| `PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` (same as the GH Pages secret) |
| `PUBLIC_SUPABASE_ANON_KEY` | the Supabase anon key (same as the GH Pages secret) |
| `SITE` | the final site origin, e.g. `https://metabolic-event.pages.dev` or your custom domain |

> Do **not** set `BASE`. Leaving it unset makes Astro build at root
> (`/`), which is what Cloudflare serves at. `BASE` is only needed for
> the GH Pages project-site path prefix.

## 4. Deploy

Click **Save and Deploy**. The first build takes ~2 minutes; subsequent
pushes auto-deploy on every `main` commit.

## 5. Verify clean URLs work

Visit `https://<project>.pages.dev/event/<your-slug>` (the *clean*
form, not the query-string version). It should load directly —
no flash, no redirect. That's `public/_redirects` doing its job.

If you see the homepage instead of the event page, the redirects file
didn't ship — confirm `dist/_redirects` exists in the build output and
that the build command is `npm run build` (not `npm run dev`).

## 6. (Optional) Custom domain

**Pages → Custom domains → Set up a domain.** If the domain's DNS is
on Cloudflare, it's two clicks; otherwise add the CNAME they show you
at your DNS provider.

After the domain resolves, update the `SITE` env var to the new origin
and trigger a redeploy so things like the raffle QR codes encode the
canonical URL.

## 7. (Optional) Decommission GitHub Pages

Once the Cloudflare deploy is stable, you can leave both running or
disable the GH Pages workflow:

- Repo → **Settings → Pages → Source → None** to stop publishing, or
- Comment out the `on.push` trigger in `.github/workflows/deploy.yml`
  to keep the workflow file but pause automatic builds.

Any existing GH Pages URLs in printed materials (older posters, share
links) will keep working as long as you don't disable Pages — the
Cloudflare deploy adds a new URL, it doesn't break the old one.
