### Task 4: Seat ledger with holds

**Files:**
- Create: `src/lib/classes/seat-ledger.ts`
- Test: `tests/lib/classes/seat-ledger.test.ts`

**Interfaces:**

```ts
export type SeatSource = 'online' | 'door-card' | 'door-counter' | 'comp' | 'pos'
export interface LedgerLine {
  id: string                 // 'led_'…
  bookingId: string          // groups a booking's lines ('bkg_'…)
  sessionIds: string[]
  ticketTypeId: string
  passId: string
  seat: number               // 1-based within the booking
  priceCents: Cents; taxCents: Cents
  addOns: Record<string, number>
  answers: Record<string, string>
  source: SeatSource
  state: 'held' | 'confirmed' | 'released' | 'refunded'
  holdExpiresAt: string | null
  customer: { givenName: string; familyName: string; email: string; phone: string } | null // null = POS sale with no name yet
  square: { orderId: string | null; paymentId: string | null; lineUid: string | null }
  by: By | null
  refunds: { at: string; cents: Cents; reason: string; by: By; freedSeat: boolean; squareRefundId: string | null }[]
  at: string
}
export interface Ledger { classId: string; lines: LedgerLine[] } // kv 'seat-ledger', key `ledger-{classId}`
export function seatsTaken(ledger: Ledger, sessionId: string, now: Date): number // held (unexpired) + confirmed
export async function getLedger(classId: string): Promise<Ledger>
export async function hold(cls: ScheduledClass, q: Quote, input: { bookingId: string; source: SeatSource; customer: LedgerLine['customer']; answers/addOns per seat; ttlMinutes: number; allowOverCapacity?: boolean; by?: By }, now: Date): Promise<{ ok: true; lines: LedgerLine[] } | { ok: false; reason: 'sold_out'; sessionId: string; left: number }>
export async function confirm(classId: string, bookingId: string, square: { orderId: string; paymentId: string | null }): Promise<LedgerLine[]>
export async function release(classId: string, bookingId: string): Promise<void>
export async function recordRefund(classId: string, lineIds: string[], input: { cents: Cents; reason: string; by: By; freeSeat: boolean; squareRefundId: string | null }): Promise<LedgerLine[]>
export async function setNames(classId: string, lineIds: string[], customer: NonNullable<LedgerLine['customer']>): Promise<void>
```

Rules: `hold` reads with etag, drops expired holds, checks every session in `q.sessionIds` has `capacity − seatsTaken ≥ q.seats` (skip check when `allowOverCapacity`, used by POS and door "squeeze one more"), writes with `setIfMatch`, retries 3×. A refunded line with `freedSeat:false` still counts as taken.

- [ ] **Step 1: Failing tests:** capacity 2, two holds of 1 → both ok, third → sold_out; **concurrent holds**: two `hold()` calls racing on the last seat (fs kv + a wrapped `setIfMatch` that makes the first writer win) → exactly one ok; expired hold frees the seat; confirm moves held→confirmed and keeps expiry null; release frees; refund with freeSeat true frees, false keeps; multi-session pass takes a seat on every session and a one-day pass only on its day; `allowOverCapacity` lets it reach 41 of 40.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(classes): seat ledger with locked holds`.

