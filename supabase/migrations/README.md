# Supabase Migrations

Use this folder for every DB change.

## Rule

- Never rely only on manual Dashboard clicks.
- Every table/policy/function change must be stored as one SQL file here.

## File name format

`YYYYMMDD_HHMMSS__short_description.sql`

Example:

`20260216_190000__add_sales_closed_reason.sql`

## Apply order

1. Open Supabase SQL Editor.
2. Run migration SQL.
3. Save result in your release notes.

## Minimum migration content

- `alter table ... add column if not exists ...`
- `drop policy if exists ...`
- `create policy ...`

