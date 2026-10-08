# Giveaways: gift cards online, comped seats from the desk

**Date:** 2026-10-08 · **Owner:** Kaden · **Status:** approved 2026-10-08 — building

## Why

Kaden wants one-off giveaways ("you shared our post — here's a free workshop seat", "$25 toward a party"), made by staff and redeemed once. No percent-off promos for the masses, no coupon-code system.

Two facts from the 2026-10-08 spikes shape the design:

1. **Square's class-booking charge takes cards and wallets only.** A gift-card token (right app id, customer attached, balance ≥ price) is refused. The documented Bookings API cannot book a class ticket at all. So no online path can give away a *seat*.
2. **Square's dashboard can.** `POST app.squareup.com/appointments/api/class-bookings` with a class id and a customer id books a seat with no payment ("Not yet paid"); `…/<id>/cancel` removes it. It works only from a browser signed in to Square (session cookie + CSRF), exactly like the class-creation snippet we already use — our API key gets 401.

Parties and kits are charged through Square's Payments API, which does accept gift cards.

## Decisions

| # | Decision |
|---|---|
| 1 | **No coupon codes.** The dead coupon system (`src/lib/coupons.ts`, `coupons.json`, `validate-coupon`, `CouponInput`, `features.coupons`) is deleted — it is wired only into the hidden Programs flow. |
| 2 | **Dollar giveaways = Square gift cards** with a promotional balance (`ADJUST_INCREMENT`, reason `COMPLIMENTARY` — the same mechanism as crew credit; no money moves). Redeemable online for parties and kits, and at the register. |
| 3 | **Free workshop seats = "Comp a seat" on `/staff`**, which makes the dashboard call from the staff browser. The iPad stays signed in to Square (it already must be for class creation). |
| 4 | Gift cards are minted from `/staff` (and a CLI) by anyone with the staff passcode. Each mint records who it was for in the card's note so the Square list is self-explaining. |
| 5 | v1: a gift card must **cover the whole amount**; otherwise the checkout says how much is on it and asks for a card. Splitting one order across a gift card and a card is a follow-up (Square supports it — two payments on one order — but it doubles the payment states to get right). |
| 6 | Nothing here cancels, refunds, or moves a booking (standing rule). "Comp a seat" only adds. |

## Scope

### A. Gift card in the one payment form (`src/components/checkout/PaymentForm.tsx`)

- The form gains a **"Pay with a gift card"** toggle under the card box. It mounts Square's `payments.giftCard()` field (verified: tokenizes a Square gift card to a `cnon:…` token; brand `SQUARE_GIFT_CARD`). The existing card/Apple/Google paths are untouched.
- On the **workshop** modal the toggle is replaced by one line: *"Gift cards can't be used for class seats — text us and we'll add you."* (Square refuses them; see Why.)
- Submitting with a gift-card token goes through the same booking endpoints with the token as `sourceId`. The party and kit endpoints already create an order and pay it; a gift card with insufficient balance fails Square's payment → the endpoint returns `402 gift_card_short` with the balance (read via `giftCards.getFromGan` before paying), and the modal shows *"That card has $X on it — this booking is $Y. Use a card instead?"* Nothing is held or charged (the same book-before-charge order applies).
- Simulated payments on previews: the mock provider accepts a fake gift-card token like it accepts a fake card.

### B. Mint gift cards (`/staff` → "Gift cards"; `scripts/mint-gift-card.ts`)

- `POST /api/staff/gift-cards.json` (staff-authed): `{ amountCents, forWhom, note? }` → creates a `DIGITAL` card, activates it with `ADJUST_INCREMENT` `COMPLIMENTARY` (not `ACTIVATE` with a fake payment id — that is what the spike used and it works, but `COMPLIMENTARY` is the honest reason code), stores `forWhom`/`note` as the card's `customer`-less metadata via our own small `gift-cards` blob record `{ gan, amountCents, forWhom, note, by, at }`, and returns the card number.
- `GET /api/staff/gift-cards.json` lists our minted cards with live balance (Square `giftCards.get`), newest first, so staff can see "Megan's $35 — $0 left, used Nov 9".
- Screen: amount (preset chips $10 / $25 / $50 / $100 + free entry), "for whom", optional note, **Make card** → shows the 16-digit number big, with a Copy button and a "text it" link that opens Messages with the number pre-filled (the staff member sends it). List below.
- CLI: `npx tsx scripts/mint-gift-card.ts --amount 35 --for "Megan (shared our reel)"` for Kaden.

