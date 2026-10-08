# Giveaways Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can mint Square gift cards (promo balance) from `/staff`, customers can pay for parties and kits with a gift card online, and staff can comp a workshop seat (Square's own no-payment "Add attendee" step + a record here that emails the guest and feeds the roster). The dead coupon system is removed.

**Architecture:** Gift cards are Square objects; our only record is a small `gift-cards` blob store (who it was for). The one shared `PaymentForm` gains a gift-card field (Square Web Payments `payments.giftCard()`); the party and kit book endpoints look the token up with `giftCards.getFromNonce` and refuse short balances *before* creating an order. Workshop seats stay card-only (Square refuses gift cards there). Comping a seat is Square-dashboard-first (link), then `POST /api/staff/comp-seat.json` writes a `seat-choices` record flagged `comped` and sends the normal confirmation.

**Tech Stack:** Astro SSR + React islands, Square SDK v44 (`square` package; `client.giftCards.*`), Netlify Blobs via `makeKvStore`, vitest + testing-library.

**Spec:** `docs/superpowers/specs/2026-10-08-giveaways-design.md`

## Global Constraints

- Never cancel, refund, or release a customer's booking in any new code (standing rule). Comp-seat only adds.
- Book-before-charge order stays: a short gift card is refused before `createOrder`, and anything claimed/held is released on refusal (same helpers the endpoints already use).
- Staff API routes: `export const prerender = false`, `staffAuthorized(request)` → 401 `{ error: 'Unauthorized' }`, `byOf(member)` for the actor.
- Square SDK v44 call shapes: `client.giftCards.create({ idempotencyKey, locationId, giftCard: { type: 'DIGITAL' } })` → `.giftCard`; `client.giftCards.activities.create({ idempotencyKey, giftCardActivity: { type, locationId, giftCardId, …Details } })`; `client.giftCards.get({ id })` → `.giftCard`; `client.giftCards.getFromNonce({ nonce })` → `.giftCard`. Money amounts are `BigInt` cents in, `Number(...)` out.
- Simulated/preview: anything written by a payment-bypass path carries `simulated: true` and stays hidden in production (`isPreviewOrDev()`), like every other store.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Stage by path. No `git stash`/`checkout --`/`reset`. Never run `npx astro check`.
- Copy voice: short, plain, no selling. Business name "Hometown Studio". Gift-card presets $10 / $25 / $50 / $100 + free entry.
- Error-code union `CheckoutErrorCode` gains exactly one value: `gift_card_short`. Both message maps must define it (TypeScript enforces).

## Review Focus

1. A gift-card token on the **workshop** endpoint must be refused before any Square call — pinned in Task 7 (`tests/api/workshop-book.test.ts`).
2. A short gift card on a **party** must leave nothing claimed and nothing charged (402, `releaseBooking` + `releaseIfClaimed`) — Task 7 (`tests/api/party-book.test.ts`).
3. A short gift card on a **kit** must release the claim and return `code: 'gift_card_short'` even though the kit helper never carried a `code` before — Task 2 + Task 7 (`tests/api/kits-order.test.ts`).
4. Minting must refuse amounts outside $1–$500 and a blank "for whom", and must never store a balance — Task 4 (`tests/api/staff-gift-cards.test.ts`).
5. Comp-seat must validate picks exactly like the public path and must write `comped: true` with `orderId: null` — Task 9 (`tests/api/staff-comp-seat.test.ts`).

---

### Task 1: Delete the coupon remnants

**Files:**
- Delete: `src/lib/coupons.ts`, `src/config/coupons.json`, `src/pages/api/checkout/validate-coupon.json.ts`, `src/components/checkout/CouponInput.tsx`, `tests/lib/coupons.test.ts`, `tests/components/checkout/CouponInput.test.tsx`
- Modify: `src/config/site.config.ts` (remove `coupons: boolean` at ~:63 and `coupons: true` at ~:352), `tests/config/site.config.test.ts` (~:23 drop the `features.coupons` assertion), `src/lib/analytics.ts` (remove `trackCouponApplied` ~:38), `src/components/programs/steps/PaymentStep.tsx` (remove the `CouponInput` import, the discount state/handler ~:21-29, `discounts:` in the request ~:80, the discount row ~:136-138, the `<CouponInput>` ~:148), `src/components/programs/EnrollmentContext.tsx` (remove `appliedDiscount`, `APPLY_COUPON`, their reducer cases), `src/components/checkout/OrderSummary.tsx` (remove the `discount` prop and its row), `tests/components/checkout/OrderSummary.test.tsx` (drop discount cases), `tests/api/checkout.test.ts` (remove the `validate-coupon` import ~:4 and cases ~:74-95; keep client-config cases)
- Keep: `Discount` on `createOrder` in the payment providers (harmless, tested, not customer-reachable).

