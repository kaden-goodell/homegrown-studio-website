# Stage 4 — Extras (Waitlist, Promo Codes, Early-Bird, Repeating Dates, Charge on the Reader) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five extras on top of our own classes. (1) A **waitlist** on full sessions: joining saves a card with Square (we never store card data), and when a seat frees up the next person who fits is added and charged automatically, texted "You're in"; a decline moves to the next person and alerts owners; per-class cutoff (default until 2 hours before); goodwill refunds never touch it. (2) **Promo codes** ($ or % off, chosen classes or everything, end date, use limit). (3) **Early-bird** prices per price cell until a date. (4) **Repeating dates** (every week, every 2 weeks, or picked dates, until a date). (5) **Charge on the reader** for door sales on /staff through Square's Point of Sale API (R16).

**Architecture:** Discounts (early-bird and promo) become **per-line discounts** that our pure `quote()` computes to the cent and the Square order carries as LINE_ITEM-scoped fixed-amount discounts, one per discounted line, so Square never apportions anything; the seat ledger stores the net price and Square's own per-line totals. Promo codes live in `src/lib/promos/` (store + pure rules + use reservations). The waitlist lives in `src/lib/classes/waitlist*.ts` (store, Cards API calls through the payment provider, a runner wired into the stage-1 `onSeatFreed` hook, a 10-minute sweep, and a "waitlist first" rule in public checkout). Repeating dates are a pure date generator plus a `repeat` admin action that creates one scheduled class per date through the existing idempotent create (R35). Charge on the reader is a server-built `square-commerce-v1://payment/create` URL, a `/staff/pos-return` page, and a server check of the returned order against Square's Orders API before the seat is marked paid.

**Tech Stack:** Astro SSR + React islands, TypeScript, Netlify Blobs via `makeKvStore` (CAS), Square SDK v44 + raw REST at `SQUARE_API_VERSION` (R13), Square Web Payments SDK (`PaymentForm.tsx`, now also `verifyBuyer` with intent `STORE`), Square Cards API (new), Square Point of Sale API (new, iOS web flow), Netlify scheduled functions, vitest + Testing Library. Preview runs Square **sandbox** with `STORE_NAMESPACE=preview`.

