-- Add an explicit monthly POS product-count source for stores that do not enter
-- menu/course quantities in every daily sales report. This is additive and does
-- not rewrite daily sales or existing close snapshots.

create table if not exists public.monthly_product_sales_submissions (
  store_id text not null references public.stores(id) on update cascade on delete restrict,
  month_start date not null check (month_start = date_trunc('month', month_start)::date),
  source_mode text not null default 'daily_reports'
    check (source_mode in ('daily_reports', 'monthly_pos')),
  confirmed boolean not null default false,
  notes text,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (store_id, month_start)
);

create table if not exists public.monthly_product_sales_totals (
  store_id text not null,
  month_start date not null,
  product_type text not null check (product_type in ('menu', 'set_menu')),
  product_id text not null,
  quantity integer not null check (quantity >= 0),
  primary key (store_id, month_start, product_type, product_id),
  foreign key (store_id, month_start)
    references public.monthly_product_sales_submissions(store_id, month_start)
    on update cascade on delete cascade
);

create index if not exists monthly_product_sales_totals_month_idx
  on public.monthly_product_sales_totals (store_id, month_start, product_type);

alter table public.monthly_product_sales_submissions enable row level security;
alter table public.monthly_product_sales_totals enable row level security;

drop policy if exists "monthly_product_sales_submissions_select_store_member"
  on public.monthly_product_sales_submissions;
create policy "monthly_product_sales_submissions_select_store_member"
on public.monthly_product_sales_submissions for select to authenticated
using (public.is_store_member(store_id));

drop policy if exists "monthly_product_sales_totals_select_store_member"
  on public.monthly_product_sales_totals;
create policy "monthly_product_sales_totals_select_store_member"
on public.monthly_product_sales_totals for select to authenticated
using (public.is_store_member(store_id));

revoke all on table public.monthly_product_sales_submissions from public, anon, authenticated;
revoke all on table public.monthly_product_sales_totals from public, anon, authenticated;
grant select on table public.monthly_product_sales_submissions to authenticated;
grant select on table public.monthly_product_sales_totals to authenticated;
grant all on table public.monthly_product_sales_submissions to service_role;
grant all on table public.monthly_product_sales_totals to service_role;

create or replace function public.save_monthly_product_sales(
  p_store_id text,
  p_month_start date,
  p_source_mode text,
  p_rows jsonb default '[]'::jsonb,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_type text;
  v_id text;
  v_quantity numeric;
  v_expected_count integer;
  v_input_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.is_store_member(p_store_id) then
    raise exception 'You do not have access to this store.' using errcode = '42501';
  end if;
  if p_month_start is null or p_month_start <> date_trunc('month', p_month_start)::date then
    raise exception 'month_start must be the first day of the month.';
  end if;
  if p_source_mode not in ('daily_reports', 'monthly_pos') then
    raise exception 'Invalid product sales source mode.';
  end if;

  perform public.assert_month_is_editable(p_store_id, p_month_start);

  if p_source_mode = 'monthly_pos' then
    if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
      raise exception 'Monthly product sales rows must be an array.';
    end if;

    select count(*) into v_expected_count
    from (
      select 'menu'::text as product_type, menu.id as product_id
      from public.menus menu where menu.store_id = p_store_id
      union all
      select 'set_menu'::text, set_menu.id
      from public.set_menus set_menu where set_menu.store_id = p_store_id
    ) expected;

    select count(*) into v_input_count
    from (
      select distinct row_value ->> 'product_type', row_value ->> 'product_id'
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as supplied_row(row_value)
    ) supplied;

    if v_expected_count = 0 then
      raise exception 'Register at least one menu or course before entering monthly POS quantities.';
    end if;

    if v_input_count <> v_expected_count
      or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) <> v_expected_count then
      raise exception 'Enter a monthly quantity, including zero, for every menu and course.';
    end if;

    for v_row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
    loop
      v_type := v_row ->> 'product_type';
      v_id := v_row ->> 'product_id';
      begin
        v_quantity := (v_row ->> 'quantity')::numeric;
      exception when others then
        raise exception 'Every monthly product quantity must be a whole number.';
      end;

      if v_quantity < 0 or v_quantity <> trunc(v_quantity) then
        raise exception 'Every monthly product quantity must be a non-negative whole number.';
      end if;
      if v_type = 'menu' then
        if not exists (select 1 from public.menus where id = v_id and store_id = p_store_id) then
          raise exception 'A menu row does not belong to this store.';
        end if;
      elsif v_type = 'set_menu' then
        if not exists (select 1 from public.set_menus where id = v_id and store_id = p_store_id) then
          raise exception 'A course row does not belong to this store.';
        end if;
      else
        raise exception 'Invalid monthly product type.';
      end if;
    end loop;
  end if;

  insert into public.monthly_product_sales_submissions (
    store_id, month_start, source_mode, confirmed, notes, updated_by, updated_at
  ) values (
    p_store_id, p_month_start, p_source_mode, true, nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), now()
  )
  on conflict (store_id, month_start) do update set
    source_mode = excluded.source_mode,
    confirmed = true,
    notes = excluded.notes,
    updated_by = auth.uid(),
    updated_at = now();

  delete from public.monthly_product_sales_totals
  where store_id = p_store_id and month_start = p_month_start;

  if p_source_mode = 'monthly_pos' then
    insert into public.monthly_product_sales_totals (
      store_id, month_start, product_type, product_id, quantity
    )
    select
      p_store_id,
      p_month_start,
      row_value ->> 'product_type',
      row_value ->> 'product_id',
      (row_value ->> 'quantity')::integer
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as supplied_row(row_value);
  end if;
