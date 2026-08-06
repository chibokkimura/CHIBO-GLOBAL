-- Phase 7B-3: read-only monthly store profitability summary.
-- Existing sales, food-cost, inventory, menu, recipe and close rows are not changed.

create or replace view public.monthly_store_profitability_summary
with (security_invoker = true)
as
with months as (
  select store_id, month_start
  from public.monthly_actual_cost_summary
  union
  select store_id, month_start
  from public.monthly_profitability_inputs
),
source as (
  select
    months.store_id,
    months.month_start,
    stores.currency,
    stores.royalty_percentage,
    actual.reported_sales,
    actual.net_sales as source_sales,
    actual.actual_cost,
    coalesce(actual.inventory_complete, false) as inventory_complete,
    inputs.guest_count,
    inputs.labor_cost,
    inputs.labor_hours,
    inputs.sales_linked_fees as entered_sales_linked_fees,
    inputs.utilities_cost,
    inputs.other_operating_cost,
    inputs.notes as monthly_input_notes,
    settings.store_id is not null as settings_complete,
    inputs.store_id is not null as monthly_input_exists,
    settings.sales_tax_mode,
    settings.sales_tax_rate,
    settings.default_monthly_rent,
    settings.default_monthly_common_area_fee,
    settings.default_sales_commission_rate,
    settings.target_labor_cost_percentage,
    settings.target_prime_cost_percentage,
    settings.target_store_margin_percentage,
    settings.notes as settings_notes
  from months
  join public.stores
    on stores.id = months.store_id
  left join public.monthly_actual_cost_summary actual
    on actual.store_id = months.store_id
    and actual.month_start = months.month_start
  left join public.monthly_profitability_inputs inputs
    on inputs.store_id = months.store_id
    and inputs.month_start = months.month_start
  left join public.store_profitability_settings settings
    on settings.store_id = months.store_id
),
normalized as (
  select
    source.*,
    case
      when source.sales_tax_mode = 'included'
        and source.sales_tax_rate > 0
        then round(source.source_sales / (1 + source.sales_tax_rate / 100), 2)
      else source.source_sales
    end::numeric(18,2) as net_sales,
    case
      when source.entered_sales_linked_fees is not null
        then source.entered_sales_linked_fees
      when source.settings_complete and source.source_sales is not null
        then round(
          (
            case
              when source.sales_tax_mode = 'included'
                and source.sales_tax_rate > 0
                then source.source_sales / (1 + source.sales_tax_rate / 100)
              else source.source_sales
            end
          ) * source.default_sales_commission_rate / 100,
          2
        )
      else null
    end::numeric(18,2) as sales_linked_fees,
    case
      when source.entered_sales_linked_fees is not null then 'monthly_input'
      when source.settings_complete then 'default_rate'
      else 'missing'
    end as sales_linked_fee_source
  from source
),
calculated as (
  select
    normalized.*,
    (
      normalized.monthly_input_exists
      and normalized.labor_cost is not null
      and normalized.labor_hours is not null
      and normalized.utilities_cost is not null
      and normalized.other_operating_cost is not null
      and normalized.sales_linked_fees is not null
    ) as operating_inputs_complete,
    (
      normalized.settings_complete
      and normalized.monthly_input_exists
      and normalized.labor_cost is not null
      and normalized.labor_hours is not null
      and normalized.utilities_cost is not null
      and normalized.other_operating_cost is not null
      and normalized.sales_linked_fees is not null
      and normalized.inventory_complete
      and normalized.net_sales > 0
    ) as profitability_ready,
    (
      coalesce(normalized.default_monthly_rent, 0)
      + coalesce(normalized.default_monthly_common_area_fee, 0)
    )::numeric(18,2) as occupancy_cost,
    case
      when normalized.net_sales is not null
        then round(normalized.net_sales * normalized.royalty_percentage / 100, 2)
      else null
    end::numeric(18,2) as royalty_cost
  from normalized
)
select
  calculated.store_id,
  calculated.month_start,
  calculated.currency,
  calculated.reported_sales,
  calculated.source_sales,
  calculated.net_sales,
  calculated.sales_tax_mode,
  calculated.sales_tax_rate,
  calculated.guest_count,
  calculated.labor_cost,
  calculated.labor_hours,
  calculated.entered_sales_linked_fees,
  calculated.sales_linked_fees,
  calculated.sales_linked_fee_source,
  calculated.default_sales_commission_rate,
  calculated.utilities_cost,
  calculated.other_operating_cost,
  calculated.default_monthly_rent,
  calculated.default_monthly_common_area_fee,
  calculated.occupancy_cost,
  calculated.royalty_percentage,
  calculated.royalty_cost,
  calculated.actual_cost,
  calculated.inventory_complete,
  calculated.settings_complete,
  calculated.monthly_input_exists,
  calculated.operating_inputs_complete,
  calculated.profitability_ready,
  calculated.target_labor_cost_percentage,
  calculated.target_prime_cost_percentage,
  calculated.target_store_margin_percentage,
  calculated.monthly_input_notes,
  calculated.settings_notes,
  case
    when calculated.net_sales > 0 and calculated.actual_cost is not null
      then round(calculated.actual_cost / calculated.net_sales * 100, 3)
    else null
  end as food_cost_percentage,
  case
    when calculated.net_sales > 0 and calculated.labor_cost is not null
      then round(calculated.labor_cost / calculated.net_sales * 100, 3)
    else null
  end as labor_cost_percentage,
  case
    when calculated.net_sales > 0
      and calculated.actual_cost is not null
      and calculated.labor_cost is not null
      then round((calculated.actual_cost + calculated.labor_cost) / calculated.net_sales * 100, 3)
    else null
  end as prime_cost_percentage,
  case
    when calculated.net_sales > 0 and calculated.sales_linked_fees is not null
      then round(calculated.sales_linked_fees / calculated.net_sales * 100, 3)
    else null
  end as sales_linked_fee_percentage,
  case
    when calculated.net_sales > 0 and calculated.settings_complete
      then round(calculated.occupancy_cost / calculated.net_sales * 100, 3)
    else null
  end as occupancy_cost_percentage,
  case
    when calculated.guest_count > 0 and calculated.net_sales is not null
      then round(calculated.net_sales / calculated.guest_count, 2)
    else null
  end as sales_per_guest,
  case
    when calculated.labor_hours > 0 and calculated.net_sales is not null
      then round(calculated.net_sales / calculated.labor_hours, 2)
    else null
  end as sales_per_labor_hour,
  case
    when calculated.profitability_ready
      then round(
        calculated.net_sales
        - calculated.actual_cost
        - calculated.labor_cost
        - calculated.sales_linked_fees
        - calculated.utilities_cost
        - calculated.other_operating_cost
        - calculated.occupancy_cost
        - calculated.royalty_cost,
        2
      )
    else null
  end::numeric(18,2) as store_management_profit,
  case
    when calculated.profitability_ready
      then round(
        (
          calculated.net_sales
          - calculated.actual_cost
          - calculated.labor_cost
          - calculated.sales_linked_fees
          - calculated.utilities_cost
          - calculated.other_operating_cost
          - calculated.occupancy_cost
          - calculated.royalty_cost
        ) / calculated.net_sales * 100,
        3
      )
    else null
  end as store_management_margin_percentage,
  case
    when calculated.net_sales > 0
      and calculated.labor_cost is not null
      and calculated.target_labor_cost_percentage is not null
      then round(
        calculated.labor_cost / calculated.net_sales * 100
        - calculated.target_labor_cost_percentage,
        3
      )
    else null
  end as labor_target_variance_percentage,
  case
    when calculated.net_sales > 0
      and calculated.actual_cost is not null
      and calculated.labor_cost is not null
      and calculated.target_prime_cost_percentage is not null
      then round(
        (calculated.actual_cost + calculated.labor_cost) / calculated.net_sales * 100
        - calculated.target_prime_cost_percentage,
        3
      )
    else null
  end as prime_target_variance_percentage,
  case
    when calculated.profitability_ready
      and calculated.target_store_margin_percentage is not null
      then round(
        (
          calculated.net_sales
          - calculated.actual_cost
          - calculated.labor_cost
          - calculated.sales_linked_fees
          - calculated.utilities_cost
          - calculated.other_operating_cost
          - calculated.occupancy_cost
          - calculated.royalty_cost
        ) / calculated.net_sales * 100
        - calculated.target_store_margin_percentage,
        3
      )
    else null
  end as margin_target_variance_percentage
from calculated;

comment on view public.monthly_store_profitability_summary is
  'RLS-aware monthly management-profit summary. It is not a statutory accounting profit statement.';

revoke all on table public.monthly_store_profitability_summary from public;
revoke all on table public.monthly_store_profitability_summary from anon;
revoke all on table public.monthly_store_profitability_summary from authenticated;
grant select on table public.monthly_store_profitability_summary to authenticated;
grant select on table public.monthly_store_profitability_summary to service_role;
