-- Keep only the table privileges used by the browser client.
-- RLS continues to decide which store rows each authenticated user may access.

revoke all on public.monthly_close_periods from authenticated;
revoke all on public.monthly_close_tasks from authenticated;
revoke all on public.tax_calendar_events from authenticated;
revoke all on public.sales_vouchers from authenticated;

grant select, insert, update, delete on public.monthly_close_periods to authenticated;
grant select, insert, update, delete on public.monthly_close_tasks to authenticated;
grant select, insert, update, delete on public.tax_calendar_events to authenticated;
grant select, insert, update, delete on public.sales_vouchers to authenticated;
