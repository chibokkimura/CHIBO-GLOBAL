# Release Checklist

Run this list for every release.

## A) Scope

- Change has one clear purpose.
- Rollback method is known.

## B) DB and Supabase

- Before changing anything, run the read-only audit and save the result.
- If DB changed, there is a SQL file in `supabase/migrations/`.
- SQL was executed in target project.
- RLS policies still allow expected OWNER/HQ behavior.
- After deployment, run the same read-only audit again.
- Core row counts did not decrease unexpectedly.
- Duplicate sales, orphan sale details, and unauthorized HQ accounts are all zero.

Read-only audit:

```bash
npm run test:audit:supabase
```

This command only performs `SELECT` requests. It does not insert, update, or delete data.

The write/delete smoke test must use Preview Supabase credentials. It is never part of the automatic production CI path.

## C) App behavior

- Owner can submit daily report.
- HQ can see owner report.
- Menu recipe add/remove persists after refresh.
- Receipt upload works and receipt preview works.
- Inventory edit persists after refresh.

## D) Deploy

- Branch Preview checked.
- Merge to `main`.
- Production smoke test finished.