end;
$$;

revoke all on function public.save_monthly_product_sales(text, date, text, jsonb, text)
  from public, anon;
grant execute on function public.save_monthly_product_sales(text, date, text, jsonb, text)
  to authenticated, service_role;

create or replace function public.guard_monthly_product_sales_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_store_id text;
  v_month_start date;
begin
  v_store_id := case when tg_op = 'DELETE' then old.store_id else new.store_id end;
  v_month_start := case when tg_op = 'DELETE' then old.month_start else new.month_start end;
  perform public.assert_month_is_editable(v_store_id, v_month_start);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.guard_monthly_product_sales_write()
  from public, anon, authenticated;

drop trigger if exists monthly_product_sales_submissions_guard_locked_month
  on public.monthly_product_sales_submissions;
create trigger monthly_product_sales_submissions_guard_locked_month
before insert or update or delete on public.monthly_product_sales_submissions
for each row execute function public.guard_monthly_product_sales_write();

drop trigger if exists monthly_product_sales_totals_guard_locked_month
  on public.monthly_product_sales_totals;
create trigger monthly_product_sales_totals_guard_locked_month
before insert or update or delete on public.monthly_product_sales_totals
for each row execute function public.guard_monthly_product_sales_write();

create or replace function public.enrich_monthly_close_snapshot_product_sales()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.payload := new.payload || jsonb_build_object(
    'monthlyProductSalesSubmission', (
      select to_jsonb(submission_row)
      from public.monthly_product_sales_submissions submission_row
      where submission_row.store_id = new.store_id
        and submission_row.month_start = new.month_start
    ),
    'monthlyProductSalesTotals', coalesce((
      select jsonb_agg(to_jsonb(total_row) order by total_row.product_type, total_row.product_id)
      from public.monthly_product_sales_totals total_row
      where total_row.store_id = new.store_id
        and total_row.month_start = new.month_start
    ), '[]'::jsonb)
  );
  return new;
end;
$$;

revoke all on function public.enrich_monthly_close_snapshot_product_sales()
  from public, anon, authenticated;

drop trigger if exists monthly_close_snapshots_add_product_sales
  on public.monthly_close_snapshots;
create trigger monthly_close_snapshots_add_product_sales
before insert on public.monthly_close_snapshots
for each row execute function public.enrich_monthly_close_snapshot_product_sales();
