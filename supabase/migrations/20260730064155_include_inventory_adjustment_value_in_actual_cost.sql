-- Phase 8C: value inventory adjustments in the same actual-cost formula used by
-- the owner and HQ profitability screens.
--
-- Positive adjustment quantity means stock/cost entered the store.
-- Negative adjustment quantity means stock/cost left the store.
-- Existing source rows are not rewritten.

create or replace view public.monthly_actual_cost_summary
with (security_invoker = true)
as
with sales_monthly as (
  select
    store_id,
    date_trunc('month', date::date)::date as month_start,
    sum(total_amount)::numeric(18,2) as reported_sales
  from public.sales
  group by store_id, date_trunc('month', date::date)::date
),
purchase_monthly as (
  select
    store_id,
    date_trunc('month', purchase_date)::date as month_start,
    sum(total_cost)::numeric(18,2) as purchase_cost
  from public.ingredient_purchases
  group by store_id, date_trunc('month', purchase_date)::date
),
inventory_monthly as (
  select
    store_id,
    month_start,
    sum(opening_quantity * opening_unit_cost)::numeric(18,2) as opening_inventory_value,
    sum(adjustment_quantity * closing_unit_cost)::numeric(18,2) as adjustment_inventory_value,
    sum(closing_quantity * closing_unit_cost)::numeric(18,2) as closing_inventory_value,
    count(*)::integer as ingredient_count,
    count(*) filter (where count_complete)::integer as completed_count
  from public.monthly_ingredient_inventory
  group by store_id, month_start
),
months as (
  select store_id, month_start from sales_monthly
  union
  select store_id, month_start from purchase_monthly
  union
  select store_id, month_start from inventory_monthly
  union
  select store_id, month_start from public.monthly_cost_controls
),
calculated as (
  select
    months.store_id,
    stores.currency,
    months.month_start,
    coalesce(sales_monthly.reported_sales, 0)::numeric(18,2) as reported_sales,
    monthly_cost_controls.net_sales_override,
    coalesce(
      monthly_cost_controls.net_sales_override,
      sales_monthly.reported_sales,
      0
    )::numeric(18,2) as net_sales,
    coalesce(inventory_monthly.opening_inventory_value, 0)::numeric(18,2) as opening_inventory_value,
    coalesce(purchase_monthly.purchase_cost, 0)::numeric(18,2) as purchase_cost,
    coalesce(inventory_monthly.closing_inventory_value, 0)::numeric(18,2) as closing_inventory_value,
    (
      coalesce(inventory_monthly.opening_inventory_value, 0)
      + coalesce(purchase_monthly.purchase_cost, 0)
      + coalesce(inventory_monthly.adjustment_inventory_value, 0)
      - coalesce(inventory_monthly.closing_inventory_value, 0)
    )::numeric(18,2) as actual_cost,
    monthly_cost_controls.target_cost_percentage,
    coalesce(inventory_monthly.ingredient_count, 0)::integer as ingredient_count,
    coalesce(inventory_monthly.completed_count, 0)::integer as completed_count
  from months
  join public.stores on stores.id = months.store_id
  left join sales_monthly
    on sales_monthly.store_id = months.store_id
    and sales_monthly.month_start = months.month_start
  left join purchase_monthly
    on purchase_monthly.store_id = months.store_id
    and purchase_monthly.month_start = months.month_start
  left join inventory_monthly
    on inventory_monthly.store_id = months.store_id
    and inventory_monthly.month_start = months.month_start
  left join public.monthly_cost_controls
    on monthly_cost_controls.store_id = months.store_id
    and monthly_cost_controls.month_start = months.month_start
)
select
  calculated.*,
  case
    when net_sales > 0 then round(actual_cost / net_sales * 100, 3)
    else null
  end as actual_cost_percentage,
  case
    when net_sales > 0 and target_cost_percentage is not null
      then round((actual_cost / net_sales * 100) - target_cost_percentage, 3)
    else null
  end as target_variance_percentage,
  (ingredient_count > 0 and ingredient_count = completed_count) as inventory_complete
from calculated;

comment on view public.monthly_actual_cost_summary is
  'RLS-aware actual food cost. Opening value + purchases + valued inventory adjustments - closing value.';

revoke all on table public.monthly_actual_cost_summary from public, anon, authenticated;
grant select on table public.monthly_actual_cost_summary to authenticated;
grant select on table public.monthly_actual_cost_summary to service_role;
