-- Set menu support:
-- 1) set_menus + set_menu_items
-- 2) sale_set_items (store set-menu quantities per report)
-- 3) RLS + indexes + realtime publication

create table if not exists public.set_menus (
  id text primary key,
  store_id text not null references public.stores(id) on delete cascade,
  name text not null,
  price numeric not null default 0
);

create table if not exists public.set_menu_items (
  set_menu_id text not null references public.set_menus(id) on delete cascade,
  menu_id text not null references public.menus(id) on delete restrict,
  quantity numeric not null,
  primary key (set_menu_id, menu_id)
);

create table if not exists public.sale_set_items (
  sale_id text not null references public.sales(id) on delete cascade,
  set_menu_id text not null references public.set_menus(id) on delete restrict,
  quantity integer not null,
  primary key (sale_id, set_menu_id)
);

alter table public.set_menus enable row level security;
alter table public.set_menu_items enable row level security;
alter table public.sale_set_items enable row level security;

drop policy if exists "set_menus_select_hq_or_own" on public.set_menus;
create policy "set_menus_select_hq_or_own"
on public.set_menus for select
using (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "set_menus_write_hq_or_own" on public.set_menus;
create policy "set_menus_write_hq_or_own"
on public.set_menus for insert
with check (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "set_menus_update_hq_or_own" on public.set_menus;
create policy "set_menus_update_hq_or_own"
on public.set_menus for update
using (public.is_hq() or store_id = public.current_store_id())
with check (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "set_menus_delete_hq_or_own" on public.set_menus;
create policy "set_menus_delete_hq_or_own"
on public.set_menus for delete
using (public.is_hq() or store_id = public.current_store_id());

drop policy if exists "set_menu_items_select_hq_or_own" on public.set_menu_items;
create policy "set_menu_items_select_hq_or_own"
on public.set_menu_items for select
using (
  public.is_hq() or exists (
    select 1 from public.set_menus sm
    where sm.id = set_menu_items.set_menu_id
      and sm.store_id = public.current_store_id()
  )
);

drop policy if exists "set_menu_items_write_hq_or_own" on public.set_menu_items;
create policy "set_menu_items_write_hq_or_own"
on public.set_menu_items for insert
with check (
  public.is_hq() or exists (
    select 1 from public.set_menus sm
    where sm.id = set_menu_items.set_menu_id
      and sm.store_id = public.current_store_id()
  )
);

drop policy if exists "set_menu_items_update_hq_or_own" on public.set_menu_items;
create policy "set_menu_items_update_hq_or_own"
on public.set_menu_items for update
using (
  public.is_hq() or exists (
    select 1 from public.set_menus sm
    where sm.id = set_menu_items.set_menu_id
      and sm.store_id = public.current_store_id()
  )
)
with check (
  public.is_hq() or exists (
    select 1 from public.set_menus sm
    where sm.id = set_menu_items.set_menu_id
      and sm.store_id = public.current_store_id()
  )
);

drop policy if exists "set_menu_items_delete_hq_or_own" on public.set_menu_items;
create policy "set_menu_items_delete_hq_or_own"
on public.set_menu_items for delete
using (
  public.is_hq() or exists (
    select 1 from public.set_menus sm
    where sm.id = set_menu_items.set_menu_id
      and sm.store_id = public.current_store_id()
  )
);

drop policy if exists "sale_set_items_select_hq_or_own" on public.sale_set_items;
create policy "sale_set_items_select_hq_or_own"
on public.sale_set_items for select
using (
  public.is_hq() or exists (
    select 1 from public.sales s
    where s.id = sale_set_items.sale_id
      and s.store_id = public.current_store_id()
  )
);

drop policy if exists "sale_set_items_write_hq_or_own" on public.sale_set_items;
create policy "sale_set_items_write_hq_or_own"
on public.sale_set_items for insert
with check (
  public.is_hq() or exists (
    select 1 from public.sales s
    where s.id = sale_set_items.sale_id
      and s.store_id = public.current_store_id()
  )
);

drop policy if exists "sale_set_items_update_hq_or_own" on public.sale_set_items;
create policy "sale_set_items_update_hq_or_own"
on public.sale_set_items for update
using (
  public.is_hq() or exists (
    select 1 from public.sales s
    where s.id = sale_set_items.sale_id
      and s.store_id = public.current_store_id()
  )
)
with check (
  public.is_hq() or exists (
    select 1 from public.sales s
    where s.id = sale_set_items.sale_id
      and s.store_id = public.current_store_id()
  )
);

drop policy if exists "sale_set_items_delete_hq_or_own" on public.sale_set_items;
create policy "sale_set_items_delete_hq_or_own"
on public.sale_set_items for delete
using (
  public.is_hq() or exists (
    select 1 from public.sales s
    where s.id = sale_set_items.sale_id
      and s.store_id = public.current_store_id()
  )
);

create index if not exists set_menus_store_id_idx on public.set_menus (store_id);
create index if not exists set_menu_items_set_menu_id_idx on public.set_menu_items (set_menu_id);
create index if not exists set_menu_items_menu_id_idx on public.set_menu_items (menu_id);
create index if not exists sale_set_items_sale_id_idx on public.sale_set_items (sale_id);
create index if not exists sale_set_items_set_menu_id_idx on public.sale_set_items (set_menu_id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'set_menus'
  ) then
    alter publication supabase_realtime add table public.set_menus;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'set_menu_items'
  ) then
    alter publication supabase_realtime add table public.set_menu_items;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sale_set_items'
  ) then
    alter publication supabase_realtime add table public.sale_set_items;
  end if;
end
$$;
