# Stage 2 — Parties on Our Own Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every new party is our own record on the shared studio schedule, paid with one Square order + one Square payment per charge, and run from /admin (book, move, cancel, extras, payment link, refund, Parties setup). No Square Booking is ever created again, so Appointments Plus can be cancelled once the last Square-booked party has run.

**Architecture:** Stage 2 reuses stage 1's machinery instead of copying it. Two shared pieces are lifted out of the class code into `src/lib/booking-core/` first (Task 1 the charge path: R14 drift, R15 unknown outcome, deterministic ids; Task 2 the refund runner: saved refund requests, R29–R31, one email, one audit), with the class tests unchanged as the proof. Parties then get their own small domain under `src/lib/parties/` (settings with a config fallback, pure time rules, records with items/charges/refunds, a month-keyed "party book" that is the lock and the schedule's party source, checkout, refunds adapter). The `parties` record store keeps its key (`bookingId`), so RSVPs, waivers, check-in, invite, host page and roster keep working; new parties get ids `pty_…`. Legacy Square parties are read (never written) until an owner switches that read off.

**Tech Stack:** Astro SSR + React islands, TypeScript, Netlify Blobs via `makeKvStore` (CAS `getWithMeta` + `setIfMatch`), Square SDK v44 (`orders.create`, `payments.create`, `refunds.refundPayment`, all already used live), Square Web Payments SDK through `src/components/checkout/PaymentForm.tsx`, vitest + Testing Library. The branch preview runs Square **sandbox** with `STORE_NAMESPACE=preview`.

**Spec:** `docs/superpowers/specs/2026-10-18-own-booking-system-design.md` ("Stage 2: parties", "Rules carried over", "Decisions (18 Oct)", "Refunds, seats and the waitlist", "Square API review"). Stage-1 plan for conventions: `docs/superpowers/plans/2026-10-18-stage1-own-classes.md`. Stage-1 ledger with rulings R1–R39: `.superpowers/sdd/2026-10-18-stage1-own-classes/progress.md`. Admin rules: `task-11b-common.md`; design: `admin-mockup-D.html` sheets `partynew`, `party`, `parties` (same folder).

## Task 0: Ready the branch (no code, no commit of its own)

Start Task 1 only when all of these hold:

- [ ] `progress.md` shows Task 11b-C complete (its fix round is editing `studio-settings`, `settings-effects`, `cafe-windows`, `to-decide` and admin sheets right now) and Task 17 merged from `kaden/admin-d` (it brings `scripts/sandbox-e2e.ts`, `scripts/lib/sandbox-e2e/{core,scenarios}.ts`, `tests/scripts/sandbox-e2e.test.ts` and `docs/superpowers/plans/stage1-real-money-checklist.md`, none of which are on `kaden/own-booking-system` yet).
- [ ] `dev` merged into the branch. It carries `466a650`, which already deletes `src/pages/api/booking/create.json.ts` and `cancel.json.ts` (cancel took any Square booking id with no sign-in) and their tests. Resolve conflicts in `tests/api/party-book.test.ts` by taking dev's deletions.
- [ ] Full suite green (`npx vitest run`), `npx tsc --noEmit` clean. Record the BASE commit in the stage-2 ledger.

## What the code does today (ground truth, re-read 19 Oct after stage 1)