- [ ] **Step 1: Delete the four source files and two test files** (`git rm`).
- [ ] **Step 2: Fix every import** — run `npx tsc --noEmit`; it lists each remaining reference. Remove them as listed above. `tests/config/site-copy.test.ts:24` lists `OrderSummary.tsx` — keep the file, so no change there.
- [ ] **Step 3: Run** `npx vitest run tests/config tests/api/checkout.test.ts tests/components/checkout tests/components/programs 2>&1 | tail -5` → all pass; `npx tsc --noEmit` → clean.
- [ ] **Step 4: Commit** `chore: remove the unused coupon-code system`.

---

### Task 2: `gift_card_short` error code and the kit `code` field

**Files:**
- Modify: `src/lib/checkout-attempt.ts` (~:28 union), `src/lib/checkout-messages.ts` (both maps), `src/pages/api/kits/order.json.ts` (`errorResponse` ~:607)
- Test: `tests/lib/checkout-messages.test.ts` (exists? if not, create), `tests/api/kits-order.test.ts`

**Interfaces:**
- Produces: `CheckoutErrorCode` includes `'gift_card_short'`; `workshopMessages.gift_card_short` and `partyMessages.gift_card_short` strings; kit `errorResponse(detail, status, code?)` returns `{ error, code, detail }`.

- [ ] **Step 1: Failing test** — in `tests/lib/checkout-messages.test.ts` (create if absent):

```ts
import { describe, it, expect } from 'vitest'
import { partyMessages, workshopMessages } from '@lib/checkout-messages'

describe('gift_card_short', () => {
  it('has a plain sentence in both maps', () => {
    expect(partyMessages.gift_card_short).toMatch(/gift card/i)
    expect(workshopMessages.gift_card_short).toMatch(/gift card/i)
  })
})
```

- [ ] **Step 2: Run** `npx vitest run tests/lib/checkout-messages.test.ts` → FAIL (tsc error / undefined).
- [ ] **Step 3: Implement.** Add `| 'gift_card_short'` to the union. Add to both maps:

```ts
gift_card_short: 'That gift card doesn’t have enough on it for this booking. Nothing was charged. Use a card instead.',
```

(The modals override this with the live balance when the response carries one — Task 7.) In `kits/order.json.ts` change the helper to:

```ts
function errorResponse(detail: string, status: number, code?: CheckoutErrorCode) {
  const resolved: CheckoutErrorCode =
    code ?? (status === 400 ? 'invalid' : status === 409 ? 'slot_taken' : status === 402 ? 'card_declined' : 'unavailable')
  return new Response(
    JSON.stringify({ error: 'Unable to complete kit order', code: resolved, detail }),
    { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
}
```

and import `CheckoutErrorCode` from `@lib/checkout-attempt`. `KitModal` reads `detail` and keeps working.

- [ ] **Step 4: Test the kit shape** — add to `tests/api/kits-order.test.ts`: a request with a missing `paymentToken` (bypass off) returns 400 with `code: 'invalid'` and a `detail` string.
- [ ] **Step 5: Run** both files → PASS. `npx tsc --noEmit` clean.
- [ ] **Step 6: Commit** `feat(checkout): gift_card_short error code; kit errors carry a code`.

---

### Task 3: Gift-card provider — rewrite for v44, add a mock

**Files:**
- Modify: `src/providers/interfaces/giftcard.ts`, `src/providers/square/giftcard.ts`, `src/providers/interfaces/index.ts` (export `giftcard`), `src/config/providers.ts` (mock → `MockGiftCardProvider`, never `null`), `tests/e2e/booking-flow.test.ts:48` (`giftcard: new MockGiftCardProvider()` or remove the line if the type now requires one)
- Create: `src/providers/mock/giftcard.ts`, `tests/providers/mock/giftcard.test.ts`, `tests/providers/square/giftcard.test.ts`

**Interfaces (Produces):**

```ts
export interface GiftCard { id: string; gan: string; balanceCents: number; state: 'ACTIVE' | 'DEACTIVATED' | 'PENDING' | 'NOT_ACTIVE' }
export interface GiftCardProvider {
  /** Create a DIGITAL card and load a promotional balance (ADJUST_INCREMENT, COMPLIMENTARY). No money moves. */
  mint(params: { amountCents: number; idempotencyKey: string }): Promise<GiftCard>
  /** Card by id (balance is live). */
  get(id: string): Promise<GiftCard | null>
  /** Card behind a Web Payments token (cnon:…). Null when the token is not a gift card. */
  fromNonce(nonce: string): Promise<GiftCard | null>
  /** Card by its 16-digit number. Null when unknown. */
  fromGan(gan: string): Promise<GiftCard | null>
}
```

