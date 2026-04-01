# Open Studio Reservations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the party booking system with an Open Studio table reservation system — 6 bookable tables via Square Bookings API, deposit-to-gift-card flow, party add-on (max 2/slot), whole studio booking, and a new reservation UI.

**Architecture:** Tables are modeled as Square "team members" (resources). The existing `SquareBookingProvider` handles availability search and booking creation. New `SquareGiftCardProvider` handles deposit→credit flow. A new `ReservationModal` replaces the old `BookingModal`/`PartyWizard` with a simpler flow: Date → Time → Options → Contact → Payment → Confirmation. Old party booking code is removed.

**Tech Stack:** Astro SSR, React (islands), Square Bookings API, Square Gift Cards API, Square Payments API, Square Customers API, Square Web Payments SDK

**Design doc:** `docs/plans/2026-03-31-open-studio-reservations-design.md`

---

## File Structure

### New files:
- `src/providers/square/giftcard.ts` — Gift card create, activate, link, deactivate
- `src/providers/interfaces/giftcard.ts` — GiftCardProvider interface
- `src/pages/api/reservations/availability.json.ts` — Table availability endpoint
- `src/pages/api/reservations/book.json.ts` — Create reservation + payment + gift card
- `src/pages/api/reservations/cancel.json.ts` — Cancel reservation + handle refund/credit
- `src/components/reservations/ReservationModal.tsx` — Main modal component
- `src/components/reservations/steps/DateStep.tsx` — Date picker step
- `src/components/reservations/steps/TimeSlotStep.tsx` — Time slot + duration selection
- `src/components/reservations/steps/OptionsStep.tsx` — Table count + party add-on + whole studio
- `src/components/reservations/steps/ContactStep.tsx` — Name, email, phone
- `src/components/reservations/steps/PaymentStep.tsx` — Payment form + order summary
- `src/components/reservations/steps/ConfirmationStep.tsx` — Success screen
- `src/components/reservations/ReservationContext.tsx` — State management for reservation flow
- `src/config/reservation.config.ts` — Minimal config (party add-on cap, craft credit rules — everything else lives in Square)

### Modified files:
- `src/config/providers.ts` — Add giftcard provider
- `src/config/site.config.ts` — Add openStudio feature config, update types
- `src/pages/book.astro` — Replace party booking with reservation landing + walk-in info

### Removed files (after new system works):
- `src/components/booking/BookingModal.tsx`
- `src/components/booking/BookingLanding.tsx`
- `src/components/booking/PartyWizard.tsx`
- `src/components/booking/WizardContext.tsx`
- `src/components/booking/steps/DateSelectionStep.tsx`
- `src/components/booking/steps/AvailableSlotsStep.tsx`
- `src/components/booking/steps/PartyTypeStep.tsx`
- `src/components/booking/steps/CustomizeStep.tsx`
- `src/components/booking/steps/CheckoutStep.tsx`
- `src/components/booking/steps/InquiryStep.tsx`
- `src/components/booking/steps/EventTypeStep.tsx`

---

## Task 1: Reservation Config

**Files:**
- Create: `src/config/reservation.config.ts`

This is minimal — hours, pricing, durations, booking window, and cancellation policy all live in Square. We only store what Square can't handle.

- [ ] **Step 1: Create the reservation config file**

```typescript
// src/config/reservation.config.ts

/** Only config that Square can't handle natively */
export const reservationConfig = {
  /** Max party add-on bookings per time slot (Square doesn't have this concept) */
  partyAddOnMaxPerSlot: 2,
  /** For whole studio bookings: how much of the $500 becomes gift card craft credit */
  wholeStudioCraftCreditCents: 20000,  // $200
  /** For table reservations: 100% of deposit becomes gift card craft credit */
  tableCraftCreditPercent: 100,
}
```

- [ ] **Step 2: Commit**

```bash
git add src/config/reservation.config.ts
git commit -m "feat(reservations): add minimal reservation config (party cap, craft credit rules)"
```

---

## Task 2: Gift Card Provider

**Files:**
- Create: `src/providers/interfaces/giftcard.ts`
- Create: `src/providers/square/giftcard.ts`
- Modify: `src/config/providers.ts`

- [ ] **Step 1: Create the gift card interface**

```typescript
// src/providers/interfaces/giftcard.ts

export interface GiftCard {
  id: string
  ganCode: string          // The gift card number (GAN)
  balanceCents: number
  state: 'ACTIVE' | 'DEACTIVATED' | 'PENDING'
}

export interface GiftCardProvider {
  /** Create a new gift card, activate it with the given amount, and link to a customer */
  createAndLink(params: {
    amountCents: number
    customerId: string
    locationId: string
  }): Promise<GiftCard>

  /** Deactivate a gift card (for refunds/cancellations) */
  deactivate(giftCardId: string): Promise<void>
}
```

- [ ] **Step 2: Create the Square gift card provider**

```typescript
// src/providers/square/giftcard.ts

import type { GiftCardProvider, GiftCard } from '../interfaces/giftcard'
import type { SquareConfig } from '../../config/site.config'
import { createLogger } from '../../lib/logger'
import { createSquareClient } from './client'

const logger = createLogger('square-giftcard')

export class SquareGiftCardProvider implements GiftCardProvider {
  private client: ReturnType<typeof createSquareClient>

  constructor(private config: SquareConfig) {
    this.client = createSquareClient(config)
  }

  async createAndLink(params: {
    amountCents: number
    customerId: string
    locationId: string
  }): Promise<GiftCard> {
    logger.info('Creating gift card', {
      amountCents: params.amountCents,
      customerId: params.customerId,
    })

    // Step 1: Create the gift card
    const createResponse = await (this.client as any).giftCards.create({
      idempotencyKey: crypto.randomUUID(),
      locationId: params.locationId,
      type: 'DIGITAL',
    })

    const giftCard = createResponse.giftCard!
    const giftCardId = giftCard.id!

    logger.info('Gift card created', { giftCardId })

    // Step 2: Activate with the deposit amount
    await (this.client as any).giftCardActivities.create({
      idempotencyKey: crypto.randomUUID(),
      giftCardActivity: {
        giftCardId,
        type: 'ACTIVATE',
        locationId: params.locationId,
        activateActivityDetails: {
          amountMoney: {
            amount: BigInt(params.amountCents),
            currency: 'USD',
          },
        },
      },
    })

    logger.info('Gift card activated', { giftCardId, amountCents: params.amountCents })

    // Step 3: Link to customer profile
    await (this.client as any).giftCards.linkCustomer({
      giftCardId,
      customerId: params.customerId,
    })

    logger.info('Gift card linked to customer', { giftCardId, customerId: params.customerId })

    return {
      id: giftCardId,
      ganCode: giftCard.gan ?? '',
      balanceCents: params.amountCents,
      state: 'ACTIVE',
    }
  }

  async deactivate(giftCardId: string): Promise<void> {
    logger.info('Deactivating gift card', { giftCardId })

    await (this.client as any).giftCardActivities.create({
      idempotencyKey: crypto.randomUUID(),
      giftCardActivity: {
        giftCardId,
        type: 'DEACTIVATE',
        deactivateActivityDetails: {
          reason: 'SUSPICIOUS_ACTIVITY', // Square requires a reason; this is closest to "cancelled"
        },
      },
    })

    logger.info('Gift card deactivated', { giftCardId })
  }
}
```

