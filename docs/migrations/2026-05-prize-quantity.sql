-- Prize quantity: lets a single prize row represent "we have 3 of these
-- gift cards". The draw action now stamps each draw against the same
-- raffle_prizes row and the prize is "fully drawn" when the count of
-- raffle_entries with prize_id = X reaches the quantity.
--
-- drawn_winner_id on the prize row continues to track the LATEST winner
-- (used by the redraw flow and the spin overlay). For all-winners-for-a-
-- prize, query raffle_entries.prize_id reverse.
--
-- Grand prizes stay enforced singular at the app layer (manage-raffle
-- forces quantity = 1 when is_grand = true on add/update).
--
-- Run once via the Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/moymqihzrcmxmqonpcov/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
--     -H "Content-Type: application/json" \
--     -d @docs/migrations/2026-05-prize-quantity.sql
--
-- Idempotent: safe to re-run.

alter table raffle_prizes
  add column if not exists quantity int not null default 1;

-- Defensive check; existing rows get 1 from the default.
do $$
begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'raffle_prizes_quantity_positive'
  ) then
    alter table raffle_prizes
      add constraint raffle_prizes_quantity_positive
      check (quantity >= 1);
  end if;
end$$;
