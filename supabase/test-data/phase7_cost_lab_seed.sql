-- Reproducible, isolated Phase 7 cost-analysis test dataset.
-- Production reporting is protected by placing all sales in January 2099.
-- Re-running this file replaces only IDs prefixed with TEST_COST_.

begin;

delete from public.stores
where id = 'TEST_COST_LAB_2099';

delete from public.ingredients
where id like 'TEST_COST_%';

insert into public.stores (
  id,
  name,
  country,
  city,
  owner_email,
  currency,
  royalty_percentage
) values (
  'TEST_COST_LAB_2099',
  'ZZ TEST Cost Lab (Do Not Use)',
  'TEST',
  'Cost Analysis Lab',
  'test.owner@chibo.invalid',
  'JPY',
  5
);

insert into public.ingredients (id, name, unit) values
  ('TEST_COST_FLOUR', 'TEST Okonomiyaki Flour', 'g'),
  ('TEST_COST_CABBAGE', 'TEST Cabbage', 'g'),
  ('TEST_COST_PORK', 'TEST Pork Belly', 'g'),
  ('TEST_COST_SAUCE', 'TEST Chibo Sauce', 'ml'),
  ('TEST_COST_NOODLES', 'TEST Yakisoba Noodles', 'g'),
  ('TEST_COST_EDAMAME', 'TEST Edamame', 'g'),
  ('TEST_COST_SYRUP', 'TEST Drink Syrup', 'ml');

insert into public.menus (id, store_id, category, name, price, image_url) values
  ('TEST_COST_MENU_OKONO', 'TEST_COST_LAB_2099', 'Okonomiyaki', 'TEST Pork Okonomiyaki', 1200, null),
  ('TEST_COST_MENU_YAKI', 'TEST_COST_LAB_2099', 'Yakisoba', 'TEST Seafood Yakisoba', 1000, null),
  ('TEST_COST_MENU_EDAMAME', 'TEST_COST_LAB_2099', 'Side Menu', 'TEST Edamame', 400, null),
  ('TEST_COST_MENU_DRINK', 'TEST_COST_LAB_2099', 'Soft Drinks', 'TEST Soft Drink', 300, null);

insert into public.menu_recipe_items (menu_id, ingredient_id, quantity) values
  ('TEST_COST_MENU_OKONO', 'TEST_COST_FLOUR', 100),
  ('TEST_COST_MENU_OKONO', 'TEST_COST_CABBAGE', 150),
  ('TEST_COST_MENU_OKONO', 'TEST_COST_PORK', 50),
  ('TEST_COST_MENU_OKONO', 'TEST_COST_SAUCE', 30),
  ('TEST_COST_MENU_YAKI', 'TEST_COST_NOODLES', 180),
  ('TEST_COST_MENU_YAKI', 'TEST_COST_CABBAGE', 100),
  ('TEST_COST_MENU_YAKI', 'TEST_COST_SAUCE', 25),
  ('TEST_COST_MENU_EDAMAME', 'TEST_COST_EDAMAME', 120),
  ('TEST_COST_MENU_DRINK', 'TEST_COST_SYRUP', 30);

insert into public.set_menus (id, store_id, name, price) values
  ('TEST_COST_SET_DINNER', 'TEST_COST_LAB_2099', 'TEST Dinner Course', 1800);

insert into public.set_menu_items (set_menu_id, menu_id, quantity) values
  ('TEST_COST_SET_DINNER', 'TEST_COST_MENU_OKONO', 1),
  ('TEST_COST_SET_DINNER', 'TEST_COST_MENU_EDAMAME', 1),
  ('TEST_COST_SET_DINNER', 'TEST_COST_MENU_DRINK', 1);

insert into public.store_ingredient_profiles (
  store_id,
  ingredient_id,
  category,
  purchase_unit,
  content_quantity,
  current_pack_price,
  currency,
  supplier,
  active
) values
  ('TEST_COST_LAB_2099', 'TEST_COST_FLOUR', 'main', '10 kg bag', 10000, 5000, 'JPY', 'TEST Flour Supplier', true),
  ('TEST_COST_LAB_2099', 'TEST_COST_CABBAGE', 'main', '10 kg case', 10000, 3000, 'JPY', 'TEST Produce Market', true),
  ('TEST_COST_LAB_2099', 'TEST_COST_PORK', 'main', '5 kg case', 5000, 6000, 'JPY', 'TEST Meat Supplier', true),
  ('TEST_COST_LAB_2099', 'TEST_COST_SAUCE', 'secondary', '1.8 L bottle', 1800, 900, 'JPY', 'TEST Sauce Supplier', true),
  ('TEST_COST_LAB_2099', 'TEST_COST_NOODLES', 'main', '6 kg case', 6000, 2400, 'JPY', 'TEST Noodle Supplier', true),
  ('TEST_COST_LAB_2099', 'TEST_COST_EDAMAME', 'secondary', '5 kg case', 5000, 2000, 'JPY', 'TEST Produce Market', true),
  ('TEST_COST_LAB_2099', 'TEST_COST_SYRUP', 'secondary', '1.5 L bottle', 1500, 1200, 'JPY', 'TEST Beverage Supplier', true);

