<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1aZGc-xCMJd9uysOkzDj-Hz9mx_LNRxXb

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Automated Validation

This repository now includes CI checks:

- `build`: runs `npm run build`
- `supabase-smoke`: runs DB/Storage smoke test with service role key
- `test:audit:supabase`: read-only production contract and row-count audit

For an operating production database, run the read-only audit before and after every release:

```bash
npm run test:audit:supabase
```

The existing `test:smoke:supabase` creates temporary rows and removes them. It is disabled in normal CI and can only be selected manually with Preview Supabase secrets.

To enable the read-only production audit in GitHub Actions, add repository secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

To enable the manually selected write/delete smoke test, configure the `preview` environment with:

- `PREVIEW_SUPABASE_URL`
- `PREVIEW_SUPABASE_SERVICE_ROLE_KEY`

GitHub path:

- Repository → `Settings` → `Secrets and variables` → `Actions` → `New repository secret`

## Safe Operations (Use This)

- Workflow: `docs/WORKFLOW.md`
- Release checks: `docs/RELEASE_CHECKLIST.md`
- Codex request template: `docs/CODEX_REQUEST_TEMPLATE.md`
- Supabase migration policy: `supabase/migrations/README.md`


## Google Login (Supabase)

1. `.env.local`에 아래를 설정합니다.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

2. Supabase Dashboard → Auth → URL Configuration

- Site URL: `https://(Vercel 도메인)`
- Additional Redirect URLs: `https://(Vercel 도메인)`, `http://localhost:5173`

3. 실행

```bash
npm install
npm run dev
```


## Supabase 운영화 (로그인 + DB + RLS 한 번에)

### 0) 준비
- Supabase 프로젝트 생성
- Authentication → Providers → Google 활성화
- Google OAuth Client ID/Secret 설정

### 1) DB 스키마 생성
Supabase Dashboard → SQL Editor 에서 아래 순서대로 실행합니다.

1) `supabase/schema.sql`
2) `supabase/migrations/20260728_120000__phase4_monthly_close_workflow.sql`
3) `supabase/migrations/20260728_121500__tighten_phase4_table_grants.sql`
4) `supabase/migrations/20260728031745_phase5_ingredient_purchases_and_monthly_inventory.sql`
5) `supabase/migrations/20260728032928_tighten_phase5_table_grants.sql`
6) `supabase/migrations/20260728035448_phase6_actual_cost_controls_and_summary.sql`
7) `supabase/migrations/20260728035610_phase6_actual_cost_summary_view.sql`
8) `supabase/migrations/20260728051618_phase7_direct_menu_quantities.sql`
9) `supabase/migrations/20260728052254_tighten_phase7_sale_menu_item_grants.sql`
10) (선택) `supabase/seed.sql`

업데이트 7A는 기존 카테고리 합계 `sale_items`를 그대로 보존하고,
신규 `sale_menu_items`에 직접 판매한 단품 메뉴수량만 저장합니다.
코스·세트는 기존 `sale_set_items`와 구성 메뉴를 자동 전개합니다.

### 2) Redirect URL 설정 (로그인 후 튕김 방지)
Supabase Dashboard → Authentication → URL Configuration

- Site URL
  - Vercel 배포: `https://YOUR_VERCEL_DOMAIN`
- Additional Redirect URLs
  - `https://YOUR_VERCEL_DOMAIN`
  - `http://localhost:5173`

### 3) 환경변수
#### 로컬
`.env.local`에 아래를 넣습니다.

- `VITE_SUPABASE_URL=...`
- `VITE_SUPABASE_ANON_KEY=...`

#### Vercel
Vercel → Project → Settings → Environment Variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

추가 후 Redeploy.

### 4) 최초 로그인 후 "최초 설정" 화면
- `app_users`에 내 계정이 없으면 앱이 자동으로 "최초 설정"을 띄웁니다.
- 점포를 1개 만들고, 내 계정을 OWNER로 등록합니다.

### 5) HQ 계정
HQ 관리자 계정은 보안상 아래 1개만 허용합니다.

- `chibo.global.mgsystem@gmail.com`

이 Google 계정으로 **한 번 로그인**한 뒤, Supabase SQL Editor에서 아래처럼 넣습니다.
(아래의 `user_id`는 Supabase Auth → Users에서 확인)

```sql
insert into public.app_users (user_id, email, name, role, store_id)
values ('AUTH_USER_UUID', 'chibo.global.mgsystem@gmail.com', 'HQ Admin', 'HQ', null)
on conflict (user_id) do update
set role='HQ', store_id=null;
```

### 6) 권한 동작
- OWNER: 자신의 store_id 데이터만 접근 가능
- HQ: 전체 점포/데이터 접근 가능
