# Take-Home Party Kits — PRD

> Status: DRAFT (pending Kaden approval) · Tier: Full · Author: 2026-07-11
> Related: docs/plans/2026-07-11-site-reorg-redesign-plan.md (teaser shipped on /book + homepage card), party flow (`src/components/party/`, `party-steps` lib), attorney review of agreement v3 (rental terms to be folded in).

## 1. Overview

A premium "party in a box": customers order craft kits for 10+ guests, optionally add a themed party package (consumables plus **rented premium tableware** — Liberty-print plates, cake stands), and pick everything up at the studio. Positioning is explicitly premium — a styled tablescape at home, not a bag of paper plates. This is Homegrown Studio's downsell for people who want the party without the $300 studio fee.

## 2. Background & Motivation

The studio party ($300 + crafts/head) is the flagship, but it prices out some groups and the room can only host one party at a time. Kits monetize demand the room can't absorb, with near-zero marginal labor at event time (assembly happens ahead, on our schedule). The premium rental component differentiates from big-box party supplies and reuses assets across many bookings. A "coming soon" teaser is already live on /book and the homepage.

## 3. API Contract

New endpoints under `/api/kits/`, mirroring the party flow's conventions (JSON envelope `{ data }`, same rate limiting and validation patterns). Payment reuses the existing checkout provider path (Square Payments via Web Payments SDK).

