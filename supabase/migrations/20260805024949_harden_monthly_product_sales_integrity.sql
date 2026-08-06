-- Keep the public save RPC under caller privileges and enforce completeness in
-- triggers. Direct API writes can only remain unconfirmed until every current
-- menu and course has a valid quantity.

drop policy if exists "monthly_product_sales_submissions_write_store_member"
  on public.monthly_product_sales_submissions;
create policy "monthly_product_sales_submissions_write_store_member"
on public.monthly_product_sales_submissions for all to authenticated
using (public.is_store_member(store_id))
with check (public.is_store_member(store_id));

drop policy if exists "monthly_product_sales_totals_write_store_member"
  on public.monthly_product_sales_totals;
create policy "monthly_product_sales_totals_write_store_member"
on public.monthly_product_sales_totals for all to authenticated
using (public.is_store_member(store_id))
with check (public.is_store_member(store_id));

grant insert, update, delete on table public.monthly_product_sales_submissions to authenticated;
grant insert, update, delete on table public.monthly_product_sales_totals to authenticated;

create or replace function public.validate_monthly_product_sales_total_row()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and (
    old.store_id <> new.store_id
    or old.month_start <> new.month_start
    or old.product_type <> new.product_type
    or old.product_id <> new.product_id
  ) then
    raise exception 'The product identity cannot be changed. Delete and add the correct row.';
  end if;

  if new.product_type = 'menu' then
    if not exists (
      select 1 from public.menus menu
      where menu.id = new.product_id and menu.store_id = new.store_id
    ) then
      raise exception 'A menu row does not belong to this store.';
    end if;
  elsif new.product_type = 'set_menu' then
    if not exists (
      select 1 from public.set_menus set_menu
      where set_menu.id = new.product_id and set_menu.store_id = new.store_id
    ) then
      raise exception 'A course row does not belong to this store.';
    end if;
  else
    raise exception 'Invalid monthly product type.';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_monthly_product_sales_total_row()
  from public, anon, authenticated;

drop trigger if exists monthly_product_sales_totals_validate_row
  on public.monthly_product_sales_totals;
create trigger monthly_product_sales_totals_validate_row
before insert or update on public.monthly_product_sales_totals
for each row execute function public.validate_monthly_product_sales_total_row();

create or replace function public.assert_monthly_product_sales_complete(
  p_store_id text,
  p_month_start date
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_expected_count integer;
  v_actual_count integer;
begin
  if auth.uid() is null or not public.is_store_member(p_store_id) then
    raise exception 'You do not have access to this store.' using errcode = '42501';
  end if;

  select count(*) into v_expected_count
  from (
    select menu.id from public.menus menu where menu.store_id = p_store_id
    union all
    select set_menu.id from public.set_menus set_menu where set_menu.store_id = p_store_id
  ) expected;

  select count(*) into v_actual_count
  from public.monthly_product_sales_totals total
  where total.store_id = p_store_id
    and total.month_start = p_month_start;

  if v_expected_count = 0 then
    raise exception 'Register at least one menu or course before confirming monthly POS quantities.';
  end if;
  if v_actual_count <> v_expected_count then
    raise exception 'Enter a monthly quantity, including zero, for every menu and course.';
  end if;
end;
$$;

revoke all on function public.assert_monthly_product_sales_complete(text, date)
  from public, anon, authenticated;
grant execute on function public.assert_monthly_product_sales_complete(text, date)
  to authenticated, service_role;

create or replace function public.validate_monthly_product_sales_submission()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.confirmed and new.source_mode = 'monthly_pos' then
    perform public.assert_monthly_product_sales_complete(new.store_id, new.month_start);
  end if;
  return new;
end;
$$;

revoke all on function public.validate_monthly_product_sales_submission()
  from public, anon, authenticated;

drop trigger if exists monthly_product_sales_submissions_validate_complete
  on public.monthly_product_sales_submissions;
create trigger monthly_product_sales_submissions_validate_complete
before insert or update on public.monthly_product_sales_submissions
for each row execute function public.validate_monthly_product_sales_submission();

create or replace function public.recheck_confirmed_monthly_product_sales()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_store_id text;
  v_month_start date;
  v_requires_check boolean;
begin
  v_store_id := case when tg_op = 'DELETE' then old.store_id else new.store_id end;
  v_month_start := case when tg_op = 'DELETE' then old.month_start else new.month_start end;

  select submission.confirmed and submission.source_mode = 'monthly_pos'
  into v_requires_check
  from public.monthly_product_sales_submissions submission
  where submission.store_id = v_store_id
    and submission.month_start = v_month_start;

  if coalesce(v_requires_check, false) then
    perform public.assert_monthly_product_sales_complete(v_store_id, v_month_start);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.recheck_confirmed_monthly_product_sales()
  from public, anon, authenticated;

drop trigger if exists monthly_product_sales_totals_recheck_complete
  on public.monthly_product_sales_totals;
create constraint trigger monthly_product_sales_totals_recheck_complete
after insert or update or delete on public.monthly_product_sales_totals
deferrable initially immediate
for each row execute function public.recheck_confirmed_monthly_product_sales();

create or replace function public.save_monthly_product_sales(
  p_store_id text,
  p_month_start date,
  p_source_mode text,
  p_rows jsonb default '[]'::jsonb,
  p_notes text default null
)
returns void
language plpgsql
security invoker
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
      select menu.id from public.menus menu where menu.store_id = p_store_id
      union all
      select set_menu.id from public.set_menus set_menu where set_menu.store_id = p_store_id
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
    p_store_id, p_month_start, p_source_mode, false,
    nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), now()
  )
  on conflict (store_id, month_start) do update set
    source_mode = excluded.source_mode,
    confirmed = false,
    notes = excluded.notes,
    updated_by = auth.uid(),
    updated_at = now();

  delete from public.monthly_product_sales_totals
  where store_id = p_store_id and month_start = p_month_start;

  if p_source_mode = 'monthly_pos' then
    insert into public.monthly_product_sales_totals (
      store_id, month_start, product_type, product_id, quantity
    )
    select p_store_id, p_month_start,
      row_value ->> 'product_type', row_value ->> 'product_id',
      (row_value ->> 'quantity')::integer
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as supplied_row(row_value);
  end if;

  update public.monthly_product_sales_submissions
  set confirmed = true, updated_at = now(), updated_by = auth.uid()
  where store_id = p_store_id and month_start = p_month_start;
end;
$$;

revoke all on function public.save_monthly_product_sales(text, date, text, jsonb, text)
  from public, anon;
grant execute on function public.save_monthly_product_sales(text, date, text, jsonb, text)
  to authenticated, service_role;