insert into public.ingredient_purchases (
  id,
  store_id,
  ingredient_id,
  purchase_date,
  packages,
  content_quantity,
  total_cost,
  currency,
  supplier,
  notes
) values
  ('20990000-0000-0000-0000-000000000001', 'TEST_COST_LAB_2099', 'TEST_COST_FLOUR', '2099-01-10', 1, 10000, 5000, 'JPY', 'TEST Flour Supplier', 'January test purchase'),
  ('20990000-0000-0000-0000-000000000002', 'TEST_COST_LAB_2099', 'TEST_COST_CABBAGE', '2099-01-10', 2, 10000, 6000, 'JPY', 'TEST Produce Market', 'January test purchase'),
  ('20990000-0000-0000-0000-000000000003', 'TEST_COST_LAB_2099', 'TEST_COST_PORK', '2099-01-10', 1, 5000, 6000, 'JPY', 'TEST Meat Supplier', 'January test purchase'),
  ('20990000-0000-0000-0000-000000000004', 'TEST_COST_LAB_2099', 'TEST_COST_SAUCE', '2099-01-10', 2, 1800, 1800, 'JPY', 'TEST Sauce Supplier', 'January test purchase'),
  ('20990000-0000-0000-0000-000000000005', 'TEST_COST_LAB_2099', 'TEST_COST_NOODLES', '2099-01-10', 2, 6000, 4800, 'JPY', 'TEST Noodle Supplier', 'January test purchase'),
  ('20990000-0000-0000-0000-000000000006', 'TEST_COST_LAB_2099', 'TEST_COST_EDAMAME', '2099-01-10', 1, 5000, 2000, 'JPY', 'TEST Produce Market', 'January test purchase'),
  ('20990000-0000-0000-0000-000000000007', 'TEST_COST_LAB_2099', 'TEST_COST_SYRUP', '2099-01-10', 2, 1500, 2400, 'JPY', 'TEST Beverage Supplier', 'January test purchase');

insert into public.monthly_ingredient_inventory (
  store_id,
  ingredient_id,
  month_start,
  opening_quantity,
  waste_quantity,
  adjustment_quantity,
  closing_quantity,
  count_complete,
  opening_unit_cost,
  closing_unit_cost,
  notes
) values
  ('TEST_COST_LAB_2099', 'TEST_COST_FLOUR', '2099-01-01', 3000, 100, 0, 5650, true, 0.5, 0.5, 'TEST actual usage 7,350 g'),
  ('TEST_COST_LAB_2099', 'TEST_COST_CABBAGE', '2099-01-01', 5000, 400, 0, 8500, true, 0.3, 0.3, 'TEST actual usage 16,500 g'),
  ('TEST_COST_LAB_2099', 'TEST_COST_PORK', '2099-01-01', 2000, 50, 0, 3300, true, 1.2, 1.2, 'TEST actual usage 3,700 g'),
  ('TEST_COST_LAB_2099', 'TEST_COST_SAUCE', '2099-01-01', 1000, 100, 0, 950, true, 0.5, 0.5, 'TEST actual usage 3,650 ml'),
  ('TEST_COST_LAB_2099', 'TEST_COST_NOODLES', '2099-01-01', 3000, 150, 0, 5700, true, 0.4, 0.4, 'TEST actual usage 9,300 g'),
  ('TEST_COST_LAB_2099', 'TEST_COST_EDAMAME', '2099-01-01', 1500, 100, 0, 2000, true, 0.4, 0.4, 'TEST actual usage 4,500 g'),
  ('TEST_COST_LAB_2099', 'TEST_COST_SYRUP', '2099-01-01', 1000, 50, 0, 2500, true, 0.8, 0.8, 'TEST actual usage 1,500 ml');

insert into public.monthly_cost_controls (
  store_id,
  month_start,
  target_cost_percentage,
  net_sales_override,
  notes
) values (
  'TEST_COST_LAB_2099',
  '2099-01-01',
  13,
  null,
  'TEST dataset: compare actual cost with recipe-based theoretical cost.'
);

insert into public.sales (
  id,
  store_id,
  date,
  total_amount,
  receipt_image,
  is_closed,
  closed_reason,
  comment
) values
  ('TEST_COST_SALE_20990101', 'TEST_COST_LAB_2099', '2099-01-01', 26300, null, false, null, 'TEST Day 1'),
  ('TEST_COST_SALE_20990102', 'TEST_COST_LAB_2099', '2099-01-02', 33200, null, false, null, 'TEST Day 2'),
  ('TEST_COST_SALE_20990103', 'TEST_COST_LAB_2099', '2099-01-03', 32000, null, false, null, 'TEST Day 3'),
  ('TEST_COST_SALE_20990104', 'TEST_COST_LAB_2099', '2099-01-04', 32000, null, false, null, 'TEST Day 4'),
  ('TEST_COST_SALE_20990105', 'TEST_COST_LAB_2099', '2099-01-05', 36500, null, false, null, 'TEST Day 5');

