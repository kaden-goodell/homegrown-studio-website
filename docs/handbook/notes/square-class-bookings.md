# Square Class Bookings — Hard-Won Knowledge

## The Correct API
Square has a **buyer-facing classes API** (public, unauthenticated) separate from the official Bookings API:
- Base URL: `https://app.squareup.com/appointments/api/buyer/classes`
- Requires headers: `Origin: https://book.squareup.com`, `Referer: https://book.squareup.com/`
- The official Bookings API (`POST /v2/bookings`) does NOT work for classes — rejects CLASS_TICKET variations

## Booking Flow (2 steps)
1. **Create**: `POST /class_bookings?unit_token={locationId}`
   - Body: `{ class_schedule_id, start_at, customer: { given_name, family_name, email_address }, quantity }`
   - Uses `start_at` (NOT `class_schedule_instance_id`) to identify which occurrence
   - Returns pending booking + DRAFT order

2. **Complete**: `POST /class_bookings/{id}/complete?unit_token={locationId}`
   - Body: `{ class_booking: { id, class_schedule_id, customer_id }, payment_source_id, verification_token, idempotency_key }`
   - `customer_id` must be a Square customer ID (from Customers API)
   - `payment_source_id` MUST be a token from Web Payments SDK initialized with Square's booking widget app ID: (Square's booking widget app id) (NOT your merchant app ID)
   - This is atomic: either charges+confirms or does neither
   - On success: booking status → "accepted", capacity decreases

## Critical Details
- **contact_token**: The `customer_id` in `/complete` must be the `contact_token` from the booking create response, NOT the Customers API ID. This was the root cause of persistent "Could not charge given payment source" errors.
- **App ID**: Must use Square's booking widget app ID ((Square's booking widget app id)) — merchant app ID tokens are rejected
- **SDK Environment**: Must use **production** SDK (`web.squarecdn.com`) — buyer-facing API is always production
- **PaymentForm**: Has `applicationIdOverride` and `environmentOverride` props for workshop flow
- **Duplicate prevention**: Same customer can't book same class twice — pre-check via `POST /class_bookings/search`
- **Rollback**: If `/complete` fails, cancel via `POST /class_bookings/{id}/cancel`
- **Paying order separately does NOT confirm booking** — DRAFT→OPEN→pay via Payments API leaves booking pending
- **Client-side /complete**: CORS blocked — must proxy through server

## Other API Endpoints Discovered
- Cancel: `POST /class_bookings/{id}/cancel?unit_token={locationId}`
- Search: `POST /class_bookings/search?unit_token={locationId}`
- Get: `GET /class_bookings/{id}?unit_token={locationId}`
- Search instances: `POST /class_schedule_instances/search?unit_token={locationId}`

## Files
- `src/pages/api/workshops/book.json.ts` — Transactional booking endpoint
- `src/providers/square/classes.ts` — Fetches class instances from buyer API
- `src/components/workshops/WorkshopBookingModal.tsx` — Modal with booking widget app ID override
- `src/components/checkout/PaymentForm.tsx` — Has `applicationIdOverride` prop and `tokenizeAndVerify` method
- `src/components/workshops/WorkshopExplorer.tsx` — WorkshopData interface with classScheduleId, classScheduleInstanceId, teamMemberId

## What Does NOT Work
- Official Bookings API for classes (rejects CLASS_TICKET service variation IDs)
- Paying booking's order via Payments API (doesn't confirm booking)
- Using merchant app ID tokens with /complete endpoint (rejected)
- `class_schedule_instance_id` in create call (widget uses `start_at` instead)


**2026-10-07:** the site now sends `customer_note` (e.g. `Pumpkin color: Lavender ×2`) in the `POST /class_bookings` body when a class has seat questions, and retries ONCE without it on a 4xx (`src/providers/square/workshop.ts` reserveSeats/holdSeats). Whether Square accepts the field is UNVERIFIED live — the structured picks live in the `seat-choices` store either way.

