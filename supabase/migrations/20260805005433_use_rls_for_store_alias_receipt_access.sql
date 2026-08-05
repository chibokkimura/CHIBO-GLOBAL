-- Use the alias table's own row-level policy instead of a SECURITY DEFINER
-- helper when checking access to legacy receipt paths.

create index if not exists store_id_aliases_canonical_store_idx
  on public.store_id_aliases(canonical_store_id);

drop policy if exists "store_id_aliases_select_hq_or_canonical" on public.store_id_aliases;
create policy "store_id_aliases_select_hq_or_canonical"
on public.store_id_aliases for select
to authenticated
using (public.is_hq() or canonical_store_id = public.current_store_id());

grant select on table public.store_id_aliases to authenticated, service_role;

create or replace function public.can_access_store_storage_path(p_path_store_id text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    public.is_hq()
    or p_path_store_id = public.current_store_id()
    or exists (
      select 1
      from public.store_id_aliases a
      where a.legacy_store_id = p_path_store_id
        and a.canonical_store_id = public.current_store_id()
    );
$$;

revoke all on function public.can_access_store_storage_path(text) from public, anon;
grant execute on function public.can_access_store_storage_path(text) to authenticated, service_role;
