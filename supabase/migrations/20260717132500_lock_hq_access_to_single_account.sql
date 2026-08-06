-- Lock HQ access to the single authorized CHIBO manager account.
-- This prevents accidental or API-level role escalation by owner accounts.

create or replace function public.current_auth_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.current_auth_uid_text()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.uid()::text, '');
$$;

create or replace function public.hq_admin_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'chibo.global.mgsystem@gmail.com'::text;
$$;

create or replace function public.is_authorized_hq_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(coalesce(p_email, ''))) = public.hq_admin_email();
$$;

-- Remove HQ role from every account except the approved manager account.
-- Existing store mappings are preserved; accounts without a store remain unable to see store data.
update public.app_users
set role = 'OWNER'
where role = 'HQ'
  and not public.is_authorized_hq_email(email);

create or replace function public.is_hq()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_authorized_hq_email(public.current_auth_email())
    and exists (
      select 1
      from public.app_users u
      where (
          coalesce(u.user_id::text, '') = public.current_auth_uid_text()
          or lower(trim(coalesce(u.email, ''))) = public.current_auth_email()
        )
        and u.role = 'HQ'
        and public.is_authorized_hq_email(u.email)
    );
$$;

drop policy if exists "app_users_insert_self" on public.app_users;
create policy "app_users_insert_self"
on public.app_users for insert
with check (
  (
    coalesce(user_id::text, '') = public.current_auth_uid_text()
    or lower(trim(coalesce(email, ''))) = public.current_auth_email()
  )
  and (
    role = 'OWNER'
    or (
      role = 'HQ'
      and public.is_authorized_hq_email(email)
      and public.is_authorized_hq_email(public.current_auth_email())
    )
  )
);

drop policy if exists "app_users_update_self" on public.app_users;
create policy "app_users_update_self"
on public.app_users for update
using (
  coalesce(user_id::text, '') = public.current_auth_uid_text()
  or lower(trim(coalesce(email, ''))) = public.current_auth_email()
)
with check (
  (
    coalesce(user_id::text, '') = public.current_auth_uid_text()
    or lower(trim(coalesce(email, ''))) = public.current_auth_email()
  )
  and (
    role = 'OWNER'
    or (
      role = 'HQ'
      and public.is_authorized_hq_email(email)
      and public.is_authorized_hq_email(public.current_auth_email())
    )
  )
);

drop policy if exists "app_users_update_hq" on public.app_users;
create policy "app_users_update_hq"
on public.app_users for update
using (public.is_hq())
with check (
  role = 'OWNER'
  or (
    role = 'HQ'
    and public.is_authorized_hq_email(email)
  )
);

grant execute on function public.hq_admin_email() to authenticated;
grant execute on function public.is_authorized_hq_email(text) to authenticated;
grant execute on function public.current_auth_email() to authenticated;
grant execute on function public.current_auth_uid_text() to authenticated;
grant execute on function public.is_hq() to authenticated;
