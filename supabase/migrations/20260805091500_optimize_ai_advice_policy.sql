create index if not exists ai_profitability_advice_runs_requester_idx
  on public.ai_profitability_advice_runs (requester_user_id);

drop policy if exists "ai_profitability_advice_runs_hq_select" on public.ai_profitability_advice_runs;
create policy "ai_profitability_advice_runs_hq_select"
on public.ai_profitability_advice_runs
for select
to authenticated
using (
  exists (
    select 1
    from public.app_users app_user
    where app_user.user_id = (select auth.uid())
      and app_user.role = 'HQ'
      and lower(app_user.email) = 'chibo.global.mgsystem@gmail.com'
  )
);
