-- CHIBO Manager (Supabase) schema + RLS
-- Run this in Supabase SQL editor (Project > SQL Editor).
-- 1) Create tables
-- 2) Enable RLS + policies
-- 3) (Optional) Run seed.sql for sample data

-- =========================
-- Tables
-- =========================

create table if not exists public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name text not null,
  role text not null check (role in ('OWNER','HQ')),
  store_id text null
);

create table if not exists public.global_config (
  id text primary key,
  config jsonb not null
);

create table if not exists public.stores (
  id text primary key,
  name text not null,
  country text not null,
  city text not null,
  owner_email text not null,
  currency text not null,
  royalty_percentage numeric not null default 5.0
);

create table if not exists public.ingredients (
  id text primary key,
  name text not null,
  unit text not null
);

create table if not exists public.store_ingredient_stock (
  store_id text not null references public.stores(id) on delete cascade,
  ingredient_name text not null,
  unit text not null,
  par numeric not null default 0,
  reorder numeric not null default 0,
  primary key (store_id, ingredient_name, unit)
);

create table if not exists public.employees (
  id text primary key,
  store_id text not null references public.stores(id) on delete cascade,
  name text not null,
  position text not null,
  age integer null,
  image_url text null
);

create table if not exists public.menus (
  id text primary key,
  store_id text not null references public.stores(id) on delete cascade,
  category text not null,
  name text not null,
  price numeric not null,
  image_url text null
);

create table if not exists public.menu_recipe_items (
  menu_id text not null references public.menus(id) on delete cascade,
  ingredient_id text not null references public.ingredients(id) on delete restrict,
  quantity numeric not null,
  primary key (menu_id, ingredient_id)
);

create table if not exists public.set_menus (
  id text primary key,
  store_id text not null references public.stores(id) on delete cascade,
  name text not null,
  price numeric not null default 0
);

create table if not exists public.set_menu_items (
  set_menu_id text not null references public.set_menus(id) on delete cascade,
  menu_id text not null references public.menus(id) on delete restrict,
  quantity numeric not null,
  primary key (set_menu_id, menu_id)
);

create table if not exists public.sales (
  id text primary key,
  store_id text not null references public.stores(id) on delete cascade,
  date text not null,
  total_amount numeric not null,
  receipt_image text null,
  is_closed boolean not null default false,
  closed_reason text null,
  comment text null,
  unique (store_id, date)
);

create table if not exists public.sale_items (
  sale_id text not null references public.sales(id) on delete cascade,
  menu_id text not null,
  quantity integer not null,
  primary key (sale_id, menu_id)
);

create table if not exists public.sale_set_items (
  sale_id text not null references public.sales(id) on delete cascade,
  set_menu_id text not null references public.set_menus(id) on delete restrict,
  quantity integer not null,
  primary key (sale_id, set_menu_id)
);

-- =========================
-- Helper: role checks
-- =========================

create or replace function public.is_hq()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_users u
    where u.user_id = auth.uid() and u.role = 'HQ'
  );
$$;

create or replace function public.current_store_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.store_id
  from public.app_users u
  where u.user_id = auth.uid()
    and u.store_id is not null
  order by
    case when u.role = 'OWNER' then 0 else 1 end,
    lower(coalesce(u.email, '')),
    u.store_id
  limit 1;
$$;

