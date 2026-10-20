### Task 13: Square webhooks and nightly reconcile

**Files:**
- Modify: `src/pages/api/webhooks/square.json.ts` (route `order.updated`, `payment.updated`, `refund.created`, `refund.updated` to handlers; keep signature verification; 200 fast)
- Create: `src/lib/classes/square-events.ts`
- Create: `src/pages/api/jobs/reconcile-classes.json.ts` + `netlify/functions/reconcile-classes.ts` (nightly 3 AM Chicago; SearchOrders for the last 48 h at our location; same handlers; idempotent by order id + line uid)
- Test: `tests/lib/classes/square-events.test.ts`

Rules: a COMPLETED order whose line `catalog_object_id` maps (via `classIdFromVariation`) to one of our classes and whose `reference_id` is not one of our bookings → `pos` ledger lines (one per quantity unit, `allowOverCapacity`, `customer: null`, square ids set). Lines we already recorded (same order id + line uid) are skipped. **Unknown variation** in the Classes category → stored in kv `unmatched-pos` and shown in warnings; never throws. A refund on one of our payments with itemized returns (`order.returns` lines mapping to our variations) → `recordRefund(freeSeat: true)`; a plain amount refund → kv `refund-flags` entry "Free a seat?" shown on /admin and /staff warnings, never changing seats.

- [ ] **Step 1: Failing tests:** POS sale of 2 → 2 counter seats; replayed webhook → no duplicate; our own online order echoed back → ignored; unknown variation → unmatched entry; itemized return → seat freed; plain refund → flag only; reconcile finds a missed sale.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(classes): POS sales and Square refunds reach the seat ledger; nightly reconcile`.

