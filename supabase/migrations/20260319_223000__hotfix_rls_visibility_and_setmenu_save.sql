-- HOTFIX: restore sales visibility and set-menu save for HQ/OWNER when app_users.user_id is missing.
-- Safe to run multiple times.

-- 1) Backfill app_users.user_id by email (for rows created manually before auth mapping)
-- Handles both uuid/text user_id column types.
do $$
declare
  user_id_type text;
begin
  select data_type
  into user_id_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'app_users'
    and column_name = 'user_id'
  limit 1;

  if user_id_type = 'uuid' then
    update public.app_users u
    set user_id = a.id
    from auth.users a
    where lower(trim(coalesce(u.email, ''))) = lower(trim(coalesce(a.email, '')))
      and u.user_id is distinct from a.id;
  else
    update public.app_users u
    set user_id = a.id::text
    from auth.users a
    where lower(trim(coalesce(u.email, ''))) = lower(trim(coalesce(a.email, '')))
      and coalesce(u.user_id::text, '') is distinct from a.id::text;
  end if;
end
$$;

-- 2) Auth email helper (fallback matching when user_id is null)
create or replace function public.current_auth_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- 3) HQ/store membership helpers
create or replace function public.is_hq()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_users u
    where (
      u.user_id = auth.uid()
      or lower(coalesce(u.email, '')) = public.current_auth_email()
    )
      and u.role = 'HQ'
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
  where (
      u.user_id = auth.uid()
      or lower(coalesce(u.email, '')) = public.current_auth_email()
    )
    and u.store_id is not null
  order by
    case when u.role = 'OWNER' then 0 else 1 end,
    lower(coalesce(u.email, '')),
    u.store_id
  limit 1;
$$;

create or replace function public.is_store_member(p_store_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_hq()
    or exists (
      select 1
      from public.app_users u
      where (
          u.user_id = auth.uid()
          or lower(coalesce(u.email, '')) = public.current_auth_email()
        )
        and u.store_id = p_store_id
    );
$$;

alter table public.app_users enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.set_menus enable row level security;
alter table public.set_menu_items enable row level security;

-- 4) app_users policies (self by user_id OR email fallback, HQ all)
drop policy if exists "app_users_select_own_or_hq" on public.app_users;
create policy "app_users_select_own_or_hq"
on public.app_users for select
using (
  public.is_hq()
  or user_id = auth.uid()
  or lower(coalesce(email, '')) = public.current_auth_email()
);

drop policy if exists "app_users_update_self" on public.app_users;
create policy "app_users_update_self"
on public.app_users for update
using (
  user_id = auth.uid()
  or lower(coalesce(email, '')) = public.current_auth_email()
)
with check (
  user_id = auth.uid()
  or lower(coalesce(email, '')) = public.current_auth_email()
);

-- 5) set_menus policies
 drop policy if exists "set_menus_select_hq_or_own" on public.set_menus;
create policy "set_menus_select_hq_or_own"
on public.set_menus for select
using (public.is_store_member(set_menus.store_id));

drop policy if exists "set_menus_write_hq_or_own" on public.set_menus;
create policy "set_menus_write_hq_or_own"
on public.set_menus for insert
with check (public.is_store_member(set_menus.store_id));

drop policy if exists "set_menus_update_hq_or_own" on public.set_menus;
create policy "set_menus_update_hq_or_own"
on public.set_menus for update
using (public.is_store_member(set_menus.store_id))
with check (public.is_store_member(set_menus.store_id));

drop policy if exists "set_menus_delete_hq_or_own" on public.set_menus;
create policy "set_menus_delete_hq_or_own"
on public.set_menus for delete
using (public.is_store_member(set_menus.store_id));

-- 6) set_menu_items policies
 drop policy if exists "set_menu_items_select_hq_or_own" on public.set_menu_items;
create policy "set_menu_items_select_hq_or_own"
on public.set_menu_items for select
using (
  exists (
    select 1
    from public.set_menus sm
    where sm.id = set_menu_items.set_menu_id
      and public.is_store_member(sm.store_id)
  )
);

drop policy if exists "set_menu_items_write_hq_or_own" on public.set_menu_items;
create policy "set_menu_items_write_hq_or_own"
on public.set_menu_items for insert
with check (
  exists (
    select 1
    from public.set_menus sm
    where sm.id = set_menu_items.set_menu_id
      and public.is_store_member(sm.store_id)
  )
);

drop policy if exists "set_menu_items_update_hq_or_own" on public.set_menu_items;
create policy "set_menu_items_update_hq_or_own"
on public.set_menu_items for update
using (
  exists (
    select 1
    from public.set_menus sm
    where sm.id = set_menu_items.set_menu_id
      and public.is_store_member(sm.store_id)
  )
)
with check (
  exists (
    select 1
    from public.set_menus sm
    where sm.id = set_menu_items.set_menu_id
      and public.is_store_member(sm.store_id)
  )
);

