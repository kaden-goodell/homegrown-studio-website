### Task 12: Refunds

**Files:**
- Create: `src/pages/api/admin/classes/refund.json.ts` (owners)
- Create: `src/pages/api/staff/class-refund.json.ts` (crew, `reason` required, ≥ 3 chars)
- Create: `src/lib/classes/refunds.ts`
- Modify: `src/lib/email.ts` (add `sendRefundEmail`)
- Test: `tests/api/class-refund.test.ts`

Flow: pick lines (whole booking / one seat / one session of a series → prorated `priceCents × sessions/sessionsInPass`, rounded down, plus that share's tax) or a custom amount ≤ remaining refundable; `freeSeat` boolean; call `providers.payment.refundPayment({ paymentId, amountCents, reason, idempotencyKey: refund:{lineIds}:{cents} })`; on success `recordRefund`; email; audit; (stage 4 hook: `onSeatFreed(classId, sessionIds)` no-op now). Refuse: more than paid, a comp/POS line with no payment id (POS refunds happen in Square), 21st refund on one payment (Square cap 20).

- [ ] **Step 1: Failing tests** for each choice, proration, cap, crew reason required, owners and crew both audited, a Square error leaves the ledger untouched.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(classes): refunds from /admin and /staff with seat release`.

