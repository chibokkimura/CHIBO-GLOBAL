-- Phase 5 grant hardening.
-- Remove privileges inherited from schema defaults, then grant only the DML
-- operations used by the application. RLS still decides which rows are visible
-- and writable for each signed-in user.

revoke all on table public.store_ingredient_profiles from anon, authenticated;
revoke all on table public.ingredient_purchases from anon, authenticated;
revoke all on table public.monthly_ingredient_inventory from anon, authenticated;

grant select, insert, update, delete on table public.store_ingredient_profiles to authenticated;
grant select, insert, update, delete on table public.ingredient_purchases to authenticated;
grant select, insert, update, delete on table public.monthly_ingredient_inventory to authenticated;
