-- Phase 4: monthly close workflow, tax calendar, and sales vouchers.
-- Additive only: existing sales and menu tables are not altered.

create table if not exists public.monthly_close_periods (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on update cascade on delete restrict,
  month_start date not null,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'reopened')),
  owner_note text,
  review_note text,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_close_periods_month_start_check
    check (month_start = date_trunc('month', month_start)::date),
  constraint monthly_close_periods_store_month_key unique (store_id, month_start)
);

create table if not exists public.monthly_close_tasks (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on update cascade on delete restrict,
  month_start date not null,
  task_key text not null,
  label text not null,
  due_date date,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'not_applicable')),
  notes text,
  sort_order integer not null default 0,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_close_tasks_month_start_check
    check (month_start = date_trunc('month', month_start)::date),
  constraint monthly_close_tasks_store_month_task_key unique (store_id, month_start, task_key)
);

create table if not exists public.tax_calendar_events (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on update cascade on delete restrict,
  country text not null,
  title text not null,
  category text not null default 'tax'
    check (category in ('tax', 'payroll', 'license', 'other')),
  due_date date not null,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'not_applicable')),
  notes text,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_vouchers (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on update cascade on delete restrict,
  sale_id text references public.sales(id) on update cascade on delete restrict,
  voucher_date date not null,
  payment_method text not null
    check (payment_method in (
      'cash',
      'credit_card',
      'qr_wallet',
      'delivery_platform',
      'bank_transfer',
      'other'
    )),
  gross_amount numeric(18, 2) not null check (gross_amount >= 0),
  tax_amount numeric(18, 2) not null default 0
    check (tax_amount >= 0 and tax_amount <= gross_amount),
  settlement_due_date date,
  settlement_status text not null default 'pending'
    check (settlement_status in ('pending', 'settled', 'not_applicable')),
  reference_number text,
  notes text,
  settled_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists monthly_close_periods_store_month_idx
  on public.monthly_close_periods (store_id, month_start desc);
create index if not exists monthly_close_tasks_store_month_idx
  on public.monthly_close_tasks (store_id, month_start, sort_order);
create index if not exists tax_calendar_events_store_due_idx
  on public.tax_calendar_events (store_id, due_date);
create index if not exists sales_vouchers_store_date_idx
  on public.sales_vouchers (store_id, voucher_date);
create index if not exists sales_vouchers_sale_id_idx
  on public.sales_vouchers (sale_id)
  where sale_id is not null;

create or replace function public.touch_management_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function public.guard_monthly_close_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'approved' and not public.is_hq() then
    raise exception 'Only the authorized HQ account can approve a monthly close.';
  end if;

  if tg_op = 'UPDATE'
    and old.status = 'approved'
    and new.status <> old.status
    and not public.is_hq()
  then
    raise exception 'Only the authorized HQ account can reopen an approved monthly close.';
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

create or replace function public.validate_sales_voucher_store()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.sale_id is not null and not exists (
    select 1
    from public.sales s
    where s.id = new.sale_id
      and s.store_id = new.store_id
  ) then
    raise exception 'Sales voucher store_id must match the linked sale.';
  end if;
  return new;
end;
$$;

drop trigger if exists monthly_close_periods_touch_updated_at on public.monthly_close_periods;
create trigger monthly_close_periods_touch_updated_at
before update on public.monthly_close_periods
for each row execute function public.touch_management_updated_at();

drop trigger if exists monthly_close_periods_guard_status on public.monthly_close_periods;
create trigger monthly_close_periods_guard_status
before insert or update on public.monthly_close_periods
for each row execute function public.guard_monthly_close_status();

drop trigger if exists monthly_close_tasks_touch_updated_at on public.monthly_close_tasks;
create trigger monthly_close_tasks_touch_updated_at
before update on public.monthly_close_tasks
for each row execute function public.touch_management_updated_at();

drop trigger if exists tax_calendar_events_touch_updated_at on public.tax_calendar_events;
create trigger tax_calendar_events_touch_updated_at
before update on public.tax_calendar_events
for each row execute function public.touch_management_updated_at();

drop trigger if exists sales_vouchers_touch_updated_at on public.sales_vouchers;
create trigger sales_vouchers_touch_updated_at
before update on public.sales_vouchers
for each row execute function public.touch_management_updated_at();

drop trigger if exists sales_vouchers_validate_store on public.sales_vouchers;
create trigger sales_vouchers_validate_store
before insert or update of store_id, sale_id on public.sales_vouchers
for each row execute function public.validate_sales_voucher_store();

alter table public.monthly_close_periods enable row level security;
alter table public.monthly_close_tasks enable row level security;
alter table public.tax_calendar_events enable row level security;
alter table public.sales_vouchers enable row level security;

drop policy if exists "monthly_close_periods_select_store_member" on public.monthly_close_periods;
create policy "monthly_close_periods_select_store_member"
on public.monthly_close_periods for select
to authenticated
using (public.is_store_member(store_id));

drop policy if exists "monthly_close_periods_insert_store_member" on public.monthly_close_periods;
create policy "monthly_close_periods_insert_store_member"
on public.monthly_close_periods for insert
to authenticated
with check (public.is_store_member(store_id));

drop policy if exists "monthly_close_periods_update_store_member" on public.monthly_close_periods;
create policy "monthly_close_periods_update_store_member"
on public.monthly_close_periods for update
to authenticated
using (public.is_store_member(store_id))
with check (public.is_store_member(store_id));

drop policy if exists "monthly_close_periods_delete_hq" on public.monthly_close_periods;
create policy "monthly_close_periods_delete_hq"
on public.monthly_close_periods for delete
to authenticated
using (public.is_hq());

drop policy if exists "monthly_close_tasks_select_store_member" on public.monthly_close_tasks;
create policy "monthly_close_tasks_select_store_member"
on public.monthly_close_tasks for select
to authenticated
using (public.is_store_member(store_id));

drop policy if exists "monthly_close_tasks_insert_store_member" on public.monthly_close_tasks;
create policy "monthly_close_tasks_insert_store_member"
on public.monthly_close_tasks for insert
to authenticated
with check (public.is_store_member(store_id));

drop policy if exists "monthly_close_tasks_update_store_member" on public.monthly_close_tasks;
create policy "monthly_close_tasks_update_store_member"
on public.monthly_close_tasks for update
to authenticated
using (public.is_store_member(store_id))
with check (public.is_store_member(store_id));

drop policy if exists "monthly_close_tasks_delete_store_member" on public.monthly_close_tasks;
create policy "monthly_close_tasks_delete_store_member"
on public.monthly_close_tasks for delete
to authenticated
using (public.is_store_member(store_id));

drop policy if exists "tax_calendar_events_select_store_member" on public.tax_calendar_events;
create policy "tax_calendar_events_select_store_member"
on public.tax_calendar_events for select
to authenticated
using (public.is_store_member(store_id));

drop policy if exists "tax_calendar_events_insert_store_member" on public.tax_calendar_events;
create policy "tax_calendar_events_insert_store_member"
on public.tax_calendar_events for insert
to authenticated
with check (public.is_store_member(store_id));

drop policy if exists "tax_calendar_events_update_store_member" on public.tax_calendar_events;
create policy "tax_calendar_events_update_store_member"
on public.tax_calendar_events for update
to authenticated
using (public.is_store_member(store_id))
with check (public.is_store_member(store_id));

drop policy if exists "tax_calendar_events_delete_store_member" on public.tax_calendar_events;
create policy "tax_calendar_events_delete_store_member"
on public.tax_calendar_events for delete
to authenticated
using (public.is_store_member(store_id));

drop policy if exists "sales_vouchers_select_store_member" on public.sales_vouchers;
create policy "sales_vouchers_select_store_member"
on public.sales_vouchers for select
to authenticated
using (public.is_store_member(store_id));

drop policy if exists "sales_vouchers_insert_store_member" on public.sales_vouchers;
create policy "sales_vouchers_insert_store_member"
on public.sales_vouchers for insert
to authenticated
with check (public.is_store_member(store_id));

drop policy if exists "sales_vouchers_update_store_member" on public.sales_vouchers;
create policy "sales_vouchers_update_store_member"
on public.sales_vouchers for update
to authenticated
using (public.is_store_member(store_id))
with check (public.is_store_member(store_id));

drop policy if exists "sales_vouchers_delete_store_member" on public.sales_vouchers;
create policy "sales_vouchers_delete_store_member"
on public.sales_vouchers for delete
to authenticated
using (public.is_store_member(store_id));

revoke all on public.monthly_close_periods from anon;
revoke all on public.monthly_close_tasks from anon;
revoke all on public.tax_calendar_events from anon;
revoke all on public.sales_vouchers from anon;

grant select, insert, update, delete on public.monthly_close_periods to authenticated;
grant select, insert, update, delete on public.monthly_close_tasks to authenticated;
grant select, insert, update, delete on public.tax_calendar_events to authenticated;
grant select, insert, update, delete on public.sales_vouchers to authenticated;

comment on table public.monthly_close_periods is
  'Per-store monthly close workflow status. Existing sales data remains unchanged.';
comment on table public.monthly_close_tasks is
  'Per-store monthly close checklist items.';
comment on table public.tax_calendar_events is
  'Store-specific tax, payroll, license, and compliance due dates.';
comment on table public.sales_vouchers is
  'Payment-method and settlement details linked optionally to daily sales reports.';