- **Gift cards are NOT a valid payment source for class bookings (spike 2026-10-08):** a Square gift-card token from Web Payments SDK (`payments.giftCard()`, booking-widget app id, $60 balance ≥ seat price, customer attached via fallbackCustomerId) → `/complete` answers 422 `payment_source_id: Could not charge given payment source`. Reservations from the buyer API come back with `contact_token: null` even for brand-new emails, so the live flow runs on fallbackCustomerId. Conclusion: workshop seats stay card/wallet only; free-seat giveaways can't be done with a gift card online. Parties/kits (Payments API) can take gift cards — untested but documented. Spike card zeroed; test customer deleted.

- **Wallets on class checkout (tested live 2026-10-11):** with the booking-widget app id on ourhometownstudio.com, `payments.googlePay()` creates + attaches fine; `payments.applePay()` refuses "Your website's domain is not registered for use with Apple Pay" — only Square can register a domain for ITS app id, so Apple Pay on classes is blocked. Google Pay wired into WorkshopBookingModal (dev 8663f7c); whether /complete ACCEPTS a Google Pay token is unverified until a real charge. Kaden: Apple Pay is a must, but customers must NOT leave the site (rejected Square's hosted booking page). Plan: ask Square support (don't reveal the internal app id — it could get the route shut down); fallback = pay via our Payments API (Apple Pay works) + dashboard "add attendee" (fragile: dashboard session expires, two-step, needs auto-refund OK).

- **ONE SEAT PER BOOKING (found 2026-10-12, a customer undercharged):** the buyer API IGNORES `quantity`; Square counts one person per booking (the order qty can be raised via Orders API and charges right, but the roster still counts 1). $0 / CASH / EXTERNAL completes are refused ("Payment source or credit pack must be provided" / "Could not charge given payment source"). Dashboard-session guest adds work but the saved session lasts only ~36–48h (Kaden), so not usable for customers. **Live design (prod 2967520): each seat = its own buyer-API booking + its own charge**; guest records "Name (guest k of N)" via Customers API as fallbackCustomerId; client tokenizes the card once per seat; server refuses unless one distinct token per seat; seat 1 charged first, seats 2+ in parallel; Google Pay only for 1 seat. UNVERIFIED until Kaden's real card test: that card.tokenize() twice gives two chargeable tokens. Pending holds can't be cancelled (404) and show as "in carts" until they expire. Dev preview has DEV_BYPASS_PAYMENT=true, so real-charge tests only on prod.

- **PER-SEAT PRICE OVERRIDE ON A HELD ORDER — PROVEN 2026-10-18 (no charge):** hold one seat via buyer API (Tallow Skincare $45), then Orders API `PUT /v2/orders/{order_id}` (Square-Version 2025-01-23, our access token) with `{order:{location_id, version, line_items:[{uid, base_price_money:{amount:1500,currency:'USD'}, note:'Kid ticket'}]}, idempotency_key}` → 200, DRAFT v2, base 1500, tax recomputed 135, total 1635, note kept, catalog link kept. Basis for ticket types (Adult/Kid prices on ONE class; Kaden rejected two linked classes as "gross"). Still to prove: /complete charges the overridden total (expected — same as the Oct 12 quantity fix) → Kaden's real-card test. Test hold couldn't be released (404) → expires.

- **❌ PRICE OVERRIDE DOES NOT CHARGE (live test 2026-10-18, Kaden's card, TEST — Ticket Check $5 / Kid $1):** the held order accepts a new base price (order total shows $1.09), but `/complete` still authorizes the ORIGINAL item price ($5.45). Square then sees tender ≠ order total, VOIDS the payment (status CANCELED, no money taken) and leaves the order OPEN; the kid seat is not booked. Adult seat at the class's own price charged fine. So per-seat prices can't be done by editing the held order. Safe failure (no overcharge). The Oct 12 quantity case is different (catalog price × qty).
