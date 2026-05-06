# GitHub Pages setup

Deploy `coach-hub-template` to a free `https://<user>.github.io/<repo>/` URL.

## 1. Create the GitHub repo

From the project folder:

```bash
gh repo create coach-hub-template --public --source=. --remote=origin --push
```

(Or do it through the web UI; just make sure you push `main`.)

## 2. Enable Pages from Actions

GitHub repo → **Settings → Pages → Source → GitHub Actions**.
The included `.github/workflows/deploy.yml` runs on every push to `main`.

## 3. Add repository secrets

GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**.

Add:

| Name | Value |
|---|---|
| `PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `PUBLIC_SUPABASE_ANON_KEY` | the anon key from Supabase → Settings → API |
| `PUBLIC_TURNSTILE_SITE_KEY` | (optional) Cloudflare Turnstile site key |

> These get inlined into the client bundle at build time. The anon key is
> meant to be public; RLS policies (see `SUPABASE_SETUP.md`) enforce that
> anon role can only read.

## 4. (Optional) override the URL paths

If you use a custom domain or move to user/org Pages, set repo **Variables**:

| Name | Value |
|---|---|
| `SITE_BASE_PATH` | `/` for custom domain or user/org root |
| `SITE_URL` | the canonical site origin, e.g. `https://hub.coach-mike.com` |

## 5. Push and watch the build

```bash
git push
```

Then watch progress at the repo's **Actions** tab. After the first
successful run, your site is live at the URL printed in the Pages settings.

## 6. CORS for Supabase Edge Functions

The `create-hub` template in `SUPABASE_SETUP.md` uses
`Access-Control-Allow-Origin: *`. That's fine for v0.1. If you tighten it
later, add your GitHub Pages origin to the allowlist.
