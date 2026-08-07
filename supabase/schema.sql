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
  royalty_percentage numeric not null default 5.0,
  reporting_status text not null default 'active' check (reporting_status in ('active', 'quarantined', 'test')),
  data_quality_note text
);

alter table public.stores
  add column if not exists reporting_status text not null default 'active',
  add column if not exists data_quality_note text;

alter table public.stores
  drop constraint if exists stores_reporting_status_check;
alter table public.stores
  add constraint stores_reporting_status_check
  check (reporting_status in ('active', 'quarantined', 'test'));

create table if not exists public.store_id_aliases (
  legacy_store_id text primary key,
  canonical_store_id text not null references public.stores(id) on update cascade on delete restrict,
  reason text not null,
  migrated_at timestamptz not null default now()
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

create table if not exists public.sale_menu_items (
  sale_id text not null references public.sales(id) on delete cascade,
  menu_id text not null references public.menus(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
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

create or replace function public.current_auth_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.current_auth_uid_text()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.uid()::text, '');
$$;

create or replace function public.hq_admin_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'chibo.global.mgsystem@gmail.com'::text;
$$;

create or replace function public.is_authorized_hq_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(coalesce(p_email, ''))) = public.hq_admin_email();
$$;

create or replace function public.is_hq()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_authorized_hq_email(public.current_auth_email())
    and exists (
      select 1
      from public.app_users u
      where (
          coalesce(u.user_id::text, '') = public.current_auth_uid_text()
          or lower(trim(coalesce(u.email, ''))) = public.current_auth_email()
        )
        and u.role = 'HQ'
        and public.is_authorized_hq_email(u.email)
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

revoke all on function public.find_store_for_onboarding(text, text, text, text)
from public, anon, authenticated;
grant execute on function public.find_store_for_onboarding(text, text, text, text) to service_role;

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
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_hq() then
    raise exception 'Not authorized';
  end if;

  return query
  select u.user_id, u.email, u.name, u.store_id
  from public.app_users u
  where u.store_id = p_store_id
  order by u.email;
end;
$$;

revoke all on function public.list_store_accounts(text) from public, anon;
grant execute on function public.list_store_accounts(text) to authenticated, service_role;

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
alter table public.store_id_aliases enable row level security;
alter table public.ingredients enable row level security;
alter table public.store_ingredient_stock enable row level security;
alter table public.employees enable row level security;
alter table public.menus enable row level security;
alter table public.menu_recipe_items enable row level security;
alter table public.set_menus enable row level security;
alter table public.set_menu_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_menu_items enable row level security;
alter table public.sale_set_items enable row level security;

revoke all on table public.store_id_aliases from public, anon, authenticated;
create index if not exists store_id_aliases_canonical_store_idx
  on public.store_id_aliases(canonical_store_id);
drop policy if exists "store_id_aliases_select_hq_or_canonical" on public.store_id_aliases;
create policy "store_id_aliases_select_hq_or_canonical"
on public.store_id_aliases for select
to authenticated
using (public.is_hq() or canonical_store_id = public.current_store_id());
grant select on table public.store_id_aliases to authenticated, service_role;

-- app_users: users can read/update their own profile; HQ can read all
drop policy if exists "app_users_select_own_or_hq" on public.app_users;
create policy "app_users_select_own_or_hq"
on public.app_users for select
using (user_id = auth.uid() or public.is_hq());

drop policy if exists "app_users_insert_self" on public.app_users;
drop policy if exists "app_users_upsert_own" on public.app_users;
create policy "app_users_insert_self"
on public.app_users for insert
to authenticated
with check (
  coalesce(user_id::text, '') = public.current_auth_uid_text()
  and lower(trim(coalesce(email, ''))) = public.current_auth_email()
  and (
    (
      role = 'OWNER'
      and store_id is null
    )
    or (
      role = 'HQ'
      and store_id is null
      and public.is_authorized_hq_email(email)
      and public.is_authorized_hq_email(public.current_auth_email())
    )
  )
);

create or replace function public.guard_owner_app_user_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.is_hq() then
    return new;
  end if;

  if new.user_id is distinct from old.user_id
    or lower(trim(new.email)) is distinct from lower(trim(old.email))
    or new.role is distinct from old.role
    or new.store_id is distinct from old.store_id
  then
    raise exception 'Store assignment and account role can only be changed by HQ.';
  end if;

  return new;
end;
$$;

drop trigger if exists app_users_guard_owner_assignment on public.app_users;
create trigger app_users_guard_owner_assignment
before update on public.app_users
for each row execute function public.guard_owner_app_user_assignment();

revoke all on function public.guard_owner_app_user_assignment() from public, anon, authenticated;
grant execute on function public.guard_owner_app_user_assignment() to service_role;

drop policy if exists "app_users_update_self" on public.app_users;
drop policy if exists "app_users_update_own" on public.app_users;
drop policy if exists "app_users_update_own_check" on public.app_users;
create policy "app_users_update_self"
on public.app_users for update
to authenticated
using (
  coalesce(user_id::text, '') = public.current_auth_uid_text()
)
with check (
  coalesce(user_id::text, '') = public.current_auth_uid_text()
  and lower(trim(coalesce(email, ''))) = public.current_auth_email()
  and (
    role = 'OWNER'
    or (
      role = 'HQ'
      and public.is_authorized_hq_email(email)
      and public.is_authorized_hq_email(public.current_auth_email())
    )
  )
);

drop policy if exists "app_users_update_hq" on public.app_users;
create policy "app_users_update_hq"
on public.app_users for update
using (public.is_hq())
with check (
  role = 'OWNER'
  or (
    role = 'HQ'
    and public.is_authorized_hq_email(email)
  )
);

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
drop policy if exists "stores_select_own" on public.stores;
create policy "stores_select_hq_or_own"
on public.stores for select
using (public.is_hq() or id = public.current_store_id());

drop policy if exists "stores_write_hq_or_own" on public.stores;
drop policy if exists "stores_insert_own_email" on public.stores;
drop policy if exists "stores_insert_hq" on public.stores;
create policy "stores_insert_hq"
on public.stores for insert
to authenticated
with check (public.is_hq());

drop policy if exists "stores_update_hq_or_own" on public.stores;
drop policy if exists "stores_update_hq" on public.stores;
create policy "stores_update_hq"
on public.stores for update
to authenticated
using (public.is_hq())
with check (public.is_hq());

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
using (
  public.is_hq()
  or exists (
    select 1
    from public.app_users u
    where u.user_id = auth.uid()
      and u.store_id = set_menus.store_id
  )
);

drop policy if exists "set_menus_write_hq_or_own" on public.set_menus;
create policy "set_menus_write_hq_or_own"
on public.set_menus for insert
with check (
  public.is_hq()
  or exists (
    select 1
    from public.app_users u
    where u.user_id = auth.uid()
      and u.store_id = set_menus.store_id
  )
);

drop policy if exists "set_menus_update_hq_or_own" on public.set_menus;
create policy "set_menus_update_hq_or_own"
on public.set_menus for update
using (
  public.is_hq()
  or exists (
    select 1
    from public.app_users u
    where u.user_id = auth.uid()
      and u.store_id = set_menus.store_id
  )
)
with check (
  public.is_hq()
  or exists (
    select 1
    from public.app_users u
    where u.user_id = auth.uid()
      and u.store_id = set_menus.store_id
  )
);

drop policy if exists "set_menus_delete_hq_or_own" on public.set_menus;
create policy "set_menus_delete_hq_or_own"
on public.set_menus for delete
using (
  public.is_hq()
  or exists (
    select 1
    from public.app_users u
    where u.user_id = auth.uid()
      and u.store_id = set_menus.store_id
  )
);

-- set_menu_items: HQ all; OWNER only own store via set menu join
drop policy if exists "set_menu_items_select_hq_or_own" on public.set_menu_items;
create policy "set_menu_items_select_hq_or_own"
on public.set_menu_items for select
using (
  public.is_hq() or exists (
    select 1
    from public.set_menus sm
    join public.app_users u on u.store_id = sm.store_id
    where sm.id = set_menu_items.set_menu_id
      and u.user_id = auth.uid()
  )
);

drop policy if exists "set_menu_items_write_hq_or_own" on public.set_menu_items;
create policy "set_menu_items_write_hq_or_own"
on public.set_menu_items for insert
with check (
  public.is_hq() or exists (
    select 1
    from public.set_menus sm
    join public.app_users u on u.store_id = sm.store_id
    where sm.id = set_menu_items.set_menu_id
      and u.user_id = auth.uid()
  )
);

drop policy if exists "set_menu_items_update_hq_or_own" on public.set_menu_items;
create policy "set_menu_items_update_hq_or_own"
on public.set_menu_items for update
using (
  public.is_hq() or exists (
    select 1
    from public.set_menus sm
    join public.app_users u on u.store_id = sm.store_id
    where sm.id = set_menu_items.set_menu_id
      and u.user_id = auth.uid()
  )
)
with check (
  public.is_hq() or exists (
    select 1
    from public.set_menus sm
    join public.app_users u on u.store_id = sm.store_id
    where sm.id = set_menu_items.set_menu_id
      and u.user_id = auth.uid()
  )
);

drop policy if exists "set_menu_items_delete_hq_or_own" on public.set_menu_items;
create policy "set_menu_items_delete_hq_or_own"
on public.set_menu_items for delete
using (
  public.is_hq() or exists (
    select 1
    from public.set_menus sm
    join public.app_users u on u.store_id = sm.store_id
    where sm.id = set_menu_items.set_menu_id
      and u.user_id = auth.uid()
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

-- sale_menu_items: direct menu-level quantities for recipe cost.
drop policy if exists "sale_menu_items_select_store_member" on public.sale_menu_items;
create policy "sale_menu_items_select_store_member"
on public.sale_menu_items for select
to authenticated
using (
  exists (
    select 1 from public.sales s
    where s.id = sale_menu_items.sale_id
      and public.is_store_member(s.store_id)
  )
);

drop policy if exists "sale_menu_items_insert_store_member" on public.sale_menu_items;
create policy "sale_menu_items_insert_store_member"
on public.sale_menu_items for insert
to authenticated
with check (
  exists (
    select 1
    from public.sales s
    join public.menus m on m.id = sale_menu_items.menu_id
    where s.id = sale_menu_items.sale_id
      and m.store_id = s.store_id
      and public.is_store_member(s.store_id)
  )
);

drop policy if exists "sale_menu_items_update_store_member" on public.sale_menu_items;
create policy "sale_menu_items_update_store_member"
on public.sale_menu_items for update
to authenticated
using (
  exists (
    select 1 from public.sales s
    where s.id = sale_menu_items.sale_id
      and public.is_store_member(s.store_id)
  )
)
with check (
  exists (
    select 1
    from public.sales s
    join public.menus m on m.id = sale_menu_items.menu_id
    where s.id = sale_menu_items.sale_id
      and m.store_id = s.store_id
      and public.is_store_member(s.store_id)
  )
);

drop policy if exists "sale_menu_items_delete_store_member" on public.sale_menu_items;
create policy "sale_menu_items_delete_store_member"
on public.sale_menu_items for delete
to authenticated
using (
  exists (
    select 1 from public.sales s
    where s.id = sale_menu_items.sale_id
      and public.is_store_member(s.store_id)
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
create index if not exists sale_menu_items_menu_id_idx on public.sale_menu_items (menu_id);
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

create or replace function public.can_access_store_storage_path(p_path_store_id text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    public.is_hq()
    or p_path_store_id = public.current_store_id()
    or exists (
      select 1
      from public.store_id_aliases a
      where a.legacy_store_id = p_path_store_id
        and a.canonical_store_id = public.current_store_id()
    );
$$;

revoke all on function public.can_access_store_storage_path(text) from public, anon;
grant execute on function public.can_access_store_storage_path(text) to authenticated, service_role;

drop policy if exists "receipts_select_hq_or_own" on storage.objects;
create policy "receipts_select_hq_or_own"
on storage.objects for select
to authenticated
using (
  bucket_id = 'receipts'
  and public.can_access_store_storage_path(split_part(name, '/', 1))
);

drop policy if exists "receipts_insert_hq_or_own" on storage.objects;
create policy "receipts_insert_hq_or_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'receipts'
  and public.can_access_store_storage_path(split_part(name, '/', 1))
);

drop policy if exists "receipts_update_hq_or_own" on storage.objects;
create policy "receipts_update_hq_or_own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'receipts'
  and public.can_access_store_storage_path(split_part(name, '/', 1))
)
with check (
  bucket_id = 'receipts'
  and public.can_access_store_storage_path(split_part(name, '/', 1))
);

drop policy if exists "receipts_delete_hq_or_own" on storage.objects;
create policy "receipts_delete_hq_or_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'receipts'
  and public.can_access_store_storage_path(split_part(name, '/', 1))
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

-- =========================
-- HQ-only maintenance: pending owner assignment and recoverable purge for test/held stores
-- =========================
-- Safely remove QA/quarantined stores without weakening protection for active stores.
-- Every purge stores a complete JSON snapshot first so the removed data remains recoverable.

create table if not exists public.store_purge_archives (
  id bigint generated always as identity primary key,
  store_id text not null,
  store_name text not null,
  reporting_status text not null,
  snapshot jsonb not null,
  deleted_by uuid,
  deleted_at timestamptz not null default now()
);

comment on table public.store_purge_archives is
  'HQ-only recovery snapshots created immediately before a test or quarantined store is purged.';

alter table public.store_purge_archives enable row level security;

drop policy if exists store_purge_archives_select_hq on public.store_purge_archives;
create policy store_purge_archives_select_hq
  on public.store_purge_archives
  for select
  to authenticated
  using (public.is_hq());

revoke all on table public.store_purge_archives from public, anon, authenticated;
grant select on table public.store_purge_archives to authenticated;
grant all on table public.store_purge_archives to service_role;
grant usage, select on sequence public.store_purge_archives_id_seq to service_role;

create or replace function public.list_pending_owner_accounts()
returns table (user_id uuid, email text, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_hq() then
    raise exception 'Not authorized';
  end if;

  return query
  select u.user_id, u.email, u.name
  from public.app_users u
  where u.role = 'OWNER'
    and u.store_id is null
  order by lower(u.email);
end;
$$;

revoke all on function public.list_pending_owner_accounts() from public, anon;
grant execute on function public.list_pending_owner_accounts() to authenticated, service_role;

create or replace function public.list_owner_account_assignments()
returns table (
  user_id uuid,
  email text,
  name text,
  store_id text,
  store_name text,
  reporting_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_hq() then
    raise exception 'Not authorized';
  end if;

  return query
  select
    u.user_id,
    u.email,
    u.name,
    u.store_id,
    s.name,
    s.reporting_status
  from public.app_users u
  left join public.stores s on s.id = u.store_id
  where u.role = 'OWNER'
  order by (u.store_id is null) desc, lower(u.email);
end;
$$;

revoke all on function public.list_owner_account_assignments() from public, anon;
grant execute on function public.list_owner_account_assignments() to authenticated, service_role;

create or replace function public.link_account_to_store(
  p_email text,
  p_store_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_hq() then
    raise exception 'Not authorized';
  end if;

  if v_email = '' then
    raise exception 'Email is required.';
  end if;

  if not exists (
    select 1
    from public.stores s
    where s.id = p_store_id
      and coalesce(s.reporting_status, 'active') in ('active', 'test')
  ) then
    raise exception 'Only an operating or test store can receive an owner account.';
  end if;

  update public.app_users
  set store_id = p_store_id,
      role = 'OWNER'
  where lower(trim(email)) = v_email
    and role <> 'HQ';

  if not found then
    raise exception 'Account not found or is HQ.';
  end if;
end;
$$;

revoke all on function public.link_account_to_store(text, text) from public, anon;
grant execute on function public.link_account_to_store(text, text) to authenticated, service_role;

create or replace function public.unlink_account_from_store(
  p_email text,
  p_store_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_hq() then
    raise exception 'Not authorized';
  end if;

  update public.app_users
  set store_id = null
  where lower(trim(email)) = v_email
    and store_id = p_store_id
    and role <> 'HQ';

  if not found then
    raise exception 'Account is not linked to this store or is HQ.';
  end if;
end;
$$;

revoke all on function public.unlink_account_from_store(text, text) from public, anon;
grant execute on function public.unlink_account_from_store(text, text) to authenticated, service_role;

create or replace function public.prevent_monthly_close_snapshot_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and current_setting('app.purge_non_operating_store', true) = 'on'
    and public.is_hq()
    and exists (
      select 1
      from public.stores s
      where s.id = old.store_id
        and coalesce(s.reporting_status, 'active') in ('test', 'quarantined')
    )
  then
    return old;
  end if;

  raise exception 'Monthly close snapshots are immutable.';
end;
$$;

create or replace function public.purge_non_operating_store(
  p_store_id text,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_snapshot jsonb;
  v_archive_id bigint;
  v_detached_accounts integer := 0;
begin
  if not public.is_hq() then
    raise exception 'Not authorized';
  end if;

  select * into v_store
  from public.stores
  where id = p_store_id
  for update;

  if not found then
    raise exception 'Store not found.';
  end if;

  if coalesce(v_store.reporting_status, 'active') not in ('test', 'quarantined') then
    raise exception 'Active operating stores cannot be purged.';
  end if;

  if trim(coalesce(p_confirmation, '')) <> v_store.name then
    raise exception 'Store name confirmation does not match.';
  end if;

  select jsonb_build_object(
    'store', to_jsonb(v_store),
    'app_users', coalesce((select jsonb_agg(to_jsonb(x)) from public.app_users x where x.store_id = p_store_id), '[]'::jsonb),
    'sales', coalesce((select jsonb_agg(to_jsonb(x)) from public.sales x where x.store_id = p_store_id), '[]'::jsonb),
    'sale_items', coalesce((select jsonb_agg(to_jsonb(x)) from public.sale_items x join public.sales s on s.id = x.sale_id where s.store_id = p_store_id), '[]'::jsonb),
    'sale_menu_items', coalesce((select jsonb_agg(to_jsonb(x)) from public.sale_menu_items x join public.sales s on s.id = x.sale_id where s.store_id = p_store_id), '[]'::jsonb),
    'sale_set_items', coalesce((select jsonb_agg(to_jsonb(x)) from public.sale_set_items x join public.sales s on s.id = x.sale_id where s.store_id = p_store_id), '[]'::jsonb),
    'menus', coalesce((select jsonb_agg(to_jsonb(x)) from public.menus x where x.store_id = p_store_id), '[]'::jsonb),
    'menu_recipe_items', coalesce((select jsonb_agg(to_jsonb(x)) from public.menu_recipe_items x join public.menus m on m.id = x.menu_id where m.store_id = p_store_id), '[]'::jsonb),
    'set_menus', coalesce((select jsonb_agg(to_jsonb(x)) from public.set_menus x where x.store_id = p_store_id), '[]'::jsonb),
    'set_menu_items', coalesce((select jsonb_agg(to_jsonb(x)) from public.set_menu_items x join public.set_menus sm on sm.id = x.set_menu_id where sm.store_id = p_store_id), '[]'::jsonb),
    'employees', coalesce((select jsonb_agg(to_jsonb(x)) from public.employees x where x.store_id = p_store_id), '[]'::jsonb),
    'store_ingredient_stock', coalesce((select jsonb_agg(to_jsonb(x)) from public.store_ingredient_stock x where x.store_id = p_store_id), '[]'::jsonb),
    'store_ingredient_profiles', coalesce((select jsonb_agg(to_jsonb(x)) from public.store_ingredient_profiles x where x.store_id = p_store_id), '[]'::jsonb),
    'ingredient_purchases', coalesce((select jsonb_agg(to_jsonb(x)) from public.ingredient_purchases x where x.store_id = p_store_id), '[]'::jsonb),
    'monthly_ingredient_inventory', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_ingredient_inventory x where x.store_id = p_store_id), '[]'::jsonb),
    'monthly_cost_controls', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_cost_controls x where x.store_id = p_store_id), '[]'::jsonb),
    'store_profitability_settings', coalesce((select jsonb_agg(to_jsonb(x)) from public.store_profitability_settings x where x.store_id = p_store_id), '[]'::jsonb),
    'monthly_profitability_inputs', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_profitability_inputs x where x.store_id = p_store_id), '[]'::jsonb),
    'monthly_close_periods', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_close_periods x where x.store_id = p_store_id), '[]'::jsonb),
    'monthly_close_tasks', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_close_tasks x where x.store_id = p_store_id), '[]'::jsonb),
    'monthly_close_snapshots', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_close_snapshots x where x.store_id = p_store_id), '[]'::jsonb),
    'sales_vouchers', coalesce((select jsonb_agg(to_jsonb(x)) from public.sales_vouchers x where x.store_id = p_store_id), '[]'::jsonb),
    'tax_calendar_events', coalesce((select jsonb_agg(to_jsonb(x)) from public.tax_calendar_events x where x.store_id = p_store_id), '[]'::jsonb),
    'profitability_import_profiles', coalesce((select jsonb_agg(to_jsonb(x)) from public.profitability_import_profiles x where x.store_id = p_store_id), '[]'::jsonb),
    'profitability_import_runs', coalesce((select jsonb_agg(to_jsonb(x)) from public.profitability_import_runs x where x.store_id = p_store_id), '[]'::jsonb),
    'monthly_product_sales_submissions', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_product_sales_submissions x where x.store_id = p_store_id), '[]'::jsonb),
    'monthly_product_sales_totals', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_product_sales_totals x where x.store_id = p_store_id), '[]'::jsonb),
    'ai_profitability_advice_runs', coalesce((select jsonb_agg(to_jsonb(x)) from public.ai_profitability_advice_runs x where x.store_id = p_store_id), '[]'::jsonb),
    'store_id_aliases', coalesce((select jsonb_agg(to_jsonb(x)) from public.store_id_aliases x where x.canonical_store_id = p_store_id), '[]'::jsonb)
  ) into v_snapshot;

  insert into public.store_purge_archives (
    store_id, store_name, reporting_status, snapshot, deleted_by
  ) values (
    v_store.id, v_store.name, v_store.reporting_status, v_snapshot, auth.uid()
  ) returning id into v_archive_id;

  update public.app_users set store_id = null where store_id = p_store_id;
  get diagnostics v_detached_accounts = row_count;

  -- Remove the non-operating store's close lock first. Source-table guards correctly
  -- block writes to approved months until the close period no longer exists.
  perform set_config('app.purge_non_operating_store', 'on', true);
  delete from public.monthly_close_snapshots where store_id = p_store_id;
  perform set_config('app.purge_non_operating_store', 'off', true);
  delete from public.monthly_close_tasks where store_id = p_store_id;
  delete from public.monthly_close_periods where store_id = p_store_id;
  -- Delete the confirmed submission parent; its totals cascade atomically.
  delete from public.monthly_product_sales_submissions where store_id = p_store_id;

  delete from public.sales_vouchers where store_id = p_store_id;
  delete from public.sale_items where sale_id in (select id from public.sales where store_id = p_store_id);
  delete from public.sale_menu_items where sale_id in (select id from public.sales where store_id = p_store_id);
  delete from public.sale_set_items where sale_id in (select id from public.sales where store_id = p_store_id);
  delete from public.sales where store_id = p_store_id;

  delete from public.set_menu_items where set_menu_id in (select id from public.set_menus where store_id = p_store_id);
  delete from public.set_menus where store_id = p_store_id;
  delete from public.menu_recipe_items where menu_id in (select id from public.menus where store_id = p_store_id);
  delete from public.menus where store_id = p_store_id;

  delete from public.monthly_profitability_inputs where store_id = p_store_id;
  delete from public.profitability_import_runs where store_id = p_store_id;
  delete from public.profitability_import_profiles where store_id = p_store_id;
  delete from public.store_profitability_settings where store_id = p_store_id;
  delete from public.tax_calendar_events where store_id = p_store_id;
  delete from public.store_id_aliases where canonical_store_id = p_store_id;

  delete from public.stores where id = p_store_id;

  return jsonb_build_object(
    'archive_id', v_archive_id,
    'store_id', v_store.id,
    'store_name', v_store.name,
    'detached_accounts', v_detached_accounts
  );
end;
$$;

revoke all on function public.purge_non_operating_store(text, text) from public, anon;
grant execute on function public.purge_non_operating_store(text, text) to authenticated, service_role;
