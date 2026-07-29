-- Phase 7B-1 follow-up: cover auth-user foreign keys identified by the
-- database performance advisor. Existing rows and application tables are
-- unchanged.

create index if not exists store_profitability_settings_created_by_idx
  on public.store_profitability_settings (created_by)
  where created_by is not null;

create index if not exists store_profitability_settings_updated_by_idx
  on public.store_profitability_settings (updated_by)
  where updated_by is not null;

create index if not exists monthly_profitability_inputs_created_by_idx
  on public.monthly_profitability_inputs (created_by)
  where created_by is not null;

create index if not exists monthly_profitability_inputs_updated_by_idx
  on public.monthly_profitability_inputs (updated_by)
  where updated_by is not null;
