-- Phase 7A: additive direct menu quantities for recipe-cost analysis.
-- Existing sales and category-level sale_items rows remain unchanged.

create table if not exists public.sale_menu_items (
  sale_id text not null references public.sales(id) on delete cascade,
  menu_id text not null references public.menus(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (sale_id, menu_id)
);

create index if not exists sale_menu_items_menu_id_idx
  on public.sale_menu_items (menu_id);

alter table public.sale_menu_items enable row level security;

create policy "sale_menu_items_select_store_member"
on public.sale_menu_items
for select
to authenticated
using (
  exists (
    select 1
    from public.sales s
    where s.id = sale_menu_items.sale_id
      and public.is_store_member(s.store_id)
  )
);

create policy "sale_menu_items_insert_store_member"
on public.sale_menu_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.sales s
    join public.menus m on m.id = sale_menu_items.menu_id
    where s.id = sale_menu_items.sale_id
      and m.store_id = s.store_id
      and public.is_store_member(s.store_id)
  )
);

create policy "sale_menu_items_update_store_member"
on public.sale_menu_items
for update
to authenticated
using (
  exists (
    select 1
    from public.sales s
    where s.id = sale_menu_items.sale_id
      and public.is_store_member(s.store_id)
  )
)
with check (
  exists (
    select 1
    from public.sales s
    join public.menus m on m.id = sale_menu_items.menu_id
    where s.id = sale_menu_items.sale_id
      and m.store_id = s.store_id
      and public.is_store_member(s.store_id)
  )
);

create policy "sale_menu_items_delete_store_member"
on public.sale_menu_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.sales s
    where s.id = sale_menu_items.sale_id
      and public.is_store_member(s.store_id)
  )
);

revoke all on table public.sale_menu_items from public;
revoke all on table public.sale_menu_items from anon;
revoke all on table public.sale_menu_items from authenticated;
grant select, insert, update, delete on table public.sale_menu_items to authenticated;
grant select, insert, update, delete on table public.sale_menu_items to service_role;
