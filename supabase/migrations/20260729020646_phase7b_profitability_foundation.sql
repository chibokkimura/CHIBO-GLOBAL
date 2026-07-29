-- Phase 7B-1: additive profitability foundation.
-- This migration does not alter or backfill existing sales, ingredient,
-- inventory, menu, recipe, employee, or monthly-close rows.

create table if not exists public.store_profitability_settings (
  store_id text primary key
    references public.stores(id) on update cascade on delete restrict,
  sales_tax_mode text not null default 'excluded'
    check (sales_tax_mode in ('excluded', 'included', 'not_applicable')),
  sales_tax_rate numeric(7,4) not null default 0
    check (sales_tax_rate between 0 and 100),
  default_monthly_rent numeric(18,2) not null default 0
    check (default_monthly_rent >= 0),
  default_monthly_common_area_fee numeric(18,2) not null default 0
    check (default_monthly_common_area_fee >= 0),
  default_sales_commission_rate numeric(7,4) not null default 0
    check (default_sales_commission_rate between 0 and 100),
  target_labor_cost_percentage numeric(7,3)
    check (
      target_labor_cost_percentage is null
      or target_labor_cost_percentage between 0 and 100
    ),
  target_prime_cost_percentage numeric(7,3)
    check (
      target_prime_cost_percentage is null
      or target_prime_cost_percentage between 0 and 100
    ),
  target_store_margin_percentage numeric(7,3)
    check (
      target_store_margin_percentage is null
      or target_store_margin_percentage between -100 and 100
    ),
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.monthly_profitability_inputs (
  store_id text not null
    references public.stores(id) on update cascade on delete restrict,
  month_start date not null
    check (month_start = date_trunc('month', month_start)::date),
  guest_count integer
    check (guest_count is null or guest_count >= 0),
  labor_cost numeric(18,2)
    check (labor_cost is null or labor_cost >= 0),
  labor_hours numeric(18,2)
    check (labor_hours is null or labor_hours >= 0),
  sales_linked_fees numeric(18,2)
    check (sales_linked_fees is null or sales_linked_fees >= 0),
  utilities_cost numeric(18,2)
    check (utilities_cost is null or utilities_cost >= 0),
  other_operating_cost numeric(18,2)
    check (other_operating_cost is null or other_operating_cost >= 0),
  input_complete boolean not null default false,
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, month_start)
);

comment on table public.store_profitability_settings is
  'HQ-managed store defaults and profitability targets. Values are stored in the store local currency.';

comment on table public.monthly_profitability_inputs is
  'Low-burden monthly operating totals used with sales and actual food cost to calculate store profitability.';

create index if not exists monthly_profitability_inputs_month_idx
  on public.monthly_profitability_inputs (month_start desc, store_id);

create or replace function public.guard_monthly_profitability_input()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not public.is_hq()
    and exists (
      select 1
      from public.monthly_close_periods close_period
      where close_period.store_id = new.store_id
        and close_period.month_start = new.month_start
        and close_period.status = 'approved'
    )
  then
    raise exception 'Reopen the approved month before changing profitability inputs.';
  end if;

  return new;
end;
$$;

drop trigger if exists store_profitability_settings_touch_updated_at
  on public.store_profitability_settings;
create trigger store_profitability_settings_touch_updated_at
before update on public.store_profitability_settings
for each row execute function public.touch_management_updated_at();

drop trigger if exists monthly_profitability_inputs_touch_updated_at
  on public.monthly_profitability_inputs;
create trigger monthly_profitability_inputs_touch_updated_at
before update on public.monthly_profitability_inputs
for each row execute function public.touch_management_updated_at();

drop trigger if exists monthly_profitability_inputs_guard_approved
  on public.monthly_profitability_inputs;
create trigger monthly_profitability_inputs_guard_approved
before insert or update on public.monthly_profitability_inputs
for each row execute function public.guard_monthly_profitability_input();

alter table public.store_profitability_settings enable row level security;
alter table public.monthly_profitability_inputs enable row level security;

drop policy if exists "store_profitability_settings_select_store_member"
  on public.store_profitability_settings;
create policy "store_profitability_settings_select_store_member"
on public.store_profitability_settings
for select
to authenticated
using (public.is_store_member(store_id));

drop policy if exists "store_profitability_settings_insert_hq"
  on public.store_profitability_settings;
create policy "store_profitability_settings_insert_hq"
on public.store_profitability_settings
for insert
to authenticated
with check (public.is_hq());

drop policy if exists "store_profitability_settings_update_hq"
  on public.store_profitability_settings;
create policy "store_profitability_settings_update_hq"
on public.store_profitability_settings
for update
to authenticated
using (public.is_hq())
with check (public.is_hq());

drop policy if exists "monthly_profitability_inputs_select_store_member"
  on public.monthly_profitability_inputs;
create policy "monthly_profitability_inputs_select_store_member"
on public.monthly_profitability_inputs
for select
to authenticated
using (public.is_store_member(store_id));

drop policy if exists "monthly_profitability_inputs_insert_store_member"
  on public.monthly_profitability_inputs;
create policy "monthly_profitability_inputs_insert_store_member"
on public.monthly_profitability_inputs
for insert
to authenticated
with check (
  public.is_hq()
  or (not public.is_hq() and store_id = public.current_store_id())
);

drop policy if exists "monthly_profitability_inputs_update_store_member"
  on public.monthly_profitability_inputs;
create policy "monthly_profitability_inputs_update_store_member"
on public.monthly_profitability_inputs
for update
to authenticated
using (
  public.is_hq()
  or (not public.is_hq() and store_id = public.current_store_id())
)
with check (
  public.is_hq()
  or (not public.is_hq() and store_id = public.current_store_id())
);

revoke all on table public.store_profitability_settings from public;
revoke all on table public.store_profitability_settings from anon;
revoke all on table public.store_profitability_settings from authenticated;
revoke all on table public.monthly_profitability_inputs from public;
revoke all on table public.monthly_profitability_inputs from anon;
revoke all on table public.monthly_profitability_inputs from authenticated;

grant select, insert, update
on table public.store_profitability_settings
to authenticated;

grant select, insert, update
on table public.monthly_profitability_inputs
to authenticated;

grant select, insert, update, delete
on table public.store_profitability_settings
to service_role;

grant select, insert, update, delete
on table public.monthly_profitability_inputs
to service_role;