drop policy if exists "set_menu_items_delete_hq_or_own" on public.set_menu_items;
create policy "set_menu_items_delete_hq_or_own"
on public.set_menu_items for delete
using (
  exists (
    select 1
    from public.set_menus sm
    where sm.id = set_menu_items.set_menu_id
      and public.is_store_member(sm.store_id)
  )
);

-- 7) sales policies
 drop policy if exists "sales_select_hq_or_own" on public.sales;
create policy "sales_select_hq_or_own"
on public.sales for select
using (public.is_store_member(sales.store_id));

drop policy if exists "sales_write_hq_or_own" on public.sales;
create policy "sales_write_hq_or_own"
on public.sales for insert
with check (public.is_store_member(sales.store_id));

drop policy if exists "sales_update_hq_or_own" on public.sales;
create policy "sales_update_hq_or_own"
on public.sales for update
using (public.is_store_member(sales.store_id))
with check (public.is_store_member(sales.store_id));

drop policy if exists "sales_delete_hq_or_own" on public.sales;
create policy "sales_delete_hq_or_own"
on public.sales for delete
using (public.is_store_member(sales.store_id));

-- 8) sale_items policies
 drop policy if exists "sale_items_select_hq_or_own" on public.sale_items;
create policy "sale_items_select_hq_or_own"
on public.sale_items for select
using (
  exists (
    select 1
    from public.sales s
    where s.id = sale_items.sale_id
      and public.is_store_member(s.store_id)
  )
);

drop policy if exists "sale_items_write_hq_or_own" on public.sale_items;
create policy "sale_items_write_hq_or_own"
on public.sale_items for insert
with check (
  exists (
    select 1
    from public.sales s
    where s.id = sale_items.sale_id
      and public.is_store_member(s.store_id)
  )
);

drop policy if exists "sale_items_update_hq_or_own" on public.sale_items;
create policy "sale_items_update_hq_or_own"
on public.sale_items for update
using (
  exists (
    select 1
    from public.sales s
    where s.id = sale_items.sale_id
      and public.is_store_member(s.store_id)
  )
)
with check (
  exists (
    select 1
    from public.sales s
    where s.id = sale_items.sale_id
      and public.is_store_member(s.store_id)
  )
);

drop policy if exists "sale_items_delete_hq_or_own" on public.sale_items;
create policy "sale_items_delete_hq_or_own"
on public.sale_items for delete
using (
  exists (
    select 1
    from public.sales s
    where s.id = sale_items.sale_id
      and public.is_store_member(s.store_id)
  )
);

-- 9) sale_set_items policies (only if table exists)
do $$
begin
  if to_regclass('public.sale_set_items') is null then
    raise notice 'sale_set_items table not found, skipping sale_set_items policy rebuild';
    return;
  end if;

  execute 'alter table public.sale_set_items enable row level security';

  execute 'drop policy if exists "sale_set_items_select_hq_or_own" on public.sale_set_items';
  execute $sql$
    create policy "sale_set_items_select_hq_or_own"
    on public.sale_set_items for select
    using (
      exists (
        select 1
        from public.sales s
        where s.id = sale_set_items.sale_id
          and public.is_store_member(s.store_id)
      )
    )
  $sql$;

  execute 'drop policy if exists "sale_set_items_write_hq_or_own" on public.sale_set_items';
  execute $sql$
    create policy "sale_set_items_write_hq_or_own"
    on public.sale_set_items for insert
    with check (
      exists (
        select 1
        from public.sales s
        where s.id = sale_set_items.sale_id
          and public.is_store_member(s.store_id)
      )
    )
  $sql$;

  execute 'drop policy if exists "sale_set_items_update_hq_or_own" on public.sale_set_items';
  execute $sql$
    create policy "sale_set_items_update_hq_or_own"
    on public.sale_set_items for update
    using (
      exists (
        select 1
        from public.sales s
        where s.id = sale_set_items.sale_id
          and public.is_store_member(s.store_id)
      )
    )
    with check (
      exists (
        select 1
        from public.sales s
        where s.id = sale_set_items.sale_id
          and public.is_store_member(s.store_id)
      )
    )
  $sql$;

  execute 'drop policy if exists "sale_set_items_delete_hq_or_own" on public.sale_set_items';
  execute $sql$
    create policy "sale_set_items_delete_hq_or_own"
    on public.sale_set_items for delete
    using (
      exists (
        select 1
        from public.sales s
        where s.id = sale_set_items.sale_id
          and public.is_store_member(s.store_id)
      )
    )
  $sql$;
end
$$;

grant execute on function public.current_auth_email() to authenticated;
grant execute on function public.is_hq() to authenticated;
grant execute on function public.current_store_id() to authenticated;
grant execute on function public.is_store_member(text) to authenticated;

notify pgrst, 'reload schema';
