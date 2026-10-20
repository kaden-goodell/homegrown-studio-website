# Task 13 — fix round 1 (fresh implementer; the previous one was stopped with no changes)

Read: task-13-brief.md (requirements), task-13-report.md (what was built), review-507c156..f7a7131.diff (the commit under review), and the Rulings R25, R26 in progress.md. Commit under fix: f7a7131.

Fix ALL of these (Important first):
1. PERFORMANCE: reconcile + webhook look up the catalog once per order — with many orders the nightly job can time out. Cache variation→class lookups per run (Map keyed by catalog_object_id) and batch-retrieve unknown ids with one BatchRetrieveCatalogObjects call per run (documented endpoint POST /v2/catalog/batch-retrieve, object_ids ≤ 1000). Keep the shared squareFetch + SQUARE_API_VERSION.
2. R25: nightly reconcile also lists refunds via documented ListPaymentRefunds (GET /v2/refunds?begin_time=now−48h&location_id=…, follow cursor) and feeds each through the SAME refund handler; idempotent by squareRefundId.
3. R26: a plain amount refund made in Square (no itemized returns) on one of our payments is recorded in the ledger IMMEDIATELY as money: recordRefund with freeSeat:false, spread across the booking's lines in seat order like a custom refund (cap per line at what's left), carrying squareRefundId so a replay is a no-op. Only the SEAT decision goes to kv refund-flags ("Free a seat?"). listRefundFlags must hide flags whose refund was made by us (SQUARE_BY marker / our own refund ids) and only show refunds made in Square.
4. Split tenders: an order paid with several tenders — match against ALL tender payment ids, not just the first.
5. Manual rerun: the reconcile route accepts ?force=1 (owner auth, same as other admin routes) to run now regardless of last-run marker.
6. The owner notification/log for a webhook must not include the raw event.data (may hold customer data) — log ids/types only.
7. refund.updated with status FAILED on one of our refunds → refund-flags entry kind 'refund-failed' (shown to owners); never auto-undo ledger entries (R24).
Tests first for each (extend tests/lib/classes/square-events.test.ts and the reconcile route test). Run the full suite (3 known clock failures in tests/lib/events.test.ts are expected) and `npx tsc --noEmit`. Commit with message `fix(classes): reconcile batches catalog lookups, catches missed refunds, records Square refunds as money`. Do not push. Do not dispatch subagents. Write your report to task-13-fix1-report.md (what changed, tests, anything you couldn't do); return status + commit + one-line test summary.

Also fix (from the full audit, audit-2026-10-19.md — read B2–B6, I10, M4, M5, M9):
8. Webhook Slack/owner note: never send raw `data` (shows "[object Object]" and may hold customer data) — ids and type only (same as item 6).
9. B5/M9: `.env.example` lists SQUARE_CLASSES_CATEGORY_ID, SQUARE_CLASS_TAX_ID, STORE_NAMESPACE, SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL (blank values, one-line comments). docs/square-setup-guide.md: webhook URL is https://ourhometownstudio.com/api/webhooks/square.json, events order.updated, payment.updated, refund.created, refund.updated; old domain gone.
10. B6: a TAXABLE class must never sync to Square without SQUARE_CLASS_TAX_ID — fail closed with a clear owner message ("Class tax isn't set up yet.") so the class can't be sold untaxed; and checkout must email owners on ANY drift where Square's total is lower than our quote by more than 1 cent (not just upward).
11. M5: reconcile also catches POS orders still OPEN whose payment is COMPLETED (search states COMPLETED and OPEN; only count lines when the order has a completed tender/payment).
12. I10: a plain refund on a payment covering several of our classes — spread the money over all its bookings' lines (seat order, class by class) and flag each class's seat decision.
