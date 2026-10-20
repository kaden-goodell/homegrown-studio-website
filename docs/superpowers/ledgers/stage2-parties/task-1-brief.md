### Task 1: booking-core — the shared charge path (no behaviour change)

**Files:**
- Create: `src/lib/booking-core/charge.ts`, `src/lib/booking-core/ids.ts`
- Modify: `src/lib/classes/checkout.ts` (re-export `PRICE_DRIFT_TOLERANCE_CENTS`, `HOLD_MINUTES`, `UNCLEAR_HOLD_HOURS`, `bookingIdFor` from booking-core; nothing else moves), `src/pages/api/classes/book.json.ts` (drift block, charge block and `paidEarlier` call the shared functions)
- Test: `tests/lib/booking-core/charge.test.ts`, `tests/lib/booking-core/ids.test.ts`; `tests/api/classes-book.test.ts` must pass **unedited**

**Interfaces:**
- Consumes: `providers.payment.{processPayment, findOrderPayment}`, `attemptKey`, `chargeOutcomeOf`, `squareErrorCodes` (`src/lib/checkout-attempt.ts`), `sendEmail`, `siteConfig.ownerEmails`.
- Produces:

```ts
// src/lib/booking-core/ids.ts
export function idFor(prefix: 'bkg' | 'pty' | 'chg', key: string): string // `${prefix}_` + sha256(key)[0..16]; bookingIdFor(a) === idFor('bkg', a)
export const CREATE_KEY_RE: RegExp                                        // /^[A-Za-z0-9_-]{8,80}$/ (same as admin-actions)

// src/lib/booking-core/charge.ts
export const PRICE_DRIFT_TOLERANCE_CENTS = 100
export const HOLD_MINUTES = 10
export const UNCLEAR_HOLD_HOURS = 24
export type DriftVerdict = { kind: 'same' } | { kind: 'charge-and-tell'; driftCents: number } | { kind: 'refuse'; driftCents: number }
export function judgeDrift(quoteCents: number, squareCents: number, opts?: { tellBelowCents?: number }): DriftVerdict // classes pass tellBelowCents 1 (today's rule)
export async function tellOwnersOfDrift(subject: string, ref: string, quoteCents: number, squareCents: number, hint: string): Promise<void> // email, never throws
export type ChargeResult =
  | { kind: 'paid'; payment: Payment }
  | { kind: 'declined'; codes: string[] }
  | { kind: 'unknown'; error: unknown }
export async function chargeOrder(input: { orderId: string; amountCents: number; paymentToken: string; email: string; attemptId: string; step?: AttemptStep }): Promise<ChargeResult>
// processPayment with attemptKey(attemptId, step ?? 'pay'); an unclear error asks findOrderPayment(orderId) before answering 'unknown'; status 'failed' → declined
export async function paidOnOrder(makeOrder: () => Promise<{ orderId: string; totalCents: number }>): Promise<{ kind: 'paid'; payment: Payment; order: { orderId: string; totalCents: number } } | { kind: 'unpaid' } | { kind: 'unknown' }>
// R15 recovery: same order key → same order → is it paid?
```

- [ ] **Step 1: Failing tests.** `judgeDrift`: 0 → same; +50 → charge-and-tell; +100 → charge-and-tell; +101 → refuse; −50 with default → charge-and-tell; −1 with `tellBelowCents: 1` → same. `chargeOrder` (mock provider): paid; declined (`not_charged` codes); a thrown unclear error whose order shows paid → paid (**"unclear charge asks the order"**); unclear and lookup throws → unknown; status `failed` → declined; the idempotency key is `attemptKey(id,'pay')`. `paidOnOrder`: completed → paid (**"paid earlier"**); none → unpaid; order create throws → unknown. `idFor('bkg', x) === bookingIdFor(x)` for 20 random ids.
- [ ] **Step 2: Run** `npx vitest run tests/lib/booking-core` — FAIL (modules missing).
- [ ] **Step 3: Implement**, then switch `classes/book.json.ts` to the shared functions keeping every message, log and alert text.
- [ ] **Step 4: Run** `npx vitest run tests/lib/booking-core tests/api/classes-book.test.ts tests/lib/classes` — PASS with `classes-book.test.ts` unedited.
- [ ] **Step 5: Commit** `refactor(booking-core): one charge path for classes and parties (R14 drift, R15 unknown outcome, ids)`.

