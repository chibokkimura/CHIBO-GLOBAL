-- Stabilize CHIBO authentication and RLS without modifying application rows.
--
-- Goals:
-- 1. Anonymous users have no direct access to application tables or RPCs.
-- 2. Authenticated users receive only the table privileges required by the app.
-- 3. RLS policies explicitly target authenticated users.
-- 4. Duplicate legacy policies are removed.
-- 5. HQ-only RPCs validate the single authorized HQ account.
-- 6. Receipt purge is service-role only.

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

create or replace function public.current_auth_email()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select lower(trim(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.current_auth_uid_text()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(auth.uid()::text, '');
$$;

create or replace function public.hq_admin_email()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select 'chibo.global.mgsystem@gmail.com'::text;
$$;

create or replace function public.is_authorized_hq_email(p_email text)
returns boolean
language sql
stable
security invoker
set search_path = ''
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
  select auth.uid() is not null
    and public.is_authorized_hq_email(public.current_auth_email())
    and exists (
      select 1
      from public.app_users u
      where u.user_id = auth.uid()
        and lower(trim(u.email)) = public.current_auth_email()
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
  where auth.uid() is not null
    and u.user_id = auth.uid()
    and lower(trim(u.email)) = public.current_auth_email()
    and u.role = 'OWNER'
    and u.store_id is not null
  limit 1;
$$;

create or replace function public.is_store_member(p_store_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and (
      public.is_hq()
      or exists (
        select 1
        from public.app_users u
        where u.user_id = auth.uid()
          and lower(trim(u.email)) = public.current_auth_email()
          and u.role = 'OWNER'
          and u.store_id = p_store_id
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- HQ account-management RPCs
-- ---------------------------------------------------------------------------

create or replace function public.list_store_accounts(p_store_id text)
returns table (user_id uuid, email text, name text, store_id text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_hq() then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  return query
  select u.user_id, u.email, u.name, u.store_id
  from public.app_users u
  where u.store_id = p_store_id
  order by u.email;
end;
$$;

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------

revoke all privileges on all tables in schema public from public, anon, authenticated;

grant select, insert, update on table public.app_users to authenticated;
grant select, insert, update on table public.global_config to authenticated;
grant select, insert, update, delete on table public.stores to authenticated;
grant select, insert, update, delete on table public.ingredients to authenticated;
grant select, insert, update, delete on table public.store_ingredient_stock to authenticated;
grant select, insert, update, delete on table public.employees to authenticated;
grant select, insert, update, delete on table public.menus to authenticated;
grant select, insert, update, delete on table public.menu_recipe_items to authenticated;
grant select, insert, update, delete on table public.set_menus to authenticated;
grant select, insert, update, delete on table public.set_menu_items to authenticated;
grant select, insert, update, delete on table public.sales to authenticated;
grant select, insert, update, delete on table public.sale_items to authenticated;
grant select, insert, update, delete on table public.sale_set_items to authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.current_auth_email() to authenticated;
grant execute on function public.current_auth_uid_text() to authenticated;
grant execute on function public.hq_admin_email() to authenticated;
grant execute on function public.is_authorized_hq_email(text) to authenticated;
grant execute on function public.is_hq() to authenticated;
grant execute on function public.current_store_id() to authenticated;
grant execute on function public.is_store_member(text) to authenticated;

grant execute on function public.find_store_for_onboarding(text, text, text, text) to authenticated;
grant execute on function public.list_store_accounts(text) to authenticated;
grant execute on function public.link_account_to_store(text, text) to authenticated;
grant execute on function public.unlink_account_from_store(text, text) to authenticated;

do $$
begin
  if to_regprocedure('public.merge_stores(text,text)') is not null then
    execute 'grant execute on function public.merge_stores(text,text) to authenticated';
  end if;
end
$$;

revoke execute on function public.purge_old_receipts(integer) from public, anon, authenticated;
grant execute on function public.purge_old_receipts(integer) to service_role;

-- ---------------------------------------------------------------------------
-- RLS policy cleanup
-- ---------------------------------------------------------------------------

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

-- Every browser-accessible application policy is authenticated-only.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format(
      'alter policy %I on %I.%I to authenticated',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end
$$;

alter policy "receipts_select_hq_or_own" on storage.objects to authenticated;
alter policy "receipts_insert_hq_or_own" on storage.objects to authenticated;
alter policy "receipts_update_hq_or_own" on storage.objects to authenticated;
alter policy "receipts_delete_hq_or_own" on storage.objects to authenticated;

-- Remove overlapping policies left by earlier hotfixes.
drop policy if exists "app_users_upsert_own" on public.app_users;
drop policy if exists "app_users_select_own" on public.app_users;
drop policy if exists "app_users_update_own" on public.app_users;
drop policy if exists "app_users_update_own_check" on public.app_users;
drop policy if exists "stores_insert_own_email" on public.stores;
drop policy if exists "stores_select_own" on public.stores;

-- Canonical app_users policies.
drop policy if exists "app_users_select_own_or_hq" on public.app_users;
create policy "app_users_select_own_or_hq"
on public.app_users for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_hq())
);

drop policy if exists "app_users_insert_self" on public.app_users;
create policy "app_users_insert_self"
on public.app_users for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and lower(trim(email)) = (select public.current_auth_email())
  and (
    role = 'OWNER'
    or (
      role = 'HQ'
      and public.is_authorized_hq_email(email)
      and public.is_authorized_hq_email((select public.current_auth_email()))
    )
  )
);

drop policy if exists "app_users_update_self" on public.app_users;
create policy "app_users_update_self"
on public.app_users for update
to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and lower(trim(email)) = (select public.current_auth_email())
  and (
    role = 'OWNER'
    or (
      role = 'HQ'
      and public.is_authorized_hq_email(email)
      and public.is_authorized_hq_email((select public.current_auth_email()))
    )
  )
);

drop policy if exists "app_users_update_hq" on public.app_users;
create policy "app_users_update_hq"
on public.app_users for update
to authenticated
using ((select public.is_hq()))
with check (
  role = 'OWNER'
  or (
    role = 'HQ'
    and public.is_authorized_hq_email(email)
  )
);

-- Canonical global configuration policies.
drop policy if exists "global_config_select_all" on public.global_config;
create policy "global_config_select_all"
on public.global_config for select
to authenticated
using (true);

drop policy if exists "global_config_insert_hq" on public.global_config;
create policy "global_config_insert_hq"
on public.global_config for insert
to authenticated
with check ((select public.is_hq()));

drop policy if exists "global_config_update_hq" on public.global_config;
create policy "global_config_update_hq"
on public.global_config for update
to authenticated
using ((select public.is_hq()))
with check ((select public.is_hq()));

-- Ingredients remain visible to signed-in users. HQ controls edits except for
-- inserts required by the existing standard-ingredient bootstrap flow.
drop policy if exists "ingredients_select_all" on public.ingredients;
create policy "ingredients_select_all"
on public.ingredients for select
to authenticated
using (true);

drop policy if exists "ingredients_insert_authenticated" on public.ingredients;
create policy "ingredients_insert_authenticated"
on public.ingredients for insert
to authenticated
with check (true);

drop policy if exists "ingredients_update_hq" on public.ingredients;
create policy "ingredients_update_hq"
on public.ingredients for update
to authenticated
using ((select public.is_hq()))
with check ((select public.is_hq()));

drop policy if exists "ingredients_delete_hq" on public.ingredients;
create policy "ingredients_delete_hq"
on public.ingredients for delete
to authenticated
using ((select public.is_hq()));

-- Cache row-independent helper checks where possible.
alter policy "employees_select_hq_or_own" on public.employees
  using ((select public.is_hq()) or store_id = (select public.current_store_id()));
alter policy "employees_write_hq_or_own" on public.employees
  with check ((select public.is_hq()) or store_id = (select public.current_store_id()));
alter policy "employees_update_hq_or_own" on public.employees
  using ((select public.is_hq()) or store_id = (select public.current_store_id()))
  with check ((select public.is_hq()) or store_id = (select public.current_store_id()));
alter policy "employees_delete_hq_or_own" on public.employees
  using ((select public.is_hq()) or store_id = (select public.current_store_id()));

alter policy "menus_select_hq_or_own" on public.menus
  using ((select public.is_hq()) or store_id = (select public.current_store_id()));
alter policy "menus_write_hq_or_own" on public.menus
  with check ((select public.is_hq()) or store_id = (select public.current_store_id()));
alter policy "menus_update_hq_or_own" on public.menus
  using ((select public.is_hq()) or store_id = (select public.current_store_id()))
  with check ((select public.is_hq()) or store_id = (select public.current_store_id()));
alter policy "menus_delete_hq_or_own" on public.menus
  using ((select public.is_hq()) or store_id = (select public.current_store_id()));

alter policy "store_ingredient_stock_select_hq_or_own" on public.store_ingredient_stock
  using ((select public.is_hq()) or store_id = (select public.current_store_id()));
alter policy "store_ingredient_stock_write_hq_or_own" on public.store_ingredient_stock
  with check ((select public.is_hq()) or store_id = (select public.current_store_id()));
alter policy "store_ingredient_stock_update_hq_or_own" on public.store_ingredient_stock
  using ((select public.is_hq()) or store_id = (select public.current_store_id()))
  with check ((select public.is_hq()) or store_id = (select public.current_store_id()));
alter policy "store_ingredient_stock_delete_hq_or_own" on public.store_ingredient_stock
  using ((select public.is_hq()) or store_id = (select public.current_store_id()));

notify pgrst, 'reload schema';
