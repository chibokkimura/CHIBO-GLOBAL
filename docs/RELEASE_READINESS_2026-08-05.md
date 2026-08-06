# Release readiness — 2026-08-05
## Result

The code and database safety work in steps 1–4 is complete. The existing
operational row counts and the global configuration hash still match the
pre-change baseline. No store, sales, menu, purchase, inventory, close, or
snapshot row was deleted during this work.

## Completed checks

1. Captured a production baseline and verified the global configuration row.
2. Blocked owners of quarantined stores from store-scoped data at the database
   policy helper used by the existing RLS rules.
3. Reconciled local migration filenames with the remote migration history.
4. Added monthly-POS safeguards: intentionally blank entry fields, complete
   whole-number entry, human confirmation, a required source note, and a
   database-level note check.
5. Checked the Taichung pilot store without inventing data. It has daily sales,
   seven menus and three courses, but it still has no purchase-unit profiles,
   menu recipe rows, monthly purchases, inventory close, profitability settings,
   or monthly operating totals. The supplied May accounting workbook is for the
   Kaohsiung operation and must not be loaded into Taichung.
6. Rechecked the isolated test store's approved June 2026 close: 30 sales days,
   seven purchases, seven inventory rows, four immutable snapshots, JPY 160,000
   net sales, JPY 21,610 actual food cost, and JPY 57,790 management profit.
7. Generated the real ten-sheet HD workbook from the UI, verified ZIP/XLSX
   integrity, preserved the template styles/theme and untouched reference
   sheets, opened it through LibreOffice, and corrected summary formulas that
   could previously display `#VALUE!` when source cells were blank.

## Interface changes

- HQ now starts with country → store → month and the first three actions.
- Network KPI cards, the margin graph, the full profitability table, the sales
  table/Excel action, and supply-chain detail are collapsed until requested.
- Missing badges explicitly say “report days missing” instead of the ambiguous
  “missing”.
- Owner monthly-POS entry clearly separates daily-report quantities from the
  POS source and shows the difference before confirmation.
- Local owner preview now carries the same sample-data warning as HQ preview.
- Header, modal-close, settings-tab and sign-out touch targets were enlarged.

## Remaining rollout dependency

Taichung can be used as the first real pilot only after its actual purchase-unit
prices, recipes, opening inventory, purchases, closing inventory, labor/operating
totals and target settings are supplied. Until then, the system must show the
month as incomplete and must not present a final margin or AI advice.
