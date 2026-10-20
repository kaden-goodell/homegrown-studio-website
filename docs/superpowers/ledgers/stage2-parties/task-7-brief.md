### Task 7: Party checkout core and the public /book route — one order, one charge, no Square booking

**Files:**
- Create: `src/lib/parties/checkout.ts` (the core the public route and /admin share)
- Rewrite: `src/pages/api/party/book.json.ts` (thin route over the core; ~150 lines)
- Modify: `src/pages/api/party/service-info.json.ts` (no appointment item; returns `facts: PublicPartyFacts` from settings + `getStudioDays()`, keeps `crafts`, `themes`, and `durationMinutes`/`basePriceCents` from the default package for cached pages), `src/providers/interfaces/payment.ts`, `src/providers/square/payment.ts`, `src/providers/mock/payment.ts` (`createOrder` gains optional `referenceId` and per-line `note`; still no `pricing_options`, no `taxes`), `src/lib/craft-catalog.ts` (`findPartyCraft(id)` on the server, 60 s cache; category id from `SQUARE_PARTY_CRAFT_CATEGORY_ID` when set), `src/pages/api/admin/classes/seed-sandbox.json.ts` (R12: also makes a "Party Crafts" category and two test crafts on the sandbox and prints the env line), `src/lib/classes/square-events.ts` (`handleOrder` skips `reference_id` `pty_…` before any catalog call, like `bkg_`)
- Test: rewrite `tests/api/party-book.test.ts`; `tests/lib/parties/checkout.test.ts`; update `tests/api/party-service-info-menus.test.ts`, `tests/api/admin-classes-seed-sandbox.test.ts`, `tests/lib/classes/square-events.test.ts`; add `tests/providers/square/payment-party-order.test.ts` (new folder)

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5, 6; `findOrCreate` customer, gift card `fromNonce`, themed-table `claimWeek/confirmWeekClaim/releaseWeekClaim` (unchanged, flag off), `sendPartyConfirmationEmail`, `announceBooking`, `reportBooking`, `issueEmailFixTicket`, `alertOwners`.
- Produces:

```ts
// src/lib/parties/checkout.ts
export interface BookInput {
  key: string                                   // attempt id (public, admin card) or create key (admin link) → partyId = idFor('pty', key) (R35)
  startIso: string; packageId?: string; guests: number; addOns?: Record<string, number>; craftId: string
  host: { firstName: string; lastName: string; email: string; phone: string }
  pay: { kind: 'card'; paymentToken: string; sourceKind?: 'card' | 'gift_card' } | { kind: 'link' } | { kind: 'simulated' }
  audience: 'public' | 'link' | 'admin'; linkPackageId?: string; by: By | null
  attribution?: unknown; posthogId?: unknown; origin: string; requestUrl: string
}
export type BookOutcome =
  | { kind: 'booked'; rec: PartyRecord; charge: PartyCharge | null; replay: boolean; emailSent: boolean; emailCheck?: unknown }
  | { kind: 'refused'; status: 400 | 402 | 404 | 409 | 503; code: CheckoutErrorCode; message: string; field?: string }
  | { kind: 'in_progress' }
  | { kind: 'unknown'; partyId: string }
export async function bookParty(input: BookInput, now?: Date): Promise<BookOutcome>
export function partyIdFor(key: string): string
```

**Flow (`bookParty`)**: settings (strict) → quote (audience) → date check (`bookableOn`, admin skips notice and window; never past, R37) → `isStartOpen(start, quote.minutes)` → existing record for this id? (booked → stored answer, `replay`; held and unexpired → `in_progress`, or R15 recovery via `paidOnOrder`) → gift-card pre-check (as today) → customer find/create (not fatal) → `holdTime(ttl 10 min, or null for link)` → themed-table claim (unchanged logic) → for `card`: `createOrder` (`attemptKey(key,'order')`, `referenceId` = party id, lines from `orderLineItems`) → `judgeDrift` (refuse > +100 with release; tell owners on any drift) → `chargeOrder` → `confirmTime` → `createPartyRecord` (source 'ours', status 'booked', items with `chargeId`, charge, `hostToken`, `payToken`, `craftId`, `endIso`) → `party-payments` index → confirmation email (craft from `findPartyCraft`, `bookingRef` = party id, end time includes extra time, refund line from `partyRefundLine`) → `announceBooking` → `reportBooking` → email-fix ticket. Declined → release, 402. Unknown → `extendHold(24 h)`, alert owners with the party id, `unknown`. Paid but `confirmTime` finds the time taken (hold expired after 24 h and resold) → record with `overlap: true`, alert owners, still 200 (R6). Record write fails after payment → retry once, then alert owners ("paid, party page not set up") as today. `link`: hold with no expiry, record with items due, no charge (Task 9 sends the link). `simulated` (payment bypass on local/preview): record `simulated: true`, no Square call.

- [ ] **Step 1: Failing tests:** happy path writes a `pty_` record, a booked hold, one order with `reference_id` and the unchanged line name, one payment of Square's total, the payments index, and **never calls `providers.booking.createBooking`**; price from settings (body price and craft price/name/image ignored; craft from the catalog); **"retry finds the payment"**: same attempt after success → stored answer, one `processPayment`; a held, unexpired same attempt → 409 `in_progress`; **"slot taken before any order"**: another attempt on a taken time → 409 `slot_taken` and no order; declined → hold released, time offered again; **"unknown keeps the hold"**: hold extended 24 h, owners alerted with the party id, 502 `unknown_outcome`; **"paid after the hold ran out"** (R6): recorded with `overlap`, owners alerted, 200; drift +50 and −50 → charged and owners emailed; drift +150 → refused, released, nothing charged; **"store down refuses"** → 503 before any Square call; `link` package refused without its id, accepted with it; online extra half hour extends `endIso` and the hold; gift card short → 402 before the hold; bookings gate closed → 503 as today; an old cached-page body (`serviceVariationId`, `people`, `craft.{id,name,perHeadCents}`, no `packageId`) books the default package. Provider: party order body has `reference_id`, line `note`, no `pricing_options`, no `taxes`. square-events: a `pty_` order is skipped with no catalog call.
- [ ] **Step 2–4:** run, implement, run `npx vitest run tests/api/party-*.test.ts tests/lib/parties tests/providers tests/lib/classes/square-events.test.ts tests/api/admin-classes-seed-sandbox.test.ts` — PASS.
- [ ] **Step 5: Commit** `feat(parties): /book books into our records with one order and one charge; no Square booking`.

