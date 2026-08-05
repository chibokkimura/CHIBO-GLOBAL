drop policy if exists "monthly_product_sales_submissions_write_store_member"
  on public.monthly_product_sales_submissions;
create policy "monthly_product_sales_submissions_insert_store_member"
on public.monthly_product_sales_submissions for insert to authenticated
with check (public.is_store_member(store_id));
create policy "monthly_product_sales_submissions_update_store_member"
on public.monthly_product_sales_submissions for update to authenticated
using (public.is_store_member(store_id))
with check (public.is_store_member(store_id));
create policy "monthly_product_sales_submissions_delete_store_member"
on public.monthly_product_sales_submissions for delete to authenticated
using (public.is_store_member(store_id));

drop policy if exists "monthly_product_sales_totals_write_store_member"
  on public.monthly_product_sales_totals;
create policy "monthly_product_sales_totals_insert_store_member"
on public.monthly_product_sales_totals for insert to authenticated
with check (public.is_store_member(store_id));
create policy "monthly_product_sales_totals_update_store_member"
on public.monthly_product_sales_totals for update to authenticated
using (public.is_store_member(store_id))
with check (public.is_store_member(store_id));
create policy "monthly_product_sales_totals_delete_store_member"
on public.monthly_product_sales_totals for delete to authenticated
using (public.is_store_member(store_id));

create index if not exists monthly_product_sales_submissions_updated_by_idx
  on public.monthly_product_sales_submissions(updated_by)
  where updated_by is not null;