-- Category totals include direct items plus the components inside each course.
insert into public.sale_items (sale_id, menu_id, quantity) values
  ('TEST_COST_SALE_20990101', 'Okonomiyaki', 12),
  ('TEST_COST_SALE_20990101', 'Yakisoba', 8),
  ('TEST_COST_SALE_20990101', 'Side Menu', 5),
  ('TEST_COST_SALE_20990101', 'Soft Drinks', 7),
  ('TEST_COST_SALE_20990102', 'Okonomiyaki', 15),
  ('TEST_COST_SALE_20990102', 'Yakisoba', 10),
  ('TEST_COST_SALE_20990102', 'Side Menu', 7),
  ('TEST_COST_SALE_20990102', 'Soft Drinks', 9),
  ('TEST_COST_SALE_20990103', 'Okonomiyaki', 12),
  ('TEST_COST_SALE_20990103', 'Yakisoba', 12),
  ('TEST_COST_SALE_20990103', 'Side Menu', 6),
  ('TEST_COST_SALE_20990103', 'Soft Drinks', 12),
  ('TEST_COST_SALE_20990104', 'Okonomiyaki', 16),
  ('TEST_COST_SALE_20990104', 'Yakisoba', 9),
  ('TEST_COST_SALE_20990104', 'Side Menu', 6),
  ('TEST_COST_SALE_20990104', 'Soft Drinks', 5),
  ('TEST_COST_SALE_20990105', 'Okonomiyaki', 15),
  ('TEST_COST_SALE_20990105', 'Yakisoba', 11),
  ('TEST_COST_SALE_20990105', 'Side Menu', 11),
  ('TEST_COST_SALE_20990105', 'Soft Drinks', 12);

-- Direct item quantities only. Course components are expanded separately.
insert into public.sale_menu_items (sale_id, menu_id, quantity) values
  ('TEST_COST_SALE_20990101', 'TEST_COST_MENU_OKONO', 10),
  ('TEST_COST_SALE_20990101', 'TEST_COST_MENU_YAKI', 8),
  ('TEST_COST_SALE_20990101', 'TEST_COST_MENU_EDAMAME', 3),
  ('TEST_COST_SALE_20990101', 'TEST_COST_MENU_DRINK', 5),
  ('TEST_COST_SALE_20990102', 'TEST_COST_MENU_OKONO', 12),
  ('TEST_COST_SALE_20990102', 'TEST_COST_MENU_YAKI', 10),
  ('TEST_COST_SALE_20990102', 'TEST_COST_MENU_EDAMAME', 4),
  ('TEST_COST_SALE_20990102', 'TEST_COST_MENU_DRINK', 6),
  ('TEST_COST_SALE_20990103', 'TEST_COST_MENU_OKONO', 8),
  ('TEST_COST_SALE_20990103', 'TEST_COST_MENU_YAKI', 12),
  ('TEST_COST_SALE_20990103', 'TEST_COST_MENU_EDAMAME', 2),
  ('TEST_COST_SALE_20990103', 'TEST_COST_MENU_DRINK', 8),
  ('TEST_COST_SALE_20990104', 'TEST_COST_MENU_OKONO', 15),
  ('TEST_COST_SALE_20990104', 'TEST_COST_MENU_YAKI', 9),
  ('TEST_COST_SALE_20990104', 'TEST_COST_MENU_EDAMAME', 5),
  ('TEST_COST_SALE_20990104', 'TEST_COST_MENU_DRINK', 4),
  ('TEST_COST_SALE_20990105', 'TEST_COST_MENU_OKONO', 10),
  ('TEST_COST_SALE_20990105', 'TEST_COST_MENU_YAKI', 11),
  ('TEST_COST_SALE_20990105', 'TEST_COST_MENU_EDAMAME', 6),
  ('TEST_COST_SALE_20990105', 'TEST_COST_MENU_DRINK', 7);

insert into public.sale_set_items (sale_id, set_menu_id, quantity) values
  ('TEST_COST_SALE_20990101', 'TEST_COST_SET_DINNER', 2),
  ('TEST_COST_SALE_20990102', 'TEST_COST_SET_DINNER', 3),
  ('TEST_COST_SALE_20990103', 'TEST_COST_SET_DINNER', 4),
  ('TEST_COST_SALE_20990104', 'TEST_COST_SET_DINNER', 1),
  ('TEST_COST_SALE_20990105', 'TEST_COST_SET_DINNER', 5);

commit;