Remove `createAndLink`/`deactivate` (unused; `scripts/team/load-crew-credit.ts` has its own client code and is untouched).

- [ ] **Step 1: Failing tests** — `tests/providers/mock/giftcard.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MockGiftCardProvider } from '@providers/mock/giftcard'

describe('MockGiftCardProvider', () => {
  it('mints a card with the balance and remembers it by id, gan and nonce', async () => {
    const p = new MockGiftCardProvider()
    const card = await p.mint({ amountCents: 2500, idempotencyKey: 'k1' })
    expect(card.balanceCents).toBe(2500)
    expect(card.gan).toMatch(/^\d{16}$/)
    expect(await p.get(card.id)).toEqual(card)
    expect(await p.fromGan(card.gan)).toEqual(card)
    expect(await p.fromNonce(`mock-gift:${card.gan}`)).toEqual(card)
  })
  it('treats a fixed-balance test token as a card: mock-gift-cents:1500 has $15', async () => {
    const p = new MockGiftCardProvider()
    const card = await p.fromNonce('mock-gift-cents:1500')
    expect(card?.balanceCents).toBe(1500)
  })
  it('returns null for a card token', async () => {
    expect(await new MockGiftCardProvider().fromNonce('cnon:card')).toBeNull()
  })
})
```

`tests/providers/square/giftcard.test.ts` — inject a fake client (constructor takes `config`, so expose a `_client` test seam like other Square providers do; check `src/providers/square/client.ts` and how `tests/providers/square/payment.test.ts` mocks `createSquareClient` and copy that):

```ts
// mint: create → activities.create(ADJUST_INCREMENT, COMPLIMENTARY) → get; returns { id, gan, balanceCents, state }
// fromNonce: getFromNonce({ nonce }) → card; a thrown Square error with category NOT_FOUND / INVALID_REQUEST → null; other errors rethrow
// get / fromGan likewise; amounts BigInt→Number
```

Write three `it` blocks asserting the exact SDK calls (`giftCards.create` called with `giftCard: { type: 'DIGITAL' }`; `activities.create` with `type: 'ADJUST_INCREMENT'` and `reason: 'COMPLIMENTARY'` and `amountMoney.amount === BigInt(2500)`), and the null-on-not-found rule.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Square provider (replace the file):

```ts
import type { GiftCard, GiftCardProvider } from '../interfaces/giftcard'
import type { SquareConfig } from '../../config/site.config'
import { createLogger } from '../../lib/logger'
import { createSquareClient } from './client'

const logger = createLogger('square-giftcard')

function toCard(raw: any): GiftCard {
  return { id: raw.id, gan: raw.gan ?? '', balanceCents: Number(raw.balanceMoney?.amount ?? 0), state: raw.state ?? 'PENDING' }
}
/** Square answers "no such card" as a thrown error; everything else is a real failure. */
function isNotFound(err: any): boolean {
  const errors = err?.errors ?? err?.body?.errors ?? []
  return err?.statusCode === 404 || errors.some((e: any) => e.code === 'NOT_FOUND' || e.category === 'INVALID_REQUEST_ERROR')
}

export class SquareGiftCardProvider implements GiftCardProvider {
  private client: ReturnType<typeof createSquareClient>
  private locationId: string
  constructor(config: SquareConfig, client = createSquareClient(config)) {
    this.client = client
    this.locationId = config.locationId
  }
  async mint({ amountCents, idempotencyKey }: { amountCents: number; idempotencyKey: string }): Promise<GiftCard> {
    const gc: any = this.client.giftCards as any
    const created: any = await gc.create({ idempotencyKey: `${idempotencyKey}-create`, locationId: this.locationId, giftCard: { type: 'DIGITAL' } })
    const id = created.giftCard.id
    await gc.activities.create({
      idempotencyKey: `${idempotencyKey}-load`,
      giftCardActivity: {
        type: 'ADJUST_INCREMENT', locationId: this.locationId, giftCardId: id,
        adjustIncrementActivityDetails: { amountMoney: { amount: BigInt(amountCents), currency: 'USD' }, reason: 'COMPLIMENTARY' },
      },
    })
    const after: any = await gc.get({ id })
    logger.info('Gift card minted', { id, amountCents })
    return toCard(after.giftCard)
  }
  async get(id: string) { try { const r: any = await (this.client.giftCards as any).get({ id }); return toCard(r.giftCard) } catch (e) { if (isNotFound(e)) return null; throw e } }
  async fromNonce(nonce: string) { try { const r: any = await (this.client.giftCards as any).getFromNonce({ nonce }); return toCard(r.giftCard) } catch (e) { if (isNotFound(e)) return null; throw e } }
  async fromGan(gan: string) { try { const r: any = await (this.client.giftCards as any).getFromGan({ gan }); return toCard(r.giftCard) } catch (e) { if (isNotFound(e)) return null; throw e } }
}
```