### C. Comp a seat (`/staff` → class roster → "Comp a seat")

- Lives on the class roster (`Roster.tsx`), next to the existing actions, drop-off or not.
- Form: name, email, phone (optional), seats (default 1), and — when the class has questions (`event-meta.options`) — the same per-seat picks the public modal asks.
- Flow:
  1. The browser checks it is signed in to Square (`GET app.squareup.com/appointments/api/class-schedules/<id>` with `credentials:'include'`; a 401/redirect → *"Sign in to Square in this browser first"* with a link, and stop).
  2. `POST /api/staff/comp-seat/prepare.json` (staff-authed): finds or creates the Square customer (`providers.customer.findOrCreate`), validates picks against the class's options, and returns `{ customerId }`. Nothing is written yet.
  3. The browser calls `POST app.squareup.com/appointments/api/class-bookings` `{ class_booking: { class_schedule_id, customer_id, start_at }, client_message: { send_email: false, … } }` once per seat (Square books one seat per booking). On any failure after the first seat, it stops and reports which seats were booked — it never cancels.
  4. `POST /api/staff/comp-seat/record.json`: `{ scheduleId, bookingIds, customerId, picks, by }` → writes the `seat-choices` record(s) (same shape the paid path writes, `simulated` absent, plus `comped: true`), and sends our own confirmation email (the "Your picks" one) so the person gets the same email a paying guest gets. The roster re-reads Square and the seat appears like any other — rosters, totals, picks, warnings all already read Square + `seat-choices`.
- The seat shows as "Not yet paid" in Square's dashboard. That is correct and wanted; staff can "Take payment" there later if a comp turns into a sale.
- The existing conflict guards apply unchanged (a comp over a sold-out class fails at step 3 with Square's error, shown as-is).

### D. Delete the coupon remnants

`src/lib/coupons.ts`, `src/config/coupons.json`, `src/pages/api/checkout/validate-coupon.json.ts`, `src/components/checkout/CouponInput.tsx`, the `coupons` feature flag, and their tests. `OrderSummary`/`EnrollmentContext` references go with them (Programs is hidden; the removal keeps it compiling).

### Out of scope

- Splitting one order across a gift card and a card (Decision 5).
- Percent-off or shareable promo codes.
- Gift cards for workshop seats online (Square refuses; see Why).
- Selling gift cards to customers (Square's own gift-card storefront can do that later with no code).
- Comping a party or a kit (no demand named; a gift card covers it).

## Data

- New blob store `gift-cards` (`makeKvStore('gift-cards','gift-cards')`): `{ gan, giftCardId, amountCents, forWhom, note, by, at }`. The balance is never stored — Square is the truth.
- `seat-choices` records gain optional `comped: true`.
- No change to event-meta, bookings, or waivers.

## Testing

- Unit: gift-card mint request validation (amount 1–500 dollars, forWhom required), comp-seat prepare (picks validated exactly like the public path, 400 naming the first problem), record (one `seat-choices` row per booking id, email sent once).
- API: staff auth (401) on all three new routes; party/kit book with a short gift card → 402 with the balance and nothing charged; workshop book with a gift-card token → 400 "cards only" before any Square call.
- Components: PaymentForm gift-card toggle (mounts, tokenizes via the mock, absent on workshops with the explanatory line); gift-card screen (mint → number shown → list refreshes); comp-seat form (picks required when the class has questions; "sign in to Square" state; partial-success message lists booked seats).
- Browser walkthrough on local dev with mock providers: mint $25 → book a $25 kit with it → kit order shows paid; comp two seats on a class with questions → roster shows both with picks and "comped"; a short card on a party → 402 copy.
- Live check before prod (Kaden's call): mint a $1 card, pay a $1 kit deposit with it on the preview; comp a seat on a test class from the iPad and cancel it in Square by hand.

## Rollout

Build on `dev` one section at a time (D first — it is pure deletion — then B, A, C), review per section, preview check, prod push on Kaden's go. Nothing ships to customers until A lands; B and C are staff-only.

## Answered by Kaden (2026-10-08)

1. Presets $10 / $25 / $50 / $100 plus a free-entry field.
2. A comped seat sends the normal confirmation email.
3. Whole-amount only at launch: check the balance before using the card; if it is short, say so plainly.