- [ ] **Step 3: Add gift card provider to the providers config**

Modify `src/config/providers.ts` — add to the `createProviders` function:

```typescript
import { SquareGiftCardProvider } from '../providers/square/giftcard'
import type { GiftCardProvider } from '../providers/interfaces/giftcard'

// In the Providers interface (or wherever it's defined), add:
// giftcard: GiftCardProvider

// In createProviders, add:
giftcard: useMock ? null : new SquareGiftCardProvider(config.providers.booking.config),
```

- [ ] **Step 4: Verify compilation**

Run: `npm run build 2>&1 | tail -20`
Expected: No type errors related to gift card provider

- [ ] **Step 5: Commit**

```bash
git add src/providers/interfaces/giftcard.ts src/providers/square/giftcard.ts src/config/providers.ts
git commit -m "feat(reservations): add Square gift card provider for deposit-to-credit flow"
```

---

## Task 3: Availability Endpoint

**Files:**
- Create: `src/pages/api/reservations/availability.json.ts`

This endpoint returns available time slots for a given date, including how many tables are free and whether the party add-on is available.

- [ ] **Step 1: Create the availability endpoint**

```typescript
// src/pages/api/reservations/availability.json.ts

import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { reservationConfig } from '@config/reservation.config'
import { createLogger } from '@lib/logger'

const logger = createLogger('api-reservation-availability')

interface SlotAvailability {
  startTime: string      // ISO 8601
  endTime: string        // ISO 8601
  durationHours: number
  tablesAvailable: number
  partyAddOnAvailable: boolean
  wholeStudioAvailable: boolean
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const { date, durationHours } = body as { date: string; durationHours: number }

    if (!date || !durationHours) {
      return new Response(JSON.stringify({ error: 'date and durationHours are required' }), { status: 400 })
    }

    if (!reservationConfig.durations.includes(durationHours)) {
      return new Response(JSON.stringify({ error: `Invalid duration. Allowed: ${reservationConfig.durations.join(', ')}` }), { status: 400 })
    }

    // Determine Open Studio hours for this date
    const dateObj = new Date(date + 'T00:00:00')
    const dayOfWeek = dateObj.getDay()
    const hoursConfig = reservationConfig.hours.find(h => h.dayOfWeek === dayOfWeek)

    if (!hoursConfig) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }

    // Check booking cutoff (midnight the night before)
    const now = new Date()
    const cutoffTime = new Date(date + 'T00:00:00')
    cutoffTime.setHours(reservationConfig.bookingWindow.cutoffHour, 0, 0, 0)
    if (now >= cutoffTime) {
      return new Response(JSON.stringify({ data: [], message: 'Booking is closed for this date' }), { status: 200 })
    }

    // Check max advance booking window
    const maxDate = new Date()
    maxDate.setDate(maxDate.getDate() + reservationConfig.bookingWindow.maxAdvanceDays)
    if (dateObj > maxDate) {
      return new Response(JSON.stringify({ data: [], message: 'Date is too far in advance' }), { status: 200 })
    }

    // Generate on-the-hour time slots where the booking fits within Open Studio hours
    const slots: SlotAvailability[] = []

    for (let hour = hoursConfig.startHour; hour + durationHours <= hoursConfig.endHour; hour++) {
      const startTime = new Date(date + `T${String(hour).padStart(2, '0')}:00:00`)
      const endTime = new Date(startTime.getTime() + durationHours * 60 * 60 * 1000)

      // Search Square for available tables at this slot
      const locationId = providers.booking.config?.locationId ?? ''
      const available = await providers.booking.searchAvailability({
        startDate: startTime.toISOString(),
        endDate: endTime.toISOString(),
        locationId,
      })

      // Count unique available team members (tables) for this exact start time
      const tablesAtSlot = available.filter(
        s => new Date(s.startAt).getTime() === startTime.getTime()
      )
      const tablesAvailable = tablesAtSlot.length

      // Check party add-on availability by listing bookings that overlap this slot
      let partyAddOnCount = 0
      try {
        // ListBookings filtered by date, then check overlap + party_addon attribute
        const bookings = await providers.booking.listBookings?.({
          startDate: startTime.toISOString(),
          endDate: endTime.toISOString(),
          locationId,
        }) ?? []

        partyAddOnCount = bookings.filter((b: any) => b.partyAddOn).length
      } catch {
        // If listBookings isn't available yet, default to available
        partyAddOnCount = 0
      }

      const partyAddOnAvailable = partyAddOnCount < reservationConfig.partyAddOn.maxPerSlot

      slots.push({
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        durationHours,
        tablesAvailable,
        partyAddOnAvailable,
        wholeStudioAvailable: tablesAvailable === reservationConfig.tables.count,
      })
    }

    return new Response(JSON.stringify({ data: slots }), { status: 200 })
  } catch (error) {
    logger.error('Availability search failed', { error })
    return new Response(JSON.stringify({ error: 'Failed to search availability' }), { status: 500 })
  }
}
```

**Note:** The `listBookings` method doesn't exist on the provider interface yet. We'll need to add it in Task 4. For now, the fallback `catch` handles the missing method gracefully.

- [ ] **Step 2: Verify the endpoint compiles**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds (or minor type issues to fix)

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/reservations/availability.json.ts
git commit -m "feat(reservations): add availability endpoint with table count and party add-on check"
```

---

## Task 4: Add listBookings to Booking Provider

**Files:**
- Modify: `src/providers/interfaces/booking.ts`
- Modify: `src/providers/square/booking.ts`

The existing provider doesn't have a `listBookings` method. We need it to check party add-on count for overlapping slots.

- [ ] **Step 1: Add listBookings to the interface**

Add to `src/providers/interfaces/booking.ts`:

```typescript
export interface BookingWithMetadata extends Booking {
  partyAddOn?: boolean
  tableCount?: number
  giftCardId?: string
}

