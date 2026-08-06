-- Keep the Data API surface limited to the operations used by the application.
revoke all on table public.sale_menu_items from public;
revoke all on table public.sale_menu_items from anon;
revoke all on table public.sale_menu_items from authenticated;

grant select, insert, update, delete
on table public.sale_menu_items
to authenticated;
