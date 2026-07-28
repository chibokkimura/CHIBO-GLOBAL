-- Deletes only the reproducible Phase 7 cost-analysis test dataset.

begin;

delete from public.stores
where id = 'TEST_COST_LAB_2099';

delete from public.ingredients
where id like 'TEST_COST_%';

commit;
