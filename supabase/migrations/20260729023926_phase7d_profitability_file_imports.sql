-- Phase 7B-4: confirmed CSV/XLSX imports for monthly profitability inputs.
-- Imported files are retained in a private bucket and never replace sales,
-- inventory, menu, recipe, or accounting source rows.

create table if not exists public.profitability_import_profiles (
  store_id text not null
    references public.stores(id) on update cascade on delete restrict,
  source_type text not null
    check (source_type in ('pos', 'attendance', 'payroll', 'operating_expenses')),
  sheet_name text,
  header_row integer not null default 1
    check (header_row between 1 and 100),
  column_mapping jsonb not null default '{}'::jsonb
    check (jsonb_typeof(column_mapping) = 'object'),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, source_type)
);

create table if not exists public.profitability_import_runs (
  id uuid primary key default gen_random_uuid(),
  store_id text not null
    references public.stores(id) on update cascade on delete restrict,
  month_start date not null
    check (month_start = date_trunc('month', month_start)::date),
  source_type text not null
    check (source_type in ('pos', 'attendance', 'payroll', 'operating_expenses')),
  original_file_name text not null,
  storage_path text not null unique,
  file_sha256 text not null
    check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_size bigint not null
    check (file_size between 1 and 10485760),
  sheet_name text,
  header_row integer not null
    check (header_row between 1 and 100),
  row_count integer not null
    check (row_count >= 0),
  mapping_snapshot jsonb not null
    check (jsonb_typeof(mapping_snapshot) = 'object'),
  imported_totals jsonb not null
    check (jsonb_typeof(imported_totals) = 'object'),
  applied_by uuid default auth.uid() references auth.users(id) on delete set null,
  applied_at timestamptz not null default now()
);

comment on table public.profitability_import_profiles is
  'Per-store CSV/XLSX column mappings reused for future monthly profitability imports.';

comment on table public.profitability_import_runs is
  'Immutable audit records for confirmed profitability imports; original files are stored privately.';

create index if not exists profitability_import_runs_store_month_idx
  on public.profitability_import_runs (store_id, month_start desc, applied_at desc);

create index if not exists profitability_import_profiles_created_by_idx
  on public.profitability_import_profiles (created_by);

create index if not exists profitability_import_profiles_updated_by_idx
  on public.profitability_import_profiles (updated_by);

create index if not exists profitability_import_runs_applied_by_idx
  on public.profitability_import_runs (applied_by);

drop trigger if exists profitability_import_profiles_touch_updated_at
  on public.profitability_import_profiles;
create trigger profitability_import_profiles_touch_updated_at
before update on public.profitability_import_profiles
for each row execute function public.touch_management_updated_at();

alter table public.profitability_import_profiles enable row level security;
alter table public.profitability_import_runs enable row level security;

drop policy if exists "profitability_import_profiles_select_store_member"
  on public.profitability_import_profiles;
create policy "profitability_import_profiles_select_store_member"
on public.profitability_import_profiles
for select
to authenticated
using (public.is_store_member(store_id));

drop policy if exists "profitability_import_profiles_insert_store_member"
  on public.profitability_import_profiles;
create policy "profitability_import_profiles_insert_store_member"
on public.profitability_import_profiles
for insert
to authenticated
with check (
  public.is_hq()
  or store_id = public.current_store_id()
);

drop policy if exists "profitability_import_profiles_update_store_member"
  on public.profitability_import_profiles;
create policy "profitability_import_profiles_update_store_member"
on public.profitability_import_profiles
for update
to authenticated
using (
  public.is_hq()
  or store_id = public.current_store_id()
)
with check (
  public.is_hq()
  or store_id = public.current_store_id()
);

drop policy if exists "profitability_import_runs_select_store_member"
  on public.profitability_import_runs;
create policy "profitability_import_runs_select_store_member"
on public.profitability_import_runs
for select
to authenticated
using (public.is_store_member(store_id));

drop policy if exists "profitability_import_runs_insert_store_member"
  on public.profitability_import_runs;
create policy "profitability_import_runs_insert_store_member"
on public.profitability_import_runs
for insert
to authenticated
with check (
  public.is_hq()
  or store_id = public.current_store_id()
);

