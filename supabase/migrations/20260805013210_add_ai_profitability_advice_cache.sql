create table if not exists public.ai_profitability_advice_runs (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on update cascade on delete cascade,
  month_start date not null,
  requester_user_id uuid not null references auth.users(id) on delete restrict,
  language text not null check (language in ('ja', 'en', 'zh-TW')),
  model text not null,
  input_hash text not null,
  advice jsonb not null,
  usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (store_id, month_start, language, input_hash)
);

create index if not exists ai_profitability_advice_runs_created_at_idx
  on public.ai_profitability_advice_runs (created_at desc);

create index if not exists ai_profitability_advice_runs_store_month_idx
  on public.ai_profitability_advice_runs (store_id, month_start, created_at desc);

create index if not exists ai_profitability_advice_runs_requester_idx
  on public.ai_profitability_advice_runs (requester_user_id);

alter table public.ai_profitability_advice_runs enable row level security;

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

revoke all on table public.ai_profitability_advice_runs from anon, authenticated;
grant select on table public.ai_profitability_advice_runs to authenticated;
grant select, insert, update, delete on table public.ai_profitability_advice_runs to service_role;
