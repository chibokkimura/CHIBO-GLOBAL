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

To enable Supabase smoke test in GitHub Actions, add repository secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

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
2) (선택) `supabase/seed.sql`

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

### 5) HQ 계정 만드는 방법(권장: 수동)
HQ로 쓰실 Google 계정으로 **한 번 로그인**한 뒤, Supabase SQL Editor에서 아래처럼 넣습니다.
(아래의 `user_id`는 Supabase Auth → Users에서 확인)

```sql
insert into public.app_users (user_id, email, name, role, store_id)
values ('AUTH_USER_UUID', 'hq@chibo.com', 'HQ Admin', 'HQ', null)
on conflict (user_id) do update
set role='HQ', store_id=null;
```

### 6) 권한 동작
- OWNER: 자신의 store_id 데이터만 접근 가능
- HQ: 전체 점포/데이터 접근 가능
