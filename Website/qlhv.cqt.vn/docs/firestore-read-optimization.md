# Firestore display reads

Firebase remains the canonical database. Display snapshots are shared between backend workers in `readViews`, with revision documents in `readViewRevisions`.

- Tuition: cache the existing monthly calculation and its distinct unpaid-student count for 15 minutes. Dashboard reuses that count. `GET /api/tuition/schedule-summary?month=10&year=2026&force=true` and the tuition page's **Tải lại dữ liệu** button rebuild from original records.
- Students: build a compact index of IDs, names, status and grade for 15 minutes. Search/filter and numbered page jumps use this shared index. Read/enrich only student documents selected for the requested page. `nextCursor` anchors the next page to the index revision and filters; expired/conflicting cursors return 409, and the UI retries the numbered page. There are no billed Firestore offsets. The first index build still bills one read per student; field projection reduces payload, not the per-document read charge.
- Dashboard: shared daily summary for 5 minutes, revenue series for 12 hours and grade totals for 10 minutes. Revision changes invalidate all three immediately. Dashboard and grade totals reuse the student index. Browser query caches are marked stale after successful business writes.

Successful student/class changes (including private schedules and enrollment), tuition/payment/promotion changes, schedules, sessions, holidays, attendance, parents, matched SePay payments and the monthly generation cron invalidate affected views **before delivering success JSON**. Failed/unauthorized requests and MISA-only operations do not invalidate financial summaries; duplicate/unmatched/outbound SePay events do not either. Existing invoice view invalidation remains separate.

TTL is a fallback for updates made outside these HTTP routes (for example manual Firebase Console edits or standalone imports). For immediate display after such updates, force a tuition/dashboard refresh or invalidate the corresponding revision. `/api/dashboard/refresh` rebuilds both the current monthly tuition summary and the dashboard. Index/page cursors rebuild after expiry.

Creating tuition records, collecting money, validating invoice amounts and exporting financial reports continue reading original records. A cached summary is never accepted as authority for a financial mutation. Concurrent mutation during a build prevents its snapshot being reused. Cache write failure returns computed data without failing the basic display request.

Validation:

```sh
npm run build
node --test test/read-cost.test.cjs test/read-views.test.cjs test/firebase-only.test.cjs test/misa-single-lookup.test.cjs test/misa-lookup.test.cjs test/telegram.test.cjs test/misa-auto-draft-contract.test.cjs
cd frontend && npm run build
```

Tests assert cache reuse and expiry, dashboard/tuition consistency, invalidation across financial workflows, filtered student pagination with only selected-page reads, cursor conflicts, and unchanged MISA/Telegram behavior.
