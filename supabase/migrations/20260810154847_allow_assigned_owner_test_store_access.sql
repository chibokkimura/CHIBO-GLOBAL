create or replace function public.is_store_member(p_store_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_hq()
    or exists (
      select 1
      from public.app_users u
      join public.stores s on s.id = u.store_id
      where (
          u.user_id = (select auth.uid())
          or lower(trim(coalesce(u.email, ''))) = public.current_auth_email()
        )
        and u.store_id = p_store_id
        -- Test stores are excluded from HQ operating totals, but an owner
        -- explicitly assigned by HQ must be able to exercise the full flow.
        and s.reporting_status in ('active', 'test')
    );
$$;

revoke all on function public.is_store_member(text) from public, anon;
grant execute on function public.is_store_member(text) to authenticated, service_role;
