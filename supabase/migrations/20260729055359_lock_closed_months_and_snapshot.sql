-- Phase 8A: make submitted/approved months immutable and capture audit snapshots.
-- This migration is additive. Existing operational rows are not rewritten or deleted.

create table if not exists public.monthly_close_snapshots (
  id uuid primary key default gen_random_uuid(),
  close_period_id uuid not null
    references public.monthly_close_periods(id) on update cascade on delete restrict,
  store_id text not null
    references public.stores(id) on update cascade on delete restrict,
  month_start date not null
    check (month_start = date_trunc('month', month_start)::date),
  close_status text not null
    check (close_status in ('submitted', 'approved')),
  revision integer not null check (revision > 0),
  payload jsonb not null,
  captured_by uuid default auth.uid() references auth.users(id) on delete set null,
  captured_at timestamptz not null default now(),
  unique (store_id, month_start, close_status, revision)
);

comment on table public.monthly_close_snapshots is
  'Immutable submitted/approved month audit snapshots. Includes source rows, recipes, costs and calculated summaries as captured.';

create index if not exists monthly_close_snapshots_store_month_idx
  on public.monthly_close_snapshots (store_id, month_start desc, captured_at desc);

alter table public.monthly_close_snapshots enable row level security;

drop policy if exists "monthly_close_snapshots_select_store_member"
  on public.monthly_close_snapshots;
create policy "monthly_close_snapshots_select_store_member"
on public.monthly_close_snapshots
for select
to authenticated
using (public.is_store_member(store_id));

revoke all on table public.monthly_close_snapshots from public, anon, authenticated;
grant select on table public.monthly_close_snapshots to authenticated;
grant select, insert on table public.monthly_close_snapshots to service_role;