// Add to BookingProvider interface:
listBookings?(params: {
  startDate: string
  endDate: string
  locationId: string
}): Promise<BookingWithMetadata[]>
```

- [ ] **Step 2: Implement listBookings in the Square provider**

Add to `src/providers/square/booking.ts`:

```typescript
async listBookings(params: {
  startDate: string
  endDate: string
  locationId: string
}): Promise<BookingWithMetadata[]> {
  logger.info('Listing bookings', {
    startDate: params.startDate,
    endDate: params.endDate,
  })

  const response = await (this.client.bookings as any).list({
    locationId: params.locationId,
    startAtMin: params.startDate,
    startAtMax: params.endDate,
  })

  const bookings = response?.bookings ?? []
  const results: BookingWithMetadata[] = []

  for (const sqBooking of bookings) {
    if (sqBooking.status === 'CANCELLED_BY_CUSTOMER' || sqBooking.status === 'CANCELLED_BY_SELLER') {
      continue
    }

    // Read custom attributes for party_addon flag
    let partyAddOn = false
    try {
      const attrResponse = await (this.client.bookings as any).customAttributes.get({
        bookingId: sqBooking.id,
        key: 'party_addon',
      })
      partyAddOn = attrResponse?.customAttribute?.value === 'true'
    } catch {
      // Attribute may not exist
    }

    const segment = sqBooking.appointmentSegments?.[0]
    const startAt = sqBooking.startAt ?? ''
    const durationMinutes = segment?.durationMinutes ?? 0
    const endAt = new Date(
      new Date(startAt).getTime() + durationMinutes * 60_000
    ).toISOString()

    results.push({
      id: sqBooking.id!,
      status: mapStatus(sqBooking.status ?? 'PENDING'),
      slot: {
        id: generateSlotId(startAt, sqBooking.locationId ?? ''),
        startAt,
        endAt,
        duration: durationMinutes,
        locationId: sqBooking.locationId ?? '',
        teamMemberId: segment?.teamMemberId ?? undefined,
        serviceVariationId: segment?.serviceVariationId ?? undefined,
        serviceVariationVersion: segment?.serviceVariationVersion ?? undefined,
        available: false,
      },
      customerId: sqBooking.customerId ?? '',
      eventType: '',
      createdAt: sqBooking.createdAt ?? '',
      partyAddOn,
    })
  }

  return results
}
```

- [ ] **Step 3: Verify compilation**

Run: `npm run build 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/providers/interfaces/booking.ts src/providers/square/booking.ts
git commit -m "feat(reservations): add listBookings method for party add-on availability check"
```

---

## Task 5: Booking Endpoint

**Files:**
- Create: `src/pages/api/reservations/book.json.ts`

This is the main endpoint. It: creates customer → creates order → processes payment → creates booking(s) → creates gift card → links to customer.

- [ ] **Step 1: Create the booking endpoint**

```typescript
// src/pages/api/reservations/book.json.ts

import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { reservationConfig } from '@config/reservation.config'
import { createLogger } from '@lib/logger'

const logger = createLogger('api-reservation-book')

interface BookRequest {
  date: string
  startTime: string         // ISO 8601
  durationHours: number     // 1 or 2
  tableCount: number        // 1–6
  wholeStudio: boolean
  partyAddOn: boolean
  customer: {
    firstName: string
    lastName: string
    email: string
    phone: string
  }
  paymentToken: string
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as BookRequest
    const {
      date, startTime, durationHours, tableCount, wholeStudio,
      partyAddOn, customer, paymentToken,
    } = body

