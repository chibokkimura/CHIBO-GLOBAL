# Supabase Migrations

Use this folder for every DB change.

## Rule

- Never rely only on manual Dashboard clicks.
- Every table/policy/function change must be stored as one SQL file here.

## File name format

`YYYYMMDDHHMMSS_short_description.sql`

Example:

`20260216190000_add_sales_closed_reason.sql`

## Apply order

1. Create the file with `supabase migration new short_description`.
2. Apply it through the migration workflow, never by copying the SQL into the
   Dashboard without recording the same version.
3. Verify that the local filename version and remote migration-history version
   are identical before the release is considered complete.

## Minimum migration content

- `alter table ... add column if not exists ...`
- `drop policy if exists ...`
- `create policy ...`
