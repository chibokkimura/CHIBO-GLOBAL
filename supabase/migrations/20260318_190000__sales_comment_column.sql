alter table public.sales
  add column if not exists comment text null;

notify pgrst, 'reload schema';