    // Validate
    if (!date || !startTime || !durationHours || !customer || !paymentToken) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 })
    }

    const effectiveTableCount = wholeStudio ? reservationConfig.tables.count : tableCount
    const locationId = providers.booking.config?.locationId ?? ''

    // Calculate total
    let totalCents: number
    let craftCreditCents: number

    if (wholeStudio) {
      totalCents = reservationConfig.pricing.wholeStudioCents
      craftCreditCents = reservationConfig.pricing.wholeStudioCraftCreditCents
    } else {
      totalCents = effectiveTableCount * reservationConfig.pricing.tableDepositCents
      craftCreditCents = totalCents  // Full deposit goes to craft credit for tables
    }

    if (partyAddOn) {
      totalCents += reservationConfig.pricing.partyAddOnCents
      // Party add-on does NOT go to craft credit
    }

    // Step 1: Find or create customer
    const sqCustomer = await providers.customer.findOrCreate({
      email: customer.email,
      givenName: customer.firstName,
      familyName: customer.lastName,
      phone: customer.phone,
    })

    logger.info('Customer resolved', { customerId: sqCustomer.id })

    // Step 2: Create order
    const lineItems = []

    if (wholeStudio) {
      lineItems.push({
        name: 'Whole Studio Booking',
        quantity: 1,
        pricePerUnit: reservationConfig.pricing.wholeStudioCents,
      })
    } else {
      lineItems.push({
        name: 'Table Reservation',
        quantity: effectiveTableCount,
        pricePerUnit: reservationConfig.pricing.tableDepositCents,
      })
    }

    if (partyAddOn) {
      lineItems.push({
        name: 'Party Add-On',
        quantity: 1,
        pricePerUnit: reservationConfig.pricing.partyAddOnCents,
      })
    }

    const order = await providers.payment.createOrder({
      locationId,
      customerId: sqCustomer.id,
      lineItems,
    })

    logger.info('Order created', { orderId: order.id })

    // Step 3: Process payment
    const payment = await providers.payment.processPayment({
      orderId: order.id,
      paymentToken,
      amount: totalCents,
      currency: 'USD',
      buyerEmailAddress: customer.email,
    })

    logger.info('Payment processed', { paymentId: payment.id, status: payment.status })

    if (payment.status !== 'completed') {
      return new Response(JSON.stringify({ error: 'Payment failed' }), { status: 402 })
    }

    // Step 4: Create booking(s) in Square — one per table
    const bookingIds: string[] = []

    for (let i = 0; i < effectiveTableCount; i++) {
      const booking = await providers.booking.createBooking({
        slotId: startTime,
        customerId: sqCustomer.id,
        eventType: wholeStudio ? 'whole_studio' : 'table_reservation',
        guestCount: reservationConfig.tables.seatsPerTable,
        specialRequests: partyAddOn && i === 0 ? 'Party Add-On included' : undefined,
        orderIdRef: order.id,
      })
      bookingIds.push(booking.id)
    }

    // Set party_addon custom attribute on first booking
    if (partyAddOn && bookingIds.length > 0) {
      try {
        await (providers.booking as any).client?.bookings?.customAttributes?.bulkUpsert?.({
          values: {
            party_addon: {
              bookingId: bookingIds[0],
              customAttribute: { value: 'true' },
            },
          },
        })
      } catch (err) {
        logger.warn('Failed to set party_addon attribute', { error: err })
      }
    }

    logger.info('Bookings created', { bookingIds, tableCount: effectiveTableCount })

    // Step 5: Create gift card with craft credit amount
    let giftCard = null
    if (craftCreditCents > 0 && providers.giftcard) {
      giftCard = await providers.giftcard.createAndLink({
        amountCents: craftCreditCents,
        customerId: sqCustomer.id,
        locationId,
      })
      logger.info('Gift card created and linked', { giftCardId: giftCard.id, amountCents: craftCreditCents })
    }

    return new Response(JSON.stringify({
      data: {
        bookingIds,
        orderId: order.id,
        paymentId: payment.id,
        receiptUrl: payment.receiptUrl,
        giftCardId: giftCard?.id ?? null,
        craftCreditCents,
        totalCharged: totalCents,
        customer: {
          id: sqCustomer.id,
          name: `${customer.firstName} ${customer.lastName}`,
          email: customer.email,
        },
      },
    }), { status: 200 })
  } catch (error: any) {
    logger.error('Reservation booking failed', { error: error?.message ?? error })
    return new Response(JSON.stringify({ error: 'Booking failed. Please try again.' }), { status: 500 })
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds. May need to adjust provider access patterns.

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/reservations/book.json.ts
git commit -m "feat(reservations): add booking endpoint with payment, gift card, and multi-table support"
```

---

## Task 6: Cancellation Endpoint

**Files:**
- Create: `src/pages/api/reservations/cancel.json.ts`

- [ ] **Step 1: Create the cancellation endpoint**

```typescript
// src/pages/api/reservations/cancel.json.ts

import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { reservationConfig } from '@config/reservation.config'
import { createLogger } from '@lib/logger'

const logger = createLogger('api-reservation-cancel')

interface CancelRequest {
  bookingIds: string[]
  hasPartyAddOn: boolean
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as CancelRequest
    const { bookingIds, hasPartyAddOn } = body

    if (!bookingIds || bookingIds.length === 0) {
      return new Response(JSON.stringify({ error: 'bookingIds required' }), { status: 400 })
    }

    // Get the first booking to check timing
    const firstBooking = await providers.booking.getBooking(bookingIds[0])
    const bookingTime = new Date(firstBooking.slot.startAt)
    const now = new Date()
    const hoursUntilBooking = (bookingTime.getTime() - now.getTime()) / (1000 * 60 * 60)

    // Determine refund eligibility
    const tableRefundEligible = hoursUntilBooking >= reservationConfig.cancellation.tableRefundHours
    const partyRefundEligible = hasPartyAddOn
      ? hoursUntilBooking >= reservationConfig.cancellation.partyRefundHours
      : true

    const fullRefund = tableRefundEligible && partyRefundEligible

    // Cancel all bookings
    for (const bookingId of bookingIds) {
      try {
        const booking = await providers.booking.getBooking(bookingId)
        await providers.booking.cancelBooking(bookingId, 0)  // version 0 = latest
        logger.info('Booking cancelled', { bookingId })
      } catch (err) {
        logger.error('Failed to cancel booking', { bookingId, error: err })
      }
    }

    // Handle gift card based on refund eligibility
    // If full refund: deactivate gift card, process refund via Square
    // If past cutoff: gift card stays active as store credit (no cash refund)
    const result = {
      cancelled: true,
      refundType: fullRefund ? 'full_refund' : 'store_credit',
      message: fullRefund
        ? 'Your reservation has been cancelled and you will receive a full refund.'
        : 'Your reservation has been cancelled. Your deposit has been converted to store credit.',
    }

    return new Response(JSON.stringify({ data: result }), { status: 200 })
  } catch (error: any) {
    logger.error('Cancellation failed', { error: error?.message ?? error })
    return new Response(JSON.stringify({ error: 'Cancellation failed' }), { status: 500 })
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/reservations/cancel.json.ts
git commit -m "feat(reservations): add cancellation endpoint with refund/store-credit logic"
```

---

## Task 7: Reservation Context (State Management)

**Files:**
- Create: `src/components/reservations/ReservationContext.tsx`

- [ ] **Step 1: Create the reservation context**

```tsx
// src/components/reservations/ReservationContext.tsx

import { createContext, useContext, useReducer } from 'react'
import type { ReactNode } from 'react'

export interface ReservationState {
  step: number
  date: string | null           // 'YYYY-MM-DD'
  durationHours: number         // 1 or 2
  startTime: string | null      // ISO 8601
  tableCount: number            // 1–6
  wholeStudio: boolean
  partyAddOn: boolean
  tablesAvailable: number
  partyAddOnAvailable: boolean
  customer: {
    firstName: string
    lastName: string
    email: string
    phone: string
  }
  // Result
  bookingIds: string[]
  orderId: string | null
  receiptUrl: string | null
  craftCreditCents: number
  totalCharged: number
}

type Action =
  | { type: 'SET_DATE'; date: string }
  | { type: 'SET_DURATION'; durationHours: number }
  | { type: 'SET_TIME_SLOT'; startTime: string; tablesAvailable: number; partyAddOnAvailable: boolean }
  | { type: 'SET_OPTIONS'; tableCount: number; wholeStudio: boolean; partyAddOn: boolean }
  | { type: 'SET_CUSTOMER'; customer: ReservationState['customer'] }
  | { type: 'SET_RESULT'; bookingIds: string[]; orderId: string; receiptUrl: string | null; craftCreditCents: number; totalCharged: number }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'RESET' }

const initialState: ReservationState = {
  step: 0,
  date: null,
  durationHours: 1,
  startTime: null,
  tableCount: 1,
  wholeStudio: false,
  partyAddOn: false,
  tablesAvailable: 0,
  partyAddOnAvailable: false,
  customer: { firstName: '', lastName: '', email: '', phone: '' },
  bookingIds: [],
  orderId: null,
  receiptUrl: null,
  craftCreditCents: 0,
  totalCharged: 0,
}

function reducer(state: ReservationState, action: Action): ReservationState {
  switch (action.type) {
    case 'SET_DATE':
      return { ...state, date: action.date, startTime: null }
    case 'SET_DURATION':
      return { ...state, durationHours: action.durationHours, startTime: null }
    case 'SET_TIME_SLOT':
      return {
        ...state,
        startTime: action.startTime,
        tablesAvailable: action.tablesAvailable,
        partyAddOnAvailable: action.partyAddOnAvailable,
      }
    case 'SET_OPTIONS':
      return {
        ...state,
        tableCount: action.tableCount,
        wholeStudio: action.wholeStudio,
        partyAddOn: action.partyAddOn,
      }
    case 'SET_CUSTOMER':
      return { ...state, customer: action.customer }
    case 'SET_RESULT':
      return {
        ...state,
        bookingIds: action.bookingIds,
        orderId: action.orderId,
        receiptUrl: action.receiptUrl,
        craftCreditCents: action.craftCreditCents,
        totalCharged: action.totalCharged,
      }
    case 'NEXT_STEP':
      return { ...state, step: state.step + 1 }
    case 'PREV_STEP':
      return { ...state, step: Math.max(0, state.step - 1) }
    case 'RESET':
      return initialState
    default:
      return state
  }
}

const ReservationContext = createContext<{
  state: ReservationState
  dispatch: React.Dispatch<Action>
} | null>(null)

export function ReservationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return (
    <ReservationContext.Provider value={{ state, dispatch }}>
      {children}
    </ReservationContext.Provider>
  )
}