revoke all on table public.profitability_import_profiles from public, anon, authenticated;
revoke all on table public.profitability_import_runs from public, anon, authenticated;

grant select, insert, update
on table public.profitability_import_profiles
to authenticated;

grant select, insert
on table public.profitability_import_runs
to authenticated;

grant select, insert, update, delete
on table public.profitability_import_profiles
to service_role;

grant select, insert, update, delete
on table public.profitability_import_runs
to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('profitability-imports', 'profitability-imports', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "profitability_imports_select_store_member" on storage.objects;
create policy "profitability_imports_select_store_member"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'profitability-imports'
  and (
    public.is_hq()
    or split_part(name, '/', 1) = public.current_store_id()
  )
);

drop policy if exists "profitability_imports_insert_store_member" on storage.objects;
create policy "profitability_imports_insert_store_member"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profitability-imports'
  and (
    public.is_hq()
    or split_part(name, '/', 1) = public.current_store_id()
  )
);

drop policy if exists "profitability_imports_delete_store_member" on storage.objects;
create policy "profitability_imports_delete_store_member"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profitability-imports'
  and (
    public.is_hq()
    or split_part(name, '/', 1) = public.current_store_id()
  )
);

create or replace function public.apply_profitability_import(
  p_store_id text,
  p_month_start date,
  p_source_type text,
  p_run_id uuid,
  p_original_file_name text,
  p_storage_path text,
  p_file_sha256 text,
  p_file_size bigint,
  p_sheet_name text,
  p_header_row integer,
  p_row_count integer,
  p_mapping jsonb,
  p_totals jsonb
)
returns public.monthly_profitability_inputs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_input public.monthly_profitability_inputs;
  v_allowed_keys constant text[] := array[
    'guest_count',
    'labor_cost',
    'labor_hours',
    'sales_linked_fees',
    'utilities_cost',
    'other_operating_cost'
  ];