Mock provider: in-memory `Map`s; `mint` makes `gan = '7783' + 12 random digits`, id `mock-gc-<n>`; `fromNonce` accepts `mock-gift:<gan>` (looks up) and `mock-gift-cents:<n>` (ad-hoc card with that balance); anything else → null. Export a module-level singleton the mock payment provider can share if needed (not required).

`providers.ts`: `giftcard: useMock ? new MockGiftCardProvider() : new SquareGiftCardProvider(...)`; type becomes `GiftCardProvider` (not nullable). Fix `tests/e2e/booking-flow.test.ts:48` accordingly.

- [ ] **Step 4: Run** both test files + `npx tsc --noEmit` → green.
- [ ] **Step 5: Commit** `feat(giftcard): provider rewritten for Square v44 (mint, get, fromNonce, fromGan) + mock`.

---

### Task 4: `gift-cards` store, mint/list endpoints, CLI

**Files:**
- Create: `src/lib/gift-cards.ts`, `src/pages/api/staff/gift-cards.json.ts`, `scripts/mint-gift-card.ts`, `tests/lib/gift-cards.test.ts`, `tests/api/staff-gift-cards.test.ts`

**Interfaces (Produces):**

```ts
// src/lib/gift-cards.ts
export interface MintedGiftCard { id: string; giftCardId: string; gan: string; amountCents: number; forWhom: string; note: string; by: By; at: string; simulated?: true }
export async function saveMintedGiftCard(r: MintedGiftCard): Promise<void>
export async function listMintedGiftCards(): Promise<MintedGiftCard[]>   // newest first; hides simulated unless isPreviewOrDev()
export function validateMint(body: unknown): { ok: true; value: { amountCents: number; forWhom: string; note: string } } | { ok: false; error: string }
// amount: integer dollars 1..500 (body.amountDollars) → cents; forWhom 1..80 chars required; note ≤ 200 optional
```

Store: `makeKvStore('gift-cards', 'gift-cards')`, key `gift-card:${id}`, `id = 'gc_' + randomUUID().slice(0, 8)`.

Endpoint `src/pages/api/staff/gift-cards.json.ts`:
- `GET` → `{ data: { cards: Array<MintedGiftCard & { balanceCents: number | null; state: string | null }> } }` — balance from `providers.giftcard.get(giftCardId)` per card, in parallel, `null` when the lookup fails (never 500 the whole list).
- `POST { amountDollars, forWhom, note? }` → validate (400 `{ error }` with the exact `validateMint` message) → `providers.giftcard.mint({ amountCents, idempotencyKey: id })` → `saveMintedGiftCard({ …, by: byOf(member), simulated: paymentBypassEnabled(request) ? true : undefined })` → 200 `{ data: { card: MintedGiftCard, balanceCents } }`. A Square failure after mint but before save → 502 with the gan in the body so staff can still hand it out (`{ error: 'Card made but not recorded', gan }`) and `alertOwners`-style log.

CLI `scripts/mint-gift-card.ts`: `--amount <dollars> --for "<who>" [--note "..."]`, uses `providers` via `import { providers } from '../src/config/providers'` (dotenv) and `saveMintedGiftCard` with `by: { id: 'cli', name: 'Kaden (CLI)' }`; prints the number.

