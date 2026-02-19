# Release Checklist

Run this list for every release.

## A) Scope

- Change has one clear purpose.
- Rollback method is known.

## B) DB and Supabase

- If DB changed, there is a SQL file in `supabase/migrations/`.
- SQL was executed in target project.
- RLS policies still allow expected OWNER/HQ behavior.

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

