-- Add a non-reporting HQ test workspace and central owner-account assignment controls.
-- The test workspace is deliberately excluded from operating totals by reporting_status.

insert into public.stores (
  id,
  name,
  country,
  city,
  owner_email,
  currency,
  royalty_percentage,
  reporting_status,
  data_quality_note
)
values (
  'HEADQUARTER_TEST',
  'Headquarter',
  'TEST',
  'Headquarter',
  'chibo.global.mgsystem@gmail.com',
  'JPY',
  0,
  'test',
  'Internal HQ test workspace. Excluded from all operating-store totals.'
)
on conflict (id) do update
set name = excluded.name,
    country = excluded.country,
    city = excluded.city,
    owner_email = excluded.owner_email,
    currency = excluded.currency,
    royalty_percentage = excluded.royalty_percentage,
    reporting_status = excluded.reporting_status,
    data_quality_note = excluded.data_quality_note;

create or replace function public.list_owner_account_assignments()
returns table (
  user_id uuid,
  email text,
  name text,
  store_id text,
  store_name text,
  reporting_status text
)
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
  select
    u.user_id,
    u.email,
    u.name,
    u.store_id,
    s.name,
    s.reporting_status
  from public.app_users u
  left join public.stores s on s.id = u.store_id
  where u.role = 'OWNER'
  order by (u.store_id is null) desc, lower(u.email);
end;
$$;

revoke all on function public.list_owner_account_assignments() from public, anon;
grant execute on function public.list_owner_account_assignments() to authenticated, service_role;

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
      and coalesce(s.reporting_status, 'active') in ('active', 'test')
  ) then
    raise exception 'Only an operating or test store can receive an owner account.';
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
