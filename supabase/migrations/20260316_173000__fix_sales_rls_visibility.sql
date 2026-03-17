-- Fix sales visibility when app_users has multiple mappings or null store_id rows.
-- Keep HQ access broad while OWNER access is resolved by matching any mapped store_id.

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

drop policy if exists "sale_items_select_hq_or_own" on public.sale_items;
create policy "sale_items_select_hq_or_own"
on public.sale_items for select
using (
  public.is_hq()
  or exists (
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
  public.is_hq()
  or exists (
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
  public.is_hq()
  or exists (
    select 1
    from public.sales s
    join public.app_users u on u.store_id = s.store_id
    where s.id = sale_items.sale_id
      and u.user_id = auth.uid()
  )
)
with check (
  public.is_hq()
  or exists (
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
  public.is_hq()
  or exists (
    select 1
    from public.sales s
    join public.app_users u on u.store_id = s.store_id
    where s.id = sale_items.sale_id
      and u.user_id = auth.uid()
  )
);

do $$
begin
  if to_regclass('public.sale_set_items') is null then
    raise notice 'Skipping sale_set_items policy sync (table does not exist).';
    return;
  end if;

  execute 'drop policy if exists "sale_set_items_select_hq_or_own" on public.sale_set_items';
  execute $sql$
    create policy "sale_set_items_select_hq_or_own"
    on public.sale_set_items for select
    using (
      public.is_hq()
      or exists (
        select 1
        from public.sales s
        join public.app_users u on u.store_id = s.store_id
        where s.id = sale_set_items.sale_id
          and u.user_id = auth.uid()
      )
    )
  $sql$;

  execute 'drop policy if exists "sale_set_items_write_hq_or_own" on public.sale_set_items';
  execute $sql$
    create policy "sale_set_items_write_hq_or_own"
    on public.sale_set_items for insert
    with check (
      public.is_hq()
      or exists (
        select 1
        from public.sales s
        join public.app_users u on u.store_id = s.store_id
        where s.id = sale_set_items.sale_id
          and u.user_id = auth.uid()
      )
    )
  $sql$;

  execute 'drop policy if exists "sale_set_items_update_hq_or_own" on public.sale_set_items';
  execute $sql$
    create policy "sale_set_items_update_hq_or_own"
    on public.sale_set_items for update
    using (
      public.is_hq()
      or exists (
        select 1
        from public.sales s
        join public.app_users u on u.store_id = s.store_id
        where s.id = sale_set_items.sale_id
          and u.user_id = auth.uid()
      )
    )
    with check (
      public.is_hq()
      or exists (
        select 1
        from public.sales s
        join public.app_users u on u.store_id = s.store_id
        where s.id = sale_set_items.sale_id
          and u.user_id = auth.uid()
      )
    )
  $sql$;

  execute 'drop policy if exists "sale_set_items_delete_hq_or_own" on public.sale_set_items';
  execute $sql$
    create policy "sale_set_items_delete_hq_or_own"
    on public.sale_set_items for delete
    using (
      public.is_hq()
      or exists (
        select 1
        from public.sales s
        join public.app_users u on u.store_id = s.store_id
        where s.id = sale_set_items.sale_id
          and u.user_id = auth.uid()
      )
    )
  $sql$;
end
$$;

notify pgrst, 'reload schema';
