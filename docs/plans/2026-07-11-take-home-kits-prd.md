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
- [ ] [API] `GET /api/kits/pickup-dates.json` — returns selectable pickup dates: open business days (Thu–Sun) that are ≥ 7 calendar days from order date, capped at a reasonable horizon (90 days)
- [ ] [API] `POST /api/kits/order.json` — accepts `{ crafts: [{craftId, qty}], guests, themeVariationId?, pickupDate, contact: {name, email, phone}, paymentToken, cardOnFileConsent? }`; creates Square Order with PICKUP fulfillment (pickup date/time window), charges total; when a rental package is included, requires `cardOnFileConsent: true` and stores card on file on the Square customer; returns `{ orderId, reference, summary }`
- [ ] [API] `POST /api/kits/order.json` rejects: guests < 10, guests > 30 when a package is selected, pickupDate not in pickup-dates set, missing card-on-file consent when package includes rentals
- [ ] [API] `GET /api/staff/kits.json` (staff-auth via existing `staffAuthorized()`) — lists kit orders bucketed by state: awaiting pickup / pickup today / **missed pickup** / out on loan / overdue return / **deposit unsettled** / settled
- [ ] [API] `POST /api/staff/kit-return.json` (staff-auth) — accepts `{ orderId, returnedComplete: boolean, missingItems?: [{itemKey, qty}] }`; complete → refunds the $50 deposit line; incomplete → refunds deposit minus (or charges card on file for) replacement totals from the replacement-price list; records kit-custody-log entry
- [ ] [API] `POST /api/staff/kit-return.json` supports `{ action: 'undo', orderId }` — reverses a mistaken check-in with compensating refund/charge, logged (mirrors checkin-store's first-class `undo-*` actions)
- [ ] [API] `POST /api/staff/kit-cancel.json` (staff-auth) — cancels a not-yet-picked-up order and refunds per cancellation policy (§5); also the resolution path for missed pickups
- [ ] [API] Rate limiting: `order.json` uses the party-book pattern by name — `rateLimited('kit-order:${clientAddress}', 5, 60_000)`; read endpoints use the availability-style bucket

### Net-new platform capabilities (NOT reuse — verified absent from codebase)

- [ ] [API] **Refund capability**: `PaymentProvider` gains `refundPayment(paymentId, amountCents, idempotencyKey, reason)` backed by the Square Refunds API. Sequencing rule for partial-return settlements that need refund + charge: refund first, then charge; if the second call fails, order enters `deposit unsettled` (no automatic retry loop)
- [ ] [API] **Card on file**: first stored-payment-method flow in the app — Square Cards API (`cards.create` from a payment token with customer consent). Treated as a security-sensitive addition: gets a security review pass (`/security-review`) as an acceptance gate

## 4. Data Model

No new database — Square catalog + orders remain the source of truth (consistent with the app's stateless architecture).

- [ ] [DATA] Catalog item `Kit Assembly` — $50 fixed, its own category `Take-Home Kits`
- [ ] [DATA] Catalog item `Party Package` — one variation per theme × tier (e.g. "The Gilded Table — serves 10" … "— serves 30"); seeded via a new script extending the **multi-variation** patterns in `scripts/seed-catalog.ts` / `scripts/seed-programs.ts` (NOT `add-party-craft.ts`, which is single-variation only); API-only per house rule
- [ ] [DATA] **New kit custody log** — its own append-only Netlify Blobs store *modeled on* `checkin-store.ts` (which is child-presence-specific: keyed `partyId+waiverRecordId`), keyed by kit order ID with taxonomy `order | cancel | pickup | missed-pickup | return-complete | return-partial | undo-return | deposit-refunded | replacement-charged | charge-failed | card-detached`
- [ ] [DATA] Catalog item `Rental Deposit` — $50 fixed; added as a line item only when the selected package includes rental (non-consumable) pieces
- [ ] [DATA] Kit config file `src/config/kit-content.ts` (content-gated like `party-content.ts` + `docs/NEEDS-FROM-KADEN.md`): theme display data (name, description, photo, consumables list, rental pieces list), replacement-price list per rental piece, lead-time days (7), tier bounds (10–30), return-window rule
- [ ] [DATA] Square Order for a kit carries: craft line items (qty = exact guest count), assembly line, package variation line, deposit line (conditional), PICKUP fulfillment with pickup date, note containing return-by date + theme
- [ ] [DATA] Card on file stored against the Square customer record when rental package present (consented)

## 5. Business Logic & Rules

- [ ] [LOGIC] Guest minimum 10 for any kit order; crafts are priced/packed **exact per guest** (11 guests = 11 craft kits)
- [ ] [LOGIC] Package tier = guest count rounded UP to the next multiple of 5 (11→15, 16→20); tiers offered: 10, 15, 20, 25, 30; guests > 30 with a package selected is rejected (order without package, or contact us)
- [ ] [LOGIC] Tier rounding is shown transparently before payment ("11 guests → serves-15 package")
- [ ] [LOGIC] Lead time: earliest selectable pickup is 7 calendar days out, for ALL kit orders (with or without package)
- [ ] [LOGIC] Pickup dates only on open business days (config `siteConfig.hours` days: Thu–Sun)
- [ ] [LOGIC] Deposit ($50) charged only when the selected package contains rental pieces; consumables-only themes (if any) carry no deposit
- [ ] [LOGIC] Rental orders require checkbox consent: card on file + agreement acknowledgment (rental terms; agreement version recorded, mirroring party agreement handling — terms folded into attorney's v3 review)
- [ ] [LOGIC] Return-by date = pickup date + 7 days (TBD confirm; printed on contents card, in confirmation email, and stored on the order)
- [ ] [LOGIC] Return check-in: complete → automatic $50 refund to original payment; incomplete → staff itemizes, system computes replacement total from `kit-content.ts` price list, refunds remainder or charges card on file for the excess; every outcome writes to the kit custody log
- [ ] [LOGIC] Return check-in is reversible: `undo` fires compensating transactions and restores the prior state (staff mistakes must not be permanent real-money errors)
- [ ] [LOGIC] Card-on-file charge failure (declined/expired weeks later) → order state `deposit unsettled`, surfaced as its own staff-portal bucket with manual retry / collect-another-way actions; never silently dropped
- [ ] [LOGIC] Card on file is **detached from the Square customer once the deposit settles** (refund complete or replacement charged), unless the customer has another open rental order — stored exactly as long as operationally needed, no longer
- [ ] [LOGIC] Failed initial payment → the just-created Square Order is voided/canceled (do NOT copy the party flow's orphaned-order wart) and staff kit lists filter to paid orders only
- [ ] [LOGIC] Cancellation (staff-initiated via kit-cancel): full refund if ≥ 7 days before pickup; inside 7 days refund minus the $50 assembly fee (assembly underway) — **policy pending Kaden confirmation (§10)**; cancelling a rental order also detaches the stored card
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
- [ ] [UI] Pickup-date picker greys out dates < 7 days out and non-open days; shows "Kits need 7 days of love and assembly" as the explainer
- [ ] [UI] Theme card selected state matches party craft-card selection chrome (glass, check overlay)
- [ ] [UI] Return check-in checklist: unchecking an item reveals qty + auto-computed replacement price; submit shows confirm summary before firing refund/charge (no native dialogs — house rule)

## 9. Settings & Configuration

- [ ] [DATA] `kit-content.ts` gates launch content: `themes[]` (id, displayName, tagline, photo, consumables, rentals w/ replacement prices), `assemblyFeeCents`, `depositCents`, `leadTimeDays: 7`, `tierBounds: {min: 10, max: 30, step: 5}`, `returnWindowDays: 7`
- [ ] [LOGIC] Feature flag `features.kits.enabled` in `site.config.ts`. Honest scope: the flag must be hand-wired into TWO independent call sites — `book.astro`'s teaser (currently flat markup, no conditional) and `index.astro`'s local `offerings` array (`href: null` case) — they share no data source today. Build includes threading the flag through both (a shared-offerings refactor is optional, not required)

## 10. Open Questions

- TBD: Theme lineup — names, per-tier prices, photos, exact contents (consumables vs rental pieces per theme). **Kaden** — will land in `docs/NEEDS-FROM-KADEN.md` pattern.
- TBD: Route name — `/kits` vs `/parties/take-home` (parties-hub framing from the site-reorg plan).
- TBD: Return window — pickup + 7 days assumed; confirm (anchor to pickup, not event date, since we don't collect event date… or should we collect it?).
- TBD: Replacement-price list values per rental piece. **Kaden**.
- TBD: Wash/sanitize workflow + who does it (operational, affects package margin; food-contact items).
- TBD: Rental terms language — with attorney in agreement v3 review; blocking for LAUNCH, not for build (build against draft terms).
- TBD: Overdue policy — grace period, when card-on-file charge fires automatically vs staff-initiated (recommend staff-initiated only, no automatic charging).
- TBD: **Cancellation policy** — proposed: full refund ≥7 days before pickup, refund minus $50 assembly fee inside 7 days, staff-initiated only. Awaiting Kaden's confirmation (asked 2026-07-11).

## 11. Out of Scope

- Delivery/shipping — pickup only at launch
- Alabama rental/lease tax treatment — explicitly deferred by Kaden (revisit with accountant before launch)
- Custom/bespoke themes, mixed-theme boxes
- Kit gifting, gift cards
- Workshops page redesign (separate push)
- Automatic overdue charging (see TBD; nothing charges a card without a human deciding)

## 12. Acceptance Checklist

### API
- [ ] [API] service-info returns crafts + themes with per-tier prices + fee/deposit/lead-time constants
- [ ] [API] pickup-dates returns only open days ≥ 7 days out
- [ ] [API] order.json creates Square PICKUP order with correct line items and charges once (book-before-charge ordering per house pattern)
- [ ] [API] order.json rejects guests<10, package with guests>30, short-notice pickup dates, missing rental consent
- [ ] [API] staff kit-return refunds full deposit on complete return; computes partial refund/charge from replacement list otherwise; supports undo with compensating transactions
- [ ] [API] `PaymentProvider.refundPayment` implemented against Square Refunds API with idempotency keys (net-new capability)
- [ ] [API] kit-cancel refunds per policy and voids/settles correctly for both package and no-package orders
- [ ] [API] `order.json` rate-limited via `rateLimited('kit-order:${ip}', 5, 60_000)`; inputs validated like party/book

### Security
- [ ] [LOGIC] Card-on-file flow passes a `/security-review` gate before launch (first stored-payment-method in the app)
- [ ] [LOGIC] Stored card detached on deposit settlement or cancellation (verified via Square customer state)

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
