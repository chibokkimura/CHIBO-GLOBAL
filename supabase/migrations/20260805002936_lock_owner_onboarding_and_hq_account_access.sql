-- Phase 1: stop owner-created stores and restrict account administration to HQ.
-- Existing stores and account mappings are preserved. This migration changes only
-- future permissions and the privileged account-list function.

create or replace function public.list_store_accounts(p_store_id text)
returns table (user_id uuid, email text, name text, store_id text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_hq() then
    raise exception 'Not authorized';
  end if;

  return query
  select u.user_id, u.email, u.name, u.store_id
  from public.app_users u
  where u.store_id = p_store_id
  order by u.email;
end;
$$;

revoke all on function public.list_store_accounts(text) from public, anon;
grant execute on function public.list_store_accounts(text) to authenticated, service_role;

-- The former onboarding lookup allowed a signed-in owner to discover a store and
-- then self-assign to it. Store assignment is now performed by HQ only.
revoke all on function public.find_store_for_onboarding(text, text, text, text)
from public, anon, authenticated;
grant execute on function public.find_store_for_onboarding(text, text, text, text)
to service_role;

drop policy if exists "stores_select_own" on public.stores;
drop policy if exists "stores_write_hq_or_own" on public.stores;
drop policy if exists "stores_insert_own_email" on public.stores;
drop policy if exists "stores_insert_hq" on public.stores;
create policy "stores_insert_hq"
on public.stores for insert
to authenticated
with check (public.is_hq());

drop policy if exists "stores_update_hq_or_own" on public.stores;
drop policy if exists "stores_update_hq" on public.stores;
create policy "stores_update_hq"
on public.stores for update
to authenticated
using (public.is_hq())
with check (public.is_hq());

-- A newly signed-in owner may create only a pending profile. HQ later assigns the
-- approved store. The sole HQ address keeps its existing bootstrap path.
drop policy if exists "app_users_upsert_own" on public.app_users;
drop policy if exists "app_users_insert_self" on public.app_users;
create policy "app_users_insert_self"
on public.app_users for insert
to authenticated
with check (
  coalesce(user_id::text, '') = public.current_auth_uid_text()
  and lower(trim(coalesce(email, ''))) = public.current_auth_email()
  and (
    (
      role = 'OWNER'
      and store_id is null
      and lower(trim(coalesce(email, ''))) = public.current_auth_email()
    )
    or (
      role = 'HQ'
      and store_id is null
      and public.is_authorized_hq_email(email)
      and public.is_authorized_hq_email(public.current_auth_email())
    )
  )
);

-- Keep owner identity and store assignment immutable from browser clients. Owners
-- may still update their display name; HQ retains full account-administration UI.
drop policy if exists "app_users_update_own" on public.app_users;
drop policy if exists "app_users_update_own_check" on public.app_users;
create or replace function public.guard_owner_app_user_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_hq() then
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

drop trigger if exists app_users_guard_owner_assignment on public.app_users;
create trigger app_users_guard_owner_assignment
before update on public.app_users
for each row execute function public.guard_owner_app_user_assignment();

revoke all on function public.guard_owner_app_user_assignment() from public, anon, authenticated;
grant execute on function public.guard_owner_app_user_assignment() to service_role;
