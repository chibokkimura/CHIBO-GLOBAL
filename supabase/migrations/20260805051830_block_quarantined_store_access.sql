-- Owners may only read or write store-scoped data while HQ has marked the
-- store active. HQ retains access to quarantined and test stores for repair
-- and QA. Because all existing store-scoped RLS and receipt-storage policies
-- call is_store_member(), this protects both old and new frontends at the DB.

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
        and s.reporting_status = 'active'
    );
$$;

revoke all on function public.is_store_member(text) from public, anon;
grant execute on function public.is_store_member(text) to authenticated, service_role;
