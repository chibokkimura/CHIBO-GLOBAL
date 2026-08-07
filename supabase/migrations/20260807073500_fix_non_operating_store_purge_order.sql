-- Approved-month guards must be released before purging source rows from a non-operating store.

create or replace function public.purge_non_operating_store(
  p_store_id text,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_snapshot jsonb;
  v_archive_id bigint;
  v_detached_accounts integer := 0;
begin
  if not public.is_hq() then
    raise exception 'Not authorized';
  end if;

  select * into v_store
  from public.stores
  where id = p_store_id
  for update;

  if not found then
    raise exception 'Store not found.';
  end if;

  if coalesce(v_store.reporting_status, 'active') not in ('test', 'quarantined') then
    raise exception 'Active operating stores cannot be purged.';
  end if;

  if trim(coalesce(p_confirmation, '')) <> v_store.name then
    raise exception 'Store name confirmation does not match.';
  end if;

  select jsonb_build_object(
    'store', to_jsonb(v_store),
    'app_users', coalesce((select jsonb_agg(to_jsonb(x)) from public.app_users x where x.store_id = p_store_id), '[]'::jsonb),
    'sales', coalesce((select jsonb_agg(to_jsonb(x)) from public.sales x where x.store_id = p_store_id), '[]'::jsonb),
    'sale_items', coalesce((select jsonb_agg(to_jsonb(x)) from public.sale_items x join public.sales s on s.id = x.sale_id where s.store_id = p_store_id), '[]'::jsonb),
    'sale_menu_items', coalesce((select jsonb_agg(to_jsonb(x)) from public.sale_menu_items x join public.sales s on s.id = x.sale_id where s.store_id = p_store_id), '[]'::jsonb),
    'sale_set_items', coalesce((select jsonb_agg(to_jsonb(x)) from public.sale_set_items x join public.sales s on s.id = x.sale_id where s.store_id = p_store_id), '[]'::jsonb),
    'menus', coalesce((select jsonb_agg(to_jsonb(x)) from public.menus x where x.store_id = p_store_id), '[]'::jsonb),
    'menu_recipe_items', coalesce((select jsonb_agg(to_jsonb(x)) from public.menu_recipe_items x join public.menus m on m.id = x.menu_id where m.store_id = p_store_id), '[]'::jsonb),
    'set_menus', coalesce((select jsonb_agg(to_jsonb(x)) from public.set_menus x where x.store_id = p_store_id), '[]'::jsonb),
    'set_menu_items', coalesce((select jsonb_agg(to_jsonb(x)) from public.set_menu_items x join public.set_menus sm on sm.id = x.set_menu_id where sm.store_id = p_store_id), '[]'::jsonb),
    'employees', coalesce((select jsonb_agg(to_jsonb(x)) from public.employees x where x.store_id = p_store_id), '[]'::jsonb),
    'store_ingredient_stock', coalesce((select jsonb_agg(to_jsonb(x)) from public.store_ingredient_stock x where x.store_id = p_store_id), '[]'::jsonb),
    'store_ingredient_profiles', coalesce((select jsonb_agg(to_jsonb(x)) from public.store_ingredient_profiles x where x.store_id = p_store_id), '[]'::jsonb),
    'ingredient_purchases', coalesce((select jsonb_agg(to_jsonb(x)) from public.ingredient_purchases x where x.store_id = p_store_id), '[]'::jsonb),
    'monthly_ingredient_inventory', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_ingredient_inventory x where x.store_id = p_store_id), '[]'::jsonb),
    'monthly_cost_controls', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_cost_controls x where x.store_id = p_store_id), '[]'::jsonb),
    'store_profitability_settings', coalesce((select jsonb_agg(to_jsonb(x)) from public.store_profitability_settings x where x.store_id = p_store_id), '[]'::jsonb),
    'monthly_profitability_inputs', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_profitability_inputs x where x.store_id = p_store_id), '[]'::jsonb),
    'monthly_close_periods', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_close_periods x where x.store_id = p_store_id), '[]'::jsonb),
    'monthly_close_tasks', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_close_tasks x where x.store_id = p_store_id), '[]'::jsonb),
    'monthly_close_snapshots', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_close_snapshots x where x.store_id = p_store_id), '[]'::jsonb),
    'sales_vouchers', coalesce((select jsonb_agg(to_jsonb(x)) from public.sales_vouchers x where x.store_id = p_store_id), '[]'::jsonb),
    'tax_calendar_events', coalesce((select jsonb_agg(to_jsonb(x)) from public.tax_calendar_events x where x.store_id = p_store_id), '[]'::jsonb),
    'profitability_import_profiles', coalesce((select jsonb_agg(to_jsonb(x)) from public.profitability_import_profiles x where x.store_id = p_store_id), '[]'::jsonb),
    'profitability_import_runs', coalesce((select jsonb_agg(to_jsonb(x)) from public.profitability_import_runs x where x.store_id = p_store_id), '[]'::jsonb),
    'monthly_product_sales_submissions', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_product_sales_submissions x where x.store_id = p_store_id), '[]'::jsonb),
    'monthly_product_sales_totals', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_product_sales_totals x where x.store_id = p_store_id), '[]'::jsonb),
    'ai_profitability_advice_runs', coalesce((select jsonb_agg(to_jsonb(x)) from public.ai_profitability_advice_runs x where x.store_id = p_store_id), '[]'::jsonb),
    'store_id_aliases', coalesce((select jsonb_agg(to_jsonb(x)) from public.store_id_aliases x where x.canonical_store_id = p_store_id), '[]'::jsonb)
  ) into v_snapshot;

  insert into public.store_purge_archives (
    store_id, store_name, reporting_status, snapshot, deleted_by
  ) values (
    v_store.id, v_store.name, v_store.reporting_status, v_snapshot, auth.uid()
  ) returning id into v_archive_id;

  update public.app_users set store_id = null where store_id = p_store_id;
  get diagnostics v_detached_accounts = row_count;

  -- Remove the non-operating store's close lock first. Source-table guards correctly
  -- block writes to approved months until the close period no longer exists.
  perform set_config('app.purge_non_operating_store', 'on', true);
  delete from public.monthly_close_snapshots where store_id = p_store_id;
  perform set_config('app.purge_non_operating_store', 'off', true);
  delete from public.monthly_close_tasks where store_id = p_store_id;
  delete from public.monthly_close_periods where store_id = p_store_id;
  -- Delete the confirmed submission parent; its totals cascade atomically.
  delete from public.monthly_product_sales_submissions where store_id = p_store_id;

  delete from public.sales_vouchers where store_id = p_store_id;
  delete from public.sale_items where sale_id in (select id from public.sales where store_id = p_store_id);
  delete from public.sale_menu_items where sale_id in (select id from public.sales where store_id = p_store_id);
  delete from public.sale_set_items where sale_id in (select id from public.sales where store_id = p_store_id);
  delete from public.sales where store_id = p_store_id;

  delete from public.set_menu_items where set_menu_id in (select id from public.set_menus where store_id = p_store_id);
  delete from public.set_menus where store_id = p_store_id;
  delete from public.menu_recipe_items where menu_id in (select id from public.menus where store_id = p_store_id);
  delete from public.menus where store_id = p_store_id;

  delete from public.monthly_profitability_inputs where store_id = p_store_id;
  delete from public.profitability_import_runs where store_id = p_store_id;
  delete from public.profitability_import_profiles where store_id = p_store_id;
  delete from public.store_profitability_settings where store_id = p_store_id;
  delete from public.tax_calendar_events where store_id = p_store_id;
  delete from public.store_id_aliases where canonical_store_id = p_store_id;

  delete from public.stores where id = p_store_id;

  return jsonb_build_object(
    'archive_id', v_archive_id,
    'store_id', v_store.id,
    'store_name', v_store.name,
    'detached_accounts', v_detached_accounts
  );
end;
$$;

revoke all on function public.purge_non_operating_store(text, text) from public, anon;
grant execute on function public.purge_non_operating_store(text, text) to authenticated, service_role;
