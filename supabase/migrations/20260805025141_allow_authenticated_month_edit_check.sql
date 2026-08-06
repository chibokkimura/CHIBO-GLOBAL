-- The monthly product-sales RPC runs with caller privileges. This read-only
-- assertion is required to reuse the existing month lock in that RPC.
grant execute on function public.assert_month_is_editable(text, date)
  to authenticated, service_role;