**Spec:** `docs/superpowers/specs/2026-10-18-own-booking-system-design.md` — "Stage 4: extras", "Decisions (18 Oct)" (waitlist auto-adds and charges the saved card; this **replaces** the stage-4 text about a 12-hour hold link), "Refunds, seats and the waitlist", "Square API review" (Save card, Charge saved card, Promo discounts), "Rules carried over". Conventions: `docs/superpowers/plans/2026-10-18-stage1-own-classes.md`. Precedents: R1–R39 in `.superpowers/sdd/2026-10-18-stage1-own-classes/progress.md`, especially R14 (charge Square's total; refuse only above quote + $1), R15 (no answer → keep the hold 24 h; retry asks Square), R16 (reader, callbacks registered, POS API not in sandbox → real $1 test), R22/R23 (freeing seats), R35 (idempotent create keys), R37 (no past dates). Admin design: `admin-mockup-D.html` sheet `promos`; shell rules `task-11b-common.md`.

**Depends on:** stage 1 complete (incl. Task 17 E2E harness), stage 2 merged (shared checkout helpers it may have moved), stage 3 not required. Prerequisites for Kaden are listed at the end.

## What the code does today (ground truth, read 19 Oct)

- `src/lib/classes/pricing.ts quote()` is pure and browser-safe; `BookingRequest.promoCode` exists but is ignored; `QuoteLine.cents` is the catalog price, `taxCents = taxCents(cents, pct)` per line (`Math.round`, half up). Prices are whole dollars today, so tax never lands on a half cent; **a percent discount can make it land on one**.
- `createClassOrder` (`src/providers/square/payment.ts`) sends catalog lines with `pricing_options.auto_apply_taxes: true` and accepts one optional **ORDER-scoped** fixed discount (never used). Its reply already carries `lineTotals` (per-line total and tax as Square computed them), but `book.json.ts` does not store them; the ledger keeps the quote's `priceCents`/`taxCents`, and refunds are computed from those.
- `processPayment` sends `sourceId`, `amountMoney`, `orderId`, `buyerEmailAddress`; no `customerId`, no `verificationToken` (stage-1 deferred minor).
- `src/lib/classes/refunds.ts onSeatFreed(classId, sessionIds)` is a no-op called from: an owner/crew refund that frees seats, `freeSeatOnly` (R23), a claimed Square refund with free seat, and the POS itemized-return webhook path. A refund that keeps the seat (goodwill) never calls it. Expired or released holds never call it.
- `ClassRules.waitlistCutoffHours` exists (default 2) and is unused.
- The admin New class / Run it again sheets create one class per call with a `createKey` (R35) and shift copied dates forward (R37); the server refuses past sessions.
- /staff door sales (`CompSeatSheet.tsx`): Comp, Pay at the counter (`door-counter`), Pay on the iPad (`door-card`, the class checkout in door mode). `SeatSource` = `online | door-card | door-counter | comp | pos`.
- More › Promotions is a preview row ("Coming in stage 4"); `router.ts` accepts `#more-promos`.
- POS API callback URLs are registered for `https://ourhometownstudio.com/staff/pos-return` and the branch preview's `/staff/pos-return` (ledger, 18 Oct). No `/staff/pos-return` page exists yet.

## Global Constraints

- Branch `kaden/own-booking-system`. Never push `main` or `dev`. Prod push only on Kaden's go.
- **Never cancel or refund automatically.** The waitlist runner only ever *adds* a person (charging their saved card with the consent they gave); it never refunds, never removes anyone else, never releases a paid seat. Cancelling a class never runs the waitlist.
- **No guessed Square writes.** New calls in this stage: `CreateCard`, `DisableCard`, `CreatePayment` with a card-on-file `source_id` + `customer_id` (+ `verification_token` where given), LINE_ITEM order discounts, `RetrieveOrder` for reader checks, the POS API web URL. Each is exercised on the **sandbox** preview (Task 12) before any customer path relies on it, except the POS API, which Square does not support in sandbox: it ships **behind `READER_ENABLED`** (off by default everywhere) and goes live only after Kaden's real $1 test.
- **We never store card data.** Only Square's card id, brand, last 4, expiry month/year and the customer id. The card number is only ever typed into Square's card iframe. Wallets and gift cards can't be saved; the waitlist join takes cards only.
- Prices, discounts and the waitlist charge amount are computed on the server from the class and the code, never from the browser.
- **R14** applies to every new charge (waitlist, discounted bookings): charge Square's order total; refuse only when it is above our quote + 100 cents; email owners on any drift.
- **Money we record = money Square computed.** After an order is created, each ledger line stores Square's line net and tax (`lineTotals`); refunds use those when present.
- Customer copy: no colons, no timelines, "party" never "birthday", "Craft Café" never "Open Studio". Every new customer string is drafted in the plan or task report and shown to Kaden before prod.
- Test texts/emails only to Kaden (preview reroute; unit tests never send). Waitlist texts in tests go to `(402) 980-2907` only.
- Money integer cents; times UTC ISO; Chicago display via `studio-time.ts`; "until a date" means the end of that Chicago day.
- New stores via `makeKvStore`; multi-writer records CAS ×3; store read failure on a paying path fails closed (nothing charged).
- Admin screens follow `task-11b-common.md`.

## Review Focus

1. **The waitlist charging a saved card** (two runners at once — refund route + webhook + sweep; a decline; no answer; a card disabled since joining; a price that rose since joining; a seat freed after the cutoff; a goodwill refund) → each entry is charged at most once (idempotency per entry attempt), a decline moves to the next person and alerts owners, no answer keeps the seat held and stops the run, a higher price or a passed cutoff skips without charging, a kept-seat refund never starts a run (Task 10 tests "two runners", "decline moves on", "no answer stops", "price rose", "after cutoff", "goodwill never runs").
2. **Discounted money to the cent** (percent code that makes a half-cent tax; $ code split over 3 seats + an add-on; early-bird plus a code; a refund of one discounted seat) → `quote()` per-line net and tax equal Square's `lineTotals` for every line (sandbox-proven), the ledger stores Square's numbers, and a one-seat refund refunds that seat's net + tax, never the list price (Task 3 "split pennies", Task 4 "line discounts body", Task 12 E2E "half cent").
3. **The last use of a promo code and its end date** (two buyers on a 1-use code; a held booking that fails; a code used at 11:59 PM Chicago on its end date and at 12:00 AM after; a code for one class used on another) → exactly one gets it, a failed booking gives the use back, the end of day is Chicago's, the wrong class is refused (Task 1 "last use", "ends at Chicago midnight").
4. **A reader return that isn't what it claims** (forged or replayed `data`; a transaction id from another sale; the wrong amount; a cash or partial tender; a cancel; no return at all; an offline payment with only a client id) → the seat is marked paid only after `RetrieveOrder` shows a COMPLETED order at our location for exactly the held amount not already linked to another booking; a replay is a no-op; no return keeps the seat held as "Waiting on the reader" with Check again (Task 11 "forged state", "wrong amount", "replay", "no return").
5. **Repeating dates** (every week across the Nov 1 clock change; a date on a closed day; one date clashing with a party; a date in the past; a retried Add) → local start times stay the same, closed and clashing dates are listed and skipped, past dates refused (R37), a retry never makes a second class or POS item (Task 7 "across the clock change", "retry once").

---

### Task 1: Promo codes — types, store, pure rules, use reservations

**Files:**
- Create: `src/lib/promos/types.ts`, `src/lib/promos/rules.ts` (pure, browser-safe), `src/lib/promos/promo-store.ts` (kv `promo-codes`, key `code-{CODE}`; kv `promo-uses`, key `uses-{CODE}`)
- Test: `tests/lib/promos/rules.test.ts`, `tests/lib/promos/promo-store.test.ts`

**Interfaces:**

```ts
// types.ts
import type { By } from '@lib/staff-auth'
export interface PromoCode {
  code: string                       // A–Z 0–9, 3–20, stored upper case; unique; never renamed
  label: string                      // owner's note, e.g. "Grand opening"
  off: { kind: 'amount'; cents: number } | { kind: 'percent'; percent: number } // 1..100 whole percent
  per: 'booking' | 'seat'            // OWNER-S4-6 ($ codes only; % is always per line)
  appliesTo: { kind: 'all' } | { kind: 'classes'; libraryIds: string[]; classIds: string[] } // library = every date of it
  includeExtras: boolean             // OWNER-S4-5 default false
  endsYmd: string | null             // last Chicago day it works; null = no end
  maxUses: number | null             // whole bookings; null = no limit
  active: boolean
  createdAt: string; updatedAt: string; by: By
  history: { at: string; by: By; change: string }[]
}
export interface PromoUses { code: string; used: { bookingId: string; at: string; classId: string }[]; holds: { bookingId: string; until: string }[] }
```

```ts
// rules.ts
export function normalizeCode(raw: string): string | null
export function validatePromo(raw: unknown): Result<Omit<PromoCode, 'createdAt' | 'updatedAt' | 'by' | 'history'>>
export function promoRefusal(p: PromoCode | null, cls: ScheduledClass, now: Date, usesLeft: number | null): string | null
// null = fine; otherwise one of: "That code isn't valid." (unknown or inactive), "That code has ended.", "That code has been used up.", "That code isn't for this class."
// promo-store.ts
export async function listPromos(): Promise<(PromoCode & { usedCount: number })[]>
export async function getPromo(code: string): Promise<PromoCode | null>
export async function savePromo(input: …, by: By, expectedUpdatedAt: string | null): Promise<PromoCode> // create-only for a new code; CAS for edits; code text immutable
export async function reserveUse(code: string, bookingId: string, untilIso: string, now: Date, maxUses: number | null): Promise<'ok' | 'used-up'> // counts used + unexpired holds; same bookingId → ok
export async function confirmUse(code: string, bookingId: string, classId: string): Promise<void>
export async function releaseUse(code: string, bookingId: string): Promise<void>
export async function extendUse(code: string, bookingId: string, untilIso: string): Promise<void> // R15 unknown outcome
```

- [ ] **Step 1: Failing tests:** normalize (spaces, lower case, punctuation refused); validation (percent 1–100, amount ≥ 50 cents, code length, end date not in the past on create, classes list non-empty when `classes`); **"ends at Chicago midnight"**: `endsYmd` 2026-11-01 works at `2026-11-02T05:59Z` (11:59 PM CST) and not at `06:00Z`; library-id match covers every scheduled class from that library; class-id match covers only that date; **"last use"**: two `reserveUse` racing on `maxUses: 1` with a wrapped `setIfMatch` → one `ok`, one `used-up`; released hold gives it back; expired hold gives it back; confirm is idempotent; a refund does not give a use back.
- [ ] **Step 2–4:** run (FAIL), implement, `npx vitest run tests/lib/promos` — PASS.
- [ ] **Step 5: Commit** `feat(promos): promo codes with end dates, use limits and use reservations`.

### Task 2: Early-bird prices on classes

**Files:**
- Modify: `src/lib/classes/types.ts` (`ClassContent.earlyBird?: { untilYmd: string; prices: Record<string, Record<string, Cents>> } | null`), `src/lib/classes/validate.ts`, `src/lib/classes/content-diff.ts` (diff label "Early-bird"), `src/lib/classes/public-view.ts` / `public-class.ts` (card and panel show "Early-bird $15 until Fri Oct 30" next to the regular price)
- Test: extend `tests/lib/classes/validate.test.ts`, `tests/lib/classes/public-view.test.ts`, `tests/lib/classes/content-diff.test.ts`

Rules (OWNER-S4-7): one end date per class, an early-bird price per cell. Each early-bird cell must be a sold cell and lower than its regular price; missing cells have no early-bird. Ends at the end of `untilYmd` in Chicago. Library versions carry it like any other field; "Run it again" (R37) drops an early-bird whose date has passed and says so ("Early-bird ended, so it was left off.").

- [ ] **Step 1: Failing tests:** valid early-bird; refused when ≥ regular, on an unsold cell, date before today on save; diff label; public label shows only while running; run-again drops a passed one.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(classes): early-bird prices per price cell until a date`.

### Task 3: quote() with discounts, exact per line

**Files:**
- Modify: `src/lib/classes/pricing.ts`
- Modify: `src/lib/classes/checkout.ts` (`orderLinesFor` returns per-line discounts), `src/lib/classes/seat-ledger.ts` (`LedgerLine.listCents?`, `discounts?`; `confirm` stores Square's line totals: `square.lineNetCents`, `square.lineTaxCents` per seat incl. its add-on lines), `src/lib/classes/refunds.ts` (`paidOn` uses Square's numbers when present)
- Test: extend `tests/lib/classes/pricing.test.ts`, `tests/lib/classes/seat-ledger.test.ts`, `tests/lib/classes/refunds.test.ts`

**Interfaces:**

```ts
export interface LineDiscount { kind: 'early-bird' | 'promo'; name: string; cents: Cents } // name shown on the receipt: "Early-bird", "Code FALLFRIENDS"
export interface QuoteLine { …; listCents: Cents; discounts: LineDiscount[]; cents: Cents /* net = list − discounts */; taxCents: Cents /* on net */ }
export interface Quote { …; discountCents: Cents; promo: { code: string; cents: Cents } | null }
export interface QuoteOptions extends SaleOptions { promo?: PromoCode | null }
export function quote(cls, req, now, taxPercent, opts?: QuoteOptions): Result<Quote>
export function splitAmount(totalCents: Cents, lineCents: Cents[]): Cents[] // largest remainder, ties to the earlier line; never above a line
```

Order of work per line: early-bird (list → early-bird cell price; discount = difference) → promo: percent → `Math.round(netSoFar × percent / 100)` per eligible line; amount per booking → `splitAmount(min(cents, eligible subtotal), eligible nets)`; amount per seat → `min(cents, line net)` per eligible seat line → tax on the final net with `taxCents`. Eligible lines: seats always; add-ons only when `includeExtras`. A line is never below 0. `quote()` with no promo and no running early-bird is byte-identical to today (`listCents === cents`, `discounts: []`).

- [ ] **Step 1: Failing tests:** no-discount quotes unchanged (snapshot of every existing pricing test); early-bird before/after its Chicago end; percent 10% of $15 = $1.50 off, tax on $13.50; **"split pennies"**: $5 per booking over 3 × $15 seats → 167/167/166, add-on untouched unless `includeExtras`; $20 per booking on a $15 total → $15 off, $0 lines with 0 tax; early-bird + 50% code; a percent that makes a half-cent tax rounds as `taxCents` does (and Task 12 proves Square agrees); ledger `confirm` keeps Square's line totals; refund of one seat uses its Square net + tax; `paidCentsOf` unchanged for old lines.
- [ ] **Step 2–4:** run, implement, `npx vitest run tests/lib/classes` — PASS.
- [ ] **Step 5: Commit** `feat(classes): quotes carry early-bird and promo discounts per line; ledger keeps Square's line totals`.

### Task 4: Square order with per-line discounts

**Files:**
- Modify: `src/providers/interfaces/payment.ts`, `src/providers/square/payment.ts`, `src/providers/mock/payment.ts` (`createClassOrder` replaces the unused `discount?` with `lineDiscounts?: { line: number; name: string; cents: number }[]`)
- Test: extend `tests/providers/square/payment-class-order.test.ts`

Body: for each discounted line i, a discount `{ uid: 'd<i>-<k>', name, type: 'FIXED_AMOUNT', amount_money: { amount, currency: 'USD' }, scope: 'LINE_ITEM' }` in `order.discounts` and `{ discount_uid }` in `line_items[i].applied_discounts`. Still `pricing_options.auto_apply_taxes: true`, still no `order.taxes`. The mock applies line discounts before its 9% so unit tests see the right totals.

- [ ] **Step 1: Failing tests — "line discounts body":** one discount object per discounted line, unique uids, LINE_ITEM scope, applied only to its line; no ORDER-scope discount ever; lines without discounts have no `applied_discounts`; `lineTotals` read from Square's `total_money`/`total_tax_money` per line; mock totals match `quote()` for the Task 3 cases.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(payments): class orders carry per-line discounts (early-bird, promo)`.

### Task 5: Codes at checkout — public panel, door, check endpoint

**Files:**
- Create: `src/pages/api/classes/promo.json.ts` (POST `{ classId, code, request }` → the discounted quote or a refusal; rate limit 10/min per IP; unknown and inactive share one answer)
- Modify: `src/pages/api/classes/book.json.ts` (read `promoCode`; `getPromo` + `promoRefusal`; `reserveUse` with the hold's TTL **before** the order; `confirmUse` on paid; `releaseUse` on every definite failure; `extendUse` with the R15 24 h hold; code refusal → 409 `promo` with the sentence and nothing held; quote with `{ promo }`; `orderLinesFor` → `lineDiscounts`)
- Modify: `src/components/classes/ClassBookingPanel.tsx` ("Have a code?" link → field + Apply on the pay step; applied code shows "Code FALLFRIENDS −$4.50" with Remove; the summary lists Early-bird and the code; Pay button total from the server's quote), `src/components/staff/CompSeatSheet.tsx` (door "Pay on the iPad" passes the code field through; Comp and Pay at the counter take no code)
- Test: extend `tests/api/classes-book.test.ts`, `tests/components/classes/ClassBookingPanel.test.tsx`; add `tests/api/classes-promo.test.ts`

- [ ] **Step 1: Failing tests:** code applied → order has line discounts, ledger lines net, use confirmed; unknown code → 409 nothing held, no order; used-up between check and pay → 409 before any Square call; declined card → use released; unknown outcome → use kept 24 h; retry with the same attempt doesn't take a second use; body prices ignored; early-bird applied without any code; panel shows the code line and the server total; rate limit.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(classes): promo codes and early-bird at checkout, online and at the door`.

### Task 6: /admin — Promotions, early-bird fields, uses

**Files:**
- Create: `src/pages/api/admin/promos.json.ts` (GET list with `usedCount`, uses by class; POST save/active/archive with `expectedUpdatedAt`; audit `promo.save`, `promo.active`)
- Create: `src/components/admin/sheets/PromosSheet.tsx` (replaces the `promos` preview), `src/components/admin/promos/PromoForm.tsx`
- Modify: `src/components/admin/More.tsx` (row subtitle "Codes, early-bird"), the class editor's "Seat prices" section (`NewClassSheet.tsx` / class edit: "Early-bird" toggle → date + a second price per cell), the class sheet booking rows (a "Code GRANDOPENING" / "Early-bird" tag), `src/lib/tax-report.ts` + Reports (discounts total this month)
- Test: `tests/api/admin-promos.test.ts`, `tests/components/admin/promos/*.test.tsx`, extend class editor tests

**Promotions** (mock-up `promos`): list (code, what it does "10% off · every class · ends Nov 30", "4 of 20 used"), + New code: Code, Money off ($ / %), Amount, For ("Everything" / "Pick classes" — library classes and single dates in one searchable list), "Take it off extras too" (off), "$ off each person or the whole booking" (only for $), Last day (optional), Use limit (optional), On/Off. Saving a code that already exists → "That code is taken." Code text can't change after the first use ("Make a new code instead.").

- [ ] **Step 1: Failing tests:** 401 without admin; create/edit/stale/turn off; code text locked after use; form validates in place; class editor early-bird grid shows only sold cells and refuses a price that isn't lower; booking rows show tags; reports discount total.
- [ ] **Step 2–4:** run, implement, pass (400 px phone, 1024 px iPad).
- [ ] **Step 5: Commit** `feat(admin): Promotions and early-bird prices`.

### Task 7: Repeating dates

**Files:**
- Create: `src/lib/classes/repeat.ts` (pure)
- Modify: `src/lib/classes/admin-actions.ts` (`repeatPreview`, `repeatClass`), `src/pages/api/admin/classes/classes.json.ts` (actions `repeat-preview`, `repeat`)
- Modify: `src/components/admin/sheets/NewClassSheet.tsx` and the Run it again sheet ("Repeat" section: Doesn't repeat / Every week / Every 2 weeks / Pick dates, "Until", a preview list of dates each with ✓ or the reason it's skipped, untick to leave a date out; footer "Add 6 classes")
- Test: `tests/lib/classes/repeat.test.ts`, extend `tests/api/admin-classes.test.ts`, the sheet tests

**Interfaces:**

```ts
export type RepeatPattern = { every: 1 | 2; untilYmd: string } | { dates: string[] } // dates = first-session days, YYYY-MM-DD
export const MAX_REPEATS = 26
export function repeatDates(firstSessions: Session[], pattern: RepeatPattern, todayYmd: string): Result<{ ymd: string; sessions: Session[] }[]> // shifts every session by whole local days, keeping local start/end times; first copy = the class as entered
export async function repeatPreview(body): Promise<{ dates: { ymd: string; ok: boolean; reason: string | null }[] }> // reason: "Closed that day.", "Clashes with Rivera party 1 PM.", "That date has passed."
export async function repeatClass(body: { …scheduleClass body, pattern, skip: string[], createKey }, by): Promise<Saved<{ created: ScheduledClass[]; skipped: { ymd: string; reason: string }[] }>>
```

Each date is its own scheduled class (spec "Repeat makes several copies"), with its own POS item; created sequentially through the same path as `scheduleClass` with child key `${createKey}:${ymd}` (R35), so a retry replays and never duplicates. Every date runs R37 and `clashes()` on its own; a date failing at create time is reported in `skipped`, the others stand. A POS sync failure on one date returns that class with `SYNC_WARNING` (stage 1). Library link and version are the same for all.

- [ ] **Step 1: Failing tests:** **"across the clock change"**: weekly 6 PM Thursdays Oct 22 → Nov 12 keep 6 PM Chicago (UTC hour changes after Nov 1); every 2 weeks; picked dates sorted and de-duplicated; until before first → refused; > 26 → refused ("Repeat up to 26 dates at a time."); multi-session camp shifts every session; closed day and clash listed in preview and skipped; past date refused; **"retry once"**: the same `repeat` call twice → same classes, one POS sync each; one date clashing at create time while the preview said ok → that date in `skipped`, others created.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(admin): repeat a class every week, every 2 weeks or on picked dates`.

### Task 8: Saved cards — Cards API through the payment provider

**Files:**
- Modify: `src/providers/interfaces/payment.ts`, `src/providers/square/payment.ts`, `src/providers/mock/payment.ts`
- Modify: `src/components/checkout/PaymentForm.tsx` (prop `mode: 'charge' | 'store'`; store mode = card only, no wallets, no gift cards, `verifyBuyer(token, { intent: 'STORE', billingContact })`, returns `{ token, verificationToken }`)
- Test: `tests/providers/square/payment-cards.test.ts`, extend `tests/components/checkout/PaymentForm*.test.tsx`

**Interfaces:**

```ts
saveCard(input: { customerId: string; sourceToken: string; verificationToken: string | null; idempotencyKey: string; referenceId: string }): Promise<{ cardId: string; brand: string; last4: string; expMonth: number; expYear: number }>
disableCard(cardId: string): Promise<void>                     // already disabled / not found → resolves (logged)
chargeSavedCard(input: { orderId: string; cardId: string; customerId: string; amount: number; idempotencyKey: string; buyerEmailAddress?: string; note: string }): Promise<Payment>
```

`saveCard` = `POST /v2/cards` `{ idempotency_key, source_id, verification_token?, card: { customer_id, reference_id } }`. `chargeSavedCard` = `CreatePayment` with `source_id: cardId`, `customer_id`, `order_id`, `autocomplete: true`, `note`. Errors map to the existing `chargeOutcomeOf` (declined / unknown); `CARD_NOT_FOUND` / disabled card → declined (never retried as unknown). Also add optional `customerId` and `verificationToken` to `processPayment` (closes the stage-1 deferred minor; passed only when present).

- [ ] **Step 1: Failing tests** (mock fetch/SDK): request bodies exactly as above; no card number/CVV fields anywhere; disable idempotent; decline mapping incl. `CARD_DECLINED`, `INSUFFICIENT_FUNDS`, `CARD_NOT_FOUND`; timeout → unknown; PaymentForm store mode renders card only and calls `verifyBuyer` with `STORE`.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(payments): save a card with Square, charge it later, disable it`.

### Task 9: Waitlist — join, leave, see

**Files:**
- Create: `src/lib/classes/waitlist-store.ts` (kv `waitlists`, key `wl-{classId}`, CAS), `src/lib/classes/waitlist.ts` (join/leave orchestration, consent text, messages)
- Create: `src/pages/api/classes/waitlist.json.ts` (POST join; POST leave `{ token }`), `src/pages/classes/waitlist/[token].astro` (leave page)
- Modify: `src/components/classes/ClassBookingPanel.tsx` (when every picked session is full and the class's waitlist cutoff hasn't passed: "Join the waitlist" step instead of Pay — same pickers, contact, `PaymentForm mode="store"`, consent tick, button "Join the waitlist"), `src/lib/classes/public-view.ts` (`waitlist: { open: boolean; waiting: number }` per session), `src/lib/email.ts` (`sendWaitlistJoinedEmail`, `sendWaitlistInEmail`, `sendWaitlistMissedEmail`)
- Test: `tests/lib/classes/waitlist-store.test.ts`, `tests/api/classes-waitlist.test.ts`, extend the panel tests

**Interfaces:**

```ts
export interface WaitlistEntry {
  id: string                                  // 'wle_…'
  createdAt: string                           // order on the list
  request: BookingRequest                     // passId, sessionIds, tickets, seats — no promo (OWNER-S4-4)
  sessionIds: string[]                        // resolved at join
  seats: number
  maxCents: Cents                             // the quote total shown at join; never charged above it (OWNER-S4-2)
  customer: { givenName; familyName; email; phone }
  square: { customerId: string; cardId: string; brand: string; last4: string; expMonth: number; expYear: number }
  consent: { textVersion: string; at: string; ipHash: string }
  leaveHash: string                           // sha256 of the leave token (emailed link)
  state: 'waiting' | 'charging' | 'added' | 'declined' | 'skipped' | 'left' | 'removed' | 'closed'
  attempts: { n: number; at: string; attemptId: string; bookingId: string; orderId: string | null; outcome: 'paid' | 'declined' | 'unknown' | 'price-rose' | null }[]
  history: { at: string; by: By | null; change: string }[]
}
export interface Waitlist { classId: string; entries: WaitlistEntry[] }
export function waitlistOpen(cls: ScheduledClass, sessionIds: string[], now: Date): boolean // before (first picked session start − waitlistCutoffHours), class open
export const MAX_WAITING_PER_CLASS = 40
```

Join flow: class open, every picked session full now, cutoff not passed, not already waiting with the same email + sessions → `quote()` (price at join = `maxCents`) → customer find/create → `saveCard` (idempotency `wl:{attemptId}:card`, `reference_id` = entry id) → entry `waiting` (CAS) → "You're on the waitlist" email with the leave link → 200 `{ position }`. If the session has a free seat by the time the join lands → refuse with "A spot just opened. Book it now." and disable the saved card. Leave: token → state `left`, `disableCard`, email "You're off the waitlist". Entries move to `closed` (card disabled) when the class's last waitlist cutoff passes or the class is cancelled (Task 10 sweep).

Draft consent text (Kaden reviews; next to an unticked tick): "Save my card with Square. If a spot opens before Sat, Oct 24 at 8 AM, Hometown Studio adds me and charges this card up to $54.50 without asking again. I'll get a text and an email right away. I can leave the waitlist any time and my card comes off." Joined email heading "You're on the waitlist", text body "We'll add you and charge your card ending 4242 if a spot opens. Leave the waitlist {link}".

- [ ] **Step 1: Failing tests:** join only when full; refused after cutoff ("The waitlist for this class has closed."); duplicate join refused kindly; consent tick required; no card fields reach our server (request body has only the token); `saveCard` failure → nothing stored, "We couldn't save that card. Nothing was charged."; seat opened during join → refused + card disabled; leave by token disables the card; wrong token → same 404 as missing; panel switches to the waitlist step with store mode and no wallets; public view counts waiting.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(classes): join and leave a class waitlist with a card saved by Square`.

### Task 10: Waitlist runner — add and charge the next person

**Files:**
- Create: `src/lib/classes/waitlist-runner.ts`
- Modify: `src/lib/classes/refunds.ts` (`onSeatFreed` → `runWaitlist(classId, { reason: 'seat-freed' })`, still `.catch(() => undefined)` at every call site), `src/lib/classes/admin-actions.ts` (raising a session's capacity → `runWaitlist(…, 'capacity')`; cancel → `closeWaitlist`), `src/pages/api/classes/book.json.ts` (**waitlist first**: a public or door hold is refused as sold out while a waiting entry that fits the free seats exists and its cutoff hasn't passed; comps and POS are never refused)
- Create: `src/pages/api/jobs/waitlist-sweep.json.ts` + `netlify/functions/waitlist-sweep.ts` (every 10 minutes: run classes with waiting entries and free seats; close passed cutoffs; finish `charging` entries older than 10 minutes by asking Square), `src/pages/api/admin/classes/waitlist.json.ts` (GET list; POST `run` now, `remove` an entry with in-sheet confirm)
- Modify: `src/components/admin/sheets/ClassSheet.tsx` (Waitlist section: order, seats, card brand/last 4, state, Remove, "Run the waitlist now"), `src/components/staff/Roster.tsx` (count "3 waiting"), `src/lib/warnings.ts` + to-decide (`waitlist-declined`, `waitlist-unknown`)
- Test: `tests/lib/classes/waitlist-runner.test.ts`, extend `tests/api/classes-book.test.ts`, `tests/api/class-refund.test.ts`, `tests/lib/classes/square-events.test.ts`

**Runner** (`runWaitlist(classId, ctx, now)`): claim a per-class run lock in the waitlist doc (`runner: { id, until: now + 2 min }`, CAS; another live claim → return, the sweep picks up) → for each `waiting` entry in `createdAt` order: skip if cutoff passed (→ `closed`, disable card, email "missed"); skip if its sessions don't all have `seats` free (stays waiting, OWNER-S4-1: later smaller groups may go first); quote now → if total > `maxCents` → `skipped` with outcome `price-rose`, alert owners, continue; mark `charging` with attempt n (CAS) → `hold` (source `online`, `waitlistEntryId`) → `createClassOrder` (`attemptKey(attemptId,'order')`) → R14 → `chargeSavedCard` (`attemptKey(attemptId,'pay')`) → paid: `confirm`, entry `added`, disable the card (OWNER-S4-3), confirmation email + "You're in" text + owner text "Waitlist added Jane Doe to Potholder Looms ($21.80)"; declined: release hold, entry `declined`, disable card, email + text "missed", `alertOwners`, continue to next; unknown: keep hold 24 h (R15), entry stays `charging`, alert owners, **stop the run**. Inline budget: at most 3 entries per call (the rest by the sweep). Attempt ids are `wl:{entryId}:{n}`; a `charging` entry is only retried after `findOrderPayment` says unpaid, with the same n (never a second payment).

Draft texts (Kaden reviews): "Hometown Studio here. A spot opened in Potholder Looms on Sat, Oct 24 at 10 AM and you're in! We charged $21.80 to your card ending 4242. See you there." / "Hometown Studio here. A spot opened in Potholder Looms but your card ending 4242 didn't go through, so it went to the next person. You can join the waitlist again on our site."

- [ ] **Step 1: Failing tests:** freed seat adds the first waiting person and charges `maxCents` or less; **"two runners"**: refund route + webhook + sweep at once → one payment; **"decline moves on"**: first declines, second added, owners alerted once; **"no answer stops"**: hold kept 24 h, run stops, the sweep later finds it paid → `added`, never charged again; **"price rose"** → skipped, no charge; **"after cutoff"** → nobody charged, entries closed, seat stays open to the public; **"goodwill never runs"**: a refund that keeps the seat doesn't call the runner (spy); cancel closes the list without charging; capacity raise runs it; waitlist-first refuses a public hold that the next entry fits and allows one that no entry fits; a disabled card → declined path; comps and POS sales ignore waitlist-first.
- [ ] **Step 2–4:** run, implement, `npx vitest run tests/lib/classes tests/api` — PASS.
- [ ] **Step 5: Commit** `feat(classes): the waitlist adds and charges the next person when a seat frees up`.

### Task 11: Charge on the reader (Square Point of Sale API)

**Files:**
- Create: `src/lib/classes/reader.ts` (pure URL builder + return parser + checks), `src/pages/api/staff/reader.json.ts` (POST `start`, `return`, `check`, `let-go`), `src/pages/staff/pos-return.astro` (reads `?data=`, posts it to `reader.json` `return`, shows the result, button back to the roster)
- Modify: `src/lib/classes/seat-ledger.ts` (`SeatSource` + `'door-reader'`; `reader?: { amountCents: Cents; startedAt: string; state: 'waiting' | 'paid' | 'cancelled' }`; grep every `source ===` / `SeatSource` use — `RefundPanel.tsx`, `admin-actions.ts`, `booking-words.ts`, `square-events.ts`, `staff-view.ts`, `refunds.ts`, `staff/print.astro` — and give it the `door-card` treatment), `src/components/staff/CompSeatSheet.tsx` ("Charge on the reader" next to Pay on the iPad, shown when `READER_ENABLED`), `src/components/staff/Roster.tsx` ("Waiting on the reader" with Check again / Let the seat go), `src/lib/classes/square-events.ts` + nightly reconcile (a reader order is never a counter sale or unmatched; a waiting reader seat is matched by amount + note within 2 h), `src/lib/tax-report.ts` (OWNER-S4-8: reader charges' tax from our ledger)
- Create: env `READER_ENABLED` (default off), `SQUARE_POS_CLIENT_ID` (the application id the callbacks are registered on)
- Test: `tests/lib/classes/reader.test.ts`, `tests/api/staff-reader.test.ts`, extend `square-events` and `tax-report` tests

**Flow:** `start { classId, passId, sessionIds, tickets, seats, customer, promoCode? }` (staff cookie) → door quote (with code/early-bird) → `hold` (source `door-reader`, ttl 24 h, `reader.state: 'waiting'`) → reply `{ bookingId, amountCents, posUrl }` where `posUrl = square-commerce-v1://payment/create?data=` + JSON `{ amount_money: { amount, currency_code: 'USD' }, callback_url: origin + '/staff/pos-return', client_id: SQUARE_POS_CLIENT_ID, version: '1.3', notes: 'Hometown ' + bookingId + ' · ' + class name + ' ' + date, options: { supported_tender_types: ['CREDIT_CARD', 'SQUARE_GIFT_CARD'] (OWNER-S4-9), clear_default_fees: true, auto_return: true }, state: bookingId + '.' + hmac(bookingId) }` → the browser opens it. `return { data }` → parse; bad/forged `state` HMAC → 400, nothing changes; `status: 'error'` with `payment_canceled` → release, "Cancelled on the reader. Nothing was charged."; other errors → keep hold, "The reader didn't finish. Check again, or take payment at the counter."; `transaction_id` → `RetrieveOrder` (raw REST, `SQUARE_API_VERSION`) → must be our location, `state: COMPLETED`, `total_money` = held amount exactly, tenders all card/gift card, created ≤ 2 h ago, not already linked (kv `reader-orders`, `ord-{orderId}` create-only) → `confirm` with order + payment ids + `chargedCents` → seat paid. Only `client_transaction_id` (offline) → keep waiting, "Square will finish this when the iPad is back online." `check` = search recent completed orders at the location for the amount whose tender note contains the booking id. `let-go` refuses when `check` finds a match. Replay of a finished return → the stored answer.

- [ ] **Step 1: Failing tests:** URL JSON exactly as above (encoding, version, callback, no line items); **"forged state"** → 400, ledger unchanged; **"wrong amount"** (order total ≠ held) → refused, seat still waiting, owners alerted; another location / OPEN order / old order / order already linked → refused; cash tender → refused (OWNER-S4-9); **"replay"** → same answer, one confirm; cancel → released; **"no return"** → seat waiting 24 h, roster shows it, `check` matches by note and confirms, `let-go` refused when a match exists; webhook and reconcile never record a reader order as a counter sale; `READER_ENABLED` off → button hidden and `start` 404; refund of a reader seat uses the ledger's payment id like any other.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(staff): Charge on the reader — Square POS app with the amount and a note, back to /staff with the payment`.

### Task 12: Warnings, archive, sandbox E2E, real-money checklist

**Files:**
- Modify: `src/lib/archive-stores.ts` (`promo-codes`, `promo-uses`, `waitlists`, `reader-orders`), `src/lib/warnings.ts` (`waitlist-declined`, `waitlist-unknown`, `reader-waiting` past its session), `netlify/functions/archive-records.ts`
- Modify: `scripts/lib/sandbox-e2e/scenarios.ts`, `scripts/sandbox-e2e.ts` (`--only` accepts the new ids; `--cleanup-only` also turns off "E2E…" codes, removes E2E waitlist entries and disables their sandbox cards)
- Create: `docs/superpowers/plans/stage4-real-money-checklist.md`
- Test: archive test, dry-run listing test

**E2E scenarios** (append after the last existing id; S4-n relative). Each asserts the API answer, the ledger via `bookings.json`, and with `SQUARE_SANDBOX_ACCESS_TOKEN` the sandbox order/payment/card:
- S4-1 **Half cent:** class $15, code 30% → line net $10.50, tax 94.5 → our `taxCents`; the sandbox order's `lineTotals` equal the quote on every line (if Square rounds differently, stop: this is the proof `quote()` must match before codes ship).
- S4-2 $5-per-booking code over 3 seats + 1 add-on: line discounts 167/167/166, add-on untouched; totals equal; refund seat 2 → refund = its Square net + tax.
- S4-3 Early-bird running: cell $12 instead of $15, receipt line "Early-bird"; early-bird + 10% code.
- S4-4 1-use code: two bookings in parallel → one discounted, one refused before any charge; a declined card gives the use back.
- S4-5 Code for one class refused on another; inactive code refused.
- S4-6 Repeat every week × 4 with one date over E2E block time → 3 classes, 1 skipped with the clash sentence; replay → same 3, 3 POS items.
- S4-7 Waitlist: capacity 1, book it, join waitlist with `cnon:card-nonce-ok` (sandbox card saved; Cards API shows it), refund the seat freeing it → runner (admin `run` or inline) adds and charges the saved card; Cards API shows the card disabled.
- S4-8 Waitlist decline path: two waiting; disable the first one's card through the sandbox API; free a seat → first `declined`, second added; owners alert sent (preview → Kaden).
- S4-9 Goodwill refund (keep seat) with someone waiting → nobody charged.
- S4-10 Cutoff: set `waitlistCutoffHours` so it has passed; free a seat → nobody charged; public booking allowed.
- S4-11 Waitlist first: free seat + a fitting waiting entry → public booking refused as sold out; run → entry added.
- S4-12 Reader (simulated; POS API has no sandbox): `start` a reader seat; create a sandbox order + payment for exactly that amount with the booking id in the note; post a hand-built `return` with that order id and the server-signed `state` → seat paid; replay → same; a second hold with a wrong-amount order → refused.

- [ ] **Step 1:** write the scenarios; `--dry-run` lists them.
- [ ] **Step 2:** push the branch (preview only); Kaden runs the one-liner with `--only <S4 ids>` and the sandbox token; every scenario PASS. A failure becomes a failing unit test in the owning task. **S4-1 must pass before promo codes or percent early-birds are turned on in prod.**
- [ ] **Step 3:** write the checklist (below).
- [ ] **Step 4: Commit** `test(e2e): sandbox scenarios for codes, early-bird, repeats, the waitlist and reader checks`.

**Real-money checklist (Kaden, on prod after the go; a hidden link-only "Test" class at $1, capacity 1, taxable; your own cards; texts go to your phone):**
1. Code TEST50 (50% off, this class only, 2 uses): book with Apple Pay → one charge of $0.55 ($0.50 + $0.05 tax), receipt shows "Code TEST50". Check Square's tax line is 5 cents (the half-cent case).
2. Early-bird $0.75 until tomorrow on the test class: book with a card → $0.82; receipt "Early-bird".
3. Refund that seat in /admin → Square refund equals what was charged for it.
4. Waitlist: book the only seat with card A. On another device join the waitlist with card B (tick the consent). In Square › Customers, card B shows on file.
5. Refund card A's seat with "Refund and free the seat" → within a minute card B is charged $1.09 automatically, you get "You're in" by text and email, owners get the owner text. Card B no longer shows on file.
6. Join again with card B, then "Refund, keep their seat" on someone → nothing happens to card B. Leave the waitlist from the email link → card B is off file.
7. Decline: join with a card you then freeze in your bank app; free the seat → "didn't go through" text, owners alerted, next person (if any) added.
8. Charge on the reader (`READER_ENABLED` on for this test): on the iPad, /staff › Sell a seat › Charge on the reader → the Square POS app opens with $1.09 and the note → tap your card → it returns to /staff → seat shows paid. In Square the payment has the note. Refund it from /admin → card refunded.
9. Reader cancel: start again, cancel in the POS app → back on /staff "Nothing was charged", seat freed.
10. Repeat: make the test class repeat every week ×3 → three link-only classes on the calendar, three POS items; cancel them.
11. Tax report: the month shows the reader charge's tax under classes.
Turn `READER_ENABLED` on for the crew only after 8–9 pass.

---

## Rulings (implementer may proceed on these)

- **S4-R1 Per-line discounts, never ORDER scope.** Square never apportions; `quote()` decides every penny; the ledger stores Square's per-line numbers. (Replaces the stage-1 note "model Square's ORDER discount apportionment".)
- **S4-R2 The 18 Oct decision supersedes the spec's stage-4 waitlist text:** no 12-hour hold link; the saved card is charged automatically.
- **S4-R3 What starts a waitlist run:** a refund or free-seat that frees seats (via `onSeatFreed`), a POS itemized return that frees seats, an owner raising capacity, and the 10-minute sweep. Expired checkout holds don't start a run but the sweep sees the free seat. A kept-seat refund never does. Cancelling a class closes its waitlist without charging.
- **S4-R4 Waitlist charge** is a seller-initiated payment on the saved card; the booking is a normal `online` booking marked with `waitlistEntryId`, refundable like any other.
- **S4-R5 Reader charges** carry tax inside the amount (`clear_default_fees`), since the POS API takes an amount and a note, not catalog lines; our ledger records the seat's net and tax.
- **S4-R6 Repeat** creates separate classes (each its own bookings, POS item, roster), not one class with more sessions; a series stays "Dates" inside one class as in stage 1.
- **S4-R7 Codes are not offered to Comp or Pay at the counter;** the counter applies discounts on the POS as it does today.

## OWNER decisions (recommended default in bold; build the default unless Kaden says otherwise)

- **OWNER-S4-1 A group that doesn't fit the freed seats:** **the first person on the list whose whole group fits gets the spot; anyone earlier stays at the top for the next opening.** Alternative: strict order (the seat waits for the first person).
- **OWNER-S4-2 Price when the waitlist charges:** **today's price, never more than the amount shown when they joined; if it's higher now, skip them and tell owners.**
- **OWNER-S4-3 After a waitlist person is added (or declined):** **take their saved card off file straight away.** Alternative: keep it for future waitlists.
- **OWNER-S4-4 Promo codes on waitlist joins:** **no code field on the waitlist.**
- **OWNER-S4-5 Codes take money off extras (add-ons) too:** **no, seats only; a per-code switch exists.**
- **OWNER-S4-6 "$5 off" means:** **$5 off the whole booking; a per-code choice "each person" exists.**
- **OWNER-S4-7 Early-bird dates:** **one end date per class, a price per cell; it ends at the end of that day. Codes stack on top of early-bird.**
- **OWNER-S4-8 Tax on reader charges (ask Chris):** **the amount includes 9% tax, and the tax report takes that tax from our records, because Square sees a plain amount.**
- **OWNER-S4-9 What the reader takes:** **card and Square gift card; cash stays "Pay at the counter".**
- **OWNER-S4-10 Decline on a waitlist charge:** **they come off the list (card removed), get a text and an email, and owners are alerted; the spot goes to the next person.**

## Prerequisites (Kaden)

- Confirm which Square application id the POS API callback URLs are registered on and set `SQUARE_POS_CLIENT_ID` on Netlify (prod and the branch).
- The iPad has the Square POS app signed in at the studio location.
- The real-money tests are on prod after the go; `READER_ENABLED` stays off until steps 8–9 pass.

## Surprises found in the current code

- `book.json.ts` throws away Square's per-line totals; with discounts, a refund computed from our quote could exceed what Square charged on a line by a cent. Task 3 stores Square's numbers.
- `taxCents` rounds halves up; nothing has ever proven how Square rounds a half cent, because whole-dollar prices never make one. A percent code will (S4-1 / real-money step 1).
- `processPayment` can't send `customer_id` or `verification_token`; a card on file needs the first, saved-card SCA the second.
- The POS API isn't in sandbox **and** the preview's server holds sandbox credentials, so a reader payment taken on the preview can't be checked against Square at all; the reader can only be proven on prod, behind a flag.
- Expired checkout holds free seats silently (no hook); only the sweep can notice them for the waitlist.
