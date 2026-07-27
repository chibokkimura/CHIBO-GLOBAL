# Phase 2 Authentication and RLS Verification

Date: 2026-07-27
Target project: `CHIBO global MG` (`kplnxkmktsylrmudhezz`)

## Purpose

This phase stabilizes the existing authentication and row-level security
boundary before adding monthly food-cost, recipe, inventory, and labor-cost
features. It does not change or delete application rows.

## Production audit findings

- All 13 application tables had RLS enabled.
- Anonymous and authenticated roles still had unnecessarily broad table
  privileges.
- Several legacy policies overlapped on `app_users` and `stores`.
- `list_store_accounts` did not enforce the HQ role inside the function.
- `purge_old_receipts` could be executed by anonymous and normal authenticated
  roles.
- All 22 current `app_users` rows match their Auth UID and normalized email.
- Exactly one HQ row exists and it uses
  `chibo.global.mgsystem@gmail.com`.

## Migration behavior

- Anonymous direct access to application tables and public RPCs is revoked.
- Authenticated browser sessions receive only the DML operations currently
  needed by the application.
- Public application and receipt policies explicitly target `authenticated`.
- HQ recognition requires Auth UID, normalized email, the `HQ` role, and the
  single authorized HQ email to match.
- OWNER store recognition requires Auth UID, normalized email, the `OWNER`
  role, and a non-null store mapping to match.
- `list_store_accounts` checks `is_hq()` internally.
- `purge_old_receipts` is executable only by `service_role`.
- Existing OWNER onboarding remains compatible; administrator approval or
  invitation-only onboarding is intentionally deferred to a separate update.

## Rollback validation result

The complete migration was executed inside one transaction against the current
production schema, followed by identity-specific assertions and `ROLLBACK`.
No schema or data change persisted.

Validated results:

- HQ saw all 447 existing sales rows and all 22 account rows.
- The selected OWNER saw only the 147 sales rows for its own store.
- The selected OWNER saw only its own account row.
- The OWNER could not execute `list_store_accounts`.
- The OWNER could not execute `purge_old_receipts`.
- The anonymous role could not select `sales`.
- The anonymous role could not execute `purge_old_receipts`.
- The transaction returned `phase2_rls_rollback_test_passed`.

Reusable post-migration assertions are stored in
`supabase/tests/phase2_rls_regression.sql`.

## Deployment boundary

The migration has not been applied to production. Production deployment must
remain a separate, explicitly approved step after the application build,
read-only data audit, and preview checks pass.