- [ ] [API] `GET /api/kits/service-info.json` — returns crafts (same source as party crafts: Square "Party Crafts" category), themes with per-tier pricing (from the package catalog item's variations), assembly fee, deposit amount, lead-time days, tier range
- [ ] [API] `GET /api/kits/weeks.json` — **Thursday→Wednesday cadence (Kaden 2026-07-11)**: customer picks their PARTY date; the system derives pickup = the Thursday before the party, return-by = the following **Wednesday** (pickup + 6 days). Wednesday is clean-and-prep day: returns come in, sets get washed/sanitized, and go back out Thursday — the same physical set can serve consecutive weeks. Endpoint returns selectable party dates (order cutoff 7 days before pickup Thursday, 90-day horizon) with per-THEME rental availability for that week (launch rule: one kit rental per theme per week; see §10 inventory model)
- [ ] [API] `POST /api/kits/order.json` — accepts `{ crafts: [{craftId, qty}], guests, themeVariationId?, partyDate, contact: {name, email, phone}, paymentToken, rentalTermsAccepted? }`; creates Square Order with PICKUP fulfillment (derived pickup Thursday), charges total; rental packages require `rentalTermsAccepted: true` (agreement acknowledgment — no card storage); returns `{ orderId, reference, summary: { pickupDate, returnByDate, ... } }`
- [ ] [API] `POST /api/kits/order.json` rejects: guests < 10, guests > 30 when a package is selected, partyDate whose week fails the lead-time cutoff, theme×tier set already rented that week, missing rental-terms acceptance when package includes rentals
- [ ] [API] `GET /api/staff/kits.json` (staff-auth via existing `staffAuthorized()`) — lists kit orders bucketed by state: awaiting pickup / pickup today / **missed pickup** / out on loan / due back today / **overdue (forfeit pending)** / settled
- [ ] [API] `POST /api/staff/kit-return.json` (staff-auth) — accepts `{ orderId, returnedComplete: boolean, withheldCents?: number, note?: string }`; complete → refunds the $50 deposit line; incomplete → staff withholds part or all of the deposit at their discretion (NO per-piece replacement-price computation — Kaden's call: "we're fine if we lose one or two things"); records kit-custody-log entry
- [ ] [API] `POST /api/staff/kit-return.json` supports `{ action: 'undo', orderId }` — reverses a mistaken check-in with compensating refund/charge, logged (mirrors checkin-store's first-class `undo-*` actions)
- [ ] [API] `POST /api/staff/kit-cancel.json` (staff-auth) — cancels a not-yet-picked-up order and refunds per cancellation policy (§5); also the resolution path for missed pickups
- [ ] [API] Rate limiting: `order.json` uses the party-book pattern by name — `rateLimited('kit-order:${clientAddress}', 5, 60_000)`; read endpoints use the availability-style bucket

### Net-new platform capabilities (NOT reuse — verified absent from codebase)

- [ ] [API] **Refund capability**: `PaymentProvider` gains `refundPayment(paymentId, amountCents, idempotencyKey, reason)` backed by the Square Refunds API — needed for deposit refunds (full or partial) and cancellations. Still net-new; still the biggest platform addition in this PRD
- **Card on file: CUT from launch** (recommended 2026-07-11, pending Kaden veto). With no per-piece replacement billing, the only automatic money is the $50 deposit — which we already hold. The rental agreement still creates liability for egregious cases (pursued manually). Cutting card-on-file removes the Square Cards API integration AND the security-review gate — the single biggest scope reduction available. Revisit only if non-returns actually happen

## 4. Data Model

No new database — Square catalog + orders remain the source of truth (consistent with the app's stateless architecture).

- [ ] [DATA] Catalog item `Kit Assembly` — $50 fixed, its own category `Take-Home Kits`
- [ ] [DATA] Catalog item `Party Package` — one variation per theme × tier (e.g. "The Gilded Table — serves 10" … "— serves 30"); seeded via a new script extending the **multi-variation** patterns in `scripts/seed-catalog.ts` / `scripts/seed-programs.ts` (NOT `add-party-craft.ts`, which is single-variation only); API-only per house rule
- [ ] [DATA] **New kit custody log** — its own append-only Netlify Blobs store *modeled on* `checkin-store.ts` (which is child-presence-specific: keyed `partyId+waiverRecordId`), keyed by kit order ID with taxonomy `order | cancel | pickup | missed-pickup | return-complete | return-partial | undo-return | deposit-refunded | replacement-charged | charge-failed | card-detached`
- [ ] [DATA] Catalog item `Rental Deposit` — $50 fixed; added as a line item only when the selected package includes rental (non-consumable) pieces
- [ ] [DATA] Kit config file `src/config/kit-content.ts` (content-gated like `party-content.ts` + `docs/NEEDS-FROM-KADEN.md`): theme display data (name, description, photo, consumables list, rental pieces list — NO replacement prices), **rental inventory count per theme×tier** (launch default: 1 set each), lead-time days (7), tier bounds (10–30), Thursday cadence rule
- [ ] [DATA] Rental availability: a theme×tier physical set serves ONE customer per Thursday→Thursday week; weeks.json and order.json enforce it (source of truth: existing paid kit orders for that pickup Thursday)
- [ ] [DATA] Square Order for a kit carries: craft line items (qty = exact guest count), assembly line, package variation line, deposit line (conditional), PICKUP fulfillment with pickup date, note containing return-by date + theme
- ~~Card on file~~ — cut from launch (see §3); rental-terms acceptance recorded on the order instead (agreement version + timestamp, mirroring waiver recording)

## 5. Business Logic & Rules

- [ ] [LOGIC] Guest minimum 10 for any kit order; crafts are priced/packed **exact per guest** (11 guests = 11 craft kits)
- [ ] [LOGIC] Package tier = guest count rounded UP to the next multiple of 5 (11→15, 16→20); tiers offered: 10, 15, 20, 25, 30; guests > 30 with a package selected is rejected (order without package, or contact us)
- [ ] [LOGIC] Tier rounding is shown transparently before payment ("11 guests → serves-15 package")
- [ ] [LOGIC] **Thursday→Wednesday cadence (Kaden 2026-07-11)**: customer picks their PARTY date; pickup = Thursday before, return-by = following Wednesday. Wednesday is the studio's clean/prep day so returned sets are washed and ready for Thursday pickups. UI always shows all three dates before payment
- [ ] [LOGIC] ⚠️ Return logistics: the studio is CLOSED to the public on Wednesdays (hours Thu–Sun) — return-by Wednesday means a **staffed drop-off window** on prep day (time TBD, e.g. 4–6 PM), communicated on the contents card + confirmation email. Early returns also accepted any open day (Thu–Sun) after the party
- [ ] [LOGIC] Lead time: 7 days for ALL kit orders — order cutoff is 7 days before the derived pickup Thursday
- [ ] [LOGIC] Deposit forfeit: kit not returned by return-by Wednesday → deposit is withheld (staff confirms with one click on/after Thursday — no silent automation, but no card charging either)
- [ ] [LOGIC] Cleaning: customer is responsible for cleaning food-contact pieces before return ("return it clean" — in agreement + contents card); staff verifies at check-in and does a final sanitize pass; returned-dirty is grounds for withholding part of the deposit
- [ ] [LOGIC] Deposit ($50) charged only when the selected package contains rental pieces; consumables-only themes (if any) carry no deposit
- [ ] [LOGIC] Rental orders require checkbox consent: card on file + agreement acknowledgment (rental terms; agreement version recorded, mirroring party agreement handling — terms folded into attorney's v3 review)
- [ ] [LOGIC] Return-by date = pickup Thursday + 6 days = the next Wednesday — CONFIRMED; printed on contents card, in confirmation email, and stored on the order
- [ ] [LOGIC] Return check-in: complete → automatic $50 deposit refund to original payment; incomplete or dirty → staff withholds part/all of deposit at discretion with a note; every outcome writes to the kit custody log. No per-piece replacement billing (decided 2026-07-11); egregious non-return handled manually per the rental agreement
- [ ] [LOGIC] Return check-in is reversible: `undo` fires compensating transactions and restores the prior state (staff mistakes must not be permanent real-money errors)
- [ ] [LOGIC] Failed initial payment → the just-created Square Order is voided/canceled (do NOT copy the party flow's orphaned-order wart) and staff kit lists filter to paid orders only
- [ ] [LOGIC] Cancellation (staff-initiated via kit-cancel) — **CONFIRMED by Kaden 2026-07-11**: full refund ≥ 7 days before pickup Thursday; inside 7 days, refund minus the $50 assembly fee
- [ ] [LOGIC] Missed pickup: pickup date passes unclaimed → `missed pickup` bucket; staff may rebook a new pickup date or cancel per the cancellation policy; kit held 7 days before staff follow-up is prompted
- [ ] [LOGIC] Confirmation email (existing Gmail/nodemailer pipeline): order summary, pickup date + hours, return-by date, what's-included (keep vs return), unique subject with slot + booking ref in footer (house email rules)
- [ ] [LOGIC] Reminder email 1 day before return-by date for rental orders with deposit still open — **INFRA weight flag**: this is the app's first real scheduled job (the only existing cron, `netlify/functions/send-rosters.ts`, is an unimplemented skeleton on Resend, not the Gmail pipeline). Requires: working Netlify scheduled function, Gmail-vs-Resend decision (recommend Gmail for consistency), and a query for open-deposit orders due tomorrow. May be deferred to fast-follow if it threatens launch
- [ ] [LOGIC] Slack notification on new kit order (existing `#bookings` webhook)

## 6. Entry Points & User Flows

### Path A — /book teaser (exists today)
"Take-Home Party Kits — Coming Soon" card upgrades to a link → kit page.

### Path B — Homepage offering card (exists today)
"Take-Home Kits" card flips from non-clickable "Coming soon" to a live link (remove `href: null` special case).

### Path C — Direct: `/kits` (or `/parties/take-home` — TBD route name)
Landing page in the party-page mold: hero promise, theme gallery with photos + names, how-it-works (order ≥7 days ahead → pick up → party → return the pretties), craft cards (shared with party flow), CTA opens the kit modal.

Flow inside the modal (dynamic steps, `party-steps` pattern — settled steps drop out): **Crafts → Guests → Theme/Package (optional) → Pickup date → Details & Payment**.

## 7. UI States & Layout

- [ ] [UI] Kit landing page: hero, themes gallery, how-it-works strip, craft cards, FAQ (what's rented vs kept, return window, deposit)
- [ ] [UI] Modal step states: loading (skeletons), populated, error-with-retry (match CraftMenu/party modal conventions); Apple/Google Pay where the party flow has them
- [ ] [UI] Guests step: stepper starting at 10 (min 10; max 30 while a package is selected, soft note beyond)
- [ ] [UI] Package step: theme cards with photo, name, per-tier price for the *computed* tier, "No package, just crafts" as an explicit first-class choice
- [ ] [UI] Payment step line items: crafts × N, Assembly $50, Package (theme — serves T) $X, Refundable rental deposit $50 (conditional), with the deposit explained inline ("back in your pocket when the pieces come home")
- [ ] [UI] Rental consent checkbox with agreement link; payment blocked until checked (rental orders only)
- [ ] [UI] Confirmation state: green-check style matching party/workshop confirmations; pickup + return-by dates prominent
- [ ] [UI] Staff portal: kits list (pickup today / out on loan / overdue), return check-in screen with per-item checklist and computed refund/charge preview

## 8. Component Behavior

- [ ] [UI] Guest stepper recomputes tier + package price live; crossing a tier boundary animates/updates the "serves T" label and price
- [ ] [UI] Party-date picker: customer picks THEIR party day; picker immediately displays the derived "Pick up Thursday {date} · Return by Thursday {date}"; weeks failing the 7-day cutoff or with the chosen theme's set already rented are greyed with reasons ("Kits need 7 days of love and assembly" / "This theme is spoken for that week")
- [ ] [UI] Theme card selected state matches party craft-card selection chrome (glass, check overlay)
- [ ] [UI] Return check-in checklist: unchecking an item reveals qty + auto-computed replacement price; submit shows confirm summary before firing refund/charge (no native dialogs — house rule)

## 9. Settings & Configuration

- [ ] [DATA] `kit-content.ts` gates launch content: `themes[]` (id, displayName, tagline, photo, consumables, rentals w/ replacement prices), `assemblyFeeCents`, `depositCents`, `leadTimeDays: 7`, `tierBounds: {min: 10, max: 30, step: 5}`, `returnWindowDays: 7`
- [ ] [LOGIC] Feature flag `features.kits.enabled` in `site.config.ts`. Honest scope: the flag must be hand-wired into TWO independent call sites — `book.astro`'s teaser (currently flat markup, no conditional) and `index.astro`'s local `offerings` array (`href: null` case) — they share no data source today. Build includes threading the flag through both (a shared-offerings refactor is optional, not required)

## 10. Open Questions

- DRAFT theme lineup (named/priced by Claude 2026-07-11 per Kaden's "you name them and put prices, we adjust"; Rainbow + neutral approved by Kaden). Liberty-print tableware is the shared backbone; each theme is the accent scheme:

| Theme | Scheme | Tagline |
|---|---|---|
| The Gilded Table | gold | "Warm gold, candlelight, and celebration" |
| The Sterling Table | silver | "Polished, cool, and effortlessly elegant" |
| The Bluebell Table | blue | "Fresh blues straight out of an English garden" |
| The Prism Table | rainbow | "Every color invited" |
| The Linen Table | neutral | "Soft naturals for gatherings that glow quietly" |
| The Sweet Sixteen | sweet-sixteen | "Sixteen only happens once" |

  Per-tier pricing (Kaden 2026-07-11: "start at 75 then go up 25"), uniform across themes at launch: **serves 10 — $75 · 15 — $100 · 20 — $125 · 25 — $150 · 30 — $175** ($5.80–7.50/head, declining with scale — fair for genuine Liberty-print tableware plus full consumables).
  ⚠️ Inventory reality: every theme×tier needs a physical rental set — 6 themes × 5 tiers = 30 stocked sets; recommend launching 3–4 themes at tiers 10/15/20 and growing from demand. Photos + final box contents → `docs/NEEDS-FROM-KADEN.md`.
- ~~Card-on-file~~ — DECIDED (Kaden 2026-07-11): cut, never store cards; deposit-only protection.
- DECIDED: Wednesday drop-off window **4–6 PM**; early drop-off possible "if they coordinate, but no promises we can make anything work" (that exact expectation goes in the confirmation email + contents card).
- Draft box contents per theme (Kaden 2026-07-11, varies per place setting, "pretty and tasteful"): cake stand, napkins, plates, candles + candle holders, trays. Exact per-theme composition → `NEEDS-FROM-KADEN.md`; build uses the existing placeholder photo for every theme until real shots exist.
- **Inventory model (recommended)**: think in *place settings per theme* + duplicate hero pieces, NOT rigid per-tier sets — a theme stocked to 25 settings serves any tier ≤ 25. Launch recommendation: **4 themes × tiers 10/15/20 only**, ~25 settings + 2 hero sets (cake stand/trays) per theme (~$300–450/theme capital, ≈$1.2–1.8k total; pays back in ~15–20 package sales). Availability rule at launch (simple, upgradeable): **per theme per Thu→Wed week — EITHER one kit rental OR any number of in-studio parties** (studio parties can share a theme across days since pieces wash between; the only real conflict is kit-out-of-building vs. studio use).
- TBD: Route name — `/kits` vs `/parties/take-home` (parties-hub framing from the site-reorg plan).
- TBD: Rental terms language — with attorney in agreement v3 review; blocking for LAUNCH, not for build (build against draft terms). Now includes the "customer cleans food-contact pieces" clause.
- ~~Return window~~ — DECIDED: Thursday→Thursday, forfeit staff-confirmed on/after return Thursday.
- ~~Replacement prices~~ — DECIDED: none; deposit withholding + manual recourse only.
- ~~Wash/sanitize~~ — DECIDED: customer cleans, staff verifies + final sanitize; dirty returns can dock the deposit.
- ~~Cancellation policy~~ — DECIDED: full refund ≥7 days pre-pickup, minus $50 assembly fee inside 7 days, staff-initiated.
- ~~Overdue policy~~ — DECIDED: deposit forfeit (staff one-click confirm), no card charging.

## 10a. In-Studio Party Packages (added scope — Kaden 2026-07-11)

The same themed packages become an optional add-on for **in-studio parties**: staff decorates the room before guests arrive. No assembly fee, no deposit, no rental terms — the pieces never leave the studio.

- [ ] [API] `/api/party/service-info.json` additionally returns available themes (+ tier prices) so the party flow can offer them
- [ ] [API] Party booking (`/api/party/book.json`) accepts optional `themeVariationId`; adds the package line item to the party's order (same theme×tier Square variations — tier from the party's guest count, same round-up rule)
- [ ] [LOGIC] **Shared inventory pool with kits**: an in-studio party on date D requires the theme to NOT be out on a kit rental during the Thu→Wed window containing D (and booking a kit blocks the theme for in-studio parties that week — first come wins). Multiple in-studio uses of one theme in a week are fine (washed between days; only one party per day exists anyway). Availability enforced in both flows
- [ ] [LOGIC] No deposit and no assembly fee on the in-studio path; price = package tier price only
- [ ] [UI] Party modal gains an optional "Add a themed table" choice (theme cards, computed tier price, skippable — mirrors the kit package step); shows on the payment summary as its own line
- [ ] [UI] Booking confirmation email includes the chosen theme so staff know what to stage
- [ ] [LOGIC] Staff party view (existing `/api/staff/parties`) surfaces the theme for prep

## 11. Out of Scope

- Delivery/shipping — pickup only at launch
- Alabama rental/lease tax treatment — explicitly deferred by Kaden (revisit with accountant before launch)
- Custom/bespoke themes, mixed-theme boxes
- Kit gifting, gift cards
- Workshops page redesign (separate push)
- Automatic overdue charging (nothing charges a card without a human deciding)
- Card on file / Square Cards API — cut from launch with the no-replacement-billing decision; revisit only if non-returns become a real problem
- Per-piece replacement billing and price lists — deposit withholding + manual recourse instead

## 12. Acceptance Checklist

### API
- [ ] [API] service-info returns crafts + themes with per-tier prices + fee/deposit/lead-time constants
- [ ] [API] pickup-dates returns only open days ≥ 7 days out
- [ ] [API] order.json creates Square PICKUP order with correct line items and charges once (book-before-charge ordering per house pattern)
- [ ] [API] order.json rejects guests<10, package with guests>30, short-notice pickup dates, missing rental consent
- [ ] [API] staff kit-return refunds full deposit on complete return; supports discretionary partial/zero refund with note; supports undo with compensating transactions
- [ ] [API] `PaymentProvider.refundPayment` implemented against Square Refunds API with idempotency keys (net-new capability)
- [ ] [API] kit-cancel refunds per confirmed policy (full ≥7d, minus $50 assembly <7d) and settles correctly for both package and no-package orders
- [ ] [API] weeks.json blocks theme×tier weeks whose set is already rented; order.json re-validates at purchase time (no double-rentals under concurrency)
- [ ] [API] `order.json` rate-limited via `rateLimited('kit-order:${ip}', 5, 60_000)`; inputs validated like party/book
- [ ] [LOGIC] Derived dates correct across month/year boundaries: pickup = Thursday strictly before party date; return-by = pickup + 7 days (unit-tested)

### Data
- [ ] [DATA] Catalog seeded: Kit Assembly $50, Rental Deposit $50, Party Package with theme×tier variations — all via scripts (no dashboard work)
- [ ] [DATA] Kit orders carry pickup fulfillment date + return-by in order data
- [ ] [DATA] Card on file stored only with consent, only for rental orders

### Logic
- [ ] [LOGIC] Tier = ceil(guests/5)×5, min 10, max 30; crafts exact per guest
- [ ] [LOGIC] Deposit line present iff package has rental pieces
- [ ] [LOGIC] Confirmation + return-reminder emails send with correct dates; Slack notify fires
- [ ] [LOGIC] Custody audit log entries on order, pickup, return, refund/charge

### UI
- [ ] [UI] Homepage + /book teasers link to the live kit page when `features.kits.enabled`
- [ ] [UI] Modal walks Crafts → Guests → Theme → Pickup → Pay with live tier display and conditional deposit line
- [ ] [UI] Rental consent gate blocks payment until checked
- [ ] [UI] Staff return check-in produces correct refund preview for complete and partial returns
