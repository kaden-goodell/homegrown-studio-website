### Task 8: Class booking endpoint

**Files:**
- Create: `src/pages/api/classes/book.json.ts`
- Create: `src/lib/classes/checkout.ts` (pure orchestration helpers + messages)
- Test: `tests/api/classes-book.test.ts`

**Flow:** validate body → load class (status open, not cancelled, sign-up cutoff not passed, link-only allowed by direct id) → `quote` → find/create customer (`providers.customer.findOrCreate`, fills missing fields) → `hold` (ttl 10) → `createClassOrder` (idempotency `attempt:{attemptId}:order`) → compare totals → `processPayment` (idempotency `attempt:{attemptId}:pay`, buyer email) → `confirm` → save picks to ledger lines → confirmation email (`sendWorkshopConfirmation`-style, new `sendClassConfirmation` in `src/lib/classes/confirmation.ts` reusing `sendWorkshopConfirmationEmail` with `seatsLabel`) → owner text (`announceBooking`) → analytics (`reportBooking`). Responses use the same `{ data }` / `{ error, code, detail }` shapes and `classifyCheckoutError` codes as `src/pages/api/party/book.json.ts`.

Failure paths: sold_out before charge → 409 nothing held; order create fails → release, 502; total mismatch → release, 502 "We couldn't price your booking. Nothing was charged."; card declined → release, 402; **no answer** → keep hold (extend to 30 min), alert owners with booking id, 502 `unknown_outcome`; retry with same `attemptId` after a success returns the stored result (look up ledger by bookingId derived from attemptId) and never charges twice.

- [ ] **Step 1: Failing tests** for every path above plus: price comes from the class, not the body (body `price` ignored); link-only class bookable by id; draft/cancelled refused; cutoff refused; `choose` pass sessions; gift card token passes through as source (sandbox nonce `cnon:gift-card-nonce-ok` in E2E); rate limit 5/min.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(classes): booking endpoint — one order, one charge, held seats`.