- **Times** come from `src/config/party.config.ts` (`partyDays` per weekday `{firstStart, lastWrap}` stepped by 90 + 60 = 150 min; `partyDateOverrides`; `bookingWindowDays` 90; `minLeadDays` 7; `bookingOpensDate`; `CAFE_PARTY_GAP_MINUTES` 60). The pure rules are in `src/lib/party-slots.ts`: `bookableDates(now)`, `bookableOn(ymd, now, days: StudioDays)`, `partyStartsForDate(ymd, now, days)`, `partyStartsInRange(from, to, now, days)`, `removeBooked`, plus `localDate` / `localToUtcISO` that `studio-schedule.ts`, `settings-effects.ts`, `admin/classes/day.json.ts` and `reports.json.ts` import. 11b-C made every rule take the owners' `StudioDays` (saved closures + café hours from `getStudioDays()` in `src/lib/studio-settings.ts`). `PartyModal.tsx` still calls the rules **in the browser** with config.
- **Package:** `basePriceCents` 30000, guests 10–30 (default 10, quick picks), `durationMinutes` 90, `hostArrivalMinutesEarly` 30. Online the customer pays only the $300 studio fee (plus a themed table when the kits flag is on; it is off). Crafts are paid at the POS.
- **Booking:** `src/pages/api/party/book.json.ts` (847 lines) creates a Square booking (`providers.booking.createBooking`), then an ad hoc order `Whole Studio Party — studio fee` (no `pricing_options`, no tax; CPA: party fees aren't sales-taxable), refuses unless Square's total **equals** the fee, charges with `attemptKey(attemptId,'pay')`, cancels the Square booking on a refusal, resumes a retry through `bookingHeldBy` (Square), writes the record with an unconditional `savePartyRecord`, sends `sendPartyConfirmationEmail` (craft name, price, image **from the browser body**), `announceBooking`, `reportBooking`, and issues an email-fix ticket (`issueEmailFixTicket({kind:'party'})`).
- **Free/taken** is decided from Square `listBookings`: `party-availability.ts openPartyStarts` (legacy class failures ignored, our classes/blocked/closed fail closed, Square bookings filtered by the variation the page sends), `party-open-dates.ts openPartyStartsInWindow` (filtered by `loadPartyVariationId()`, which returns '' on the sandbox), `studio-schedule.ts partyBusy` (**every** non-cancelled booking at the location, no service filter, fails closed), `class-guard.ts findPartyClashes` (used by `/api/staff/conflicts.json`), `warnings.ts scan`, `api/calendar.json.ts`, `api/party/available-dates.json.ts`. R10 kept "book anyway if the pre-charge check errors" for this stage to remove.
- **Records:** `src/lib/party-store.ts` kv `parties`, key = Square booking id, no order/payment/status/end time, unconditional `kv.set`; `api/booking/fix-email.json.ts` read-modify-writes without CAS. Readers: `events.ts`, `admin/party.json.ts`, `admin/classes/calendar.json.ts`, `admin/reports.json.ts` (parties booked this month by `createdAt`), `staff/parties.json.ts`, `party/roster.json.ts`, `party/invite.ics.ts`, `invite.astro`, `party/[id].astro`, `kit-store.ts`, `warnings.ts`, `class-guard.ts`, `studio-schedule.ts`.
- **Admin (11b-A):** hash tokens `#book-party[-YYYY-MM-DD]`, `#party-<day>-<id>`, `#more-parties` (`src/components/admin/shell/router.ts`). `BookPartySheet` (link to `/book`) and `PartiesSetupSheet` (read-only config + crafts from `service-info.json`) are in `sheets/MoreSheets.tsx`; the read-only `PartySheet` (Details · Guests · Payments, Call/Text) is in `sheets/CalendarSheets.tsx`, fed by `GET /api/admin/party.json?id=`. Hours & Craft Café and Closed days (`sheets/SettingsSheets.tsx`, `POST /api/admin/settings.json`) are the editable-settings pattern to copy.
- **Sandbox:** `service-info.json` needs the live-only appointment item `ZMSLASCRBGJ7JE3MJVOVJUSA` and the live party-craft category, so the party flow and Parties setup crafts cannot load on the preview. Sandbox seeding is the admin route `src/pages/api/admin/classes/seed-sandbox.json.ts` (R12), not a script.
- **Square → us:** `src/lib/classes/square-events.ts` skips orders with `reference_id` `bkg_…`; every other order with a non-class line costs a catalog batch-retrieve (audit M2). Refunds on payments that aren't class lines are `ignored: not-ours`. `tax-report.ts` matches the party fee by `PARTY_FEE_PREFIX = 'Whole Studio Party'`.

## Global Constraints

- Branch `kaden/own-booking-system` (the preview's env and `STORE_NAMESPACE=preview` are tied to it). Push only the branch (R3, R5); never `main` or `dev`. Prod only on Kaden's go.
- Never cancel or refund a booking automatically. Cancel never moves money and says so; Refund is its own action with an in-sheet confirm that names the host and the amount. An unpaid party is never cancelled for being unpaid.
- No guessed Square writes. New in this stage: `reference_id` and line `note` on the ad hoc party order (both already used on class orders) and nothing else. Every changed call runs on the sandbox preview first (Task 14). No Square Bookings API write anywhere in new code; legacy parties are read only.
- Prices are always computed on the server from saved settings; the body's prices, craft name, craft price and image are ignored (crafts resolved from the catalog on the server).
- **R14**: charge Square's order total; refuse (nothing charged, hold released) only when Square's total is more than quote + `PRICE_DRIFT_TOLERANCE_CENTS` (100); email the owners on any drift either way.
- **R15 / R6**: a charge with no answer keeps the hold (parties: no expiry, S2-R5a; classes 24 h) and alerts owners; a retry re-creates the order with the same key and asks `findOrderPayment`; money taken always means a party recorded (even if its time was lost meanwhile: recorded with `overlap: true`, warned, never refunded automatically).
- **R35**: every create is idempotent: the party id comes from the attempt id (public, card) or the sheet's create key (admin), so a retry finds the first try's party.
- **R37**: nothing is booked or moved to a start in the past, from any path.
- **R29–R31**: party refunds go through the shared refund runner and the existing `refund-requests` store: a saved request per ask, one key across retries, different refunds refused while one waits on Square, "Refund again" only with `again.of`, one customer email per request.
- **R38 / R39**: Parties setup never writes Square. Party times step aside for the owners' saved café hours and closed days (`getStudioDays`), read `strict` on every booking path.
- Party lines are untaxed ad hoc lines. The order carries no `pricing_options` and no `taxes` (OWNER-1).
- Customer copy: no colons, no timelines, "party" never "birthday", "Craft Café" never "Open Studio". Drafts are fine on the branch; Kaden reviews before prod.
- Test texts and emails: the preview reroutes to Kaden (`src/lib/preview-outbound.ts`); unit tests never send.
- Money in integer cents. Times stored as UTC ISO; shown in America/Chicago via `src/lib/studio-time.ts`.
- New stores via `makeKvStore(name, dir)`, added to `src/lib/archive-stores.ts`; every multi-writer record uses `getWithMeta` + `setIfMatch` with 3 attempts. A store read failure on a booking path **fails closed** (refuse, nothing charged).
- New ids: parties `pty_` + 16 hex, charges `chg_`, items `itm_`, packages `pkg_`, add-ons `add_`; never colliding with Square booking ids already used as keys in `parties`, `rsvps`, `waivers`, `checkins`, `event-meta`.
- Production behaves exactly as today until an owner saves Parties setup (config fallback, pinned by an equivalence test).
- Admin screens follow `task-11b-common.md` and the existing shell tokens: `#book-party[-day]`, `#party-<day>-<id>`, `#more-parties`; one sheet at a time; toasts; no `window.confirm`; buttons and inputs ≥ 44 px, 16 px text.
- Card details only ever go into Square's card iframe (`PaymentForm`); the mock-up's "Card number" field is replaced.
- Keep every existing API contract the admin and staff screens use (`expectedUpdatedAt`/stale 409, `confirm`, refund body and reply shapes).

## Review Focus (the five riskiest inputs, and the tests that pin them)

1. **Double-booking a party time** (two browsers; a browser and an owner on the phone; a class saved at the same moment) → exactly one hold wins in the month-keyed party book; the other is refused before any order or charge; any party-book, settings or schedule read failure refuses instead of offering. Pinned: Task 5 "concurrent holds", "extra time clashes", "no party crosses midnight"; Task 6 "store down refuses", "legacy read fails closed"; Task 7 "slot taken before any order"; E2E 26.
2. **Unknown payment outcome** (Square times out on the charge; on the order; the record write fails after payment) → hold kept (no expiry for parties, S2-R5a; classes 24 h) until a retry, Square's payment event or an owner in To decide ('party-paid-unclear') settles it, owners alerted with the party id, a retry with the same attempt never charges twice and recovers a paid order, a paid party whose hold expired is still recorded (R6). Pinned: Task 1 "unclear charge asks the order", "paid earlier"; Task 7 "unknown keeps the hold", "retry finds the payment", "paid after the hold ran out"; Task 9 "two payers".
3. **Move or cancel with money on it** (paid, part-paid, a link payment in flight) → move only to a free time and only while no payment is in flight, money untouched; cancel releases the time, never refunds, keeps every charge refundable afterwards; refunds never exceed what is left per charge and never change status or time. Pinned: Task 10 "refund caps per charge", "R29 waiting blocks"; Task 11 "move refused while paying", "cancel never refunds", "refund after cancel"; E2E 34, 35, 37.
4. **Package or add-on price drift** (an owner changes the price while someone is on the pay step; an add-on added after a link was sent; Square's total differs) → the quote is re-priced on the server at charge time, items already on a booked party keep their price, R14 decides the charge, and a link pays exactly the unpaid items that existed when its order was made. Pinned: Task 4 "items keep their price"; Task 7 "drift +50/−50/+150"; Task 9 "items added after the order stay due"; Task 8 "price change reaches the Pay button".
5. **Legacy Square parties during switch-over** → still hold their times, still show on /admin (read-only, "Booked in Square") and /staff, are never moved, cancelled or refunded by us; while the Square read is on and fails, no party time is offered; turning the read off is refused while any future Square party remains. Pinned: Task 6 "legacy blocks", "legacy read fails closed", "only the party service counts"; Task 11 "legacy writes refused", "switch off refused while some remain"; checklist part C.

## Precedents applied (stage-1 rulings → where)

| Ruling | Meaning for parties | Task |
|---|---|---|
| R6 | paid always recorded; lost time → `overlap: true` + warning, never auto-refund | 7, 13 |
| R8 | one hold per party id; extras later are items on the same party, not new holds | 4, 5 |
| R10 | the "book anyway on a check error" rule ends: party paths fail closed | 6, 7 |
| R11 | party candidates keep the 60-min gap from blocked time, in `clashes()` itself | 5 |
| R14 | drift rule, shared code | 1, 7, 9 |
| R15 | 24-h hold on no answer; retry re-creates the order with the same key + `findOrderPayment` | 1, 7 |
| R17 | no paid-check on a first attempt with nothing held | 7 |
| R18 | blocking time over a party → 409 listing it unless `confirm` (comes free once parties are in `busyBetween`) | 6 |
| R24–R26 | Square-side refunds on party payments recorded as money at once; FAILED flagged; nightly catch-up | 10 |
| R29–R31 | shared refund runner | 2, 10 |
| R35 | ids from attempt id / create key | 1, 7, 11 |
| R37 | no past starts on book or move | 3, 11 |
| R38/R39 | party settings never write Square; café/closures from `getStudioDays` | 3 |
| Task 8 note | panel makes a new attempt id after any definite failure; 409 `in_progress` is a known outcome | 8, 9, 12 |
| deferred minor | `verificationToken` not passed to `processPayment` (classes and parties); pass it if a real card needs it | 14 checklist |

---

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

### Task 3: Party settings — store, pure time rules, config fallback

**Files:**
- Create: `src/lib/parties/types.ts`, `src/lib/parties/party-times.ts` (pure, browser-safe: no `node:` imports, no stores), `src/lib/parties/settings-store.ts` (server)
- Modify: `src/lib/party-slots.ts` (every export and signature kept, including `localDate`/`localToUtcISO`; `bookableDates`/`bookableOn`/`partyStartsForDate`/`partyStartsInRange` become thin wrappers over `party-times.ts` with `configPartySettings()`), `src/lib/archive-stores.ts` (+ `party-settings`), `tests/lib/archive-stores.test.ts` (also scan `src/lib/parties` for stores)
- Test: `tests/lib/parties/party-times.test.ts`, `tests/lib/parties/settings-store.test.ts`; `tests/lib/party-slots.test.ts`, `tests/lib/party-date-overrides.test.ts` stay green unedited

**Interfaces:**
- Consumes: `StudioDays` (`src/config/studio-days.ts`), `closureOn`, `cafeOn` (`src/lib/cafe-days.ts`), `STUDIO_HOURS` (`src/config/hours.ts`), `By` (`src/lib/staff-auth.ts`), `SettingsError` (`src/lib/studio-settings.ts`).
- Produces:

```ts
// src/lib/parties/types.ts
export type Cents = number
export interface PartyPackage {
  id: string                 // 'pkg_whole' for the one from config
  name: string               // 'Whole studio'
  priceCents: Cents          // 30000
  minutes: number            // 90
  minGuests: number; maxGuests: number; defaultGuests: number; quickPicks: number[]
  who: 'everyone' | 'link' | 'admin' // link = bookable online only by /book?package=<id> (the test package)
  archived: boolean
}
export interface PartyAddOn {
  id: string; label: string; priceCents: Cents
  per: 'party' | 'guest'     // goodie bags are per guest
  extraMinutes: 0 | 15 | 30 | 45 | 60
  maxQty: number             // per party; 1 for extra time
  online: boolean            // offered on /book; always offered on /admin
  archived: boolean
}
export interface PartyTimes {
  weekly: Record<'0'|'1'|'2'|'3'|'4'|'5'|'6', string[]> // studio-local 'HH:MM' starts
  dates: Record<string, string[]>                       // 'YYYY-MM-DD' → starts replacing that weekday; [] = no parties; may precede opensDate
  bookingWindowDays: number; minLeadDays: number; opensDate: string
}
export interface PartySettingsInput { times: PartyTimes; packages: PartyPackage[]; addOns: PartyAddOn[]; readSquareBookings: boolean }
export interface PartySettings extends PartySettingsInput {
  updatedAt: string | null   // null = never saved (config in use)
  by: By | null
  history: { at: string; by: By; changed: string[]; before: PartySettingsInput }[] // capped 50, like studio-settings
}

// src/lib/parties/party-times.ts — pure
export const PARTY_CLEANUP_MINUTES = 60   // = partyConfig.cleanupBufferMinutes (S2-R11: code, not settings)
export function configPartySettings(): PartySettings           // weekly starts generated by today's step rule; dates from partyDateOverrides; [pkg_whole]; addOns []; readSquareBookings true
export function startsOn(t: PartyTimes, ymd: string): string[]
export function bookableDates(t: PartyTimes, now: Date): { first: string; last: string }
export function bookableOn(t: PartyTimes, ymd: string, now: Date, days: StudioDays): 'ok' | 'before_opening' | 'closed' | 'too_soon' | 'too_far'
export function partyStartsForDate(s: PartySettings, ymd: string, now: Date, days: StudioDays, opts?: { minutes?: number; admin?: boolean }): string[] // UTC ISOs; café gap 60 measured with `minutes` (default: shortest 'everyone' package); admin = ignore notice + window, never past (R37)
export function partyStartsInRange(s: PartySettings, fromIso: string, toIso: string, now: Date, days: StudioDays, opts?: { minutes?: number; admin?: boolean }): string[]
export function validatePartySettings(raw: unknown): PartySettingsInput // throws SettingsError(400, sentence, field)
export function describePartyChanges(before: PartySettingsInput, after: PartySettingsInput): string[]
export interface PublicPartyFacts { packages: PartyPackage[]; addOns: PartyAddOn[]; times: PartyTimes; days: StudioDays; first: string; last: string }
export function publicPartyFacts(s: PartySettings, days: StudioDays, now: Date, opts?: { packageId?: string }): PublicPartyFacts // 'everyone' packages + the named 'link' one; online add-ons only

// src/lib/parties/settings-store.ts — kv 'party-settings', key 'settings'
export async function getPartySettings(opts?: { strict?: boolean; fresh?: boolean }): Promise<PartySettings> // missing → config; 60 s cache; strict read error throws (booking paths), non-strict → last good or config (display)
export async function savePartySettings(input: PartySettingsInput, opts: { expectedUpdatedAt: string | null; by: By; now?: Date }): Promise<{ saved: PartySettings; changed: string[] }>
export class StalePartySettingsError extends SettingsError { current: PartySettings } // 409
export function resetPartySettingsCache(): void
```

Validation sentences (owner-readable): HH:MM; starts on one day at least (longest package + 60) minutes apart ("Party times on Sundays must be at least 2 hours 30 minutes apart."); every start + longest package + largest extra + 60 ends within studio hours and before midnight (**no party or its cleanup crosses midnight**, which keeps every clash inside one month doc in Task 5); window 1–365; notice 0–60; guests 1–60 and min ≤ default ≤ max; price 0–1,000,000 cents; ids unique; labels ≤ 60; at least one non-archived `everyone` package; at most 20 packages, 20 add-ons, 120 dated days.

- [ ] **Step 1: Failing tests.** `party-times.test.ts` **"matches today's times"**: copy today's `partyStartsForDate` into the test as the oracle; for every date 2026-10-19 … +120 days, at `now` = Oct 19, Nov 1 (clock change) and Dec 15, with both `CONFIG_STUDIO_DAYS` and a saved-closures `StudioDays`, `partyStartsForDate(configPartySettings(), …)` equals the oracle. Oct 24 gives five starts before opening; a café Saturday drops 1:30 only inside the 60-min gap; a closure gives none; `dates[x] = []` gives none; `admin` offers tomorrow and later today but never a past start (R37); a 120-minute package widens the café gap check; each validation failure gives its sentence and field. `settings-store.test.ts` (fs kv): missing → config with `updatedAt: null`; save then get; stale `expectedUpdatedAt` → 409 with `current`; a lost `setIfMatch` retried; `updatedAt` only moves forward; strict read error throws, non-strict returns the last good; history capped at 50 with `before`.
- [ ] **Step 2: Run** `npx vitest run tests/lib/parties tests/lib/party-slots.test.ts tests/lib/party-date-overrides.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Copy the shape of `studio-settings.ts` (monotonic stamp, history with `before`, cache replaced on the saving instance). Rewrap `party-slots.ts` without changing behaviour.
- [ ] **Step 4: Run** the files above and `npx vitest run tests/lib` — PASS.
- [ ] **Step 5: Commit** `feat(parties): party times, packages and extras as settings with a config fallback`.

### Task 4: Party records v2, pricing, money, payments index

**Files:**
- Modify: `src/lib/party-store.ts` (new optional fields; `createPartyRecord` create-only; `updatePartyRecord` CAS; `savePartyRecord` kept only for legacy writes until Task 7 removes its last caller)
- Create: `src/lib/parties/pricing.ts` (pure, browser-safe), `src/lib/parties/money.ts` (pure), `src/lib/parties/party-payments.ts` (kv `party-payments`, key `pay-<paymentId>` → `{ partyId, chargeId }`, create-only)
- Modify: `src/pages/api/booking/fix-email.json.ts` (party branch uses `updatePartyRecord`), `src/lib/archive-stores.ts` (+ `parties`, `party-payments`)
- Test: `tests/lib/parties/pricing.test.ts`, `tests/lib/parties/money.test.ts`, `tests/lib/parties/party-payments.test.ts`, extend `tests/lib/party-store.test.ts`, `tests/api/booking-fix-email.test.ts`

**Interfaces:**
- Consumes: `PartySettings` (Task 3), `idFor` (Task 1), `makeKvStore`.
- Produces:

```ts
// added to PartyRecord (all optional; legacy records load unchanged; no `source` = 'square')
source?: 'square' | 'ours'
status?: 'booked' | 'cancelled'
endIso?: string                       // start + package minutes + extra minutes (cleanup not included)
packageId?: string
craftId?: string                      // resolved on the server (Task 7)
items?: PartyItem[]
charges?: PartyCharge[]
refunds?: PartyRefund[]
payToken?: string                     // payment-link key, separate from hostToken (S2-R6)
paying?: { attemptId: string; until: string } | null // one payment in flight (link or admin card)
linkSent?: { at: string; by: By | null; email: boolean; text: boolean }[]
cancelled?: { at: string; by: By; note: string }
overlap?: true                        // R6: paid after its time was taken
history?: { at: string; by: By | null; change: string }[] // capped 100

export interface PartyItem { id: string; kind: 'package' | 'addon'; refId: string; label: string; qty: number; unitCents: Cents; cents: Cents; extraMinutes: number; chargeId: string | null; addedAt: string; by: By | null }
export interface PartyCharge { id: string; via: 'online' | 'admin-card' | 'link'; orderId: string; paymentId: string; cents: Cents; quotedCents: Cents; itemIds: string[]; receiptUrl: string | null; at: string; by: By | null; simulated?: true }
export interface PartyRefund { id: string; chargeId: string; paymentId: string; cents: Cents; reason: string; by: By | null; role: 'owner' | 'crew' | 'square'; squareRefundId: string | null; requestId: string | null; at: string }

export async function createPartyRecord(r: PartyRecord): Promise<{ kind: 'created' | 'exists'; rec: PartyRecord }>
export async function updatePartyRecord(id: string, fn: (r: PartyRecord) => PartyRecord | null, change: string, by: By | null): Promise<PartyRecord> // CAS ×3; null = no change; throws when missing
export const isOurs = (r: PartyRecord) => r.source === 'ours'

// pricing.ts
export interface PartyRequest { packageId?: string; guests: number; addOns?: Record<string, number> }
export interface PartyQuote { pkg: PartyPackage; minutes: number; items: Omit<PartyItem, 'id' | 'chargeId' | 'addedAt' | 'by'>[]; totalCents: Cents }
export function quoteParty(s: PartySettings, req: PartyRequest, audience: 'public' | 'link' | 'admin', linkPackageId?: string): { ok: true; value: PartyQuote } | { ok: false; error: string; field?: string }
export function quoteAddOn(s: PartySettings, rec: PartyRecord, addOnId: string, qty: number): { ok: true; value: PartyQuote['items'][number] } | { ok: false; error: string }
export function orderLineItems(items: Pick<PartyItem, 'label' | 'qty' | 'unitCents' | 'refId' | 'kind'>[], pkgName: string): { name: string; quantity: number; pricePerUnit: Cents; note: string }[]
// pkg_whole keeps 'Whole Studio Party — studio fee'; its add-ons 'Whole Studio Party — <label>'; other packages 'Party — <name>' / 'Party — <label>'

// money.ts
export function dueCents(r: PartyRecord): Cents            // booked: items with chargeId null; cancelled: 0
export function paidCents(r: PartyRecord): Cents           // charges − refunds
export function refundableOn(r: PartyRecord, chargeId: string): Cents // never below 0
export function paymentState(r: PartyRecord): 'paid' | 'waiting' | 'partly' | 'legacy' | 'cancelled'
export function claimPaying(r: PartyRecord, attemptId: string, now: Date, ttlMinutes: number): { ok: true; rec: PartyRecord } | { ok: false; reason: 'busy' } // same attempt → ok (retry)
```

- [ ] **Step 1: Failing tests.** Pricing: whole studio 10 guests = 30000; 9 or 31 guests refused ("Parties are for 10 to 30 guests."); unknown or archived package refused; `link` package refused for public without its id, allowed with it and for admin; `admin` package only for admin; per-guest add-on × guests; `maxQty`; offline add-on refused for public; extra half hour adds 30 minutes; line names keep `Whole Studio Party — studio fee` for `pkg_whole`; **"items keep their price"**: changing the saved price never changes an existing record's items. Money: due/paid/partly/legacy/cancelled; refundable per charge never negative; `claimPaying` refuses a second attempt inside the TTL, lets the same attempt through, frees after expiry. Store: a legacy record without new fields reads; create-only returns `exists` with the stored record; update CAS retries a lost race; history capped; fix-email keeps a concurrent `charges` write. Payments index: create-only, second write with another party refused.
- [ ] **Step 2–4:** run (FAIL), implement, run `npx vitest run tests/lib/parties tests/lib/party-store.test.ts tests/api/booking-fix-email.test.ts tests/lib/archive-stores.test.ts` — PASS.
- [ ] **Step 5: Commit** `feat(parties): party records with items, charges and refunds; server pricing; payment index`.

### Task 5: The party book — locked holds on the shared schedule

**Files:**
- Create: `src/lib/parties/party-book.ts` (kv `party-book`, key `month-YYYY-MM` by studio-local start month)
- Modify: `src/lib/classes/studio-schedule.ts` (`partyBusy` = party-book holds ∪ legacy parties (Task 6 fills the legacy half; until then the existing Square read stays); `Busy` gains optional `party?: { state: 'held' | 'booked'; partyId: string }`; `gapNeeded` for a **party** candidate against `blocked` = 60 (R11) instead of 0; `clashes` also takes the cleanup gap from the module constant in `party-times.ts`), `src/lib/archive-stores.ts` (+ `party-book`)
- Test: `tests/lib/parties/party-book.test.ts`, extend `tests/lib/classes/studio-schedule.test.ts`

**Interfaces:**
- Consumes: `Busy`, `clashes`, `clashMessage`, `busyBetween` (studio-schedule), `PARTY_CLEANUP_MINUTES`.
- Produces:

```ts
export interface PartyHold { partyId: string; startIso: string; endIso: string; state: 'held' | 'booked'; holdExpiresAt: string | null; at: string }
export async function holdsBetween(fromIso: string, toIso: string, now: Date): Promise<PartyHold[]> // unexpired held + booked; throws on read error
export async function holdTime(
  input: { partyId: string; startIso: string; endIso: string; ttlMinutes: number | null },
  others: Busy[],             // everything else around the time from busyBetween (classes, café, blocked, closed, legacy parties)
  now: Date,
): Promise<{ ok: true; replay: boolean } | { ok: false; reason: 'taken' | 'clash'; message: string }>
export async function confirmTime(partyId: string, startIso: string): Promise<void>                 // held → booked; re-creates a lost hold as booked (R6) and returns overlap info
export async function extendHold(partyId: string, startIso: string, untilIso: string): Promise<void>
export async function releaseTime(partyId: string, startIso: string): Promise<void>
export async function resizeTime(partyId: string, startIso: string, newEndIso: string, others: Busy[], now: Date): Promise<{ ok: true } | { ok: false; message: string }>
export async function moveTime(partyId: string, from: { startIso: string }, to: { startIso: string; endIso: string }, others: Busy[], now: Date): Promise<{ ok: true } | { ok: false; message: string }> // write new (CAS) → caller updates the record → removeOld
```

Rules: `holdTime` reads the month doc with its etag, drops expired holds, checks the candidate against the doc's other holds **and** `others` with `clashes({ kind: 'party', … })`, then `setIfMatch`, 3 attempts. The same `partyId` already holding the same start is a replay (ok). A move across months writes the new month first; a crash between the writes leaves an extra hold that daily warnings name ("Party hold with no party", Task 13), never a double booking. Because no party or its cleanup crosses midnight (Task 3 validation, and admin "Another time" obeys the same rule), two parties that could clash always share a month doc. Residual race between a class save and a party hold (two different stores) is accepted as in stage 1 (Task 10 minor): the daily "class over party" warning catches it.

- [ ] **Step 1: Failing tests** (fs kv): hold → `holdsBetween` sees it; **"concurrent holds"**: two `holdTime` calls on the same start with a wrapped `setIfMatch` that lets the first writer win → exactly one ok, the other `taken` with a sentence; a 1:00 and a 3:30 party on one Sunday both fit (150-min step); **"extra time clashes"**: 1:00 + 30 extra (ends 3:00, + 60) refuses 3:30 and vice versa; resize refused on a clash, allowed when free; expired hold frees; confirm keeps; release frees; move within a month and Oct→Nov; a Sun Nov 1 hold (clock change) uses real instants; **"no party crosses midnight"** (a hold whose end + 60 passes local midnight is refused with a sentence); party candidate vs blocked time keeps 60 min (R11); `partyBusy` lists holds with `party.state`; a party-book read error makes `busyBetween` throw.
- [ ] **Step 2–4:** run, implement, run `npx vitest run tests/lib/parties tests/lib/classes/studio-schedule.test.ts tests/lib/archive-stores.test.ts` — PASS.
- [ ] **Step 5: Commit** `feat(parties): locked party holds on the shared studio schedule`.

### Task 6: Open party times from our book; legacy Square parties read only

**Files:**
- Create: `src/lib/parties/legacy-square.ts` (read only: Square bookings at the location **filtered to the party service variation**, as `Busy` with `id` = Square booking id; `[]` without calling Square when `readSquareBookings` is false or on the sandbox; `legacyRemaining(now)` = future non-cancelled ones, for Parties setup)
- Create: `src/lib/parties/open-times.ts`
- Modify: `src/lib/classes/studio-schedule.ts` (`partyBusy` = book ∪ legacy, deduped by id; `busyBetween(from, to, days?, opts?: { legacyClasses?: 'strict' | 'ignore-failure' })` — party offering passes `ignore-failure` (spec E), everything else stays strict), `src/lib/party-availability.ts` and `src/lib/party-open-dates.ts` (delegate to `open-times.ts`; `bookingHeldBy` deleted; `loadPartyVariationId`/`onSandbox`/`isNotFound` move into `legacy-square.ts` with re-exports for `settings-effects.ts`), `src/lib/class-guard.ts` (`findPartyClashes` from `busyBetween` party entries), `src/lib/warnings.ts` (`scan().parties` from `partyBusy`), `src/pages/api/calendar.json.ts` (booked party times from `partyBusy`), `src/pages/api/party/available-dates.json.ts`, `src/pages/api/party/availability.json.ts` (settings + `open-times.ts`; accept and ignore `serviceVariationId`; `packageId`, `addOns` optional)
- Test: `tests/lib/parties/open-times.test.ts`, `tests/lib/parties/legacy-square.test.ts`; update `tests/lib/party-availability.test.ts`, `tests/lib/party-availability-own-classes.test.ts`, `tests/lib/party-open-dates.test.ts`, `tests/lib/warnings.test.ts`, `tests/api/calendar.test.ts`, `tests/api/party-available-dates.test.ts`, `tests/api/staff-conflicts.test.ts`

**Interfaces:**
- Consumes: Tasks 3 and 5; `getStudioDays({ strict: true })`.
- Produces:

```ts
// src/lib/parties/open-times.ts — every function throws when anything can't be read (fail closed)
export async function openPartyStarts(date: string, want?: { packageId?: string; addOns?: Record<string, number>; admin?: boolean; ignorePartyId?: string }, now?: Date): Promise<string[]>
export async function openPartyStartsInWindow(now?: Date, want?: { packageId?: string }): Promise<string[]>
export async function isStartOpen(startIso: string, minutes: number, opts?: { admin?: boolean; ignorePartyId?: string }, now?: Date): Promise<{ ok: true } | { ok: false; message: string }>
export const PARTY_TIMES_UNREADABLE = "We couldn't load party times. Try again in a minute."
```

- [ ] **Step 1: Failing tests:** a booked `pty_` party removes its start and every start whose span + 60 overlaps it; **"legacy blocks"**: a Square party booking removes its start while `readSquareBookings` is true, and no Square call is made when false or on the sandbox; **"only the party service counts"**: a Square booking of another service variation is not a party (fixes `partyBusy`'s unfiltered read); **"legacy read fails closed"**: Square read throws while the switch is on → `openPartyStarts` throws and the APIs answer 503 with `PARTY_TIMES_UNREADABLE` (no longer "show every time"); **"store down refuses"**: party-settings or party-book read error → 503; a legacy **class** lookup failure is still ignored on the party offering path; R18: `blockTime` over a `pty_` party answers 409 naming it; scheduling a class over a `pty_` party is refused naming it; staff conflicts and warnings "class over party" see a `pty_` party; the public calendar shows a `pty_` party as booked.
- [ ] **Step 2–4:** run, implement, run `npx vitest run tests/lib tests/api/calendar.test.ts tests/api/party-available-dates.test.ts tests/api/staff-conflicts.test.ts tests/api/admin-classes.test.ts` — PASS.
- [ ] **Step 5: Commit** `feat(parties): open party times come from our party book; legacy Square parties read only and fail closed`.

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

**Flow (`bookParty`)**: settings (strict) → quote (audience) → date check (`bookableOn`, admin skips notice and window; never past, R37) → `isStartOpen(start, quote.minutes)` → existing record for this id? (booked → stored answer, `replay`; held and unexpired → `in_progress`, or R15 recovery via `paidOnOrder`) → gift-card pre-check (as today) → customer find/create (not fatal) → `holdTime(ttl 10 min, or null for link)` → themed-table claim (unchanged logic) → for `card`: `createOrder` (`attemptKey(key,'order')`, `referenceId` = party id, lines from `orderLineItems`) → `judgeDrift` (refuse > +100 with release; tell owners on any drift) → `chargeOrder` → `confirmTime` → `createPartyRecord` (source 'ours', status 'booked', items with `chargeId`, charge, `hostToken`, `payToken`, `craftId`, `endIso`) → `party-payments` index → confirmation email (craft from `findPartyCraft`, `bookingRef` = party id, end time includes extra time, refund line from `partyRefundLine`) → `announceBooking` → `reportBooking` → email-fix ticket. Declined → release, 402. Unknown → `extendHold(…, null, endIso)` (no expiry, S2-R5a), alert owners with the party id, `unknown`. Paid but `confirmTime` finds the time taken (hold expired after 24 h and resold) → record with `overlap: true`, alert owners, still 200 (R6). Record write fails after payment → retry once, then alert owners ("paid, party page not set up") as today. `link`: hold with no expiry, record with items due, no charge (Task 9 sends the link). `simulated` (payment bypass on local/preview): record `simulated: true`, no Square call.

- [ ] **Step 1: Failing tests:** happy path writes a `pty_` record, a booked hold, one order with `reference_id` and the unchanged line name, one payment of Square's total, the payments index, and **never calls `providers.booking.createBooking`**; price from settings (body price and craft price/name/image ignored; craft from the catalog); **"retry finds the payment"**: same attempt after success → stored answer, one `processPayment`; a held, unexpired same attempt → 409 `in_progress`; **"slot taken before any order"**: another attempt on a taken time → 409 `slot_taken` and no order; declined → hold released, time offered again; **"unknown keeps the hold"**: hold extended 24 h, owners alerted with the party id, 502 `unknown_outcome`; **"paid after the hold ran out"** (R6): recorded with `overlap`, owners alerted, 200; drift +50 and −50 → charged and owners emailed; drift +150 → refused, released, nothing charged; **"store down refuses"** → 503 before any Square call; `link` package refused without its id, accepted with it; online extra half hour extends `endIso` and the hold; gift card short → 402 before the hold; bookings gate closed → 503 as today; an old cached-page body (`serviceVariationId`, `people`, `craft.{id,name,perHeadCents}`, no `packageId`) books the default package. Provider: party order body has `reference_id`, line `note`, no `pricing_options`, no `taxes`. square-events: a `pty_` order is skipped with no catalog call.
- [ ] **Step 2–4:** run, implement, run `npx vitest run tests/api/party-*.test.ts tests/lib/parties tests/providers tests/lib/classes/square-events.test.ts tests/api/admin-classes-seed-sandbox.test.ts` — PASS.
- [ ] **Step 5: Commit** `feat(parties): /book books into our records with one order and one charge; no Square booking`.

### Task 8: /book reads our settings; extras step; copy follows settings

**Files:**
- Modify: `src/components/party/PartyModal.tsx` (every `partyConfig.*` and the direct `bookableDates()`/`partyStartsForDate()` calls read `info.facts` through `party-times.ts`, with `partyConfig` only as the first-paint default; a package step only when > 1 package is offered or `?package=` names a link package; the `'theme'` step becomes `'extras'`, shown when `facts.addOns.length > 0` or themes exist; body sends `packageId`, `guests`, `addOns`, `craftId`, `startTime`, no prices; a new attempt id after any definite failure, 409 `in_progress` treated as known)
- Modify: `src/lib/party-steps.ts` (`extras`), `src/lib/party-summary.ts` (package + extras; "Pay today" = package + extras; crafts stay "Pay at the studio"), `src/components/party/PartyPriceSummary.tsx`
- Modify: `src/config/party-content.ts`, `src/config/policy-content.ts`, `src/lib/refund-lines.ts` (fee, length, guest numbers become inputs: `partyContentFor(facts)`, `partyRefundLine(startIso, now?, feeCents?)`), `src/pages/book.astro`, `src/pages/index.astro`, `src/components/party/PartyLanding.tsx`, `src/pages/policies.astro` (SSR loads settings once, non-strict, and passes facts)
- Test: `tests/lib/party-steps.test.ts`, `tests/lib/party-summary.test.ts`, `tests/components/party/PartyModal.test.tsx`, `tests/components/party/PartyLanding.test.tsx`, `tests/lib/refund-lines.test.ts`, new `tests/lib/parties/party-content.test.ts`

- [ ] **Step 1: Failing tests:** with config fallback the modal shows the same steps, quick picks, guest limits and Pay label as today (labels, not markup); no add-ons → no extras step; an online add-on → extras step and the Pay label includes it; a per-guest add-on follows the guest count; **"price change reaches the Pay button"**: a saved $350 package reaches the Pay button, `/book` copy, the FAQ answer and the refund line; a 120-minute package changes the length copy; `?package=pkg_test` shows the test package; the request body carries no prices; after a 402 the next submit uses a new attempt id, after a 502 `unknown_outcome` the same one.
- [ ] **Step 2–4:** run, implement, run `npx vitest run tests/components/party tests/lib` — PASS. Check at 400 px width.
- [ ] **Step 5: Commit** `feat(parties): /book reads party settings; extras step; party copy follows settings`.

### Task 9: Pay the balance online — payment link page and sender

**Files:**
- Create: `src/pages/party/pay/[id].astro`, `src/components/party/PartyPayPanel.tsx` (unpaid items, a crafts reminder, `PaymentForm` with wallets and gift cards, a paid screen)
- Create: `src/pages/api/party/balance.json.ts` (GET `?id&k` → `{ when, hostFirstName, packageName, items, dueCents, state }`; a wrong key answers exactly like a missing party, 404)
- Create: `src/pages/api/party/pay.json.ts` (POST `{ id, k, attemptId, paymentToken, sourceKind }`)
- Create: `src/lib/parties/payment-link.ts` (`payLinkUrl(origin, rec)`, `sendPaymentLink(rec, origin, by)`: email via `sendEmail` and text via `sendQuoText`, both through the preview reroute; appends `linkSent`)
- Modify: `src/lib/email.ts` (`sendPartyPaymentLinkEmail`, `sendPartyPaidEmail`)
- Test: `tests/api/party-pay.test.ts`, `tests/lib/parties/payment-link.test.ts`, `tests/components/party/PartyPayPanel.test.tsx`

**Flow (`pay.json`)**: rate limit → constant-time key match on `payToken` → record ours, booked → `due > 0` (else 200 "Already paid" with the receipt) → **`claimPaying`** through `updatePartyRecord` (10 min; another attempt in flight → 409 "A payment for this party is already going through. Check back in a few minutes.") → order for exactly the unpaid items at that moment (`attemptKey(attemptId,'order')`, `referenceId` = party id; the item ids go on the charge) → `judgeDrift` → `chargeOrder` → `updatePartyRecord`: set those items' `chargeId`, add the charge, clear `paying` → payments index → paid email to the host + owner text ("Balance paid") → reply. Declined → clear `paying`, 402. Unknown → keep `paying` 24 h, alert owners, 502. A cancelled party → 410 "This party was cancelled. Nothing was charged." The bookings gate does not apply (S2-R16).

Draft customer copy (Kaden reviews): text "Hometown Studio here. Your party on Sat, Nov 8 at 1:30 PM is held for you. Pay $300 here to finish booking {link}". Page heading "Pay for your party". Crafts line "Crafts are paid at the studio for whoever comes."

- [ ] **Step 1: Failing tests:** wrong/missing key 404 (same body); the host token does **not** open the pay page; pays exactly the due items and marks them; **"two payers"**: two different attempts at once → one 409 before any order, one charge; the same attempt retried after success → "paid", no second charge; due 0 → no Square call; cancelled → 410; drift rules as Task 7; **"items added after the order stay due"**; gate closed still lets a link payment through; the sender writes `linkSent`, emails and texts the host, and on the preview both go to Kaden.
- [ ] **Step 2–4:** run, implement, run `npx vitest run tests/api/party-pay.test.ts tests/lib/parties tests/components/party` — PASS.
- [ ] **Step 5: Commit** `feat(parties): pay the balance online from a payment link`.

### Task 10: Party refunds on the shared runner; refunds made in Square

**Files:**
- Create: `src/lib/parties/refunds.ts` (the party `RefundBook`: scope `{ classId: 'party', bookingId: partyId }`; plan = one charge, an amount ≤ `refundableOn`; write appends `PartyRefund` keyed by request id + Square refund id; email `sendRefundEmail` with the party label; audit `party-refund`; registered with `registerRefundScope`)
- Create: `src/pages/api/admin/parties/refund.json.ts` (owners) and `src/pages/api/staff/party-refund.json.ts` (crew, reason required) — both via a shared `partyRefundReply(request, actor, { reasonRequired })` mirroring `refundReply`; body `{ partyId, chargeId, cents, reason, attempt, again? }`; GET lists the party's refund requests like `refundRequestsReply`; POST `{ action: 'clear', requestId, outcome, reason }` = "It went through / didn't go through"
- Modify: `src/lib/classes/square-events.ts` (`handleRefund`: a payment in `party-payments` → `claimSquareRefund` for the party scope, else record a `PartyRefund` with `role: 'square'`, idempotent by Square refund id (R26, money only, no seat flag); FAILED/REJECTED on one of ours → `refund-failed` flag with the party scope (R24); the nightly `ListPaymentRefunds` catch-up runs parties through the same handler (R25)); `src/lib/classes/to-decide.ts` and `src/components/admin/inbox/ToDecideSheet.tsx` (flags with scope `party` read "the Justice party" and open `#party-<day>-<id>`; `refund-unconfirmed` / `refund-unfinished` for parties work the same as for classes); `src/lib/classes/square-events.ts flagUnconfirmedRequests` (party requests included)
- Test: `tests/lib/parties/refunds.test.ts`, `tests/api/party-refund.test.ts`, extend `tests/lib/classes/square-events.test.ts`, `tests/lib/classes/to-decide.test.ts`

- [ ] **Step 1: Failing tests:** owner partial then full refund on one charge; **"refund caps per charge"**: more than `refundableOn` refused, a 21st refund on one payment refused (`SQUARE_REFUND_CAP`); a legacy party → `NOT_PAID_HERE`; **"R29 waiting blocks"**: Square no answer → 502 `SQUARE_NO_ANSWER`, a different refund on the party → 409 `STILL_WAITING_ON_SQUARE`, "It went through" finishes it; the same refund entered after a reload → "Already refunded"; "Refund again" needs `again.of` (R31); crew without a reason refused, with a reason logged with their name; one customer email per request (R30); refund never changes status, items or the hold; a party refunded in Square shows once even when the webhook and the reconcile both see it; a FAILED Square refund on a party raises one To decide item that opens the party; a refund on a class payment still takes the class path unchanged.
- [ ] **Step 2–4:** run, implement, run `npx vitest run tests/lib/parties tests/api/party-refund.test.ts tests/lib/classes tests/api/class-refund.test.ts` — PASS.
- [ ] **Step 5: Commit** `feat(parties): refunds on the shared refund runner, from /admin and /staff; refunds made in Square reach the party`.

### Task 11: Admin party API — book, move, cancel, extras, send link, Parties setup

**Files:**
- Create: `src/pages/api/admin/parties/settings.json.ts` (GET `{ settings, legacyRemaining: { count, lastIso } }`; POST save with `expectedUpdatedAt` → stale 409 with `current`; the reply lists parties already booked on starts or days the save removed: "Anything already booked stays booked."; turning `readSquareBookings` off is refused while `legacyRemaining.count > 0`)
- Create: `src/pages/api/admin/parties/times.json.ts` (GET `?from&to&packageId&addOns&exclude=<partyId>` → free party times for owners: notice and window ignored, never past)
- Create: `src/pages/api/admin/parties/book.json.ts` (POST `{ createKey, startIso, packageId, guests, craftId, addOns, host, pay: { kind: 'link' } | { kind: 'card', attemptId, paymentToken } }` → `bookParty` with `audience: 'admin'`; key = `createKey` for link, `attemptId` for card)
- Create: `src/pages/api/admin/parties/actions.json.ts` (POST `{ id, action: 'move' | 'cancel' | 'add-extra' | 'remove-extra' | 'send-link' | 'edit-details', … }`), `src/lib/parties/admin-actions.ts`
- Modify: `src/pages/api/admin/party.json.ts` (keep its GET contract; add `status`, `legacy`, `items`, `charges`, `refunds`, `dueCents`, `paymentState`, `linkSent`, `endIso`, `overlap`, `refundRequests`)
- Test: `tests/api/admin-parties.test.ts`, create `tests/api/admin-party.test.ts` (the stage-1 GET has no test file of its own)

Rules: every route `adminAuthorized`, `adminActor(request)` into `history` and `recordAudit` (`party-book`, `party-move`, `party-cancel`, `party-extra`, `party-link`, `party-settings`). Legacy (Square) parties: every write refused, "This party was booked in Square. Change it there." **Book / link**: `bookParty` (`pay: link`) → `sendPaymentLink` → toast data; a retry with the same `createKey` answers the same party (`replay`) and sends no second link. **Book / card**: `bookParty` with `via: 'admin-card'`, cards only (S2-R3). **Move**: refused while `paying` is set ("A payment is going through. Try again in a few minutes."); only to a free party time (or another free time, OWNER-3) via `moveTime` → `updatePartyRecord` (`startIso`, `endIso`) → old hold removed; never past (R37); money untouched; the reply carries `hostToTell` `{ name, phone, email }` and the sheet offers Call / Text / Email (class precedent: owners tell people; nothing sent automatically, S2-R7). **Cancel**: refused while `paying`; status cancelled, `releaseTime`, themed-table claim released, nothing refunded, no message sent; reply repeats "Nothing was refunded." and carries `hostToTell`; charges stay refundable. **Add extra**: `quoteAddOn` → item due; an extra with minutes calls `resizeTime` first and refuses a clash; **remove extra**: only unpaid ones (shrinks the hold). **Edit details**: host name/phone/email, guests within the package range (prices of existing items unchanged), craft (from the catalog).

- [ ] **Step 1: Failing tests:** 401 without the passcode; book/link creates a due record, a booked hold and sends one link; the same `createKey` again → `replay`, no second record or link (R35); book/card charges once and records `admin-card`; book refuses a clash naming it, and a past start (R37); book ignores the 7-day notice and the window; move to a free time frees the old one; move onto a taken time refused naming it; move across months; **"move refused while paying"**; **"cancel never refunds"**: releases the time, never calls `refundPayment` or sends a message; **"refund after cancel"** still works through Task 10's route; add extra half hour extends the hold and refuses when the next party is too close; removing a paid extra refused; **"legacy writes refused"**; settings stale → 409; a save that removes a booked start lists it; **"switch off refused while some remain"**.
- [ ] **Step 2–4:** run, implement, run `npx vitest run tests/api/admin-parties.test.ts tests/api/admin-party.test.ts tests/lib/parties` — PASS.
- [ ] **Step 5: Commit** `feat(admin): book, move, cancel, extras, payment links and Parties setup for parties`.

### Task 12: Admin screens — Book a party, the party sheet, Parties setup

**Files:**
- Create: `src/components/admin/parties/BookPartySheet.tsx`, `PartySheet.tsx`, `PartiesSetupSheet.tsx`, `api.ts`
- Modify: `src/components/admin/AdminShell.tsx` (cases `book-party`, `party`, `more/parties` render the new sheets), `src/components/admin/sheets/MoreSheets.tsx` and `sheets/CalendarSheets.tsx` (stage-1 placeholders removed), `src/components/admin/shell/items.tsx` (party sub-line "14 guests · Waiting on payment"; tag "Booked in Square" for legacy), `src/components/admin/More.tsx` (row subtitle from saved settings), `src/components/shared/RefundPanel.tsx` (an `amount` mode for parties: pick the charge, amount, reason; same attempt / waiting / Refund again / It went through flows and the same `Send` type)
- Test: `tests/components/admin/parties/*.test.tsx`, extend `tests/components/admin/AdminShell.test.tsx`, `tests/components/shared/RefundPanel.test.tsx`

Per the mock-up with these corrections. **Book a party** (`#book-party[-day]`): Day and time from `times.json` (opened from a day with none → "No party times on Tue, Nov 10." + "Another time" (OWNER-3) + the full list), Package (only when > 1), Craft (catalog), Guests (package range), Extras, Host name/phone/email, a summary split like `/book` ("Pay now" = package + extras; "At the studio" = crafts estimate; the mock's crafts-in-total is replaced), Payment segmented **Send payment link** | **Take card now** (card mode mounts `PaymentForm`, cards only); footer "Book and send link" / "Charge $300 and book"; a `createKey` minted when the sheet opens (R35); dirty-leave prompt. **Party sheet** (`#party-<day>-<id>`): tabs Details · Guests · Payments; Details: when (with extra time), host, guests, craft, package, extras, status tag (Waiting on payment / Paid / Part paid / Cancelled / Booked in Square), an overlap warning (R6); Guests: RSVPs + waiver tags + Copy invite link; Payments: items, charges with receipt links, refunds, Due, [Send payment link] / [Send it again] with the last-sent time, RefundPanel per charge (confirm "Refund $300 to Stefanie Justice? This sends money back to their card."); footer Move / Cancel / + Add an extra, plus Call / Text. Move panel lists only free party times; after a move the sheet shows "Let Stefanie know" with Call / Text / Email. Cancel panel "Cancel Stefanie's party? The time opens up on the calendar. This does not refund anything. Use Refund on the Payments tab if they should get money back." Legacy party: read-only, "Booked in Square. Change it there." **Parties setup** (`#more-parties`): party days and times (per-weekday chips + "+ Add a party time", dated days, no-party days), booking window and notice, packages (price, minutes, fewest/most/usual guests, who can book: Everyone / Only with the link / Only from here), extras (+ Add an extra: name, price, per party/per guest, extra minutes, offered online), party crafts (read-only from the catalog), "Parties still booked in Square: N, last on Dec 12" with the Square read switch (disabled while N > 0), Save with the stale guard ("Someone else saved Parties setup. Reload to see their changes.") and dirty-leave prompt.

- [ ] **Step 1: Failing tests:** book sheet validates guests and host name in place; card mode renders `PaymentForm` and no card input of ours; switching to link unmounts it; a retried Book reuses the createKey; the server's clash sentence shows in the sheet; party sheet tabs; Move lists only free times and shows "Let … know" after; Cancel copy says nothing is refunded; RefundPanel amount mode confirm names host and amount, and handles the waiting/again replies; legacy party has no write buttons; setup sheet adds a start, saves, shows "Saved. New bookings use these." and the still-booked list; stale save message; the Square switch is disabled while legacy parties remain.
- [ ] **Step 2–4:** run, implement, run `npx vitest run tests/components/admin tests/components/shared` — PASS; check 400 px phone and 1024 px iPad; buttons ≥ 44 px.
- [ ] **Step 5: Commit** `feat(admin): book a party, the party sheet with move, cancel, extras and refunds, Parties setup`.

### Task 13: Staff, host pages, warnings, jobs, reports, tax report, archive

**Files:**
- Modify: `src/lib/events.ts`, `src/pages/api/staff/parties.json.ts`, `src/components/staff/Upcoming.tsx`, `src/components/staff/Roster.tsx` (cancelled parties leave This week and the door list; `endIso` is the party's span; crew see "Waiting on payment"; party roster gets RefundPanel amount mode on `/api/staff/party-refund.json`, reason required)
- Modify: `src/pages/party/[id].astro`, `src/components/party/PartyDashboard.tsx`, `src/pages/invite.astro`, `src/pages/api/party/invite.ics.ts`, `src/pages/api/party/roster.json.ts` (cancelled → "This party was cancelled." and no RSVP form; host page shows a "Pay the rest" link when due > 0; end time includes extra time)
- Modify: `src/lib/warnings.ts` (+ "Party waiting on payment" within 7 days; + "Party hold with no party" and "Party with no hold"; + "Two parties at once" for `overlap`), `src/pages/api/jobs/daily-warnings.json.ts`, `src/pages/api/jobs/signup-emails.json.ts` and `src/pages/api/party/notify-me.json.ts` (party dates from `open-times.ts`; a read failure says nothing about party dates this time, as today)
- Modify: `src/pages/api/admin/reports.json.ts` (parties booked this month = non-cancelled `pty_` + legacy records by `createdAt`; party fees taken = charges − refunds this month), `src/lib/tax-report.ts` (an order whose `reference_id` starts `pty_` is a party whatever its line names; `PARTY_FEE_PREFIX` kept for older orders), `src/lib/archive-stores.ts` (all party stores listed; test covers `src/lib/parties`)
- Test: extend `tests/lib/events.test.ts`, `tests/api/party-roster.test.ts`, `tests/lib/warnings.test.ts`, `tests/api/jobs-daily-warnings.test.ts`, `tests/api/jobs-signup-emails.test.ts`, `tests/api/party-notify-me.test.ts`, `tests/lib/tax-report.test.ts`, `tests/api/staff-roster.test.ts`, `tests/components/party/PartyDashboard.test.tsx`, `tests/lib/archive-stores.test.ts`

- [ ] **Step 1: Failing tests** for each behaviour above, including: a cancelled `pty_` party is not on /staff This week; the invite page of a cancelled party has no RSVP form; a party waiting on payment 5 days out is one warning line, 10 days out none; a hold with no record is named; a `Party — Test party` order with `reference_id` `pty_…` counts as a party in the tax report; crew refund on a party needs a reason.
- [ ] **Step 2–4:** run, implement, run `npx vitest run` — PASS.
- [ ] **Step 5: Commit** `feat(parties): staff, host pages, warnings, jobs, reports and tax report follow our party records`.

### Task 14: Sandbox E2E for parties; real-money checklist; retire Square booking reads

**Files:**
- Create: `scripts/lib/sandbox-e2e/party-scenarios.ts` (scenarios 24–40, appended to the list `scripts/sandbox-e2e.ts` runs; same `--only`, `--dry-run`, `--cleanup-only`, signal cleanup and summary table)
- Modify: `scripts/sandbox-e2e.ts` (import and append the party scenarios; header lists them), `scripts/lib/sandbox-e2e/scenarios.ts` (`cleanUpLeftovers`: cancel parties whose host is "E2E <run> …" and revert Party setup to the `before` of the earliest history entry whose change starts "E2E"), `tests/scripts/sandbox-e2e.test.ts` (dry-run lists 24–40; cleanup-only plan includes parties)
- Delete: `src/pages/api/booking/availability.json.ts` and its case in `tests/api/booking.test.ts` (unused by any page; create/cancel went in Task 0)
- Leave in place until the last Square party has run (follow-up on Kaden's go): `SquareBookingProvider`, `legacy-square.ts`, `partyConfig.square.catalogItemId`
- Create: `docs/superpowers/plans/stage2-real-money-checklist.md`

Party E2E setup: the preview uses `STORE_NAMESPACE=preview`, so Parties setup is saved there only. Scenario 24 saves dated party days ≥ 8 days ahead on `SlotAllocator` days, at 04:00 and 06:30 (a "E2E" test package of $1, 90 minutes, `who: 'link'`; an "E2E extra half hour" $1 / 30 min; an "E2E bags" $1 per guest), with the history note "E2E <run>"; every later scenario books only those times; cleanup restores the settings and cancels every party it made. Each scenario asserts the API answer, the record via `GET /api/admin/party.json`, the party book via `times.json`, and (with `SQUARE_SANDBOX_ACCESS_TOKEN`) the sandbox order/payment/refund by `reference_id`. Test texts go to (402) 980-2907 only.

| # | Scenario |
|---|---|
| 24 | Parties setup: save the test days and package; `available-dates` offers them with `?package=`; config times unchanged elsewhere |
| 25 | Public booking, card nonce: one order with `reference_id`, one payment, record + booked hold, **no Square booking** (ListBookings count unchanged) |
| 26 | Two bookings of one time in parallel → one 200, one 409 `slot_taken`, one payment |
| 27 | Declined card → nothing held, time offered again; the panel's next try is a new attempt |
| 28 | Gift card nonce pays |
| 29 | Online with the extra half hour → hold ends 30 min later; the 06:30 start that day is gone |
| 30 | Same attempt sent again after success → stored answer, one payment |
| 31 | Admin book with link → due $1 → pay page with card nonce → paid; pay again → "Already paid"; host token refused on the pay page |
| 32 | Admin book with card nonce → paid `admin-card`; the same createKey again → replay |
| 33 | Add the per-guest extra after booking → due → link pays only it |
| 34 | Move to a free time → old time offered again; onto a taken time refused naming it |
| 35 | Owner refund $0.50 then the rest → sandbox refunds match; a further refund refused; the same refund re-entered → "Already refunded"; Refund again with `again.of` |
| 36 | Crew refund from /staff: no reason refused; with a reason logged by name |
| 37 | Cancel → time offered again, nothing refunded, the charge still refundable |
| 38 | Block time over a party → 409 naming it (R18); a class over a party refused |
| 39 | Closed day added over a test party day → its times disappear; the save lists the party as still booked; restored |
| 40 | Square-side refund on a party payment (sandbox token only) → reconcile → shows once on the party |

- [ ] **Step 1:** failing `tests/scripts/sandbox-e2e.test.ts` cases (dry run lists 24–40; cleanup plan includes parties and the settings revert); write the scenarios.
- [ ] **Step 2:** push the branch (preview only). Kaden runs the stage-1 one-liner with `--only 24,25,…,40` (`parseArgs` takes a comma list; add `24-40` range support in Step 1 if wanted; same passcode command, no secrets fetched by us); every scenario PASS (40 SKIP without the sandbox token). A FAIL becomes a failing unit test in the owning task, fixed, re-run.
- [ ] **Step 3:** write the real-money checklist (below) for Kaden.
- [ ] **Step 4: Commit** `test(e2e): sandbox end-to-end for parties; real-money checklist; retire the unused Square availability endpoint`.

**Real-money checklist** (`docs/superpowers/plans/stage2-real-money-checklist.md`, same layout as stage 1: A sandbox run, B preview look-through, C live with real money after the go; a "Test party" package at $1, "Only with the link", and a $1 "Extra half hour" with 30 minutes, made in Parties setup on prod):

1. Before anything: in Square, check the Appointments notification settings (OWNER-2) and write down whether hosts get a Square reminder.
2. Book `/book?package=<test id>` on a free time with Apple Pay: one $1 charge, receipt line `Party — Test party`, party on the /admin calendar, confirmation email, owner text, nothing new in Square Appointments.
3. Move it to another free time from /admin: the old time reappears on `/book`; Call/Text/Email the new time to yourself from the sheet.
4. Add the extra half hour from /admin: the next party time that day disappears from `/book`; Payments shows $1 due.
5. Send the payment link to your own phone; pay $1 with a real card: Paid, receipt, owner text. If the card asks for verification and fails, tell me (verificationToken carry-over).
6. From /admin on the iPad, Book a party with Take card now ($1 test package, a real card typed into Square's card field).
7. Refund $1 on one charge from /admin: the Square refund matches; Payments shows it; the time stays booked.
8. Refund the other $1 in the Square dashboard: it appears on the party's Payments tab after the webhook or the nightly check.
9. A crew refund from /staff needs a reason (cancel at the confirm; no money).
10. Cancel both test parties: times reopen; nothing refunded by the cancel.
11. Gift card, if one is on hand.
12. Switch-over, once "Parties still booked in Square" reads 0: turn off online booking for the party service in Square (so no party is booked where we can't see it), switch the Square read off in Parties setup, wait a day of normal bookings, then cancel Appointments Plus.

---

## Rulings

### Resolved here (from the spec and stage-1 precedents; execution follows these)

- **S2-R1 Pay the balance** = the package and extras not yet paid (admin link bookings, extras added later). Crafts are never charged online (spec: per-guest crafts stay on the POS).
- **S2-R2 Admin Book a party total** shows like `/book`: "Pay now" = package + extras; crafts as an estimate at the studio (spec; changing it would change customer pricing).
- **S2-R3 Take card now**: cards only (Apple/Google Pay would be the owner's own wallet; no gift cards in v1). `verificationToken` stays deferred as in stage 1 until a real card needs it.
- **S2-R4 Admin booking and notice**: owners ignore the notice and the window (door sales ignore the online cutoff; R33 sends overrides to /admin), never a past start (R37), never over a clash.
- **S2-R5 Unpaid admin bookings** keep their time until an owner cancels; never auto-cancelled (rule); warnings list them within 7 days.
- **S2-R6 Payment-link key** is a separate `payToken` (the host page shows other families' children and allergies).
- **S2-R7 Move / Cancel messages**: nothing is sent automatically; the reply names the host and the sheet offers Call / Text / Email (the class move precedent: confirm, then "let them know").
- **S2-R8 Who refunds a party**: owners in /admin, and crew on /staff with a reason logged with their name (spec Decisions: "Refunds: owners, and crew with a reason"); cheap now that both ride the shared runner.
- **S2-R9 Legacy Square parties** are read-only here; moved, cancelled and refunded in Square, as today, until they've run (no guessed Square writes; never cancel).
- **S2-R11 Cleanup and café gaps** stay in code (60 and 60 minutes).
- **S2-R12 Extra time** must fit the shared schedule (classes, parties, café, blocked time with R11's gap, closed days) and studio closing time; no party or its cleanup crosses midnight.
- **S2-R13 Package edits** (price, length, guests): public copy follows (Task 8); booked parties keep what they bought.
- **S2-R16 Bookings gate**: `/book` keeps `BOOKINGS_OPEN`; /admin booking and the pay link ignore it.
- **S2-R17 Themed tables** (kits flag off): port the claim/confirm/release logic unchanged.
- **S2-R18 Test package**: "Only with the link", $1, booked through `/book?package=<id>`; cancelled right after the test.
- **S2-R19 Old Square booking endpoints**: create/cancel already removed on dev (466a650, merged in Task 0); availability removed in Task 14.
- **S2-R20 Craft details in emails** come from the catalog on the server.
- **S2-R21 Paid but the time was lost** (R6): recorded with `overlap`, warned, never refunded automatically.
- **S2-R22 Unknown outcome** (R15): hold kept with no expiry (S2-R5a) until settled (retry, Square's payment event, To decide 'party-paid-unclear'); a retry re-creates the order with the same key and asks Square.
- **S2-R23 Party ids** come from the attempt id or the sheet's create key (R35).
- **S2-R24 Refunds made in Square** on party payments are recorded as money at once (R26); there is no seat to decide, so no plain-refund flag; FAILED ones are flagged (R24); the nightly catch-up covers them (R25).
- **S2-R25 Refund unit** is one charge (one Square payment); a party with several charges is refunded charge by charge.
- **S2-R26 Move or cancel while a payment is going through** is refused until it settles (keeps money and time consistent).
- **S2-R27 The Square read switch** can't be turned off while any future Square-booked party remains.

### OWNER (execution proceeds on the recommended default; Kaden can change it before prod)

- **OWNER-1 Tax on goods extras.** Goodie bags or food are goods and may be taxable even though party fees aren't (CPA 8/6). **Default: every party line stays untaxed, Parties setup has no "taxable" switch, and Kaden asks Chris before adding goodie bags or food as extras.** A taxable extra would need a new, sandbox-proven order shape.
- **OWNER-2 Square's own messages to hosts.** If Square Appointments sends hosts a reminder today, it stops with this stage. **Default: build nothing new; checklist step 1 has Kaden look at the Appointments notification settings, and if hosts get a Square reminder, a follow-up adds our own party reminder before the Square read is switched off.**
- **OWNER-3 Booking a party for someone at a time that isn't a party time** (a Tuesday on the phone). **Default: allowed from /admin through "Another time", checked by the shared schedule, studio hours and the no-crossing-midnight rule, shown after the party-times list; the public `/book` only ever offers party times.** The alternative (add the day in Parties setup first) costs the owner two extra steps.

## Surprises found in the current code

- The party pre-charge check and the date picker **fail open** on a Square read error and rely on Square's booking create to refuse a clash; dropping Square bookings without our own lock would allow double bookings (Task 5).
- `studio-schedule.ts partyBusy` treats **every** non-cancelled Square booking at the location as a party (no service filter), unlike `calendar.json` and `party-open-dates.ts` (Task 6).
- `PartyModal.tsx` computes dates and times in the browser from `party.config.ts`; saved settings must reach it through `service-info.json` (Task 8).
- `service-info.json` needs the live-only appointment item, so the party flow and Parties setup crafts can't load on the sandbox preview; the sandbox has no party craft category (Task 7 seeds one through the admin seed route).
- Party records store no order id, payment id, status or end time, are written without CAS, and `fix-email` read-modify-writes them unguarded (Task 4).
- The confirmation email takes the craft's name, price, description and image from the browser body (Task 7).
- `refund-requests` is already keyed by an opaque scope + booking id, so parties can share it with no data migration (Task 2).
- Every party and café order costs a catalog batch-retrieve in the webhook and reconcile (audit M2); skipping `pty_` orders removes the party share (Task 7).
- The `parties` store is not in the weekly archive (Task 4).
- The mock-up's party data (2.5 hours, Saturday/Sunday only, crafts in the total, a card-number field, "refund it in Square") differs from the real setup and the rules; the plan follows the code and the spec.
