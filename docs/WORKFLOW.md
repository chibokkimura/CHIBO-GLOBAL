# CHIBO Delivery Workflow (Safe Mode)

This is the only workflow you should use.

## 1) Start a task

Use one branch per request.

```bash
git checkout main
git pull
git checkout -b codex/<short-task-name>
```

## 2) Make small changes only

Rules:

- One commit should solve one problem.
- Do not mix UI and DB changes in random order.
- If DB schema/policy changed, add one SQL file in `supabase/migrations/`.

## 3) Commit format

```bash
git add .
git commit -m "fix: <what was fixed>"
git push -u origin codex/<short-task-name>
```

## 4) Validate in Vercel Preview

- Open the Preview URL for that branch.
- Test only the changed feature.
- If fail, fix in same branch.

## 5) Merge to production

- Merge branch to `main` only after Preview test passes.
- `main` must stay deployable.

## 6) Hotfix rule

If production is broken:

1. Create a new branch from `main`.
2. Commit only the minimal fix.
3. Merge after Preview verification.

