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
| 3 | **Free workshop seats = "Comp a seat" on `/staff`**: a link into Square's dashboard for the no-payment "Add attendee" step, then a form here that records the person and their picks and sends the confirmation. (Direct call from our page is impossible — CORS; see C.) |
| 4 | Gift cards are minted from `/staff` (and a CLI) by anyone with the staff passcode. Each mint records who it was for in the card's note so the Square list is self-explaining. |
| 5 | v1: a gift card must **cover the whole amount**; otherwise the checkout says how much is on it and asks for a card. Splitting one order across a gift card and a card is a follow-up (Square supports it — two payments on one order — but it doubles the payment states to get right). |
| 6 | Nothing here cancels, refunds, or moves a booking (standing rule). "Comp a seat" only adds. |
| 7 | **Added 2026-10-08:** every staff action is written to an audit log (who, what, when, on what) — backend only, read via a staff endpoint (`GET /api/staff/audit.json`, any signed-in staff) and `scripts/audit-log.ts` (reads production through the netlify CLI), no screen (Kaden: "doesn't have to manifest on the frontend"). No role gates — "anyone can do it. Trust first. But we need to be able to check these things." |

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

**Deviation recorded 2026-10-08:** the first draft had the staff page call Square's dashboard endpoint directly. A live probe from the studio origin fails (`Failed to fetch`): Square sends no CORS allowance, so that call works only from inside an app.squareup.com tab. The flow below keeps the outcome and routes the one Square step through Square's own screen.

- Lives on the class roster (`Roster.tsx`), next to the existing actions, drop-off or not. Opens a right-side sheet (same pattern as `AddFamilySheet`).
- **Step 1 — in Square (one link).** The sheet shows a button *"Open this class in Square"* → `https://app.squareup.com/dashboard/appointments/calendar/classes/<classScheduleId>?date=<YYYY-MM-DD>&view=week` in a new tab, with the three taps spelled out: *Add attendee → pick or create the person → Add to class → Skip payment.* (Verified: that books the seat with no charge; it shows "Not yet paid" in Square.)
- **Step 2 — record it here.** The same sheet has the form: name, email, phone (optional), seats (default 1), and — when the class has questions — the per-seat picks the public modal asks. *Record comped seat* → `POST /api/staff/comp-seat.json` (staff-authed) `{ scheduleId, givenName, familyName, email, phone?, seats, picks }`:
  - validates picks against the class's options exactly as the public path does (400 naming the first problem);
  - writes one `seat-choices` record with `bookingId: 'comp_<id>'`, `orderId: null`, `comped: true`, `by` = the staff member;
  - sends the same confirmation email a paying guest gets (the "Seats … paid" line reads *comped* instead);
  - returns `{ ok: true, bookingId }`. The roster refreshes; the person appears under "Paid, not signed in yet" (now labelled *"Comped / paid, not signed in yet"*) with their picks, and the class's picks-missing warning clears once the recorded seats match Square's sold count.
- Nothing here talks to Square. The seat exists in Square because staff added it there; our record is what the roster, totals, picks and email run on. If staff records but forgets Square, the oversold/picks warnings don't catch it — the sheet's copy makes the order explicit (Square first, then record), and the warnings panel already flags a class whose recorded seats exceed Square's sold count.

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
- `seat-choices` records gain optional `comped: true` and `by?: By`; comped records use `bookingId: 'comp_<id>'` and `orderId: null`.
- No change to event-meta, bookings, or waivers.

## Testing

- Unit: gift-card mint request validation (amount 1–500 dollars, forWhom required); comp-seat record (picks validated exactly like the public path, 400 naming the first problem; one `seat-choices` row, `comped: true`; email sent once with the comped wording).
- API: staff auth (401) on all three new routes; party/kit book with a short gift card → 402 with the balance and nothing charged; workshop book with a gift-card token → 400 "cards only" before any Square call.
- Components: PaymentForm gift-card toggle (mounts, tokenizes via the mock, absent on workshops with the explanatory line); gift-card screen (mint → number shown → list refreshes); comp-seat sheet (Square link carries the class id and day; picks required when the class has questions; success refreshes the roster).
- Browser walkthrough on local dev with mock providers: mint $25 → book a $25 kit with it → kit order shows paid; record a two-seat comp on a class with questions → roster shows them with picks and "comped"; a short card on a party → 402 copy.
- Live check before prod (Kaden's call): mint a $1 card, pay a $1 kit deposit with it on the preview; add an attendee to a test class from Square's dashboard (Skip payment), record it on /staff, confirm the email and the roster; cancel the attendee in Square by hand.

## Rollout

Build on `dev` one section at a time (D first — it is pure deletion — then B, A, C), review per section, preview check, prod push on Kaden's go. Nothing ships to customers until A lands; B and C are staff-only.

## Answered by Kaden (2026-10-08)

1. Presets $10 / $25 / $50 / $100 plus a free-entry field.
2. A comped seat sends the normal confirmation email.
3. Whole-amount only at launch: check the balance before using the card; if it is short, say so plainly.
