-- Deduplicate sales rows by (store_id, date), keeping the row with the most detail.
-- Then enforce one report per store per date.

do $$
begin
  if to_regclass('public.sale_set_items') is null then
    with item_counts as (
      select si.sale_id, count(*)::int as cnt
      from public.sale_items si
      group by si.sale_id
    ),
    ranked as (
      select
        s.id,
        s.store_id,
        s.date,
        coalesce(ic.cnt, 0) as item_cnt,
        case when coalesce(s.receipt_image, '') <> '' then 1 else 0 end as has_receipt,
        row_number() over (
          partition by s.store_id, s.date
          order by
            coalesce(ic.cnt, 0) desc,
            case when coalesce(s.receipt_image, '') <> '' then 1 else 0 end desc,
            s.id desc
        ) as rn
      from public.sales s
      left join item_counts ic on ic.sale_id = s.id
    ),
    losers as (
      select id
      from ranked
      where rn > 1
    )
    delete from public.sales s
    using losers l
    where s.id = l.id;
  else
    with item_counts as (
      select si.sale_id, count(*)::int as cnt
      from public.sale_items si
      group by si.sale_id
    ),
    set_item_counts as (
      select ssi.sale_id, count(*)::int as cnt
      from public.sale_set_items ssi
      group by ssi.sale_id
    ),
    ranked as (
      select
        s.id,
        s.store_id,
        s.date,
        coalesce(ic.cnt, 0) as item_cnt,
        coalesce(sic.cnt, 0) as set_item_cnt,
        case when coalesce(s.receipt_image, '') <> '' then 1 else 0 end as has_receipt,
        row_number() over (
          partition by s.store_id, s.date
          order by
            (coalesce(ic.cnt, 0) + coalesce(sic.cnt, 0)) desc,
            case when coalesce(s.receipt_image, '') <> '' then 1 else 0 end desc,
            s.id desc
        ) as rn
      from public.sales s
      left join item_counts ic on ic.sale_id = s.id
      left join set_item_counts sic on sic.sale_id = s.id
    ),
    losers as (
      select id
      from ranked
      where rn > 1
    )
    delete from public.sales s
    using losers l
    where s.id = l.id;
  end if;
end
$$;

-- Add unique constraint only once.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sales'::regclass
      and conname = 'sales_store_id_date_key'
  ) then
    alter table public.sales
      add constraint sales_store_id_date_key unique (store_id, date);
  end if;
end
$$;

notify pgrst, 'reload schema';
