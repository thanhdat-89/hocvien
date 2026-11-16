# Tuition batch completion

The tuition page processes selected rows with two concurrent requests. Remaining rows are shown as queued. A synchronous guard prevents duplicate submission of the same batch. Each POST has a 70-second browser timeout; a stalled request must not keep the result dialog open indefinitely.

The MISA creation workflow shares a 35-second provider-request budget across template lookup, authentication and creation. Existing shorter step timeouts remain active. No invoice write is retried. Ambiguous write outcomes keep their reserved RefID and remain `OUTCOME_UNKNOWN` for review.

If a payment request loses its response (network error, timeout or server error), the browser calls authenticated `GET /api/tuition/workflow-result?studentId=...&classId=...&month=...&year=...&recordId=...` with a 10-second timeout. This endpoint reads canonical tuition/payment/invoice records, bypasses display caches and performs no writes or provider calls. It rejects mismatched periods and ambiguous duplicate fees. The browser accepts recovery only if the recorded payment state matches the requested state.

Successful rows and ambiguous requests are removed from the pending batch to prevent replay. Confirmed validation failures remain available for correction. Unknown results are shown for review and trigger a fresh tuition summary read; the browser never automatically repeats a payment POST or invoice creation. A saved fee without invoice metadata is not presented as a confirmed invoice failure or success.

The result modal sits above the pending-changes toolbar so its Close button remains clickable for long batches. Tests use mocked APIs and never create real invoices, collect payments or send ZNS messages.

```sh
npm run build
node --test test/misa-deadline.test.cjs test/tuition-workflow-result.test.cjs test/misa-single-lookup.test.cjs test/misa-lookup.test.cjs test/misa-auto-draft-contract.test.cjs test/telegram.test.cjs
cd frontend && npm run build
# With local servers running, from the project root:
python test/tuition-batch-ui.py
```

Browser tests require `pip install playwright` and `playwright install chromium`, or an installed Chrome selected using `PLAYWRIGHT_CHROME_PATH`. An optional URL argument supports testing a deployed frontend, with API responses still mocked.
