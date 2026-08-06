-- Phase 5: additive ingredient purchase setup, purchase history, and monthly counts.
-- Existing sales, menu, recipe, and legacy estimated-stock tables are not altered.

create table if not exists public.store_ingredient_profiles (
  store_id text not null references public.stores(id) on delete cascade,
  ingredient_id text not null references public.ingredients(id) on delete restrict,
  category text not null default 'other'
    check (category in ('main', 'secondary', 'packaging', 'other')),
  purchase_unit text not null default 'pack'
    check (length(trim(purchase_unit)) between 1 and 40),
  content_quantity numeric(18,3) not null default 1
    check (content_quantity > 0),
  current_pack_price numeric(18,2) not null default 0
    check (current_pack_price >= 0),
  currency text not null
    check (length(trim(currency)) between 1 and 10),
  supplier text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, ingredient_id)
);

create table if not exists public.ingredient_purchases (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on delete cascade,
  ingredient_id text not null references public.ingredients(id) on delete restrict,
  purchase_date date not null,
  packages numeric(18,3) not null check (packages > 0),
  content_quantity numeric(18,3) not null check (content_quantity > 0),
  base_quantity numeric(18,3)
    generated always as (packages * content_quantity) stored,
  total_cost numeric(18,2) not null check (total_cost >= 0),
  currency text not null check (length(trim(currency)) between 1 and 10),
  supplier text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.monthly_ingredient_inventory (
  store_id text not null references public.stores(id) on delete cascade,
  ingredient_id text not null references public.ingredients(id) on delete restrict,
  month_start date not null check (month_start = date_trunc('month', month_start)::date),
  opening_quantity numeric(18,3) not null default 0 check (opening_quantity >= 0),
  waste_quantity numeric(18,3) not null default 0 check (waste_quantity >= 0),
  adjustment_quantity numeric(18,3) not null default 0,
  closing_quantity numeric(18,3) not null default 0 check (closing_quantity >= 0),
  count_complete boolean not null default false,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, ingredient_id, month_start)
);

create index if not exists store_ingredient_profiles_store_active_idx
  on public.store_ingredient_profiles (store_id, active, ingredient_id);

create index if not exists store_ingredient_profiles_ingredient_idx
  on public.store_ingredient_profiles (ingredient_id);

create index if not exists ingredient_purchases_store_date_idx
  on public.ingredient_purchases (store_id, purchase_date desc);

create index if not exists ingredient_purchases_store_ingredient_date_idx
  on public.ingredient_purchases (store_id, ingredient_id, purchase_date desc);

create index if not exists ingredient_purchases_ingredient_idx
  on public.ingredient_purchases (ingredient_id);

create index if not exists ingredient_purchases_created_by_idx
  on public.ingredient_purchases (created_by)
  where created_by is not null;

create index if not exists monthly_ingredient_inventory_store_month_idx
  on public.monthly_ingredient_inventory (store_id, month_start, ingredient_id);

create index if not exists monthly_ingredient_inventory_ingredient_idx
  on public.monthly_ingredient_inventory (ingredient_id);

create index if not exists monthly_ingredient_inventory_created_by_idx
  on public.monthly_ingredient_inventory (created_by)
  where created_by is not null;

create index if not exists monthly_ingredient_inventory_updated_by_idx
  on public.monthly_ingredient_inventory (updated_by)
  where updated_by is not null;

alter table public.store_ingredient_profiles enable row level security;
alter table public.ingredient_purchases enable row level security;
alter table public.monthly_ingredient_inventory enable row level security;

create policy "store_ingredient_profiles_select_store_member"
on public.store_ingredient_profiles
for select
to authenticated
using (public.is_store_member(store_id));

create policy "store_ingredient_profiles_insert_owner"
on public.store_ingredient_profiles
for insert
to authenticated
with check (not public.is_hq() and store_id = public.current_store_id());

create policy "store_ingredient_profiles_update_owner"
on public.store_ingredient_profiles
for update
to authenticated
using (not public.is_hq() and store_id = public.current_store_id())
with check (not public.is_hq() and store_id = public.current_store_id());

create policy "store_ingredient_profiles_delete_owner"
on public.store_ingredient_profiles
for delete
to authenticated
using (not public.is_hq() and store_id = public.current_store_id());

create policy "ingredient_purchases_select_store_member"
on public.ingredient_purchases
for select
to authenticated
using (public.is_store_member(store_id));

create policy "ingredient_purchases_insert_owner"
on public.ingredient_purchases
for insert
to authenticated
with check (not public.is_hq() and store_id = public.current_store_id());

create policy "ingredient_purchases_update_owner"
on public.ingredient_purchases
for update
to authenticated
using (not public.is_hq() and store_id = public.current_store_id())
with check (not public.is_hq() and store_id = public.current_store_id());

create policy "ingredient_purchases_delete_owner"
on public.ingredient_purchases
for delete
to authenticated
using (not public.is_hq() and store_id = public.current_store_id());

create policy "monthly_ingredient_inventory_select_store_member"
on public.monthly_ingredient_inventory
for select
to authenticated
using (public.is_store_member(store_id));

create policy "monthly_ingredient_inventory_insert_owner"
on public.monthly_ingredient_inventory
for insert
to authenticated
with check (not public.is_hq() and store_id = public.current_store_id());

create policy "monthly_ingredient_inventory_update_owner"
on public.monthly_ingredient_inventory
for update
to authenticated
using (not public.is_hq() and store_id = public.current_store_id())
with check (not public.is_hq() and store_id = public.current_store_id());

create policy "monthly_ingredient_inventory_delete_owner"
on public.monthly_ingredient_inventory
for delete
to authenticated
using (not public.is_hq() and store_id = public.current_store_id());

revoke all on table public.store_ingredient_profiles from anon;
revoke all on table public.ingredient_purchases from anon;
revoke all on table public.monthly_ingredient_inventory from anon;

grant select, insert, update, delete on table public.store_ingredient_profiles to authenticated;
grant select, insert, update, delete on table public.ingredient_purchases to authenticated;
grant select, insert, update, delete on table public.monthly_ingredient_inventory to authenticated;

grant select, insert, update, delete on table public.store_ingredient_profiles to service_role;
grant select, insert, update, delete on table public.ingredient_purchases to service_role;
grant select, insert, update, delete on table public.monthly_ingredient_inventory to service_role;
