# Task 13 report: Square webhooks and nightly reconcile

Status: DONE. Commit f7a7131 `feat(classes): POS sales and Square refunds reach the seat ledger; nightly reconcile`.

## Files
- `src/lib/classes/square-events.ts` (new): `handleOrder`, `handleOrderById`, `handleRefund`, `handleSquareEvent`, `reconcileClasses`, `splitCents`, readers `listUnmatchedPos()`, `listPosNeedsDays()`, `listRefundFlags({includeResolved?})`, `resolveRefundFlag(id, by, action)` (action: 'freed-seat' | 'kept-seat' | 'dismissed'), `SQUARE_BY`, `CLASS_EVENTS`. Stores: kv `unmatched-pos`, `pos-needs-days`, `refund-flags`.
- `src/lib/classes/seat-ledger.ts`: new `recordPos(cls, {bookingId, orderId, paymentId, chargedCents, lines}, now)` - CAS-written confirmed 'pos' lines, one per unit, customer null, capacity ignored, idempotent by (orderId, lineUid, unit index = count of existing lines for that order+lineUid), marks overCapacity like `confirm` does.
- `src/pages/api/webhooks/square.json.ts`: keeps signature check; adds refund.created/updated to handled set; order/payment/refund events go to `handleSquareEvent` inside `locals.netlify.context.waitUntil` when present (else awaited); errors logged, always 200.
- `src/pages/api/jobs/reconcile-classes.json.ts` + `netlify/functions/reconcile-classes.ts`: HMAC job key `job:reconcile-classes` (same as other jobs, LOOKUP_SIGNING_SECRET); scheduled `0 8,9 * * *` UTC and the route only acts when studio clock is 03 (3 AM Chicago all year, same pattern as waiver-reminders). SearchOrders: our location, COMPLETED, updated_at last 48h, sort UPDATED_AT, paged by cursor.
- Tests: `tests/lib/classes/square-events.test.ts` (19), `tests/api/jobs-reconcile-classes.test.ts` (4), `tests/netlify/reconcile-classes.test.ts` (3), 5 new cases in `tests/api/webhooks.test.ts`.

## Behaviour
- Sale: order COMPLETED, or OPEN with a COMPLETED payment (payment event hint, else GET /payments for tenders). Skips other locations and `reference_id` starting `bkg_`; also skips an order already on that class's ledger from a non-pos source. Booking id per order: `bkg_pos_<orderId>`. Unit price/tax = line (total_money - total_tax_money) and total_tax_money split evenly, odd cents first. chargedCents = sum of that class's seat lines' total_money in the order. paymentId = payment-event id, else tender payment_id/id.
- Sessions: all → every session; fixed → its sessions; remaining → sessions not started at the order's closed_at; choose(count N) → next N not-yet-ended sessions (rule said "next upcoming session"; N for count>1) and a `pos-needs-days` entry. Sale time is the order's closed_at/updated_at/created_at, not processing time.
- Add-on lines: logged, ignored. Unknown variation: one catalog batch-retrieve per order; Classes-category item or sku 'cls_' → `unmatched-pos` {orderId, lineUid, name, qty, at} (deduped per order+line). Catalog failure logged, no throw.
- Refunds: matched by ledger square.paymentId across all classes. Known squareRefundId → ignored. COMPLETED + order (refund.order_id) with `returns` → match return line `source_line_item_uid` to ledger lineUid (and source_order_id); fallback by return line catalog_object_id → class variation (needed because our online/door lines have no lineUid). recordRefund freeSeat true, by {id:'square'}, reason 'Refunded in Square', cents per unit capped at what's left; onSeatFreed called. Returns that are not class items → ignored. Plain refund → `refund-flags` kind 'plain-refund'. FAILED/REJECTED on a refund the ledger recorded → 'refund-failed' flag; never undone. PENDING ignored. Flags deduped by kind+refund id.
- `listRefundFlags` hides a plain-refund flag once the ledger carries that squareRefundId (covers the race where Square's webhook lands before our own refund flow saves its refund id).

## Verification
- Focused: 178 passed (classes libs, webhook, job, function). `npx tsc --noEmit -p .` = 0 errors.
- Full suite: 3346 passed, 3 failed - only the known clock-dependent tests/lib/events.test.ts.

## Concerns / for later
1. Reconcile covers sales only, not refunds (Order.refunds ids vs PaymentRefund ids not verified against live Square; didn't guess). A missed refund webhook is not caught nightly.
2. Every café order/payment event now costs a GET order (+ a catalog batch-retrieve when it has items that aren't ours) and a listClasses read, in the background. Fine at this volume; could filter by catalog ids cached later.
3. Plain refunds are flagged only, not recorded as money on the ledger, so `bookingCap` for our own refund flow does not know about Square-side plain refunds (Square itself will refuse over-refunds).
4. `resolveRefundFlag` records the decision only; Task 14 should call `refunds.freeSeatOnly` for "free the seat" then resolve with 'freed-seat'. `listPosNeedsDays()` also needs a UI and a way to move the seat (no setter written).
5. Existing behaviour kept: every handled event still sends the 'webhook' notification before processing (now including refunds).
6. Webhook processing never verified against real Square payloads (fixtures follow the 2026-01-22 shapes from docs).