- [ ] **Step 1: Failing tests.** `tests/lib/gift-cards.test.ts` (copy the `seat-choices` test's isolation style): save → list returns it newest first; `validateMint` rejects 0, 501, 12.5, missing forWhom, 81-char forWhom, accepts `{ amountDollars: 25, forWhom: 'Megan' }` → 2500. `tests/api/staff-gift-cards.test.ts`: 401 unauthenticated on GET and POST; POST 400 with the validation message; POST 200 mints via a mocked `providers.giftcard.mint` and saves `forWhom`/`by`; GET lists with `balanceCents` from `get`, and `null` when `get` throws.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** as above. **Step 4: Run** → PASS, tsc clean.
- [ ] **Step 5: Commit** `feat(staff): mint and list gift cards (gift-cards store, /api/staff/gift-cards, CLI)`.

---

### Task 5: Staff "Gift cards" screen

**Files:**
- Create: `src/components/staff/GiftCards.tsx`, `tests/components/staff/GiftCards.test.tsx`
- Modify: `src/components/staff/StaffConsole.tsx` (phase union + `'giftcards'` render), `src/components/staff/StaffHeader.tsx` (add `onGiftCards` prop + "Gift cards" button between Kits and Log out), every `<StaffHeader>` / `<Today>` / `<Roster>` call site that must pass the new prop (grep `onKits=`).

**Interfaces:** `GiftCards({ staff, onSwitch, onKits, onLogout, onBack })` — uses `StaffHeader` with `title="Gift cards"`.

Screen (inline styles from `ui.tsx`): amount chips `$10 $25 $50 $100` + a number input "Other", "For whom" input, "Note" input, **Make card** (`btn(true)`). On success: the 16-digit number in a large monospace block, grouped `7783 3252 3965 2851`, a **Copy** button (`navigator.clipboard.writeText`, falls back to selecting the text), and a line *"Hand this number to them — it works online for parties and kits, and at the register."* Below: the list — `forWhom · $amount · $balance left · date · by` — fetched on mount and after each mint; `balanceCents === null` shows "balance unavailable".

- [ ] **Step 1: Failing tests** (fetch mocked as in `Roster.test.tsx`): renders the chips; tapping `$25` then typing "Megan" and **Make card** POSTs `{ amountDollars: 25, forWhom: 'Megan', note: '' }` and shows the returned number grouped in fours; the list shows a row with "$0.00 left" when `balanceCents: 0`; a 400 shows the server's `error` text.
- [ ] **Step 2–4:** implement, run, tsc. Wire the phase: in `StaffConsole`, `onGiftCards={() => setPhase('giftcards')}` passed into `Today`/`Roster`/kits header, and `phase === 'giftcards'` renders `<GiftCards … onBack={() => setPhase('today')} />`. Update `tests/components/staff/StaffConsole-open.test.tsx` only if its fetch stubs need a new route (they shouldn't).
- [ ] **Step 5: Commit** `feat(staff): Gift cards screen — mint, copy the number, see balances`.

---

### Task 6: Gift card in the payment form; modals send `sourceKind`

**Files:**
- Modify: `src/components/checkout/PaymentForm.tsx`, `src/components/party/PartyModal.tsx`, `src/components/kits/KitModal.tsx`, `src/components/workshops/WorkshopBookingModal.tsx`
- Test: `tests/components/checkout/PaymentForm.test.tsx`, `tests/components/party/PartyModal.test.tsx`, `tests/components/kits/KitModal.test.tsx` (exists? else create minimal), `tests/components/workshops/WorkshopBookingModal.test.tsx`

**Interfaces (Produces):**
- `PaymentFormProps` gains `giftCards?: 'allowed' | 'cards-only'` (default `'allowed'`). With `'cards-only'` no toggle renders; instead the line *"Gift cards can’t be used for class seats — text us and we’ll add you."* (reuse the TEXT_US phrase from `checkout-messages` if exported, else literal "text us at (256) 464-1710").
- `PaymentFormRef.tokenize()` now resolves `{ token: string; kind: 'card' | 'gift_card' }` — **breaking**: update the three modals and the test mocks (`tokenize: async () => ({ token: 'cnon:test-token', kind: 'card' })`). Wallet tokens are always `kind: 'card'`.
- Modals add `sourceKind: kind` to the POST body next to `paymentToken`.

Implementation notes: in `initSquare`, after `payments.card()`, also `const gift = await payments.giftCard(); giftRef.current = gift` and attach it to `#gift-card-container` only when the toggle is on (attach on toggle, `destroy()` on toggle-off; Square fields can't be hidden by `display:none` reliably). Toggle UI: a small link-button under the card box *"Pay with a gift card instead"* ↔ *"Pay with a card instead"*. In mock mode the gift toggle shows a text input "Gift card number (test)" and `tokenize()` returns `{ token: \`mock-gift:${value}\`, kind: 'gift_card' }`; an input of the form `cents:1500` returns `mock-gift-cents:1500` (lets the walkthrough simulate a short card without minting).

- [ ] **Step 1: Failing tests.** PaymentForm (mock mode): toggle present by default, absent with `giftCards="cards-only"` plus the line; toggling and typing `7783…` → `tokenize()` resolves `kind: 'gift_card'`. Each modal test: the POST body contains `sourceKind` (`'card'` for the existing flows). Workshop modal renders `<PaymentForm giftCards="cards-only">` (assert via the mocked component's captured props).
- [ ] **Step 2–4:** implement, run the four files, tsc.
- [ ] **Step 5: Commit** `feat(checkout): pay with a gift card (parties and kits); workshops say cards only`.

---

### Task 7: Balance check on the server; short-card copy in the modals

**Files:**
- Modify: `src/pages/api/party/book.json.ts` (before `createOrder` ~:509), `src/pages/api/kits/order.json.ts` (before `createOrder` ~:353), `src/pages/api/workshops/book.json.ts` (after body validation ~:79), `src/components/party/PartyModal.tsx`, `src/components/kits/KitModal.tsx`
- Test: `tests/api/party-book.test.ts`, `tests/api/kits-order.test.ts`, `tests/api/workshop-book.test.ts`, modal tests

**Server rule (party and kit), identical in both:**

```ts
if (body.sourceKind === 'gift_card') {
  const card = await providers.giftcard.fromNonce(body.paymentToken)   // Square: a non-gift token → null
  if (!card) { /* release what was claimed */ return errorResponse('That doesn’t look like a gift card. Use a card instead.', 400, 'invalid') }
  if (card.balanceCents < totalCents) {
    /* release what was claimed */
    return new Response(JSON.stringify({ error: '…', code: 'gift_card_short', detail: shortMessage(card.balanceCents, totalCents), balanceCents: card.balanceCents, totalCents }), { status: 402, headers })
  }
}
```

`shortMessage` lives in `src/lib/checkout-messages.ts`: `giftCardShortMessage(balanceCents, totalCents)` → `"That gift card has $25.00 on it — this booking is $300.00. Nothing was charged. Use a card instead."` (format with `(cents/100).toFixed(2)`). `totalCents` for a party is the computed order total already in scope before `createOrder` (the same number the mismatch guard checks); for a kit, the deposit amount. Bypass paths (`paymentBypassEnabled`) skip the check unless the token starts with `mock-gift` — then the mock provider answers and the short path is exercisable on previews.

Workshop: right after the body validation, `if (body.sourceKind === 'gift_card') return fail(400, 'invalid', 'Gift cards can’t be used for class seats — text us and we’ll add you.')`.

Modals: on a 402 whose JSON has `code === 'gift_card_short'`, show `detail` verbatim (it already carries the balance) and keep the form on the payment step with the gift toggle still on; the attempt id regenerates (not an unknown outcome).

- [ ] **Step 1: Failing tests.** party-book: `sourceKind: 'gift_card'` + mocked `providers.giftcard.fromNonce` → `{ balanceCents: 2500 }` on a $300 party → 402, `code: 'gift_card_short'`, `balanceCents: 2500`, `createOrder` NOT called, `releaseBooking` called; balance ≥ total → proceeds to `createOrder`/`processPayment` as today. kits-order: same two cases with the deposit total and `releaseIfClaimed`. workshop-book: `sourceKind: 'gift_card'` → 400 and `reserveSeats` not called. Modal tests: a mocked 402 `gift_card_short` response shows its `detail` text.
- [ ] **Step 2–4:** implement, run, tsc.
- [ ] **Step 5: Commit** `feat(checkout): refuse a short gift card before anything is held or charged`.

---

### Task 8: Shared workshop-confirmation helper; comped wording

**Files:**
- Create: `src/lib/workshop-confirmation.ts`, `tests/lib/workshop-confirmation.test.ts`
- Modify: `src/pages/api/workshops/book.json.ts` (replace the local `sendConfirmation` + `studioClock` with the import), `src/lib/email.ts` (`sendWorkshopConfirmationEmail` input gains `comped?: boolean`; when true the text line is `Seats: ${seatWord}, comped` and the HTML `<strong>comped</strong>`), `tests/lib/email.test.ts` or wherever `sendWorkshopConfirmationEmail` is tested (add the comped case)

**Interfaces (Produces):**

```ts
export async function sendWorkshopConfirmation(input: {
  origin: string; bookingId: string; workshop: Workshop; seats: number; email: string; givenName: string
  receiptUrl: string | null; options: SeatOption[]; picks: SeatPick[]; totalChargedCents: number; comped?: boolean
}): Promise<boolean>
```

Move the body of the existing `sendConfirmation` (incl. `studioClock`, `buildIcs`, `inviteContent`, policy lines) verbatim; `book.json.ts` calls `sendWorkshopConfirmation({ origin: new URL(request.url).origin, … })`. Behaviour unchanged for paid bookings — existing `workshop-book` tests must stay green without edits.

- [ ] **Step 1: Failing test** — `tests/lib/workshop-confirmation.test.ts` mocks `@lib/email`'s `sendWorkshopConfirmationEmail` and asserts: picks produce `pickLines`; `comped: true` passes `comped: true` and `totalChargedCents: 0`; the waiver URL carries the booking id. Email test: `comped` text contains "comped" and not "$0.00 paid".
- [ ] **Step 2–4:** implement, run `tests/lib/workshop-confirmation.test.ts tests/api/workshop-book.test.ts` + email tests, tsc.
- [ ] **Step 5: Commit** `refactor(workshops): shared confirmation helper; comped wording`.

---

### Task 9: `/api/staff/comp-seat.json` and `comped` seat-choices

**Files:**
- Create: `src/pages/api/staff/comp-seat.json.ts`, `tests/api/staff-comp-seat.test.ts`
- Modify: `src/lib/seat-choices.ts` (`SeatChoiceRecord` gains `comped?: true` and `by?: By`; `summarizeChoices` unmatched entries gain `comped: boolean`), `src/pages/api/staff/roster.json.ts` (passes through), `src/components/staff/Roster.tsx` (the "Paid, not signed in yet" heading becomes *"Paid or comped, not signed in yet"* and a comped row shows a small `Badge` "comped")

**Endpoint:** `POST { scheduleId, givenName, familyName, email, phone?, seats, picks }` (staff-authed):
1. Validate: names 1..60, email `EMAIL_RE` as in waiver sign, `seats` integer 1..10, `picks` via `validatePicks(options, seats, picks)` where `options` come from `getEventMeta('workshop', scheduleId)` — 400 `{ error }` with the first problem.
2. Find the workshop: `providers.workshop.listAllWorkshops()` → the one with this `scheduleId` (404 `{ error: 'Class not found' }` otherwise; no booking is created so nothing to release).
3. `bookingId = 'comp_' + randomUUID().slice(0, 10)`; `saveSeatChoices({ eventKind: 'workshop', eventId: scheduleId, bookingId, orderId: null, customer, seats, picks, at: now, attemptId: bookingId, comped: true, by: byOf(member), ...(paymentBypassEnabled(request) ? { simulated: true } : {}) })`.
4. `sendWorkshopConfirmation({ …, receiptUrl: null, totalChargedCents: 0, comped: true })` — a failed email never fails the request (log + `emailSent: false`).
5. 200 `{ data: { bookingId, emailSent } }`.

- [ ] **Step 1: Failing tests** (`tests/api/staff-comp-seat.test.ts`, mocks like `staff-roster.test.ts`): 401; 400 naming the first pick problem when the class has options and picks are missing; 404 unknown class; 200 writes one `seat-choices` record with `comped: true`, `orderId: null`, `by`, and calls `sendWorkshopConfirmation` once with `comped: true`; an email failure still returns 200 with `emailSent: false`. `tests/lib/seat-choices.test.ts`: a comped record appears in `unmatched` with `comped: true`.
- [ ] **Step 2–4:** implement, run, tsc. Roster test (`tests/components/staff/Roster.test.tsx`): an unmatched entry with `comped: true` shows the "comped" badge.
- [ ] **Step 5: Commit** `feat(staff): record a comped seat — picks, roster, confirmation email`.

---

### Task 10: "Comp a seat" sheet on the roster

**Files:**
- Create: `src/components/staff/CompSeatSheet.tsx`, `tests/components/staff/CompSeatSheet.test.tsx`
- Modify: `src/components/staff/Roster.tsx` (button in the action row ~:213-224, workshops only: `event.kind === 'workshop'`; mount the sheet with `onRecorded={refresh}`)

**Props:** `{ event: { id: string; title: string; day: string }, options: SeatOption[], onRecorded: () => void, onClose: () => void }`.

Sheet (mirror `AddFamilySheet`): heading *"Comp a seat"*.
**1 — In Square:** button *"Open this class in Square"* → `https://app.squareup.com/dashboard/appointments/calendar/classes/${event.id}?date=${event.day}&view=week`, `target="_blank" rel="noopener"`. Under it, three short lines: *Add attendee · pick or create the person · Add to class, then Skip payment.*
**2 — Record it here:** first name, last name, email, phone (optional), seats (number, 1–10), per-seat selects when `options.length > 0` (reuse the markup/labels the public modal uses: "Seat 1 · Pumpkin color"), **Record comped seat** → POST `/api/staff/comp-seat.json` → on 200: *"Recorded. They’ll get the usual confirmation email."* then `onRecorded()`; on 4xx show the server's `error`.

- [ ] **Step 1: Failing tests:** the Square link contains the class id and the day; with options, submitting without a pick shows the server's 400 text (mock fetch); a 200 calls `onRecorded`; no "Comp a seat" button on a party roster.
- [ ] **Step 2–4:** implement, run `tests/components/staff/CompSeatSheet.test.tsx tests/components/staff/Roster.test.tsx`, tsc.
- [ ] **Step 5: Commit** `feat(staff): Comp a seat — Square link + record form on the class roster`.

---

### Task 12: Staff audit log (backend only)

> Added 2026-10-08 (Kaden): "we really need a log on who makes any decisions/actions on the admin page … It doesn't have to manifest on the frontend but it needs to be logged." Build this BEFORE Task 11's final gate. No screen. No role gates — Kaden: "anyone can do it. Trust first. But we need to be able to check these things."

**Files:**
- Create: `src/lib/audit.ts`, `src/pages/api/staff/audit.json.ts`, `scripts/audit-log.ts`, `tests/lib/audit.test.ts`, `tests/api/staff-audit.test.ts`
- Modify: every mutating staff endpoint — `checkin`, `comp-seat`, `event-meta`, `gift-cards` (POST), `incident`, `kit-cancel`, `kit-remind`, `kit-return`, `open-studio`, `rsvp`, `send-waiver-link`, and `pick` (records `staff.signed-in`) — each calls `recordAudit` after its write succeeds.

**Interfaces (Produces):**

```ts
// src/lib/audit.ts
export interface AuditEntry { id: string; at: string; by: { id: string; name: string; role: 'owner' | 'crew' }; action: string; target: { kind: string; id: string; label?: string }; details?: Record<string, string | number | boolean | null>; simulated?: true }
export async function recordAudit(e: Omit<AuditEntry, 'id' | 'at'>): Promise<void>   // NEVER throws; logs on failure — an audit failure must not fail the action
export async function listAudit(opts?: { limit?: number; byId?: string; since?: string }): Promise<AuditEntry[]>   // newest first; hides simulated unless isPreviewOrDev()
```

Store `makeKvStore('audit', 'audit')`, key `audit:${at}-${id}` (ISO `at` first so `kv.list()` sorts by time). `action` is a short verb-noun: `gift-card.minted`, `seat.comped`, `checkin.here`, `checkin.out`, `custody.override`, `event.settings`, `rsvp.updated`, `kit.cancelled`, `kit.reminded`, `kit.returned`, `incident.filed`, `waiver-link.sent`, `staff.signed-in`. `details` carries the human-relevant facts (`amountCents`, `forWhom`, `seats`, `email`, `scheduleId`, `householdName` …) — never secrets, never a full waiver. The `by` comes from `staffAuthorized(request)` (id, name, role).

**No role gates.** Any signed-in staff member can mint or comp; the log records `by.role` so owners can review.

**Read endpoint:** `GET /api/staff/audit.json?limit=200&by=<staffId>&since=<ISO>` → `{ data: { entries } }`, any signed-in staff.

**CLI:** `npx tsx scripts/audit-log.ts [--limit 100] [--by <staffId>] [--since YYYY-MM-DD]` prints `time · who (role) · action · target · details` one per line, newest first (reads the store directly via `listAudit`).

- [ ] **Step 1: Failing tests.** `audit.test.ts`: record → list newest first; `byId` and `since` filters; `simulated` hidden in prod; `recordAudit` swallows a store throw (spy on the logger). `staff-audit.test.ts`: 401 unauth, 200 signed-in (crew or owner) with entries and the `by` filter passed through. In `staff-gift-cards.test.ts` and `staff-comp-seat.test.ts`: `recordAudit` called once with the action and details, including `by.role`. In each other mutating endpoint's existing test file: one assertion that `recordAudit` is called with the right `action` (mock `@lib/audit`).
- [ ] **Step 2–4:** implement, run `npx vitest run tests/lib/audit.test.ts tests/api`, tsc.
- [ ] **Step 5: Commit** `feat(staff): audit log of every staff action`.

---

### Task 11: Docs and the full gate

**Files:** `docs/CREW-OPERATIONS.md` (new short section "Giveaways: gift cards and comped seats" — how to mint, how to comp: Square first, then record; every action is logged — `scripts/audit-log.ts` to read it), `docs/NEEDS-FROM-KADEN.md` (one line: live check before prod — mint $1, pay a $1 kit deposit on the preview).

- [ ] **Step 1:** write the two doc edits.
- [ ] **Step 2: Full gate:** `npx vitest run` (all green), `npx tsc --noEmit`, `npm run build`.
- [ ] **Step 3: Commit** `docs: giveaways — crew steps`.
