# Monthly tuition invoice reconciliation

The production backend starts a monthly reconciliation on the final calendar day at 07:00 Asia/Ho_Chi_Minh, from October 2026 onward. Vercel Hobby invokes daily cron within the configured hour, so actual startup is between 07:00 and 07:59. The fee cutoff remains 07:00 even if startup is delayed.

`GET /api/tuition/cron/reconcile-monthly-invoices` runs daily with `0 0 * * *` UTC. It starts a run only on the last day after 07:00 Vietnam time, and otherwise acts as a watchdog for interrupted runs or unsent reports. All cron/readiness/worker routes require `Authorization: Bearer CRON_SECRET`. They are mounted before tuition user authentication, with their own secret validation.

The watchdog dispatches `GET /api/tuition/cron/monthly-invoice-worker`. Each worker immediately acknowledges with HTTP 202, uses `waitUntil` for one bounded reconciliation step, releases its lease, then dispatches the next worker. This accommodates Hobby's daily cron minimum without a continuously running process or another scheduler. A chain interruption resumes at the next daily watchdog; an administrator can also invoke the protected watchdog without creating another run for the same month.

## Scope and persistence

The snapshot includes existing tuition records for the billing month/year, regardless of payment status. Records created after the 07:00 cutoff are excluded. Zero-value/fully waived fees are skipped. Invalid amounts or missing creation dates require review. Eligibility is checked again against canonical fee data before creation and inside the invoice-reservation transaction.

`monthlyInvoiceRuns/YYYY-MM` holds the run status, lease, timestamps, totals and report-delivery progress. Its `items/{tuitionRecordId}` subcollection stores each snapshot entry and result. Initialization writes deterministic batches before marking a run ready. Two-minute transactional leases protect initialization, worker processing and report dispatch. Stale leases can be reclaimed.

Existing invoice links include document IDs, recordIds and grouped source IDs, including older documents without billingPeriods. Confirmed draft/issued/tax-sent invoices prevent another creation. Unresolved RefIDs are read from MISA; failed lookups, failed/deleted invoice links and interrupted work without canonical metadata are reported for review. Retired draft links are also checked by the existing creation service. MISA invoices manually created without any website linkage cannot be automatically matched by this flow; they require reconciliation before creating a replacement.

New invoices use the existing template/buyer validation and reservation workflow, with actor `monthly-invoices:YYYY-MM`, positive amounts required and individual Telegram notifications suppressed. Invoices are never signed or published by this job. A lost acknowledgement is recovered from the reserved invoice; ambiguous outcomes are never automatically posted again.

## Telegram and inspection

The final report includes fee totals, existing invoices, new drafts and their value, skipped zero/changed/late fees, and failure/review details. Messages are split below Telegram's size limit. Each successful message advances a saved report cursor. Telegram failure stops the chain and the daily watchdog retries notification only; invoice work is not replayed. Telegram delivery is at least once: a process failure after Telegram accepts a message but before its receipt is persisted can duplicate that report message.

Admin-only read endpoints:

- `/api/tuition/misa/monthly-reconciliation/preview?month=10&year=2026`: fee/link snapshot only; no writes or MISA/Telegram calls.
- `/api/tuition/misa/monthly-reconciliation?month=10&year=2026`: saved run summary and per-fee results.

Protected readiness endpoint `/api/tuition/cron/monthly-invoice-readiness` checks Telegram connectivity and the unique default MISA template without creating an invoice or sending a message.

## Validation

```sh
npm run build
node --test test/monthly-invoice-reconciliation.test.cjs test/monthly-invoice-cron.test.cjs test/misa-single-lookup.test.cjs test/invoice-eligibility.test.cjs test/tuition-workflow-result.test.cjs
npm --prefix frontend run build
```

Tests use in-memory Firestore and provider doubles. Production preflight must use preview/readiness only. Do not change the clock or invoke a creation routine to simulate month-end against live data.
