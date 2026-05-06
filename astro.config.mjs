// @ts-check
import { defineConfig } from 'astro/config';

// Static-only output. Public read pages fetch hub/transformation/data
// straight from Supabase REST at runtime. The Build/Edit forms call
// Supabase Edge Functions. No server-side Astro routes.
//
// Set BASE in .env to '/repo-name' if deploying to project Pages
// (https://<user>.github.io/<repo>/). Leave blank for *.pages.dev or
// a user/org Pages site or a custom domain.
const base = process.env.BASE || '/';

export default defineConfig({
  site: process.env.SITE || 'https://example.com',
  base,
  trailingSlash: 'ignore',
});