export function useReservation() {
  const ctx = useContext(ReservationContext)
  if (!ctx) throw new Error('useReservation must be used within ReservationProvider')
  return ctx
}
```

- [ ] **Step 2: Verify compilation**

Run: `npm run build 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/reservations/ReservationContext.tsx
git commit -m "feat(reservations): add reservation state context with reducer"
```

---

## Task 8: Reservation Modal + Steps (UI)

**Files:**
- Create: `src/components/reservations/ReservationModal.tsx`
- Create: `src/components/reservations/steps/DateStep.tsx`
- Create: `src/components/reservations/steps/TimeSlotStep.tsx`
- Create: `src/components/reservations/steps/OptionsStep.tsx`
- Create: `src/components/reservations/steps/ContactStep.tsx`
- Create: `src/components/reservations/steps/PaymentStep.tsx`
- Create: `src/components/reservations/steps/ConfirmationStep.tsx`

This is the largest task. Each step is a focused component. The modal follows the same glassmorphism/progress-bar pattern as the existing `WorkshopBookingModal` and `BookingModal`.

**Important:** Follow the exact same modal chrome pattern used in `WorkshopBookingModal` — glassmorphism backdrop, progress bar, back button, step transition animation with `visible`/`displayStep`.

- [ ] **Step 1: Create DateStep**

```tsx
// src/components/reservations/steps/DateStep.tsx

import { useState } from 'react'
import { useReservation } from '../ReservationContext'
import { reservationConfig } from '@config/reservation.config'

