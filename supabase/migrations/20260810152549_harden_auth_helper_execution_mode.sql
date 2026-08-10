-- These helpers only read JWT/session claims or compare a constant HQ address.
-- They do not need owner privileges. Keeping them SECURITY DEFINER exposes an
-- unnecessary elevated RPC surface and triggers Supabase security warnings.
alter function public.current_auth_email() security invoker;
alter function public.current_auth_uid_text() security invoker;
alter function public.hq_admin_email() security invoker;
alter function public.is_authorized_hq_email(text) security invoker;

-- Preserve the existing API grants used by RLS policies and privileged wrapper
-- functions, while keeping anonymous callers blocked.
revoke execute on function public.current_auth_email() from public, anon;
revoke execute on function public.current_auth_uid_text() from public, anon;
revoke execute on function public.hq_admin_email() from public, anon;
revoke execute on function public.is_authorized_hq_email(text) from public, anon;

grant execute on function public.current_auth_email() to authenticated, service_role;
grant execute on function public.current_auth_uid_text() to authenticated, service_role;
grant execute on function public.hq_admin_email() to authenticated, service_role;
grant execute on function public.is_authorized_hq_email(text) to authenticated, service_role;
