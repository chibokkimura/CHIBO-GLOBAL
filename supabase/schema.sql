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

create table if not exists public.sales (
  id text primary key,
  store_id text not null references public.stores(id) on delete cascade,
  date text not null,
  total_amount numeric not null,
  receipt_image text null,
  is_closed boolean not null default false
);

create table if not exists public.sale_items (
  sale_id text not null references public.sales(id) on delete cascade,
  menu_id text not null,
  quantity integer not null,
  primary key (sale_id, menu_id)
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
  select u.store_id from public.app_users u
  where u.user_id = auth.uid()
  limit 1;
$$;

-- =========================
-- RLS
-- =========================

alter table public.app_users enable row level security;
alter table public.global_config enable row level security;
alter table public.stores enable row level security;
alter table public.ingredients enable row level security;
alter table public.employees enable row level security;
alter table public.menus enable row level security;
alter table public.menu_recipe_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

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
create policy "ingredients_write_hq"
on public.ingredients for insert
with check (public.is_hq());

drop policy if exists "ingredients_update_hq" on public.ingredients;
create policy "ingredients_update_hq"
on public.ingredients for update
using (public.is_hq())
with check (public.is_hq());

drop policy if exists "ingredients_delete_hq" on public.ingredients;
create policy "ingredients_delete_hq"
on public.ingredients for delete
using (public.is_hq());

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

-- sales: HQ all; OWNER own store
drop policy if exists "sales_select_hq_or_own" on public.sales;
create policy "sales_select_hq_or_own"
on public.sales for select
using (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "sales_write_hq_or_own" on public.sales;
create policy "sales_write_hq_or_own"
on public.sales for insert
with check (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "sales_update_hq_or_own" on public.sales;
create policy "sales_update_hq_or_own"
on public.sales for update
using (public.is_hq() or store_id = public.current_store_id())
with check (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "sales_delete_hq_or_own" on public.sales;
create policy "sales_delete_hq_or_own"
on public.sales for delete
using (public.is_hq() or store_id = public.current_store_id());

-- sale_items: HQ all; OWNER own store via sales join
drop policy if exists "sale_items_select_hq_or_own" on public.sale_items;
create policy "sale_items_select_hq_or_own"
on public.sale_items for select
using (
  public.is_hq() or exists (
    select 1 from public.sales s
    where s.id = sale_items.sale_id
      and s.store_id = public.current_store_id()
  )
);

drop policy if exists "sale_items_write_hq_or_own" on public.sale_items;
create policy "sale_items_write_hq_or_own"
on public.sale_items for insert
with check (
  public.is_hq() or exists (
    select 1 from public.sales s
    where s.id = sale_items.sale_id
      and s.store_id = public.current_store_id()
  )
);

drop policy if exists "sale_items_update_hq_or_own" on public.sale_items;
create policy "sale_items_update_hq_or_own"
on public.sale_items for update
using (
  public.is_hq() or exists (
    select 1 from public.sales s
    where s.id = sale_items.sale_id
      and s.store_id = public.current_store_id()
  )
)
with check (
  public.is_hq() or exists (
    select 1 from public.sales s
    where s.id = sale_items.sale_id
      and s.store_id = public.current_store_id()
  )
);

drop policy if exists "sale_items_delete_hq_or_own" on public.sale_items;
create policy "sale_items_delete_hq_or_own"
on public.sale_items for delete
using (
  public.is_hq() or exists (
    select 1 from public.sales s
    where s.id = sale_items.sale_id
      and s.store_id = public.current_store_id()
  )
);
