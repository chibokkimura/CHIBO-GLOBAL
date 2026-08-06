-- 1) sales.closed_reason compatibility
alter table public.sales
  add column if not exists closed_reason text null;

-- 2) receipts bucket
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- 3) receipts policies (OWNER own-store path, HQ all)
drop policy if exists "receipts_select_hq_or_own" on storage.objects;
create policy "receipts_select_hq_or_own"
on storage.objects for select
using (
  bucket_id = 'receipts'
  and (
    public.is_hq()
    or split_part(name, '/', 1) = public.current_store_id()
  )
);

drop policy if exists "receipts_insert_hq_or_own" on storage.objects;
create policy "receipts_insert_hq_or_own"
on storage.objects for insert
with check (
  bucket_id = 'receipts'
  and (
    public.is_hq()
    or split_part(name, '/', 1) = public.current_store_id()
  )
);

drop policy if exists "receipts_update_hq_or_own" on storage.objects;
create policy "receipts_update_hq_or_own"
on storage.objects for update
using (
  bucket_id = 'receipts'
  and (
    public.is_hq()
    or split_part(name, '/', 1) = public.current_store_id()
  )
)
with check (
  bucket_id = 'receipts'
  and (
    public.is_hq()
    or split_part(name, '/', 1) = public.current_store_id()
  )
);

drop policy if exists "receipts_delete_hq_or_own" on storage.objects;
create policy "receipts_delete_hq_or_own"
on storage.objects for delete
using (
  bucket_id = 'receipts'
  and (
    public.is_hq()
    or split_part(name, '/', 1) = public.current_store_id()
  )
);

-- 4) refresh PostgREST schema cache
notify pgrst, 'reload schema';