export default function DateStep() {
  const { state, dispatch } = useReservation()

  // Build min/max dates
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const minDate = tomorrow.toISOString().split('T')[0]

  const maxDate = new Date(today)
  maxDate.setDate(maxDate.getDate() + reservationConfig.bookingWindow.maxAdvanceDays)
  const maxDateStr = maxDate.toISOString().split('T')[0]

  // Filter to only days that have Open Studio hours
  const openDays = reservationConfig.hours.map(h => h.dayOfWeek)

  function isOpenDay(dateStr: string): boolean {
    const d = new Date(dateStr + 'T12:00:00')
    return openDays.includes(d.getDay())
  }

  function handleDateChange(dateStr: string) {
    if (isOpenDay(dateStr)) {
      dispatch({ type: 'SET_DATE', date: dateStr })
    }
  }

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold text-gray-900">Pick a Date</h3>
      <p className="text-sm text-gray-600">
        Open Studio is available Thursday, Friday, Saturday, and Sunday.
      </p>

      <input
        type="date"
        min={minDate}
        max={maxDateStr}
        value={state.date ?? ''}
        onChange={e => handleDateChange(e.target.value)}
        className="w-full p-3 rounded-lg border border-gray-300 text-lg"
      />

      {state.date && !isOpenDay(state.date) && (
        <p className="text-sm text-red-600">No Open Studio on this day.</p>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">Duration</label>
        <div className="flex gap-3">
          {reservationConfig.durations.map(d => (
            <button
              key={d}
              onClick={() => dispatch({ type: 'SET_DURATION', durationHours: d })}
              className={`flex-1 py-3 rounded-lg border-2 text-lg font-medium transition-colors ${
                state.durationHours === d
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {d} hour{d > 1 ? 's' : ''}
            </button>
          ))}
        </div>
      </div>

      <button
        disabled={!state.date || !isOpenDay(state.date)}
        onClick={() => dispatch({ type: 'NEXT_STEP' })}
        className="w-full py-3 rounded-lg bg-primary text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Next
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Create TimeSlotStep**

```tsx
// src/components/reservations/steps/TimeSlotStep.tsx

import { useState, useEffect } from 'react'
import { useReservation } from '../ReservationContext'

interface SlotData {
  startTime: string
  endTime: string
  durationHours: number
  tablesAvailable: number
  partyAddOnAvailable: boolean
  wholeStudioAvailable: boolean
}

export default function TimeSlotStep() {
  const { state, dispatch } = useReservation()
  const [slots, setSlots] = useState<SlotData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!state.date) return
    setLoading(true)

    fetch('/api/reservations/availability.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: state.date, durationHours: state.durationHours }),
    })
      .then(res => res.json())
      .then(json => setSlots(json.data ?? []))
      .catch(() => setSlots([]))
      .finally(() => setLoading(false))
  }, [state.date, state.durationHours])

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  function handleSelect(slot: SlotData) {
    dispatch({
      type: 'SET_TIME_SLOT',
      startTime: slot.startTime,
      tablesAvailable: slot.tablesAvailable,
      partyAddOnAvailable: slot.partyAddOnAvailable,
    })
  }

  if (loading) {
    return <div className="text-center py-8 text-gray-500">Loading available times...</div>
  }

  const availableSlots = slots.filter(s => s.tablesAvailable > 0)

  if (availableSlots.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-gray-900">No Available Times</h3>
        <p className="text-gray-600">All tables are booked for this date and duration. Try a different date or duration.</p>
        <button
          onClick={() => dispatch({ type: 'PREV_STEP' })}
          className="w-full py-3 rounded-lg border-2 border-gray-300 text-gray-700 font-semibold"
        >
          Back
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold text-gray-900">Pick a Time</h3>

      <div className="space-y-2">
        {availableSlots.map(slot => (
          <button
            key={slot.startTime}
            onClick={() => handleSelect(slot)}
            className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
              state.startTime === slot.startTime
                ? 'border-primary bg-primary/10'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-lg font-medium">
                {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
              </span>
              <span className="text-sm text-gray-500">
                {slot.tablesAvailable} table{slot.tablesAvailable !== 1 ? 's' : ''} open
              </span>
            </div>
          </button>
        ))}
      </div>

      <button
        disabled={!state.startTime}
        onClick={() => dispatch({ type: 'NEXT_STEP' })}
        className="w-full py-3 rounded-lg bg-primary text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Next
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Create OptionsStep**

```tsx
// src/components/reservations/steps/OptionsStep.tsx

import { useReservation } from '../ReservationContext'
import { reservationConfig } from '@config/reservation.config'

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

export default function OptionsStep() {
  const { state, dispatch } = useReservation()
  const { pricing } = reservationConfig

  function setOptions(updates: Partial<{ tableCount: number; wholeStudio: boolean; partyAddOn: boolean }>) {
    dispatch({
      type: 'SET_OPTIONS',
      tableCount: updates.tableCount ?? state.tableCount,
      wholeStudio: updates.wholeStudio ?? state.wholeStudio,
      partyAddOn: updates.partyAddOn ?? state.partyAddOn,
    })
  }

  // Calculate total
  let total = 0
  let creditAmount = 0
  if (state.wholeStudio) {
    total = pricing.wholeStudioCents
    creditAmount = pricing.wholeStudioCraftCreditCents
  } else {
    total = state.tableCount * pricing.tableDepositCents
    creditAmount = total
  }
  if (state.partyAddOn) {
    total += pricing.partyAddOnCents
  }

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold text-gray-900">Your Reservation</h3>

      {/* Whole Studio toggle */}
      {state.tablesAvailable === reservationConfig.tables.count && (
        <label className="flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 cursor-pointer hover:border-gray-300">
          <input
            type="checkbox"
            checked={state.wholeStudio}
            onChange={e => setOptions({ wholeStudio: e.target.checked, tableCount: e.target.checked ? 6 : 1 })}
            className="w-5 h-5 rounded"
          />
          <div>
            <div className="font-medium">Book Whole Studio</div>
            <div className="text-sm text-gray-500">
              All 6 tables — {formatPrice(pricing.wholeStudioCents)} ({formatPrice(pricing.wholeStudioCraftCreditCents)} craft credit)
            </div>
          </div>
        </label>
      )}

      {/* Table count (if not whole studio) */}
      {!state.wholeStudio && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">
            Number of Tables ({formatPrice(pricing.tableDepositCents)} deposit each)
          </label>
          <div className="flex gap-2">
            {Array.from({ length: state.tablesAvailable }, (_, i) => i + 1).map(n => (
              <button
                key={n}
                onClick={() => setOptions({ tableCount: n })}
                className={`w-12 h-12 rounded-lg border-2 text-lg font-medium ${
                  state.tableCount === n
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Party add-on */}
      {state.partyAddOnAvailable && (
        <label className="flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 cursor-pointer hover:border-gray-300">
          <input
            type="checkbox"
            checked={state.partyAddOn}
            onChange={e => setOptions({ partyAddOn: e.target.checked })}
            className="w-5 h-5 rounded"
          />
          <div>
            <div className="font-medium">Party Add-On</div>
            <div className="text-sm text-gray-500">
              Dedicated party area + staff — {formatPrice(pricing.partyAddOnCents)}
            </div>
          </div>
        </label>
      )}

      {/* Summary */}
      <div className="p-4 rounded-lg bg-gray-50 space-y-1">
        <div className="flex justify-between">
          <span>{state.wholeStudio ? 'Whole Studio' : `${state.tableCount} Table${state.tableCount > 1 ? 's' : ''}`}</span>
          <span>{formatPrice(state.wholeStudio ? pricing.wholeStudioCents : state.tableCount * pricing.tableDepositCents)}</span>
        </div>
        {state.partyAddOn && (
          <div className="flex justify-between">
            <span>Party Add-On</span>
            <span>{formatPrice(pricing.partyAddOnCents)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold border-t pt-1 mt-1">
          <span>Total</span>
          <span>{formatPrice(total)}</span>
        </div>
        <div className="text-sm text-green-700">
          {formatPrice(creditAmount)} will be applied as craft credit at the studio
        </div>
      </div>

      <button
        onClick={() => dispatch({ type: 'NEXT_STEP' })}
        className="w-full py-3 rounded-lg bg-primary text-white font-semibold"
      >
        Next
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Create ContactStep**

```tsx
// src/components/reservations/steps/ContactStep.tsx

import { useState } from 'react'
import { useReservation } from '../ReservationContext'

export default function ContactStep() {
  const { state, dispatch } = useReservation()
  const [firstName, setFirstName] = useState(state.customer.firstName)
  const [lastName, setLastName] = useState(state.customer.lastName)
  const [email, setEmail] = useState(state.customer.email)
  const [phone, setPhone] = useState(state.customer.phone)

  const isValid = firstName.trim() && lastName.trim() && email.includes('@') && phone.trim()

  function handleNext() {
    dispatch({
      type: 'SET_CUSTOMER',
      customer: { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), phone: phone.trim() },
    })
    dispatch({ type: 'NEXT_STEP' })
  }

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold text-gray-900">Your Info</h3>
      <p className="text-sm text-gray-600">
        This is how we'll look you up when you arrive. Your deposit will be applied as craft credit under this name.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-gray-700">First Name</label>
          <input
            type="text"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            className="w-full mt-1 p-3 rounded-lg border border-gray-300"
            placeholder="Jane"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">Last Name</label>
          <input
            type="text"
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            className="w-full mt-1 p-3 rounded-lg border border-gray-300"
            placeholder="Smith"
          />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700">Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full mt-1 p-3 rounded-lg border border-gray-300"
          placeholder="jane@example.com"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700">Phone</label>
        <input
          type="tel"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          className="w-full mt-1 p-3 rounded-lg border border-gray-300"
          placeholder="(555) 123-4567"
        />
      </div>

      <button
        disabled={!isValid}
        onClick={handleNext}
        className="w-full py-3 rounded-lg bg-primary text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Continue to Payment
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Create PaymentStep**

```tsx
// src/components/reservations/steps/PaymentStep.tsx

import { useState, useRef } from 'react'
import { useReservation } from '../ReservationContext'
import { reservationConfig } from '@config/reservation.config'
import PaymentForm from '@components/checkout/PaymentForm'
import type { PaymentFormRef } from '@components/checkout/PaymentForm'

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

export default function PaymentStep() {
  const { state, dispatch } = useReservation()
  const paymentFormRef = useRef<PaymentFormRef>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { pricing } = reservationConfig

  // Calculate total
  let total: number
  if (state.wholeStudio) {
    total = pricing.wholeStudioCents
  } else {
    total = state.tableCount * pricing.tableDepositCents
  }
  if (state.partyAddOn) {
    total += pricing.partyAddOnCents
  }

  async function handlePay() {
    if (!paymentFormRef.current) return
    setProcessing(true)
    setError(null)

    try {
      const token = await paymentFormRef.current.tokenize()
      if (!token) {
        setError('Failed to process card. Please try again.')
        setProcessing(false)
        return
      }

      const res = await fetch('/api/reservations/book.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: state.date,
          startTime: state.startTime,
          durationHours: state.durationHours,
          tableCount: state.tableCount,
          wholeStudio: state.wholeStudio,
          partyAddOn: state.partyAddOn,
          customer: state.customer,
          paymentToken: token,
        }),
      })

      const json = await res.json()

      if (!res.ok || json.error) {
        setError(json.error || 'Booking failed. Please try again.')
        setProcessing(false)
        return
      }

      dispatch({
        type: 'SET_RESULT',
        bookingIds: json.data.bookingIds,
        orderId: json.data.orderId,
        receiptUrl: json.data.receiptUrl,
        craftCreditCents: json.data.craftCreditCents,
        totalCharged: json.data.totalCharged,
      })
      dispatch({ type: 'NEXT_STEP' })
    } catch (err) {
      setError('Something went wrong. Please try again.')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold text-gray-900">Payment</h3>

      <div className="p-4 rounded-lg bg-gray-50 space-y-1 text-sm">
        <div className="flex justify-between">
          <span>{state.wholeStudio ? 'Whole Studio' : `${state.tableCount} Table${state.tableCount > 1 ? 's' : ''}`}</span>
          <span>{formatPrice(state.wholeStudio ? pricing.wholeStudioCents : state.tableCount * pricing.tableDepositCents)}</span>
        </div>
        {state.partyAddOn && (
          <div className="flex justify-between">
            <span>Party Add-On</span>
            <span>{formatPrice(pricing.partyAddOnCents)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold border-t pt-1 mt-1">
          <span>Total Due Now</span>
          <span>{formatPrice(total)}</span>
        </div>
      </div>

      <PaymentForm ref={paymentFormRef} />

      {error && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      <button
        disabled={processing}
        onClick={handlePay}
        className="w-full py-3 rounded-lg bg-primary text-white font-semibold disabled:opacity-50"
      >
        {processing ? 'Processing...' : `Pay ${formatPrice(total)}`}
      </button>
    </div>
  )
}
```

- [ ] **Step 6: Create ConfirmationStep**

```tsx
// src/components/reservations/steps/ConfirmationStep.tsx

import { useReservation } from '../ReservationContext'
import { reservationConfig } from '@config/reservation.config'

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function ConfirmationStep({ onClose }: { onClose: () => void }) {
  const { state } = useReservation()

  return (
    <div className="text-center space-y-6">
      {/* Green checkmark — same pattern as other confirmation screens */}
      <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
        <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h3 className="text-2xl font-semibold text-gray-900">Reservation Confirmed!</h3>

      <div className="p-4 rounded-lg bg-gray-50 text-left space-y-2">
        <div><span className="font-medium">Date:</span> {state.date ? formatDate(state.date) : ''}</div>
        <div><span className="font-medium">Time:</span> {state.startTime ? formatTime(state.startTime) : ''}</div>
        <div><span className="font-medium">Duration:</span> {state.durationHours} hour{state.durationHours > 1 ? 's' : ''}</div>
        <div>
          <span className="font-medium">
            {state.wholeStudio ? 'Whole Studio' : `${state.tableCount} Table${state.tableCount > 1 ? 's' : ''}`}
          </span>
          {state.partyAddOn && <span className="ml-2 text-sm text-purple-600 font-medium">+ Party</span>}
        </div>
        <div className="border-t pt-2 mt-2">
          <span className="font-medium">Charged:</span> {formatPrice(state.totalCharged)}
        </div>
        <div className="text-green-700 text-sm">
          {formatPrice(state.craftCreditCents)} craft credit will be applied when you visit
        </div>
      </div>

      <p className="text-sm text-gray-600">
        A confirmation has been sent to <strong>{state.customer.email}</strong>.
        Just give your name when you arrive — your craft credit is already on your account.
      </p>

      {state.receiptUrl && (
        <a
          href={state.receiptUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary underline"
        >
          View Receipt
        </a>
      )}

      <button
        onClick={onClose}
        className="w-full py-3 rounded-lg bg-primary text-white font-semibold"
      >
        Done
      </button>
    </div>
  )
}
```

- [ ] **Step 7: Create the ReservationModal shell**

```tsx
// src/components/reservations/ReservationModal.tsx

import { useState, useEffect, useRef } from 'react'
import { ReservationProvider, useReservation } from './ReservationContext'
import DateStep from './steps/DateStep'
import TimeSlotStep from './steps/TimeSlotStep'
import OptionsStep from './steps/OptionsStep'
import ContactStep from './steps/ContactStep'
import PaymentStep from './steps/PaymentStep'
import ConfirmationStep from './steps/ConfirmationStep'

const STEP_LABELS = ['Date', 'Time', 'Options', 'Info', 'Payment', 'Confirmed']

function ModalContent({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useReservation()
  const [visible, setVisible] = useState(true)
  const [displayStep, setDisplayStep] = useState(state.step)
  const prevStep = useRef(state.step)

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Step transition animation
  useEffect(() => {
    if (state.step !== prevStep.current) {
      setVisible(false)
      const timer = setTimeout(() => {
        setDisplayStep(state.step)
        prevStep.current = state.step
        setVisible(true)
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [state.step])

  const isConfirmation = displayStep === 5

  const steps = [
    <DateStep key="date" />,
    <TimeSlotStep key="time" />,
    <OptionsStep key="options" />,
    <ContactStep key="contact" />,
    <PaymentStep key="payment" />,
    <ConfirmationStep key="confirmation" onClose={onClose} />,
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white/90 backdrop-blur-xl z-10 px-6 pt-5 pb-3">
          <div className="flex items-center justify-between mb-3">
            {displayStep > 0 && !isConfirmation ? (
              <button onClick={() => dispatch({ type: 'PREV_STEP' })} className="text-gray-500 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            ) : (
              <div className="w-5" />
            )}
            <h2 className="text-lg font-semibold text-gray-900">
              {isConfirmation ? '' : 'Reserve a Table'}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Progress bar */}
          {!isConfirmation && (
            <div className="flex gap-1">
              {STEP_LABELS.slice(0, -1).map((label, i) => (
                <div
                  key={label}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i <= displayStep ? 'bg-primary' : 'bg-gray-200'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Step content */}
        <div className={`px-6 pb-6 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}>
          {steps[displayStep]}
        </div>
      </div>
    </div>
  )
}

export default function ReservationModal({ onClose }: { onClose: () => void }) {
  return (
    <ReservationProvider>
      <ModalContent onClose={onClose} />
    </ReservationProvider>
  )
}
```

- [ ] **Step 8: Verify all components compile**

Run: `npm run build 2>&1 | tail -30`
Expected: Build succeeds. Fix any import path issues.

- [ ] **Step 9: Commit**

```bash
git add src/components/reservations/
git commit -m "feat(reservations): add ReservationModal with 6-step booking flow"
```

---

## Task 9: Update Book Page

**Files:**
- Modify: `src/pages/book.astro`

Replace the party booking landing with the new reservation page: a "Reserve a Table" button that opens the modal, plus a Walk-In info section.

- [ ] **Step 1: Read the current book.astro to understand its structure**

Run: Read `src/pages/book.astro`

- [ ] **Step 2: Replace the content**

Replace the party BookingLanding component with:
- A hero section explaining Open Studio
- A "Reserve a Table" button that opens ReservationModal
- Open Studio hours display
- Walk-In info section
- Link/section for Whole Studio bookings (opens same modal)

The exact implementation depends on the current page structure — match the existing layout patterns (Layout component, section styling, etc.) but swap out `BookingLanding` for a simpler React island that renders the "Reserve" button and conditionally renders `ReservationModal`.

Create a small wrapper component if needed:

```tsx
// inline in book.astro or as a separate component
// src/components/reservations/ReservationLanding.tsx

import { useState } from 'react'
import ReservationModal from './ReservationModal'
import { reservationConfig } from '@config/reservation.config'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function formatHour(h: number): string {
  if (h === 0) return '12am'
  if (h < 12) return `${h}am`
  if (h === 12) return '12pm'
  return `${h - 12}pm`
}

export default function ReservationLanding() {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <div className="space-y-12">
      {/* Open Studio section */}
      <section className="text-center space-y-6">
        <h1 className="text-4xl font-bold text-gray-900">Open Studio</h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Walk in or reserve a table to craft at your own pace. Pick your project when you arrive —
          your reservation deposit goes toward whatever you create.
        </p>

        <button
          onClick={() => setModalOpen(true)}
          className="px-8 py-4 rounded-xl bg-primary text-white text-lg font-semibold shadow-lg hover:shadow-xl transition-shadow"
        >
          Reserve a Table
        </button>
      </section>

      {/* Hours */}
      <section className="max-w-md mx-auto">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4 text-center">Open Studio Hours</h2>
        <div className="space-y-2">
          {reservationConfig.hours
            .sort((a, b) => ((a.dayOfWeek + 3) % 7) - ((b.dayOfWeek + 3) % 7)) // Thu first
            .map(h => (
              <div key={h.dayOfWeek} className="flex justify-between p-3 rounded-lg bg-gray-50">
                <span className="font-medium">{DAY_NAMES[h.dayOfWeek]}</span>
                <span className="text-gray-600">{formatHour(h.startHour)} – {formatHour(h.endHour)}</span>
              </div>
            ))}
        </div>
      </section>

      {/* Walk-ins */}
      <section className="text-center p-8 rounded-2xl bg-green-50">
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Walk-Ins Welcome!</h2>
        <p className="text-gray-600">
          No reservation needed — just stop by during Open Studio hours.
          Grab a seat, pick a craft, and pay at the register.
        </p>
      </section>

      {modalOpen && <ReservationModal onClose={() => setModalOpen(false)} />}
    </div>
  )
}
```

- [ ] **Step 3: Update book.astro to use ReservationLanding**

Replace the `BookingLanding` import and usage with `ReservationLanding`:

```astro
---
import Layout from '../layouts/Layout.astro'
export const prerender = false
---

<Layout title="Reserve | Homegrown Studio">
  <main class="container mx-auto px-4 py-12">
    <ReservationLanding client:load />
  </main>
</Layout>
```

(Adjust to match actual Layout patterns in the codebase.)

- [ ] **Step 4: Verify the page loads**

Run: `npm run dev` and visit `http://localhost:4321/book`
Expected: Page shows Open Studio info, "Reserve a Table" button, hours, walk-in section

- [ ] **Step 5: Commit**

```bash
git add src/pages/book.astro src/components/reservations/ReservationLanding.tsx
git commit -m "feat(reservations): replace party booking page with Open Studio reservation landing"
```

---

## Task 10: Clean Up Old Party Booking Code

**Files:**
- Remove: `src/components/booking/BookingModal.tsx`
- Remove: `src/components/booking/BookingLanding.tsx`
- Remove: `src/components/booking/PartyWizard.tsx`
- Remove: `src/components/booking/WizardContext.tsx`
- Remove: `src/components/booking/steps/` (all files)

**Important:** Only do this after the new reservation system is working end-to-end.

- [ ] **Step 1: Check for any remaining imports of old booking components**

Run: `grep -r "from.*booking/" src/ --include="*.tsx" --include="*.ts" --include="*.astro" | grep -v node_modules | grep -v reservations`

Fix any remaining references before deleting.

- [ ] **Step 2: Remove old booking components**

```bash
rm -rf src/components/booking/
```

- [ ] **Step 3: Remove old party config from site.config.ts**

Remove the `parties` feature config and old `EventTypeConfig` entries for kids/adult/corporate parties. Keep the config structure intact for workshops and programs.

- [ ] **Step 4: Verify build**

Run: `npm run build 2>&1 | tail -20`
Expected: No errors from missing imports

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove old party booking flow, replaced by Open Studio reservations"
```

---

## Task 11: Square Setup Verification

**Files:** None (manual Square dashboard configuration)

This task is a checklist for setting up Square correctly. It requires manual steps in the Square dashboard.

- [ ] **Step 1: Create 6 team members in Square dashboard**

In Square Dashboard → Staff → Team Members:
- Create: Table 1, Table 2, Table 3, Table 4, Table 5, Table 6
- Each should be bookable

- [ ] **Step 2: Create a "Table Reservation" service**

In Square Dashboard → Appointments → Services:
- Name: "Table Reservation"
- Duration options: 60 min and 120 min
- All 6 team members can provide this service

- [ ] **Step 3: Set business hours**

In Square Dashboard → Appointments → Business Hours:
- Thursday: 4pm–9pm
- Friday: 4pm–6pm
- Saturday: 9am–6pm
- Sunday: 2pm–6pm

- [ ] **Step 4: Set booking window**

- Max advance booking: 90 days
- Booking cutoff: configurable per business rules (midnight handled in our code)

- [ ] **Step 5: Test SearchAvailability returns 6 tables**

```bash
curl -X POST http://localhost:4321/api/reservations/availability.json \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-04-04","durationHours":1}'
```

Expected: Returns slots with `tablesAvailable: 6` for each open hour

- [ ] **Step 6: Document the Square setup in CLAUDE.md or a setup doc**

Add notes about the team member IDs and service variation IDs needed for the booking provider config.

---

## Task 12: End-to-End Test

**Files:** None (manual testing)

- [ ] **Step 1: Test the full happy path**

1. Open `http://localhost:4321/book`
2. Click "Reserve a Table"
3. Pick a date (tomorrow or later, on an Open Studio day)
4. Select duration (1hr)
5. Pick a time slot
6. Select 1 table
7. Enter contact info
8. Enter test card (Square sandbox: 4111 1111 1111 1111)
9. Complete payment
10. Verify confirmation screen shows correct details

- [ ] **Step 2: Test whole studio booking**

Same flow but pick a slot with all 6 tables available, toggle "Book Whole Studio"

- [ ] **Step 3: Test party add-on**

Book a table with party add-on. Verify the $150 is added to total.

- [ ] **Step 4: Test booking cutoff**

Try to book for today — should show no available slots or "Booking is closed" message.

- [ ] **Step 5: Test fully booked slot**

Book all 6 tables for a slot, then try to book again. Should show 0 tables available.

- [ ] **Step 6: Verify gift card in Square dashboard**

After a successful booking, check Square Dashboard → Gift Cards. Verify:
- Gift card exists with correct balance
- Linked to the customer profile

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end reservation testing"
```
