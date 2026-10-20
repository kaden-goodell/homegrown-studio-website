### Task 2: booking-core — the shared refund runner (no behaviour change)

**Files:**
- Create: `src/lib/booking-core/refund-runner.ts`
- Modify: `src/lib/classes/refunds.ts` (`refundClassBooking`, `clearRefundRequest`, `claimSquareRefund` become the class adapter over the runner; `planRefund`, keys, messages and `RefundError` stay where they are and are re-exported), `src/lib/classes/refund-requests.ts` (doc comment: `classId` is the **scope**; `'party'` is reserved for parties; no format change, so saved requests keep loading)
- Test: `tests/lib/booking-core/refund-runner.test.ts`; `tests/api/class-refund.test.ts`, `tests/api/admin-classes.test.ts`, `tests/lib/classes/square-events.test.ts`, `tests/lib/classes/to-decide.test.ts`, `tests/lib/classes/seat-ledger.test.ts`, `tests/components/shared/RefundPanel.test.tsx` must pass **unedited**

**Interfaces:**
- Consumes: `refund-requests.ts` (`saveRefundRequest`, `resendRefundRequest`, `changeRefundRequest`, `markRequestSent`, `markRequestDone`, `claimRequestEmail`, `releaseRequestEmail`, `listRefundRequests`, `hashOf`, `isWaiting`, `sameAsk`, `doneAsks`), `providers.payment.refundPayment`, `refundKey`.
- Produces:

```ts
// src/lib/booking-core/refund-runner.ts
export interface RefundScope { classId: string; bookingId: string } // parties: { classId: 'party', bookingId: <pty_ or legacy id> }
export interface RefundBook<W> {
  scope: RefundScope
  label: string                                          // class name, or "the Justice party"
  inputHash: string                                      // what was asked, without the attempt token
  plan(): Promise<RefundPlan>                            // throws RefundError before any money moves
  stillFits(rec: SavedRefundRequest): Promise<boolean>   // a turned-down request may be sent again only while it fits
  noteFailed(rawKey: string): Promise<void>
  write(rec: SavedRefundRequest, squareRefundId: string | null): Promise<W> // idempotent by request id + Square refund id
  afterWrite?(rec: SavedRefundRequest, written: W): Promise<void>           // classes: onSeatFreed
  email(rec: SavedRefundRequest, written: W): Promise<boolean>              // called only by the claimRequestEmail winner (R30)
  audit(rec: SavedRefundRequest, squareRefundId: string, how?: 'checked-in-square'): Promise<void>
}
export async function runRefund<W>(book: RefundBook<W>, ask: { attempt?: string; again?: { of: string; token: string }; reason: string }, actor: { by: By; role: 'owner' | 'crew' }): Promise<RefundResult<W>>
export async function clearRequest<W>(book: RefundBook<W>, requestId: string, outcome: 'went-through' | 'did-not-go-through', reason: string, actor: { by: By; role: 'owner' | 'crew' }): Promise<RefundResult<W> | null>
export function registerRefundScope(match: (scope: RefundScope) => boolean, bookFor: (scope: RefundScope) => Promise<RefundBook<unknown> | null>): void
export async function refundBookFor(scope: RefundScope): Promise<RefundBook<unknown> | null> // classes by default; Task 10 registers 'party'
```

- [ ] **Step 1: Failing tests** with a fake in-memory book: the R29 path (an unanswered request blocks a different ask with `STILL_WAITING_ON_SQUARE`); the same ask after a reload continues the saved request and sends the **same** key; a done ask answers "Already refunded" unless `again.of` is the latest (R31), a stale `of` → `AGAIN_IS_STALE`; FAILED → `turned-down`, failure count +1, new key on the next try; no answer → 502 `SQUARE_NO_ANSWER`, key unchanged; `write` throws after Square took it → 500 "went through in Square but didn't save here" and a retry only writes; two finishers → one email, one audit.
- [ ] **Step 2: Run** `npx vitest run tests/lib/booking-core` — FAIL.
- [ ] **Step 3: Implement** by moving the body of `refundClassBooking` (steps 1–3 identity, save, send, write, done, email once, audit once) into `runRefund` verbatim, then making the class code an adapter. `claimSquareRefund` and the webhook keep their signatures and resolve the writer through `refundBookFor`.
- [ ] **Step 4: Run** the files above unedited plus `npx vitest run tests/lib/booking-core` — PASS. Diff review: no message string changed.
- [ ] **Step 5: Commit** `refactor(booking-core): one refund runner for saved refund requests (R29–R31), classes as its first user`.


## Carried from Task 1 review (do these too)
- admin-actions.ts imports CREATE_KEY_RE from booking-core/ids.ts (one definition).
- Charge results carry an explicit `reason: 'declined' | 'failed'` tag (keep class logs/wording identical).
- Unit tests for `recovered: true` and a failed payment's paymentId.
- tellOwnersOfDrift escapes reference and hint in the HTML.
- Test stability: SettingsSheets.test.tsx and PrivateEventForm.test.tsx timed out under load once each — find the slow part (e.g. real timers, large renders) and make them deterministic (fake timers / findBy with sane timeout); don't just raise timeouts.
