-- Adds a separate opt-in flag for "I want a free 1:1 Metabolic
-- Consultation" alongside the existing apprentice_optin. Stored on
-- raffle_entries so the host can see who flagged it on the Raffle
-- control page and follow up after the event.
--
-- The metabolic-health quiz on the raffle entry form also stores its
-- per-question answers in the existing raffle_entries.quiz_answers
-- JSONB column — no schema change needed for that part.
--
-- Run once via the Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/moymqihzrcmxmqonpcov/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
--     -H "Content-Type: application/json" \
--     -d @docs/migrations/2026-05-consultation-optin.sql
--
-- Idempotent: safe to re-run.

alter table raffle_entries
  add column if not exists consultation_optin boolean not null default false;
