# Production data repair — 2026-08-05

## Scope

This repair addressed store records created with contradictory store, country and currency selections before HQ-only account approval was enforced.

## Safety controls

- The repair ran in one database transaction and aborted unless the expected row counts and the single date collision matched exactly.
- A private database snapshot was stored under repair key `2026-08-05_hanoi_store_repair` before any live row was changed.
- The snapshot contains the three affected store rows, account mappings, all direct child records, sales children and receipt object metadata.
- Existing receipt files were not deleted or renamed. A legacy-store alias allows only the canonical store account and HQ to read the old receipt paths.
- The uncertain duplicate was quarantined instead of deleted.

## Verified result

| Check | Result |
| --- | ---: |
| Stores before / after | 11 / 10 |
| Accounts before / after | 25 / 25 |
| HQ accounts | 1 |
| Linked owner accounts | 24 |
| Active / quarantined / test stores | 8 / 1 / 1 |
| Ha Noi Kim Ma July sales | 30 reports / VND 577,600,001 |
| Ningbo canonical sales preserved | 54 reports / CNY 507,415.8 |
| Backup sales rows / receipt objects | 32 / 32 |

The removed store was an incorrect onboarding shell. Its 30 Vietnam sales reports and owner mapping now belong to the canonical Ha Noi Kim Ma store. The canonical zero-value report that conflicted on 2026-07-30 was preserved in the private snapshot before replacement.

## Reporting behavior

- `active` stores participate in HQ sales, FX, royalty, profitability, Excel and supply-chain totals.
- `quarantined` stores remain visible to HQ in a separate data-quality section but cannot affect totals or accept new owner input.
- `test` stores remain available as QA workspaces but cannot affect operating totals.

## Automated checks

The read-only production audit now fails if:

- a store has an invalid reporting status;
- a TEST store is marked active;
- a migrated legacy store still exists or still owns sales;
- an alias points to a missing canonical store;
- unauthorized HQ accounts, duplicate daily sales or orphan sale items appear.