create or replace function public.assert_month_is_editable(
  p_store_id text,
  p_month_start date
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if p_store_id is null or p_month_start is null then
    return;
  end if;

  select close_period.status
  into v_status
  from public.monthly_close_periods close_period
  where close_period.store_id = p_store_id
    and close_period.month_start = date_trunc('month', p_month_start)::date;

  if v_status in ('submitted', 'approved') then
    raise exception
      'This month is %. HQ must reopen it before sales, purchases, inventory or monthly totals can be changed.',
      v_status
      using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.assert_month_is_editable(text, date)
  from public, anon, authenticated;
grant execute on function public.assert_month_is_editable(text, date)
  to service_role;

create or replace function public.guard_locked_month_source_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_store_id text;
  v_new_store_id text;
  v_old_month_start date;
  v_new_month_start date;
begin
  if tg_table_name = 'sales' then
    if tg_op <> 'INSERT' then
      v_old_store_id := old.store_id;
      v_old_month_start := date_trunc('month', old.date::date)::date;
    end if;
    if tg_op <> 'DELETE' then
      v_new_store_id := new.store_id;
      v_new_month_start := date_trunc('month', new.date::date)::date;
    end if;
  elsif tg_table_name in ('sale_items', 'sale_menu_items', 'sale_set_items') then
    if tg_op <> 'INSERT' then
      select sale.store_id, date_trunc('month', sale.date::date)::date
      into v_old_store_id, v_old_month_start
      from public.sales sale
      where sale.id = old.sale_id;
    end if;
    if tg_op <> 'DELETE' then
      select sale.store_id, date_trunc('month', sale.date::date)::date
      into v_new_store_id, v_new_month_start
      from public.sales sale
      where sale.id = new.sale_id;
    end if;
  elsif tg_table_name = 'ingredient_purchases' then
    if tg_op <> 'INSERT' then
      v_old_store_id := old.store_id;
      v_old_month_start := date_trunc('month', old.purchase_date)::date;
    end if;
    if tg_op <> 'DELETE' then
      v_new_store_id := new.store_id;
      v_new_month_start := date_trunc('month', new.purchase_date)::date;
    end if;
  elsif tg_table_name in (
    'monthly_ingredient_inventory',
    'monthly_cost_controls',
    'monthly_profitability_inputs'
  ) then
    if tg_op <> 'INSERT' then
      v_old_store_id := old.store_id;
      v_old_month_start := old.month_start;
    end if;
    if tg_op <> 'DELETE' then
      v_new_store_id := new.store_id;
      v_new_month_start := new.month_start;
    end if;
  end if;

  if tg_op <> 'INSERT' then
    perform public.assert_month_is_editable(v_old_store_id, v_old_month_start);
  end if;
  if tg_op <> 'DELETE'
    and (
      tg_op = 'INSERT'
      or v_new_store_id is distinct from v_old_store_id
      or v_new_month_start is distinct from v_old_month_start
    )
  then
    perform public.assert_month_is_editable(v_new_store_id, v_new_month_start);
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.guard_locked_month_source_write()
  from public, anon, authenticated;

drop trigger if exists sales_guard_locked_month on public.sales;
create trigger sales_guard_locked_month
before insert or update or delete on public.sales
for each row execute function public.guard_locked_month_source_write();

drop trigger if exists sale_menu_items_guard_locked_month on public.sale_menu_items;
create trigger sale_menu_items_guard_locked_month
before insert or update or delete on public.sale_menu_items
for each row execute function public.guard_locked_month_source_write();

drop trigger if exists sale_items_guard_locked_month on public.sale_items;
create trigger sale_items_guard_locked_month
before insert or update or delete on public.sale_items
for each row execute function public.guard_locked_month_source_write();

drop trigger if exists sale_set_items_guard_locked_month on public.sale_set_items;
create trigger sale_set_items_guard_locked_month
before insert or update or delete on public.sale_set_items
for each row execute function public.guard_locked_month_source_write();

drop trigger if exists ingredient_purchases_guard_locked_month on public.ingredient_purchases;
create trigger ingredient_purchases_guard_locked_month
before insert or update or delete on public.ingredient_purchases
for each row execute function public.guard_locked_month_source_write();

drop trigger if exists monthly_inventory_guard_locked_month
  on public.monthly_ingredient_inventory;
create trigger monthly_inventory_guard_locked_month
before insert or update or delete on public.monthly_ingredient_inventory
for each row execute function public.guard_locked_month_source_write();

drop trigger if exists monthly_cost_controls_guard_locked_month
  on public.monthly_cost_controls;
create trigger monthly_cost_controls_guard_locked_month
before insert or update or delete on public.monthly_cost_controls
for each row execute function public.guard_locked_month_source_write();

drop trigger if exists monthly_profitability_inputs_guard_approved
  on public.monthly_profitability_inputs;
drop trigger if exists monthly_profitability_inputs_guard_locked_month
  on public.monthly_profitability_inputs;
create trigger monthly_profitability_inputs_guard_locked_month
before insert or update or delete on public.monthly_profitability_inputs
for each row execute function public.guard_locked_month_source_write();

create or replace function public.validate_monthly_close_ready(
  p_store_id text,
  p_month_start date
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_month_end date;
  v_expected_end date;
  v_missing_dates integer;
  v_missing_receipts integer;
  v_profitability_ready boolean;
  v_confirmation_complete boolean;
begin
  if p_month_start <> date_trunc('month', p_month_start)::date then
    raise exception 'Monthly close month_start must be the first day of the month.';
  end if;

  if p_month_start > current_date then
    raise exception 'A future month cannot be submitted.';
  end if;

  v_month_end := (p_month_start + interval '1 month - 1 day')::date;
  v_expected_end := case
    when date_trunc('month', current_date)::date = p_month_start
      then least(v_month_end, current_date - 1)
    else v_month_end
  end;

  if v_expected_end >= p_month_start then
    select count(*)
    into v_missing_dates
    from generate_series(p_month_start, v_expected_end, interval '1 day') expected(day)
    where not exists (
      select 1
      from public.sales sale
      where sale.store_id = p_store_id
        and sale.date = expected.day::date::text
    );
  else
    v_missing_dates := 0;
  end if;

  if v_missing_dates > 0 then
    raise exception '% daily sales or closed-day report(s) are missing.', v_missing_dates;
  end if;

  select count(*)
  into v_missing_receipts
  from public.sales sale
  where sale.store_id = p_store_id
    and sale.date::date between p_month_start and v_expected_end
    and not sale.is_closed
    and nullif(trim(coalesce(sale.receipt_image, '')), '') is null;

  if v_missing_receipts > 0 then
    raise exception '% open-day report(s) have no receipt image.', v_missing_receipts;
  end if;

  select coalesce(summary.profitability_ready, false)
  into v_profitability_ready
  from public.monthly_store_profitability_summary summary
  where summary.store_id = p_store_id
    and summary.month_start = p_month_start;

  if not coalesce(v_profitability_ready, false) then
    raise exception
      'Monthly profitability is incomplete. Finish HQ settings, monthly totals and inventory close first.';
  end if;

  select exists (
    select 1
    from public.monthly_close_tasks task
    where task.store_id = p_store_id
      and task.month_start = p_month_start
      and task.task_key = 'monthly_sales_confirmed'
      and task.status = 'completed'
  )
  into v_confirmation_complete;

  if not v_confirmation_complete then
    raise exception 'Confirm the monthly sales total before submission.';
  end if;
end;
$$;

revoke all on function public.validate_monthly_close_ready(text, date)
  from public, anon, authenticated;
grant execute on function public.validate_monthly_close_ready(text, date)
  to service_role;

create or replace function public.guard_monthly_close_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'approved' and not public.is_hq() then
    raise exception 'Only the authorized HQ account can approve a monthly close.';
  end if;

  if tg_op = 'UPDATE'
    and old.status in ('submitted', 'approved')
    and new.status <> old.status
    and not public.is_hq()
  then
    raise exception 'Only the authorized HQ account can reopen a submitted or approved month.';
  end if;

  if (
    tg_op = 'INSERT'
    or old.status is distinct from new.status
  ) and new.status in ('submitted', 'approved') then
    perform public.validate_monthly_close_ready(new.store_id, new.month_start);
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'submitted' then
      new.submitted_at := now();
      new.approved_at := null;
    elsif new.status = 'approved' then
      new.approved_at := now();
      new.submitted_at := coalesce(new.submitted_at, now());
    else
      new.approved_at := null;
    end if;
  elsif old.status is distinct from new.status then
    if new.status = 'submitted' then
      new.submitted_at := now();
      new.approved_at := null;
    elsif new.status = 'approved' then
      new.approved_at := now();
      new.submitted_at := coalesce(new.submitted_at, now());
    elsif new.status in ('draft', 'reopened') then
      new.approved_at := null;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_monthly_close_status()
  from public, anon, authenticated;

drop trigger if exists monthly_close_periods_guard_status
  on public.monthly_close_periods;
create trigger monthly_close_periods_guard_status
before insert or update on public.monthly_close_periods
for each row execute function public.guard_monthly_close_status();

create or replace function public.capture_monthly_close_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision integer;
  v_payload jsonb;
  v_month_end date;
begin
  if new.status not in ('submitted', 'approved') then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  v_month_end := (new.month_start + interval '1 month - 1 day')::date;

  select coalesce(max(snapshot.revision), 0) + 1
  into v_revision
  from public.monthly_close_snapshots snapshot
  where snapshot.store_id = new.store_id
    and snapshot.month_start = new.month_start
    and snapshot.close_status = new.status;

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'capturedStatus', new.status,
    'capturedAt', now(),
    'store', (
      select to_jsonb(store_row)
      from public.stores store_row
      where store_row.id = new.store_id
    ),
    'closePeriod', to_jsonb(new),
    'closeTasks', coalesce((
      select jsonb_agg(to_jsonb(task_row) order by task_row.sort_order, task_row.task_key)
      from public.monthly_close_tasks task_row
      where task_row.store_id = new.store_id
        and task_row.month_start = new.month_start
    ), '[]'::jsonb),
    'sales', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', sale.id,
          'store_id', sale.store_id,
          'date', sale.date,
          'total_amount', sale.total_amount,
          'is_closed', sale.is_closed,
          'closed_reason', sale.closed_reason,
          'comment', sale.comment,
          'has_receipt', nullif(trim(coalesce(sale.receipt_image, '')), '') is not null
        )
        order by sale.date, sale.id
      )
      from public.sales sale
      where sale.store_id = new.store_id
        and sale.date::date between new.month_start and v_month_end
    ), '[]'::jsonb),
    'saleMenuItems', coalesce((
      select jsonb_agg(to_jsonb(item_row) order by item_row.sale_id, item_row.menu_id)
      from public.sale_menu_items item_row
      join public.sales sale on sale.id = item_row.sale_id
      where sale.store_id = new.store_id
        and sale.date::date between new.month_start and v_month_end
    ), '[]'::jsonb),
    'saleItems', coalesce((
      select jsonb_agg(to_jsonb(item_row) order by item_row.sale_id, item_row.menu_id)
      from public.sale_items item_row
      join public.sales sale on sale.id = item_row.sale_id
      where sale.store_id = new.store_id
        and sale.date::date between new.month_start and v_month_end
    ), '[]'::jsonb),
    'saleSetItems', coalesce((
      select jsonb_agg(to_jsonb(item_row) order by item_row.sale_id, item_row.set_menu_id)
      from public.sale_set_items item_row
      join public.sales sale on sale.id = item_row.sale_id
      where sale.store_id = new.store_id
        and sale.date::date between new.month_start and v_month_end
    ), '[]'::jsonb),
    'ingredientProfiles', coalesce((
      select jsonb_agg(to_jsonb(profile_row) order by profile_row.ingredient_id)
      from public.store_ingredient_profiles profile_row
      where profile_row.store_id = new.store_id
    ), '[]'::jsonb),
    'ingredients', coalesce((
      select jsonb_agg(to_jsonb(ingredient_row) order by ingredient_row.id)
      from public.ingredients ingredient_row
      where exists (
        select 1
        from public.store_ingredient_profiles profile
        where profile.store_id = new.store_id
          and profile.ingredient_id = ingredient_row.id
      )
      or exists (
        select 1
        from public.menu_recipe_items recipe
        join public.menus menu on menu.id = recipe.menu_id
        where menu.store_id = new.store_id
          and recipe.ingredient_id = ingredient_row.id
      )
    ), '[]'::jsonb),
    'purchases', coalesce((
      select jsonb_agg(to_jsonb(purchase_row) order by purchase_row.purchase_date, purchase_row.id)
      from public.ingredient_purchases purchase_row
      where purchase_row.store_id = new.store_id
        and purchase_row.purchase_date between new.month_start and v_month_end
    ), '[]'::jsonb),
    'inventory', coalesce((
      select jsonb_agg(to_jsonb(inventory_row) order by inventory_row.ingredient_id)
      from public.monthly_ingredient_inventory inventory_row
      where inventory_row.store_id = new.store_id
        and inventory_row.month_start = new.month_start
    ), '[]'::jsonb),
    'costControl', (
      select to_jsonb(control_row)
      from public.monthly_cost_controls control_row
      where control_row.store_id = new.store_id
        and control_row.month_start = new.month_start
    ),
    'profitabilityInput', (
      select to_jsonb(input_row)
      from public.monthly_profitability_inputs input_row
      where input_row.store_id = new.store_id
        and input_row.month_start = new.month_start
    ),
    'profitabilitySettings', (
      select to_jsonb(settings_row)
      from public.store_profitability_settings settings_row
      where settings_row.store_id = new.store_id
    ),
    'menus', coalesce((
      select jsonb_agg(to_jsonb(menu_row) order by menu_row.id)
      from public.menus menu_row
      where menu_row.store_id = new.store_id
    ), '[]'::jsonb),
    'menuRecipes', coalesce((
      select jsonb_agg(to_jsonb(recipe_row) order by recipe_row.menu_id, recipe_row.ingredient_id)
      from public.menu_recipe_items recipe_row
      join public.menus menu on menu.id = recipe_row.menu_id
      where menu.store_id = new.store_id
    ), '[]'::jsonb),
    'setMenus', coalesce((
      select jsonb_agg(to_jsonb(set_row) order by set_row.id)
      from public.set_menus set_row
      where set_row.store_id = new.store_id
    ), '[]'::jsonb),
    'setMenuItems', coalesce((
      select jsonb_agg(to_jsonb(component_row) order by component_row.set_menu_id, component_row.menu_id)
      from public.set_menu_items component_row
      join public.set_menus set_row on set_row.id = component_row.set_menu_id
      where set_row.store_id = new.store_id
    ), '[]'::jsonb),
    'actualCostSummary', (
      select to_jsonb(actual_row)
      from public.monthly_actual_cost_summary actual_row
      where actual_row.store_id = new.store_id
        and actual_row.month_start = new.month_start
    ),
    'profitabilitySummary', (
      select to_jsonb(summary_row)
      from public.monthly_store_profitability_summary summary_row
      where summary_row.store_id = new.store_id
        and summary_row.month_start = new.month_start
    )
  );

  insert into public.monthly_close_snapshots (
    close_period_id,
    store_id,
    month_start,
    close_status,
    revision,
    payload,
    captured_by
  )
  values (
    new.id,
    new.store_id,
    new.month_start,
    new.status,
    v_revision,
    v_payload,
    auth.uid()
  );

  return new;
end;
$$;

revoke all on function public.capture_monthly_close_snapshot()
  from public, anon, authenticated;

drop trigger if exists monthly_close_periods_capture_snapshot
  on public.monthly_close_periods;
create trigger monthly_close_periods_capture_snapshot
after insert or update of status on public.monthly_close_periods
for each row execute function public.capture_monthly_close_snapshot();

create or replace function public.prevent_monthly_close_snapshot_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'Monthly close snapshots are immutable.';
end;
$$;

revoke all on function public.prevent_monthly_close_snapshot_mutation()
  from public, anon, authenticated;

drop trigger if exists monthly_close_snapshots_prevent_mutation
  on public.monthly_close_snapshots;
create trigger monthly_close_snapshots_prevent_mutation
before update or delete on public.monthly_close_snapshots
for each row execute function public.prevent_monthly_close_snapshot_mutation();
