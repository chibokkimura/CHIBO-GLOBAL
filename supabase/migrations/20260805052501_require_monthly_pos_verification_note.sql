-- A confirmed monthly POS quantity source must carry a human-verification note.
-- This prevents old or direct API clients from confirming unexplained totals.

create or replace function public.validate_monthly_product_sales_submission()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.confirmed and new.source_mode = 'monthly_pos' then
    if nullif(trim(coalesce(new.notes, '')), '') is null then
      raise exception 'Enter the monthly POS report name or checker in the source note before confirming.';
    end if;
    perform public.assert_monthly_product_sales_complete(new.store_id, new.month_start);
  end if;
  return new;
end;
$$;

revoke all on function public.validate_monthly_product_sales_submission()
  from public, anon, authenticated;
grant execute on function public.validate_monthly_product_sales_submission()
  to service_role;
