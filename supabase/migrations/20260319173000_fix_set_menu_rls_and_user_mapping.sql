-- Fix set menu RLS so OWNER can write when one account is linked to multiple stores.
-- Also backfill app_users.user_id by email in case rows were inserted manually.

update public.app_users u
set user_id = a.id
from auth.users a
where lower(u.email) = lower(a.email)
  and u.user_id is distinct from a.id;

alter table public.set_menus enable row level security;
alter table public.set_menu_items enable row level security;

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

notify pgrst, 'reload schema';
