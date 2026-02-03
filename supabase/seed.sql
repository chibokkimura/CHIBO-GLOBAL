-- Optional seed data (run after schema.sql)
-- This creates sample stores, ingredients, menus, employees, sales.

insert into public.stores (id, name, country, city, owner_email, currency, royalty_percentage) values
  ('S1', 'KR Goraewa co.', 'South Korea', 'Seoul', 'owner@kr1.chibo.com', 'JPY', 5.0),
  ('S2', 'Ha Noi Kim Ma', 'Vietnam', 'Hanoi', 'owner@hanoi.chibo.com', 'USD', 5.0)
on conflict (id) do nothing;

insert into public.ingredients (id, name, unit) values
  ('I1', 'Cabbage', 'g'),
  ('I2', 'Pork Belly', 'g'),
  ('I3', 'Okonomiyaki Flour', 'g'),
  ('I4', 'Egg', 'pcs'),
  ('I5', 'Sauce', 'ml')
on conflict (id) do nothing;

insert into public.menus (id, store_id, category, name, price, image_url) values
  ('M1', 'S1', 'Okonomiyaki', 'Dotombori Yaki', 1200, null),
  ('M2', 'S1', 'Yakisoba', 'Seafood Salt Yakisoba', 1300, null),
  ('M3', 'S2', 'Okonomiyaki', 'Classic Okonomiyaki', 10, null)
on conflict (id) do nothing;

insert into public.menu_recipe_items (menu_id, ingredient_id, quantity) values
  ('M1','I1',150),
  ('M1','I3',100),
  ('M1','I4',1),
  ('M2','I5',30)
on conflict do nothing;

insert into public.employees (id, store_id, name, position, age, image_url) values
  ('E1','S1','Staff A','Manager',30,null),
  ('E2','S1','Staff B','Server',22,null),
  ('E3','S2','Staff C','Chef',28,null)
on conflict (id) do nothing;

insert into public.sales (id, store_id, date, total_amount, receipt_image, is_closed) values
  ('SA1','S1','2026-02-01', 50000, null, false),
  ('SA2','S1','2026-02-02', 42000, null, false),
  ('SA3','S2','2026-02-01', 900, null, false)
on conflict (id) do nothing;

insert into public.sale_items (sale_id, menu_id, quantity) values
  ('SA1','M1',10),
  ('SA1','M2',5),
  ('SA2','M1',7),
  ('SA3','M3',20)
on conflict do nothing;

-- NOTE:
-- app_users is NOT seeded here because it must reference auth.users(id).
-- After you sign in once, use the onboarding screen in the app to create your OWNER profile+store,
-- or insert HQ profile manually in SQL with the correct auth user_id.