create or replace function public.find_store_for_onboarding(
  p_name text,
  p_country text,
  p_city text,
  p_currency text
)
returns table (id text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from public.stores s
  where s.name = p_name
    and s.country = p_country
    and s.city = p_city
    and s.currency = p_currency
  limit 1;
$$;

grant execute on function public.find_store_for_onboarding(text, text, text, text) to authenticated;

create or replace function public.merge_stores(
  p_source_id text,
  p_target_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_source_id is null or p_target_id is null then
    raise exception 'Source and target store are required';
  end if;
  if p_source_id = p_target_id then
    return;
  end if;
  if not public.is_hq() then
    raise exception 'Not authorized';
  end if;

  update public.sales set store_id = p_target_id where store_id = p_source_id;
  update public.menus set store_id = p_target_id where store_id = p_source_id;
  update public.employees set store_id = p_target_id where store_id = p_source_id;
  update public.app_users set store_id = p_target_id where store_id = p_source_id;

  insert into public.store_ingredient_stock (store_id, ingredient_name, unit, par, reorder)
  select p_target_id, ingredient_name, unit, par, reorder
  from public.store_ingredient_stock
  where store_id = p_source_id
  on conflict (store_id, ingredient_name, unit)
  do update set
    par = greatest(public.store_ingredient_stock.par, excluded.par),
    reorder = greatest(public.store_ingredient_stock.reorder, excluded.reorder);

  delete from public.store_ingredient_stock where store_id = p_source_id;
  delete from public.stores where id = p_source_id;
end;
$$;

grant execute on function public.merge_stores(text, text) to authenticated;

create or replace function public.list_store_accounts(p_store_id text)
returns table (user_id uuid, email text, name text, store_id text)
language sql
stable
security definer
set search_path = public
as $$
  select u.user_id, u.email, u.name, u.store_id
  from public.app_users u
  where u.store_id = p_store_id
  order by u.email;
$$;

grant execute on function public.list_store_accounts(text) to authenticated;

create or replace function public.link_account_to_store(
  p_email text,
  p_store_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_hq() then
    raise exception 'Not authorized';
  end if;

  update public.app_users
  set store_id = p_store_id, role = 'OWNER'
  where lower(email) = lower(p_email)
    and role <> 'HQ';

  if not found then
    raise exception 'Account not found or is HQ.';
  end if;
end;
$$;

grant execute on function public.link_account_to_store(text, text) to authenticated;

create or replace function public.unlink_account_from_store(
  p_email text,
  p_store_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_hq() then
    raise exception 'Not authorized';
  end if;

  update public.app_users
  set store_id = null
  where lower(email) = lower(p_email)
    and store_id = p_store_id
    and role <> 'HQ';

  if not found then
    raise exception 'Account not found or is HQ.';
  end if;
end;
$$;

grant execute on function public.unlink_account_from_store(text, text) to authenticated;

-- =========================
-- RLS
-- =========================

alter table public.app_users enable row level security;
alter table public.global_config enable row level security;
alter table public.stores enable row level security;
alter table public.ingredients enable row level security;
alter table public.store_ingredient_stock enable row level security;
alter table public.employees enable row level security;
alter table public.menus enable row level security;
alter table public.menu_recipe_items enable row level security;
alter table public.set_menus enable row level security;
alter table public.set_menu_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_set_items enable row level security;

-- app_users: users can read/update their own profile; HQ can read all
drop policy if exists "app_users_select_own_or_hq" on public.app_users;
create policy "app_users_select_own_or_hq"
on public.app_users for select
using (user_id = auth.uid() or public.is_hq());

drop policy if exists "app_users_insert_self" on public.app_users;
create policy "app_users_insert_self"
on public.app_users for insert
with check (user_id = auth.uid());

drop policy if exists "app_users_update_self" on public.app_users;
create policy "app_users_update_self"
on public.app_users for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "app_users_update_hq" on public.app_users;
create policy "app_users_update_hq"
on public.app_users for update
using (public.is_hq())
with check (public.is_hq());

-- global_config: everyone can read; only HQ can write
drop policy if exists "global_config_select_all" on public.global_config;
create policy "global_config_select_all"
on public.global_config for select
using (auth.role() = 'authenticated');

drop policy if exists "global_config_insert_hq" on public.global_config;
create policy "global_config_insert_hq"
on public.global_config for insert
with check (public.is_hq());

drop policy if exists "global_config_update_hq" on public.global_config;
create policy "global_config_update_hq"
on public.global_config for update
using (public.is_hq())
with check (public.is_hq());

-- stores: HQ all; OWNER only their store
drop policy if exists "stores_select_hq_or_own" on public.stores;
create policy "stores_select_hq_or_own"
on public.stores for select
using (public.is_hq() or id = public.current_store_id());

drop policy if exists "stores_write_hq_or_own" on public.stores;
create policy "stores_write_hq_or_own"
on public.stores for insert
with check (public.is_hq() or id = public.current_store_id());

drop policy if exists "stores_update_hq_or_own" on public.stores;
create policy "stores_update_hq_or_own"
on public.stores for update
using (public.is_hq() or id = public.current_store_id())
with check (public.is_hq() or id = public.current_store_id());

drop policy if exists "stores_delete_hq" on public.stores;
create policy "stores_delete_hq"
on public.stores for delete
using (public.is_hq());

-- ingredients: HQ all write; OWNER read-only (so recipes can render)
drop policy if exists "ingredients_select_all" on public.ingredients;
create policy "ingredients_select_all"
on public.ingredients for select
using (true);

drop policy if exists "ingredients_write_hq" on public.ingredients;
drop policy if exists "ingredients_write_hq_or_standard" on public.ingredients;
drop policy if exists "ingredients_insert_authenticated" on public.ingredients;
create policy "ingredients_insert_authenticated"
on public.ingredients for insert
with check (auth.role() = 'authenticated');

drop policy if exists "ingredients_update_hq" on public.ingredients;
create policy "ingredients_update_hq"
on public.ingredients for update
using (public.is_hq())
with check (public.is_hq());

drop policy if exists "ingredients_delete_hq" on public.ingredients;
create policy "ingredients_delete_hq"
on public.ingredients for delete
using (public.is_hq());

-- store_ingredient_stock: HQ all; OWNER only own store
drop policy if exists "store_ingredient_stock_select_hq_or_own" on public.store_ingredient_stock;
create policy "store_ingredient_stock_select_hq_or_own"
on public.store_ingredient_stock for select
using (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "store_ingredient_stock_write_hq_or_own" on public.store_ingredient_stock;
create policy "store_ingredient_stock_write_hq_or_own"
on public.store_ingredient_stock for insert
with check (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "store_ingredient_stock_update_hq_or_own" on public.store_ingredient_stock;
create policy "store_ingredient_stock_update_hq_or_own"
on public.store_ingredient_stock for update
using (public.is_hq() or store_id = public.current_store_id())
with check (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "store_ingredient_stock_delete_hq_or_own" on public.store_ingredient_stock;
create policy "store_ingredient_stock_delete_hq_or_own"
on public.store_ingredient_stock for delete
using (public.is_hq() or store_id = public.current_store_id());

-- employees: HQ all; OWNER only own store
drop policy if exists "employees_select_hq_or_own" on public.employees;
create policy "employees_select_hq_or_own"
on public.employees for select
using (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "employees_write_hq_or_own" on public.employees;
create policy "employees_write_hq_or_own"
on public.employees for insert
with check (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "employees_update_hq_or_own" on public.employees;
create policy "employees_update_hq_or_own"
on public.employees for update
using (public.is_hq() or store_id = public.current_store_id())
with check (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "employees_delete_hq_or_own" on public.employees;
create policy "employees_delete_hq_or_own"
on public.employees for delete
using (public.is_hq() or store_id = public.current_store_id());

-- menus: HQ all; OWNER only own store
drop policy if exists "menus_select_hq_or_own" on public.menus;
create policy "menus_select_hq_or_own"
on public.menus for select
using (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "menus_write_hq_or_own" on public.menus;
create policy "menus_write_hq_or_own"
on public.menus for insert
with check (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "menus_update_hq_or_own" on public.menus;
create policy "menus_update_hq_or_own"
on public.menus for update
using (public.is_hq() or store_id = public.current_store_id())
with check (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "menus_delete_hq_or_own" on public.menus;
create policy "menus_delete_hq_or_own"
on public.menus for delete
using (public.is_hq() or store_id = public.current_store_id());

-- menu_recipe_items: HQ all; OWNER only own store via menu join
drop policy if exists "recipe_select_hq_or_own" on public.menu_recipe_items;
create policy "recipe_select_hq_or_own"
on public.menu_recipe_items for select
using (
  public.is_hq() or exists (
    select 1 from public.menus m
    where m.id = menu_recipe_items.menu_id
      and m.store_id = public.current_store_id()
  )
);

drop policy if exists "recipe_write_hq_or_own" on public.menu_recipe_items;
create policy "recipe_write_hq_or_own"
on public.menu_recipe_items for insert
with check (
  public.is_hq() or exists (
    select 1 from public.menus m
    where m.id = menu_recipe_items.menu_id
      and m.store_id = public.current_store_id()
  )
);

drop policy if exists "recipe_update_hq_or_own" on public.menu_recipe_items;
create policy "recipe_update_hq_or_own"
on public.menu_recipe_items for update
using (
  public.is_hq() or exists (
    select 1 from public.menus m
    where m.id = menu_recipe_items.menu_id
      and m.store_id = public.current_store_id()
  )
)
with check (
  public.is_hq() or exists (
    select 1 from public.menus m
    where m.id = menu_recipe_items.menu_id
      and m.store_id = public.current_store_id()
  )
);

drop policy if exists "recipe_delete_hq_or_own" on public.menu_recipe_items;
create policy "recipe_delete_hq_or_own"
on public.menu_recipe_items for delete
using (
  public.is_hq() or exists (
    select 1 from public.menus m
    where m.id = menu_recipe_items.menu_id
      and m.store_id = public.current_store_id()
  )
);

-- set_menus: HQ all; OWNER only own store
drop policy if exists "set_menus_select_hq_or_own" on public.set_menus;
create policy "set_menus_select_hq_or_own"
on public.set_menus for select
using (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "set_menus_write_hq_or_own" on public.set_menus;
create policy "set_menus_write_hq_or_own"
on public.set_menus for insert
with check (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "set_menus_update_hq_or_own" on public.set_menus;
create policy "set_menus_update_hq_or_own"
on public.set_menus for update
using (public.is_hq() or store_id = public.current_store_id())
with check (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "set_menus_delete_hq_or_own" on public.set_menus;
create policy "set_menus_delete_hq_or_own"
on public.set_menus for delete
using (public.is_hq() or store_id = public.current_store_id());

-- set_menu_items: HQ all; OWNER only own store via set menu join
drop policy if exists "set_menu_items_select_hq_or_own" on public.set_menu_items;
create policy "set_menu_items_select_hq_or_own"
on public.set_menu_items for select
using (
  public.is_hq() or exists (
    select 1 from public.set_menus sm
    where sm.id = set_menu_items.set_menu_id
      and sm.store_id = public.current_store_id()
  )
);

drop policy if exists "set_menu_items_write_hq_or_own" on public.set_menu_items;
create policy "set_menu_items_write_hq_or_own"
on public.set_menu_items for insert
with check (
  public.is_hq() or exists (
    select 1 from public.set_menus sm
    where sm.id = set_menu_items.set_menu_id
      and sm.store_id = public.current_store_id()
  )
);

drop policy if exists "set_menu_items_update_hq_or_own" on public.set_menu_items;
create policy "set_menu_items_update_hq_or_own"
on public.set_menu_items for update
using (
  public.is_hq() or exists (
    select 1 from public.set_menus sm
    where sm.id = set_menu_items.set_menu_id
      and sm.store_id = public.current_store_id()
  )
)
with check (
  public.is_hq() or exists (
    select 1 from public.set_menus sm
    where sm.id = set_menu_items.set_menu_id
      and sm.store_id = public.current_store_id()
  )
);

drop policy if exists "set_menu_items_delete_hq_or_own" on public.set_menu_items;
create policy "set_menu_items_delete_hq_or_own"
on public.set_menu_items for delete
using (
  public.is_hq() or exists (
    select 1 from public.set_menus sm
    where sm.id = set_menu_items.set_menu_id
      and sm.store_id = public.current_store_id()
  )
);

-- sales: HQ all; OWNER own store
drop policy if exists "sales_select_hq_or_own" on public.sales;
create policy "sales_select_hq_or_own"
on public.sales for select
using (
  public.is_hq()
  or exists (
    select 1
    from public.app_users u
    where u.user_id = auth.uid()
      and u.store_id = sales.store_id
  )
);

drop policy if exists "sales_write_hq_or_own" on public.sales;
create policy "sales_write_hq_or_own"
on public.sales for insert
with check (
  public.is_hq()
  or exists (
    select 1
    from public.app_users u
    where u.user_id = auth.uid()
      and u.store_id = sales.store_id
  )
);

drop policy if exists "sales_update_hq_or_own" on public.sales;
create policy "sales_update_hq_or_own"
on public.sales for update
using (
  public.is_hq()
  or exists (
    select 1
    from public.app_users u
    where u.user_id = auth.uid()
      and u.store_id = sales.store_id
  )
)
with check (
  public.is_hq()
  or exists (
    select 1
    from public.app_users u
    where u.user_id = auth.uid()
      and u.store_id = sales.store_id
  )
);

drop policy if exists "sales_delete_hq_or_own" on public.sales;
create policy "sales_delete_hq_or_own"
on public.sales for delete
using (
  public.is_hq()
  or exists (
    select 1
    from public.app_users u
    where u.user_id = auth.uid()
      and u.store_id = sales.store_id
  )
);

-- sale_items: HQ all; OWNER own store via sales join
drop policy if exists "sale_items_select_hq_or_own" on public.sale_items;
create policy "sale_items_select_hq_or_own"
on public.sale_items for select
using (
  public.is_hq() or exists (
    select 1
    from public.sales s
    join public.app_users u on u.store_id = s.store_id
    where s.id = sale_items.sale_id
      and u.user_id = auth.uid()
  )
);

drop policy if exists "sale_items_write_hq_or_own" on public.sale_items;
create policy "sale_items_write_hq_or_own"
on public.sale_items for insert
with check (
  public.is_hq() or exists (
    select 1
    from public.sales s
    join public.app_users u on u.store_id = s.store_id
    where s.id = sale_items.sale_id
      and u.user_id = auth.uid()
  )
);

drop policy if exists "sale_items_update_hq_or_own" on public.sale_items;
create policy "sale_items_update_hq_or_own"
on public.sale_items for update
using (
  public.is_hq() or exists (
    select 1
    from public.sales s
    join public.app_users u on u.store_id = s.store_id
    where s.id = sale_items.sale_id
      and u.user_id = auth.uid()
  )
)
with check (
  public.is_hq() or exists (
    select 1
    from public.sales s
    join public.app_users u on u.store_id = s.store_id
    where s.id = sale_items.sale_id
      and u.user_id = auth.uid()
  )
);

drop policy if exists "sale_items_delete_hq_or_own" on public.sale_items;
create policy "sale_items_delete_hq_or_own"
on public.sale_items for delete
using (
  public.is_hq() or exists (
    select 1
    from public.sales s
    join public.app_users u on u.store_id = s.store_id
    where s.id = sale_items.sale_id
      and u.user_id = auth.uid()
  )
);

-- sale_set_items: HQ all; OWNER own store via sales join
drop policy if exists "sale_set_items_select_hq_or_own" on public.sale_set_items;
create policy "sale_set_items_select_hq_or_own"
on public.sale_set_items for select
using (
  public.is_hq() or exists (
    select 1
    from public.sales s
    join public.app_users u on u.store_id = s.store_id
    where s.id = sale_set_items.sale_id
      and u.user_id = auth.uid()
  )
);

drop policy if exists "sale_set_items_write_hq_or_own" on public.sale_set_items;
create policy "sale_set_items_write_hq_or_own"
on public.sale_set_items for insert
with check (
  public.is_hq() or exists (
    select 1
    from public.sales s
    join public.app_users u on u.store_id = s.store_id
    where s.id = sale_set_items.sale_id
      and u.user_id = auth.uid()
  )
);

drop policy if exists "sale_set_items_update_hq_or_own" on public.sale_set_items;
create policy "sale_set_items_update_hq_or_own"
on public.sale_set_items for update
using (
  public.is_hq() or exists (
    select 1
    from public.sales s
    join public.app_users u on u.store_id = s.store_id
    where s.id = sale_set_items.sale_id
      and u.user_id = auth.uid()
  )
)
with check (
  public.is_hq() or exists (
    select 1
    from public.sales s
    join public.app_users u on u.store_id = s.store_id
    where s.id = sale_set_items.sale_id
      and u.user_id = auth.uid()
  )
);

drop policy if exists "sale_set_items_delete_hq_or_own" on public.sale_set_items;
create policy "sale_set_items_delete_hq_or_own"
on public.sale_set_items for delete
using (
  public.is_hq() or exists (
    select 1
    from public.sales s
    join public.app_users u on u.store_id = s.store_id
    where s.id = sale_set_items.sale_id
      and u.user_id = auth.uid()
  )
);

-- =========================
-- Indexes (performance)
-- =========================

create index if not exists sales_store_date_idx on public.sales (store_id, date);
create index if not exists sale_items_sale_id_idx on public.sale_items (sale_id);
create index if not exists sale_set_items_sale_id_idx on public.sale_set_items (sale_id);
create index if not exists sale_set_items_set_menu_id_idx on public.sale_set_items (set_menu_id);
create index if not exists menu_recipe_items_menu_id_idx on public.menu_recipe_items (menu_id);
create index if not exists menus_store_id_idx on public.menus (store_id);
create index if not exists set_menus_store_id_idx on public.set_menus (store_id);
create index if not exists set_menu_items_set_menu_id_idx on public.set_menu_items (set_menu_id);
create index if not exists set_menu_items_menu_id_idx on public.set_menu_items (menu_id);
create index if not exists employees_store_id_idx on public.employees (store_id);
create index if not exists store_ingredient_stock_store_id_idx on public.store_ingredient_stock (store_id);

-- =========================
-- Sales Receipt Retention
-- =========================

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists "receipts_select_hq_or_own" on storage.objects;
create policy "receipts_select_hq_or_own"
on storage.objects for select
using (
  bucket_id = 'receipts'
  and (
    public.is_hq()
    or split_part(name, '/', 1) = public.current_store_id()
  )
);

drop policy if exists "receipts_insert_hq_or_own" on storage.objects;
create policy "receipts_insert_hq_or_own"
on storage.objects for insert
with check (
  bucket_id = 'receipts'
  and (
    public.is_hq()
    or split_part(name, '/', 1) = public.current_store_id()
  )
);

drop policy if exists "receipts_update_hq_or_own" on storage.objects;
create policy "receipts_update_hq_or_own"
on storage.objects for update
using (
  bucket_id = 'receipts'
  and (
    public.is_hq()
    or split_part(name, '/', 1) = public.current_store_id()
  )
)
with check (
  bucket_id = 'receipts'
  and (
    public.is_hq()
    or split_part(name, '/', 1) = public.current_store_id()
  )
);

drop policy if exists "receipts_delete_hq_or_own" on storage.objects;
create policy "receipts_delete_hq_or_own"
on storage.objects for delete
using (
  bucket_id = 'receipts'
  and (
    public.is_hq()
    or split_part(name, '/', 1) = public.current_store_id()
  )
);

alter table public.sales
  add column if not exists closed_reason text null;

alter table public.sales
  add column if not exists comment text null;

create or replace function public.purge_old_receipts(p_days int default 90)
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_paths text[];
  v_deleted int := 0;
begin
  select array_agg(receipt_image)
  into v_paths
  from public.sales
  where receipt_image is not null
    and receipt_image not like 'data:%'
    and receipt_image not like 'http%'
    and date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and to_date(date, 'YYYY-MM-DD') < (current_date - p_days);

  if v_paths is null then
    return 0;
  end if;

  delete from storage.objects
  where bucket_id = 'receipts'
    and name = any(v_paths);

  get diagnostics v_deleted = row_count;

  update public.sales
  set receipt_image = null
  where receipt_image = any(v_paths);

  return v_deleted;
end;
$$;

revoke all on function public.purge_old_receipts(int) from public;
grant execute on function public.purge_old_receipts(int) to service_role;
