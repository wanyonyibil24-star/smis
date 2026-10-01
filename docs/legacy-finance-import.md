# Legacy Finance and Stores Import

This one-time import copies existing relational Finance and Stores records into the replacement Resources & Finance module's single JSON state row. It **does not modify or delete** any legacy table rows.

## Before running

The existing Manus WebDev project must be attached and verified as the intended project. Its development and published containers share the managed database, so schema changes and writes affect the same project data. Apply the committed additive schema migration first, then review the dry-run summary:

```sh
pnpm exec drizzle-kit migrate
pnpm db:import-legacy-finance
```

The command defaults to **dry-run**. It reports only row counts and serialized size, not learner names or financial totals. If the Finance module state row already exists, the importer refuses to overwrite it.

After reviewing the dry-run, run the one-time import explicitly:

```sh
pnpm db:import-legacy-finance -- --apply
```

The apply is transactional: it writes the singleton module state and an audit-log entry together. Re-running after a successful import is safe because the existing state row causes the command to stop without changes.

## Mapping decisions

- Learners are copied with stable IDs derived from their legacy learner IDs. Admission numbers are minimally sanitized for the module's stored-text rules; missing/orphan learner references receive a clearly labeled placeholder so payment records are not dropped.
- The old Finance overview summed **all** fee-structure rows for each learner's grade, regardless of year or term. To preserve those displayed balances, every legacy schedule period becomes an invoice with its original period and line items. Only the current school year/term's fee rows remain as reusable fee templates, preventing historical schedules from being re-billed as current fees.
- Each payment becomes a receipt and an approved cashbook income/refund transaction. Payment method, reference, payer, and date are retained where available.
- Each expenditure becomes an approved cashbook transaction. The old schema has no payment method, so it is marked `Not recorded` rather than guessed.
- Store items retain name, unit, and reorder level. Store movements are converted to signed quantities matching the old overview's calculation (`issued` subtracts; `received` and legacy `adjustment` add). The old schema has no inventory unit cost/category, so cost is zero and category is `Other` rather than invented.
- The old database has no opening cash balance, budgets, suppliers, purchase orders, assets, or maintenance records; those new-module sections start empty. No new historical values are fabricated.

The importer validates the complete serialized state against the module's current size, shape, ID, and text constraints before any write. If a dry-run fails validation, it performs no database changes.
