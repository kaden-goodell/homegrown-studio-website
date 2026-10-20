### Task 2: Pricing and quotes

**Files:**
- Create: `src/lib/classes/pricing.ts`
- Test: `tests/lib/classes/pricing.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:

```ts
export interface BookingRequest {
  passId: string
  /** session ids the buyer picked (for 'choose'); ignored otherwise */
  sessionIds?: string[]
  /** count per ticket type id */
  tickets: Record<string, number>
  /** per seat: answers and add-on counts, seat index = order of seats (ticket types in content order) */
  seats?: { answers?: Record<string, string>; addOns?: Record<string, number> }[]
  promoCode?: string // stage 4
}
export interface QuoteLine { kind: 'seat' | 'addon'; seat: number; ticketTypeId: string; label: string; cents: Cents; taxCents: Cents; variationKey?: string }
export interface Quote { sessionIds: string[]; seats: number; lines: QuoteLine[]; subtotalCents: Cents; taxCents: Cents; totalCents: Cents }
export function sessionsForPass(cls: ScheduledClass, passId: string, picked: string[] | undefined, now: Date): Result<string[]>
export function quote(cls: ScheduledClass, req: BookingRequest, now: Date, taxPercent: number): Result<Quote>
```

- [ ] **Step 1: Failing tests** for: one-price class (3 people × $15 at 9% → per-line tax 135 each, total 4905); Adult/Kid cells; full series vs one-day pass on a 4-session camp; `choose` needs exactly N distinct sessions of this class; `remaining` returns only sessions with `startIso > now`, refused when `joinPartway` is false and the first session has started, refused when none remain; a not-sold cell refused ("Kid tickets aren't sold for this pass."); zero people refused; over `maxPerBooking` refused; add-on counts beyond `maxPerSeat` refused; missing required answers refused naming the seat ("Seat 2 needs a pumpkin color."); non-taxable class has 0 tax; seat ordering (ticket types in content order).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Tax per line = `taxCents(cents, taxPercent)` from `@lib/tax`; add-ons are their own lines with their own tax; `variationKey` = `${passId}:${ticketTypeId}` for seat lines and `addon:${addOnId}` for add-ons.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(classes): pricing and quotes`.

