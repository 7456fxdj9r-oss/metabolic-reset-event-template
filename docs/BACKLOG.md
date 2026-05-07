# Backlog

Deferred features and ideas, captured so they don't get lost. The original
phase plan lives in `spec.json`; this doc is for things added since.

## Public event page additions

### "The Science" button
- Optional button/section on the public event page (and possibly the
  transformation page).
- Default URL the user wants it to point to:
  https://7456fxdj9r-oss.github.io/Spokane-MREvent/why-it-works.html
  (the existing Spokane "why it works" page, which already cites the
  Arterburn study).
- Per-event override: store on the event row as `science_url`. Empty = hide.
- Likely lives next to the takeaway block in the event/transformation view.

### Metabolic Quiz / Health Assessment link
- Optional URL field on the event row.
- Renders as a CTA on the public event page when populated.
- Examples of likely use: a Typeform/Google Form/MemberVault quiz the coach
  wants attendees to take after the event.
- Same "empty → don't render" rule as the science button.

### Connect-with-organizers panel (bottom of public event page)
- Section for attendees to reach the event organizers after the event.
- Inputs the coach can fill on the edit page:
  - Organizer name(s)
  - Email
  - Phone (optional)
  - Website
  - Social handles: Instagram, Facebook, TikTok, YouTube, LinkedIn (any subset)
  - Optional short bio / blurb
- Each field independently optional. Whole panel hidden if all are empty.
- Renders as the last block on `/event?slug=…`, above the footer.

## Schema additions implied by the above

```sql
alter table events
  add column if not exists science_url   text,   -- "The Science" CTA target
  add column if not exists quiz_url      text,   -- Metabolic Quiz / Health Assessment
  add column if not exists organizer_name    text,
  add column if not exists organizer_email   text,
  add column if not exists organizer_phone   text,
  add column if not exists organizer_website text,
  add column if not exists organizer_bio     text,
  add column if not exists social_instagram  text,
  add column if not exists social_facebook   text,
  add column if not exists social_tiktok     text,
  add column if not exists social_youtube    text,
  add column if not exists social_linkedin   text;
```

(Don't run this until we're ready to build the feature.)

## Other ideas already in flight

(See `spec.json` Phase 4 / Phase 5 + `project_event_template_stack.md` memory)

- Multi-host raffle with per-host edit tokens (v0.2)
- Per-participant private status URL
- Live synchronized wheel animation via Supabase Realtime Broadcast
- Follow-up CRM / lead status / CSV export / templated emails
- Cloudflare Turnstile on the Build form (Phase 4)
- Photo quotas + size caps server-side
- Onboarding playbook + auto-generated print materials
- Clean URLs (`/event/mike` instead of `/event?slug=mike`) via 404.html SPA redirect
