-- Phase 2: preserve the affected source rows, repair the clearly misassigned
-- Vietnam sales account, and keep uncertain/test stores out of HQ reporting.

alter table public.stores
  add column if not exists reporting_status text not null default 'active',
  add column if not exists data_quality_note text;

alter table public.stores
  drop constraint if exists stores_reporting_status_check;
alter table public.stores
  add constraint stores_reporting_status_check
  check (reporting_status in ('active', 'quarantined', 'test'));

-- Keep browser owners immutable while allowing trusted database maintenance and
-- SECURITY DEFINER administration functions to perform an HQ-approved repair.
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

create table if not exists public.store_id_aliases (
  legacy_store_id text primary key,
  canonical_store_id text not null references public.stores(id) on update cascade on delete restrict,
  reason text not null,
  migrated_at timestamptz not null default now()
);

alter table public.store_id_aliases enable row level security;
revoke all on table public.store_id_aliases from public, anon, authenticated;
create index if not exists store_id_aliases_canonical_store_idx
  on public.store_id_aliases(canonical_store_id);
drop policy if exists "store_id_aliases_select_hq_or_canonical" on public.store_id_aliases;
create policy "store_id_aliases_select_hq_or_canonical"
on public.store_id_aliases for select
to authenticated
using (public.is_hq() or canonical_store_id = public.current_store_id());
grant select on table public.store_id_aliases to authenticated, service_role;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.store_data_repair_backups (
  id uuid primary key default gen_random_uuid(),
  repair_key text unique not null,
  description text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

revoke all on table private.store_data_repair_backups from public, anon, authenticated;

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

update public.stores
set reporting_status = 'test',
    data_quality_note = coalesce(data_quality_note, 'Internal QA data. Excluded from operating reports.')
where upper(trim(country)) = 'TEST' or id like 'TEST!_%' escape '!';

do $$
declare
  v_hanoi_target text;
  v_hanoi_uncertain text;
  v_hanoi_misassigned text;
  v_ids text[];
  v_collision_count integer;
  v_source_sales integer;
  v_other_references integer;
begin
  select id into v_hanoi_target
  from public.stores
  where name = 'Ha Noi Kim Ma'
    and country = 'Vietnam'
    and city = 'Hanoi'
    and currency = 'VND'
  order by id
  limit 1;

  select id into v_hanoi_uncertain
  from public.stores
  where name = 'Ha Noi Kim Ma'
    and country = 'South Korea'
    and city = 'Seoul'
    and currency = 'USD'
  order by id
  limit 1;

  select id into v_hanoi_misassigned
  from public.stores
  where name = '千房宁波来福士店'
    and country = 'Vietnam'
    and city = 'Seoul'
    and currency = 'USD'
  order by id
  limit 1;

  if v_hanoi_uncertain is not null then
    update public.stores
    set reporting_status = 'quarantined',
        data_quality_note = 'Invalid country/currency setup and implausible July inputs. Original rows preserved; HQ review required.'
    where id = v_hanoi_uncertain;
  end if;

  if v_hanoi_misassigned is null then
    return;
  end if;

  if v_hanoi_target is null then
    raise exception 'Canonical Ha Noi Kim Ma store was not found; repair aborted.';
  end if;

  v_ids := array_remove(array[v_hanoi_target, v_hanoi_uncertain, v_hanoi_misassigned], null);

  insert into private.store_data_repair_backups (repair_key, description, snapshot)
  select
    '2026-08-05_hanoi_store_repair',
    'Pre-repair snapshot for the misassigned Vietnam sales store and the quarantined duplicate.',
    jsonb_build_object(
      'stores', coalesce((select jsonb_agg(to_jsonb(t)) from public.stores t where t.id = any(v_ids)), '[]'::jsonb),
      'app_users', coalesce((select jsonb_agg(to_jsonb(t)) from public.app_users t where t.store_id = any(v_ids)), '[]'::jsonb),
      'employees', coalesce((select jsonb_agg(to_jsonb(t)) from public.employees t where t.store_id = any(v_ids)), '[]'::jsonb),
      'menus', coalesce((select jsonb_agg(to_jsonb(t)) from public.menus t where t.store_id = any(v_ids)), '[]'::jsonb),
      'menu_recipe_items', coalesce((select jsonb_agg(to_jsonb(t)) from public.menu_recipe_items t where t.menu_id in (select id from public.menus where store_id = any(v_ids))), '[]'::jsonb),
      'set_menus', coalesce((select jsonb_agg(to_jsonb(t)) from public.set_menus t where t.store_id = any(v_ids)), '[]'::jsonb),
      'set_menu_items', coalesce((select jsonb_agg(to_jsonb(t)) from public.set_menu_items t where t.set_menu_id in (select id from public.set_menus where store_id = any(v_ids))), '[]'::jsonb),
      'sales', coalesce((select jsonb_agg(to_jsonb(t)) from public.sales t where t.store_id = any(v_ids)), '[]'::jsonb),
      'sale_items', coalesce((select jsonb_agg(to_jsonb(t)) from public.sale_items t where t.sale_id in (select id from public.sales where store_id = any(v_ids))), '[]'::jsonb),
      'sale_menu_items', coalesce((select jsonb_agg(to_jsonb(t)) from public.sale_menu_items t where t.sale_id in (select id from public.sales where store_id = any(v_ids))), '[]'::jsonb),
      'sale_set_items', coalesce((select jsonb_agg(to_jsonb(t)) from public.sale_set_items t where t.sale_id in (select id from public.sales where store_id = any(v_ids))), '[]'::jsonb),
      'sales_vouchers', coalesce((select jsonb_agg(to_jsonb(t)) from public.sales_vouchers t where t.store_id = any(v_ids)), '[]'::jsonb),
      'ingredient_purchases', coalesce((select jsonb_agg(to_jsonb(t)) from public.ingredient_purchases t where t.store_id = any(v_ids)), '[]'::jsonb),
      'monthly_ingredient_inventory', coalesce((select jsonb_agg(to_jsonb(t)) from public.monthly_ingredient_inventory t where t.store_id = any(v_ids)), '[]'::jsonb),
      'monthly_cost_controls', coalesce((select jsonb_agg(to_jsonb(t)) from public.monthly_cost_controls t where t.store_id = any(v_ids)), '[]'::jsonb),
      'monthly_profitability_inputs', coalesce((select jsonb_agg(to_jsonb(t)) from public.monthly_profitability_inputs t where t.store_id = any(v_ids)), '[]'::jsonb),
      'monthly_close_periods', coalesce((select jsonb_agg(to_jsonb(t)) from public.monthly_close_periods t where t.store_id = any(v_ids)), '[]'::jsonb),
      'monthly_close_snapshots', coalesce((select jsonb_agg(to_jsonb(t)) from public.monthly_close_snapshots t where t.store_id = any(v_ids)), '[]'::jsonb),
      'monthly_close_tasks', coalesce((select jsonb_agg(to_jsonb(t)) from public.monthly_close_tasks t where t.store_id = any(v_ids)), '[]'::jsonb),
      'store_ingredient_profiles', coalesce((select jsonb_agg(to_jsonb(t)) from public.store_ingredient_profiles t where t.store_id = any(v_ids)), '[]'::jsonb),
      'store_ingredient_stock', coalesce((select jsonb_agg(to_jsonb(t)) from public.store_ingredient_stock t where t.store_id = any(v_ids)), '[]'::jsonb),
      'store_profitability_settings', coalesce((select jsonb_agg(to_jsonb(t)) from public.store_profitability_settings t where t.store_id = any(v_ids)), '[]'::jsonb),
      'profitability_import_profiles', coalesce((select jsonb_agg(to_jsonb(t)) from public.profitability_import_profiles t where t.store_id = any(v_ids)), '[]'::jsonb),
      'profitability_import_runs', coalesce((select jsonb_agg(to_jsonb(t)) from public.profitability_import_runs t where t.store_id = any(v_ids)), '[]'::jsonb),
      'tax_calendar_events', coalesce((select jsonb_agg(to_jsonb(t)) from public.tax_calendar_events t where t.store_id = any(v_ids)), '[]'::jsonb),
      'receipt_objects', coalesce((select jsonb_agg(jsonb_build_object('bucket_id', bucket_id, 'name', name, 'created_at', created_at, 'updated_at', updated_at, 'metadata', metadata)) from storage.objects where bucket_id = 'receipts' and split_part(name, '/', 1) = any(v_ids)), '[]'::jsonb)
    )
  on conflict (repair_key) do nothing;

  select count(*) into v_source_sales
  from public.sales
  where store_id = v_hanoi_misassigned;

  if v_source_sales <> 30 then
    raise exception 'Expected 30 source sales rows, found %; repair aborted.', v_source_sales;
  end if;

  select count(*) into v_collision_count
  from public.sales source_sale
  join public.sales target_sale on target_sale.store_id = v_hanoi_target
                               and target_sale.date = source_sale.date
  where source_sale.store_id = v_hanoi_misassigned;

  if v_collision_count <> 1 or not exists (
    select 1 from public.sales
    where store_id = v_hanoi_target and date = '2026-07-30' and total_amount = 0
  ) then
    raise exception 'Unexpected target-date collision; repair aborted.';
  end if;

  select
    (select count(*) from public.employees where store_id = v_hanoi_misassigned)
    + (select count(*) from public.ingredient_purchases where store_id = v_hanoi_misassigned)
    + (select count(*) from public.menus where store_id = v_hanoi_misassigned)
    + (select count(*) from public.monthly_close_periods where store_id = v_hanoi_misassigned)
    + (select count(*) from public.monthly_close_snapshots where store_id = v_hanoi_misassigned)
    + (select count(*) from public.monthly_close_tasks where store_id = v_hanoi_misassigned)
    + (select count(*) from public.monthly_cost_controls where store_id = v_hanoi_misassigned)
    + (select count(*) from public.monthly_ingredient_inventory where store_id = v_hanoi_misassigned)
    + (select count(*) from public.monthly_profitability_inputs where store_id = v_hanoi_misassigned)
    + (select count(*) from public.profitability_import_profiles where store_id = v_hanoi_misassigned)
    + (select count(*) from public.profitability_import_runs where store_id = v_hanoi_misassigned)
    + (select count(*) from public.sales_vouchers where store_id = v_hanoi_misassigned)
    + (select count(*) from public.set_menus where store_id = v_hanoi_misassigned)
    + (select count(*) from public.store_ingredient_profiles where store_id = v_hanoi_misassigned)
    + (select count(*) from public.store_ingredient_stock where store_id = v_hanoi_misassigned)
    + (select count(*) from public.store_profitability_settings where store_id = v_hanoi_misassigned)
    + (select count(*) from public.tax_calendar_events where store_id = v_hanoi_misassigned)
  into v_other_references;

  if v_other_references <> 0 then
    raise exception 'Unexpected source references (%) found; repair aborted.', v_other_references;
  end if;

  delete from public.sales
  where store_id = v_hanoi_target
    and date = '2026-07-30'
    and total_amount = 0;

  insert into public.store_id_aliases (legacy_store_id, canonical_store_id, reason)
  values (v_hanoi_misassigned, v_hanoi_target, 'Incorrect onboarding store identity; July VND sales and account moved to canonical Ha Noi Kim Ma.')
  on conflict (legacy_store_id) do update
    set canonical_store_id = excluded.canonical_store_id,
        reason = excluded.reason,
        migrated_at = now();

  update public.sales
  set store_id = v_hanoi_target
  where store_id = v_hanoi_misassigned;

  update public.app_users
  set store_id = v_hanoi_target
  where store_id = v_hanoi_misassigned;

  delete from public.stores
  where id = v_hanoi_misassigned;
end
$$;
