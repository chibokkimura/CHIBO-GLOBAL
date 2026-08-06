-- Restrict direct Data API access to privileged helper functions.
-- Authenticated execution remains only where RLS policies or signed-in UI RPCs require it.

revoke execute on function public.current_auth_email() from anon;
revoke execute on function public.current_auth_uid_text() from anon;
revoke execute on function public.current_store_id() from anon;
revoke execute on function public.find_store_for_onboarding(text, text, text, text) from anon;
revoke execute on function public.hq_admin_email() from anon;
revoke execute on function public.is_authorized_hq_email(text) from anon;
revoke execute on function public.is_hq() from anon;
revoke execute on function public.is_store_member(text) from anon;
revoke execute on function public.link_account_to_store(text, text) from anon;
revoke execute on function public.list_store_accounts(text) from anon;
revoke execute on function public.unlink_account_from_store(text, text) from anon;

-- Receipt deletion is maintenance-only and must never be callable by browser clients.
revoke execute on function public.purge_old_receipts(integer) from anon, authenticated;
grant execute on function public.purge_old_receipts(integer) to service_role;
