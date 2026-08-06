-- Require both immutable Auth user ID and normalized Auth email for self-service
-- pending profile registration. Existing account rows are not modified.

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
    )
    or (
      role = 'HQ'
      and store_id is null
      and public.is_authorized_hq_email(email)
      and public.is_authorized_hq_email(public.current_auth_email())
    )
  )
);

drop policy if exists "app_users_update_self" on public.app_users;
create policy "app_users_update_self"
on public.app_users for update
to authenticated
using (coalesce(user_id::text, '') = public.current_auth_uid_text())
with check (
  coalesce(user_id::text, '') = public.current_auth_uid_text()
  and lower(trim(coalesce(email, ''))) = public.current_auth_email()
  and (
    role = 'OWNER'
    or (
      role = 'HQ'
      and public.is_authorized_hq_email(email)
      and public.is_authorized_hq_email(public.current_auth_email())
    )
  )
);
