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
      and coalesce(s.reporting_status, 'active') = 'active'
  ) then
    raise exception 'Only an active operating store can receive an owner account.';
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
