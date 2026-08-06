-- PostgreSQL grants function execution to PUBLIC by default. Remove that inherited
-- grant first, then explicitly restore only the signed-in RPC/RLS functions.

revoke execute on function public.current_auth_email() from public;
revoke execute on function public.current_auth_uid_text() from public;
revoke execute on function public.current_store_id() from public;
revoke execute on function public.find_store_for_onboarding(text, text, text, text) from public;
revoke execute on function public.hq_admin_email() from public;
revoke execute on function public.is_authorized_hq_email(text) from public;
revoke execute on function public.is_hq() from public;
revoke execute on function public.is_store_member(text) from public;
revoke execute on function public.link_account_to_store(text, text) from public;
revoke execute on function public.list_store_accounts(text) from public;
revoke execute on function public.purge_old_receipts(integer) from public;
revoke execute on function public.unlink_account_from_store(text, text) from public;

grant execute on function public.current_auth_email() to authenticated, service_role;
grant execute on function public.current_auth_uid_text() to authenticated, service_role;
grant execute on function public.current_store_id() to authenticated, service_role;
grant execute on function public.find_store_for_onboarding(text, text, text, text) to authenticated, service_role;
grant execute on function public.hq_admin_email() to authenticated, service_role;
grant execute on function public.is_authorized_hq_email(text) to authenticated, service_role;
grant execute on function public.is_hq() to authenticated, service_role;
grant execute on function public.is_store_member(text) to authenticated, service_role;
grant execute on function public.link_account_to_store(text, text) to authenticated, service_role;
grant execute on function public.list_store_accounts(text) to authenticated, service_role;
grant execute on function public.unlink_account_from_store(text, text) to authenticated, service_role;
grant execute on function public.purge_old_receipts(integer) to service_role;
