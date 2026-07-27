-- CHIBO phase 2 authentication/RLS regression test.
--
-- Preconditions:
--   1. Run as a database administrator.
--   2. Run after 20260727075639_stabilize_auth_and_rls_permissions.sql.
--   3. Keep this entire file in one database session.
--
-- This test discovers existing HQ/OWNER identities, impersonates their JWT
-- claims, checks visibility boundaries, and rolls back. It does not persist
-- application data changes.

begin;

select set_config(
  'test.hq_uid',
  (
    select u.user_id::text
    from public.app_users u
    where u.role = 'HQ'
      and public.is_authorized_hq_email(u.email)
    limit 1
  ),
  true
);

select set_config(
  'test.hq_email',
  (
    select u.email
    from public.app_users u
    where u.user_id::text = current_setting('test.hq_uid')
  ),
  true
);

select set_config(
  'test.owner_uid',
  (
    select u.user_id::text
    from public.app_users u
    where u.role = 'OWNER'
      and u.store_id is not null
    order by (
      select count(*)
      from public.sales s
      where s.store_id = u.store_id
    ) desc
    limit 1
  ),
  true
);

select set_config(
  'test.owner_email',
  (
    select u.email
    from public.app_users u
    where u.user_id::text = current_setting('test.owner_uid')
  ),
  true
);

select set_config(
  'test.owner_store',
  (
    select u.store_id
    from public.app_users u
    where u.user_id::text = current_setting('test.owner_uid')
  ),
  true
);

select set_config(
  'test.expected_total_sales',
  (select count(*)::text from public.sales),
  true
);

select set_config(
  'test.expected_owner_sales',
  (
    select count(*)::text
    from public.sales s
    where s.store_id = current_setting('test.owner_store')
  ),
  true
);

select set_config(
  'test.expected_total_users',
  (select count(*)::text from public.app_users),
  true
);

set local role authenticated;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('test.hq_uid'),
    'email', current_setting('test.hq_email'),
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  visible_count bigint;
begin
  if not public.is_hq() then
    raise exception 'HQ identity was not recognized';
  end if;

  select count(*) into visible_count from public.sales;
  if visible_count <> current_setting('test.expected_total_sales')::bigint then
    raise exception 'HQ sales visibility mismatch: %', visible_count;
  end if;

  select count(*) into visible_count from public.app_users;
  if visible_count <> current_setting('test.expected_total_users')::bigint then
    raise exception 'HQ account visibility mismatch: %', visible_count;
  end if;
end
$$;

reset role;
set local role authenticated;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('test.owner_uid'),
    'email', current_setting('test.owner_email'),
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  visible_count bigint;
begin
  if public.is_hq() then
    raise exception 'OWNER identity was incorrectly recognized as HQ';
  end if;

  if public.current_store_id() <> current_setting('test.owner_store') then
    raise exception 'OWNER store mapping mismatch';
  end if;

  select count(*) into visible_count from public.sales;
  if visible_count <> current_setting('test.expected_owner_sales')::bigint then
    raise exception 'OWNER sales visibility mismatch: %', visible_count;
  end if;

  if exists (
    select 1
    from public.sales
    where store_id <> current_setting('test.owner_store')
  ) then
    raise exception 'OWNER can see another store';
  end if;

  select count(*) into visible_count from public.app_users;
  if visible_count <> 1 then
    raise exception 'OWNER account visibility mismatch: %', visible_count;
  end if;

  begin
    perform *
    from public.list_store_accounts(current_setting('test.owner_store'));
    raise exception 'OWNER unexpectedly called list_store_accounts';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.purge_old_receipts(90);
    raise exception 'OWNER unexpectedly called purge_old_receipts';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;
set local role anon;

select set_config('request.jwt.claims', '{}', true);

do $$
begin
  begin
    perform count(*) from public.sales;
    raise exception 'Anonymous role unexpectedly selected sales';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.purge_old_receipts(90);
    raise exception 'Anonymous role unexpectedly called purge_old_receipts';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;
rollback;

select 'phase2_rls_regression_passed' as result;