begin
  if not (
    public.is_hq()
    or p_store_id = public.current_store_id()
  ) then
    raise exception 'You cannot import data for this store.';
  end if;

  if p_month_start <> date_trunc('month', p_month_start)::date then
    raise exception 'Import month must be the first day of the month.';
  end if;

  if p_source_type not in ('pos', 'attendance', 'payroll', 'operating_expenses') then
    raise exception 'Unsupported profitability import source.';
  end if;

  if not public.is_hq()
    and exists (
      select 1
      from public.monthly_close_periods
      where store_id = p_store_id
        and month_start = p_month_start
        and status in ('submitted', 'approved')
    )
  then
    raise exception 'Reopen the submitted or approved month before importing.';
  end if;

  if jsonb_typeof(p_mapping) <> 'object'
    or jsonb_typeof(p_totals) <> 'object'
    or p_totals = '{}'::jsonb
  then
    raise exception 'Import mapping and totals must be non-empty objects.';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_totals) as imported_key
    where imported_key <> all(v_allowed_keys)
  ) then
    raise exception 'Import contains an unsupported monthly field.';
  end if;

  if exists (
    select 1
    from jsonb_each(p_totals) as imported_value
    where jsonb_typeof(imported_value.value) <> 'number'
      or (imported_value.value #>> '{}')::numeric < 0
  ) then
    raise exception 'Imported totals must be non-negative numbers.';
  end if;

  if p_totals ? 'guest_count'
    and (p_totals ->> 'guest_count')::numeric
      <> trunc((p_totals ->> 'guest_count')::numeric)
  then
    raise exception 'Imported guest count must be a whole number.';
  end if;

  if p_file_size not between 1 and 10485760
    or p_file_sha256 !~ '^[0-9a-f]{64}$'
    or split_part(p_storage_path, '/', 1) <> p_store_id
  then
    raise exception 'Invalid original file metadata.';
  end if;

  if exists (
    select 1
    from public.profitability_import_runs
    where store_id = p_store_id
      and month_start = p_month_start
      and source_type = p_source_type
      and file_sha256 = p_file_sha256
  ) then
    raise exception 'This file was already applied to the selected month.';
  end if;

  insert into public.profitability_import_profiles (
    store_id,
    source_type,
    sheet_name,
    header_row,
    column_mapping,
    created_by,
    updated_by
  )
  values (
    p_store_id,
    p_source_type,
    nullif(p_sheet_name, ''),
    p_header_row,
    p_mapping,
    auth.uid(),
    auth.uid()
  )
  on conflict (store_id, source_type)
  do update set
    sheet_name = excluded.sheet_name,
    header_row = excluded.header_row,
    column_mapping = excluded.column_mapping,
    updated_by = auth.uid();

  insert into public.monthly_profitability_inputs (
    store_id,
    month_start,
    guest_count,
    labor_cost,
    labor_hours,
    sales_linked_fees,
    utilities_cost,
    other_operating_cost,
    input_complete,
    created_by,
    updated_by
  )
  values (
    p_store_id,
    p_month_start,
    case when p_totals ? 'guest_count' then (p_totals ->> 'guest_count')::integer else null end,
    case when p_totals ? 'labor_cost' then (p_totals ->> 'labor_cost')::numeric else null end,
    case when p_totals ? 'labor_hours' then (p_totals ->> 'labor_hours')::numeric else null end,
    case when p_totals ? 'sales_linked_fees' then (p_totals ->> 'sales_linked_fees')::numeric else null end,
    case when p_totals ? 'utilities_cost' then (p_totals ->> 'utilities_cost')::numeric else null end,
    case when p_totals ? 'other_operating_cost' then (p_totals ->> 'other_operating_cost')::numeric else null end,
    false,
    auth.uid(),
    auth.uid()
  )
  on conflict (store_id, month_start)
  do update set
    guest_count = case
      when p_totals ? 'guest_count' then excluded.guest_count
      else monthly_profitability_inputs.guest_count
    end,
    labor_cost = case
      when p_totals ? 'labor_cost' then excluded.labor_cost
      else monthly_profitability_inputs.labor_cost
    end,
    labor_hours = case
      when p_totals ? 'labor_hours' then excluded.labor_hours
      else monthly_profitability_inputs.labor_hours
    end,
    sales_linked_fees = case
      when p_totals ? 'sales_linked_fees' then excluded.sales_linked_fees
      else monthly_profitability_inputs.sales_linked_fees
    end,
    utilities_cost = case
      when p_totals ? 'utilities_cost' then excluded.utilities_cost
      else monthly_profitability_inputs.utilities_cost
    end,
    other_operating_cost = case
      when p_totals ? 'other_operating_cost' then excluded.other_operating_cost
      else monthly_profitability_inputs.other_operating_cost
    end,
    updated_by = auth.uid();

  update public.monthly_profitability_inputs imported_input
  set input_complete = (
    imported_input.labor_cost is not null
    and imported_input.labor_hours is not null
    and imported_input.utilities_cost is not null
    and imported_input.other_operating_cost is not null
    and (
      imported_input.sales_linked_fees is not null
      or exists (
        select 1
        from public.store_profitability_settings
        where store_id = p_store_id
      )
    )
  )
  where imported_input.store_id = p_store_id
    and imported_input.month_start = p_month_start
  returning imported_input.* into v_input;

  insert into public.profitability_import_runs (
    id,
    store_id,
    month_start,
    source_type,
    original_file_name,
    storage_path,
    file_sha256,
    file_size,
    sheet_name,
    header_row,
    row_count,
    mapping_snapshot,
    imported_totals,
    applied_by
  )
  values (
    p_run_id,
    p_store_id,
    p_month_start,
    p_source_type,
    p_original_file_name,
    p_storage_path,
    p_file_sha256,
    p_file_size,
    nullif(p_sheet_name, ''),
    p_header_row,
    p_row_count,
    p_mapping,
    p_totals,
    auth.uid()
  );

  return v_input;
end;
$$;

revoke all on function public.apply_profitability_import(
  text, date, text, uuid, text, text, text, bigint, text, integer, integer, jsonb, jsonb
) from public, anon;

grant execute on function public.apply_profitability_import(
  text, date, text, uuid, text, text, text, bigint, text, integer, integer, jsonb, jsonb
) to authenticated, service_role;

notify pgrst, 'reload schema';
