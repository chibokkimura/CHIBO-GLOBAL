-- Phase 6: monthly actual food-cost controls and a single calculation contract.
-- Existing sales, menu, recipe, and legacy estimated-stock rows are not changed.

alter table public.monthly_ingredient_inventory
  add column if not exists opening_unit_cost numeric(18,6) not null default 0
    check (opening_unit_cost >= 0),
  add column if not exists closing_unit_cost numeric(18,6) not null default 0
    check (closing_unit_cost >= 0);

create table public.monthly_cost_controls (
  store_id text not null references public.stores(id) on delete cascade,
  month_start date not null check (month_start = date_trunc('month', month_start)::date),
  target_cost_percentage numeric(7,3)
    check (target_cost_percentage is null or target_cost_percentage between 0 and 100),
  net_sales_override numeric(18,2)
    check (net_sales_override is null or net_sales_override >= 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, month_start)
);

create index monthly_cost_controls_created_by_idx
  on public.monthly_cost_controls (created_by)
  where created_by is not null;

create index monthly_cost_controls_updated_by_idx
  on public.monthly_cost_controls (updated_by)
  where updated_by is not null;

alter table public.monthly_cost_controls enable row level security;

create policy "monthly_cost_controls_select_store_member"
on public.monthly_cost_controls
for select
to authenticated
using (public.is_store_member(store_id));

create policy "monthly_cost_controls_insert_store_or_hq"
on public.monthly_cost_controls
for insert
to authenticated
with check (
  public.is_hq()
  or (store_id = public.current_store_id() and not public.is_hq())
);

create policy "monthly_cost_controls_update_store_or_hq"
on public.monthly_cost_controls
for update
to authenticated
using (
  public.is_hq()
  or (store_id = public.current_store_id() and not public.is_hq())
)
with check (
  public.is_hq()
  or (store_id = public.current_store_id() and not public.is_hq())
);

create policy "monthly_cost_controls_delete_store_or_hq"
on public.monthly_cost_controls
for delete
to authenticated
using (
  public.is_hq()
  or (store_id = public.current_store_id() and not public.is_hq())
);

revoke all on table public.monthly_cost_controls from anon, authenticated;
grant select, insert, update, delete on table public.monthly_cost_controls to authenticated;
grant select, insert, update, delete on table public.monthly_cost_controls to service_role;
