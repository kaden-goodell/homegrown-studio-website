# Open Studio Reservations — Design Doc

## Date: 2026-03-31

## Overview

Homegrown Studio is shifting from scheduled-only parties to an Open Studio model. The studio has 36 seats across 6 tables. During Open Studio hours, customers can walk in or reserve tables online. Workshops continue as-is on Friday/Saturday/Sunday evenings.

## Business Model

### 1. Open Studio (Table Reservations)
- **Schedule:**
  - Thursday: 4pm–9pm (no workshop)
  - Friday: 4pm–6pm (1hr cleanup, 7pm workshop)
  - Saturday: 9am–6pm (1hr cleanup, 7pm workshop)
  - Sunday: 2pm–6pm (1hr cleanup, 7pm workshop)
- **Walk-ins:** No online booking needed. Show up, pick a craft, pay at POS.
- **Table Reservation:** $100 deposit, reserves 1 table (6 seats), 1hr or 2hr blocks, on the hour
  - Deposit becomes craft credit via Square gift card linked to customer profile
  - Can book multiple tables
- **Add-Ons (independent, mix and match):**
  - **Party Table:** $50, max 2 per time slot (separate party area, doesn't consume a craft table)
  - **Dedicated Host:** $100, max 2 per time slot (staffing constraint)
  - Set up as modifiers on the service in Square, but processed via Orders API (Bookings API doesn't support modifiers)
- **Booking cutoff:** Midnight the night before
- **No individual seat reservations online** — walk-in only

### 2. Whole Studio Booking
- $500 total ($200 goes toward craft credit as gift card)
- Books all 6 tables for the time slot
- Crafts purchased per person at POS
- Blocks the slot from all other reservations

### 3. Workshops (unchanged)
- Friday, Saturday, Sunday evenings
- Per-seat pricing
- Managed via Square Classes API (buyer-facing, already working)

## Tech Stack

| Layer | Tool | Purpose |
|-------|------|---------|
| Website | Astro (existing) | UI, reservation flow |
| Payments | Square | Online deposits, gift cards, in-store POS |
| Bookings | Square Bookings API | Table availability, reservation management |
| Workshops | Square Classes API (existing) | Per-seat workshop bookings |
| Customer data | Square Customers API | Profiles, gift card linking, loyalty |
| Hosting | Netlify (existing) | Deployment |

**No new infrastructure needed.** No database, no Shopify, no third-party booking plugins.

## How Tables Map to Square

**Square Appointments Free plan — no Premium needed.**

Tables are NOT modeled as resources or team members. Instead:
- All bookings go against one team member (Kaden — `TMeIN-kxF-ZVhTVj`)
- Square allows unlimited concurrent bookings on the same team member
- Our code enforces the 6-table cap by counting overlapping bookings via `ListBookings`
- `SearchAvailability` tells us which hours are valid (business hours)
- `6 - count(overlapping bookings) = tables available`

**Service setup in Square:**
- "Table Reservation" service with 1hr and 2hr duration variants
- Pricing set in Square (currently $100 deposit per table)
- Modifier list (multi-select): Party Table ($50), Dedicated Host ($100)

**Important API limitation:** Bookings API does NOT support modifiers. Add-ons (party table, dedicated host) are handled via the Orders API as line items when processing payment. Selections are stored as custom attributes on the booking.

## Booking Flow (Customer-Facing)

### Table Reservation
1. Customer visits reservation page
2. Selects a date → we call `SearchAvailability` to get open slots
3. Selects a time slot (1hr or 2hr, on the hour)
4. UI shows: X tables available, party add-on available (if < 2 booked)
5. Selects number of tables (1–N available)
6. Optionally adds party add-on ($150)
7. Enters name, email, phone
8. Pays deposit ($100/table + $150 party add-on if selected)
9. We create/find Square customer profile
10. Create booking(s) via Square Bookings API
11. Create gift card with deposit amount, link to customer profile
12. Send confirmation email
13. Customer walks in → cashier looks up name → gift card credit applied at POS

### Whole Studio Booking
1. Same date/time selection
2. "Book Whole Studio" option only appears if all 6 tables are available
3. $500 charge
4. Books all 6 tables for the slot
5. Gift card created for $200 (craft credit portion)
6. Confirmation email

### Cancellation
- **Table reservations:** Cancel up to 24h in advance → full refund (gift card voided)
- **Party add-on:** Cancel up to 48h in advance → full refund
- **After cutoff:** No cash refund, deposit converts to store credit (gift card stays active)
- Cancel via link in confirmation email
- Booking cancelled in Square, gift card voided or kept depending on timing

## Availability Logic

### Available tables for a slot:
```
Call SearchAvailability(date, time, duration)
→ Returns list of available tables (team members)
→ Count = number of bookable tables
→ If count == 6, "Book Whole Studio" is available
```

### Add-on availability check:
```
Call ListBookings(date)
→ Filter bookings overlapping with selected time slot
→ Count bookings with party_table custom attribute → if < 2, party table available
→ Count bookings with dedicated_host custom attribute → if < 2, dedicated host available
```

## Deposit → Gift Card Flow

1. Collect payment via Square Payments API (Web Payments SDK)
2. Call Gift Cards API → `CreateGiftCard`
3. Call Gift Card Activities API → `ActivateGiftCard` with deposit amount
4. Call Gift Cards API → `LinkCustomerToGiftCard` with customer_id
5. Gift card balance appears on customer profile in Square POS
6. Cashier looks up customer by name/phone → applies gift card at checkout

## Open Studio Hours Management

All managed in Square dashboard (not in code):
- **Location business hours:** 4pm–9pm (full window, avoids class conflict warnings)
- **Resource availability (Table 1–6):** Set per-table hours to end at 6pm on Fri/Sat/Sun (1hr cleanup buffer before 7pm workshops). Thursday tables available until 9pm.
- **Booking window:** Set in Square — up to 3 months in advance
- **Cancellation policy:** Set in Square — 24h for tables, 48h for add-ons
- **Blocked dates:** Managed via Square dashboard (holidays, closures)
- **Service durations:** 1hr and 2hr variants on "Table Reservation" service

## What the Site Needs (UI Changes)

### New/Modified Pages:
1. **Reservation page** — date picker, time slot selection, table count, party add-on toggle, checkout
2. **Walk-in info section** — "Walk-Ins Welcome" with Open Studio hours, no booking button
3. **Workshops page** — unchanged (already working)

### Removed:
- Old party booking flow (BookingModal, PartyWizard, EventTypeStep, etc.)
- Old party types (kids, adult, corporate sub-types)
- Programs section (TBD — keeping or removing?)

## Resolved Questions

1. **Cancellation:** 24h for tables (full refund), 48h for party add-on (full refund), after cutoff → store credit (gift card stays active)
2. **Booking window:** Up to 3 months in advance, closes at midnight the night before
3. **Close times:** Open Studio ends at 6pm on workshop nights (Fri/Sat/Sun) with 1hr cleanup buffer before 7pm workshops. Thursday runs until 9pm (no workshop).
4. **Programs:** Still active — booked via Square Classes API (same as workshops). Enrollment modal collects child/parent info.
5. **Confirmations:** Email + SMS, both handled by Square automatically
6. **Workshop overlap:** Prevented by setting Open Studio end time to 6pm on Fri/Sat/Sun. Last possible 2hr booking starts at 4pm, last 1hr at 5pm.

## Architecture Decisions (learned during implementation)

1. **No resources, no Premium** — Square allows unlimited concurrent bookings on one team member. All bookings go against Kaden. Our code counts overlapping bookings and caps at 6. Tested and confirmed via API.
2. **Modifiers via Orders API** — Bookings API doesn't support modifiers. Party table ($50) and dedicated host ($100) are line items on the payment order, stored as custom attributes on the booking.
3. **Pricing in Square, not code** — All pricing (table deposit, add-ons, whole studio) set in Square dashboard. Code fetches at runtime.
4. **Hours in Square, not code** — Business hours, booking windows, cancellation policy all configured in Square. Code only stores what Square can't: add-on caps and craft credit rules.
5. **Party add-on split** — Originally one $150 "party add-on." Now two independent add-ons: Party Table ($50) and Dedicated Host ($100). Customer can book either or both.

## Cost

- Square Appointments Free plan: $0/month
- Square payment processing: 2.6% + 10¢ per in-person, 2.9% + 30¢ per online transaction
- Everything else: $0 (existing infrastructure)
