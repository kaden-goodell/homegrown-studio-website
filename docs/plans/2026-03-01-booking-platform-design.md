# Booking Platform Design — Homegrown Craft Studio

**Date:** 2026-03-01
**Status:** Approved
**First deployment:** Homegrown Craft Studio (homegrowncraftstudio.com)
**Goal:** Configurable, white-label booking platform for experience-based businesses

---

## 1. Architecture

**Framework:** Astro 5 + React 19 islands, deployed on Netlify (SSR via serverless functions)

**Rendering strategy:**

| Page | Rendering | Reason |
|------|-----------|--------|
| Home, About, Gallery | Static (prerendered) | No dynamic data, fastest possible |
| Workshops, Party Builder, Checkout | SSR (on request) | Real-time availability/pricing |
| All provider API calls | API routes (serverless) | Frontend never talks to Square directly |

**Project structure:**

```
src/
  config/              # Site config, feature flags, theme, coupons
    site.config.ts     # Main configuration file
    coupons.json       # Coupon code definitions
    providers.ts       # Provider wiring/instantiation
  providers/           # Abstraction interfaces + implementations
    interfaces/        #   BookingProvider, PaymentProvider, etc.
      booking.ts
      payment.ts
      catalog.ts
      capacity.ts
      customer.ts
      notification.ts
    square/            #   Square implementation
      booking.ts
      payment.ts
      catalog.ts
      capacity.ts       # Internal API for seat counts
      customer.ts
    mock/              #   Mock implementation for development
      booking.ts
      payment.ts
      catalog.ts
      capacity.ts
      customer.ts
    slack/
      notification.ts
  components/          # React islands
    booking/           #   Party builder wizard
      PartyWizard.tsx
      steps/
        EventTypeStep.tsx
        DateSelectionStep.tsx
        AvailableSlotsStep.tsx
        CustomizeStep.tsx
        CheckoutStep.tsx
        InquiryStep.tsx
      WizardContext.tsx  # useReducer state management
    workshops/         #   Workshop browsing
      WorkshopExplorer.tsx
      CalendarView.tsx
      SearchView.tsx
      WorkshopCard.tsx
    checkout/          #   Payment components
      OrderSummary.tsx
      CouponInput.tsx
      PaymentForm.tsx   # Square Web Payments SDK iframe wrapper
    shared/            #   Reusable components
      Newsletter.tsx
      DateRangePicker.tsx
      Shimmer.tsx       # Subtle particle/shimmer background effect
  layouts/
    Layout.astro       # Base layout with theme variables, textures, analytics
    StaticLayout.astro # Optimized for prerendered pages
  pages/
    index.astro        # Home
    about.astro        # About
    gallery.astro      # Gallery (conditional on config.features.gallery)
    workshops.astro    # Workshops page
    book.astro         # Party builder wizard
    api/               # API routes (see Section 5)
  content/             # Astro content collections
    about/             # About page content (markdown)
    gallery/           # Gallery images + captions
  lib/
    logger.ts          # Structured logging
    types.ts           # Shared TypeScript types
    errors.ts          # Typed error classes
    utils.ts           # Shared utilities
  styles/
    global.css         # ONE color system, theme variables, textures
    textures.css       # Linen, paper, clean background patterns
    animations.css     # Shimmer, fade-in, hover effects
public/
  fonts/
  images/
  favicon.svg
```

**Key architectural decisions:**
- Interactive features are React components with proper state management — no vanilla JS in Astro pages
- Static pages stay as pure Astro (zero JS shipped)
- All provider calls proxied through API routes for logging, error handling, provider swappability
- Mock providers enable full development without Square connection

---

## 2. Provider Abstraction Layer

Every external service goes through an interface. Square is the first implementation. Adding a new provider means writing a class that implements the interface and changing one line in config.

### BookingProvider

```ts
// src/providers/interfaces/booking.ts
export interface TimeSlot {
  id: string
  startAt: string              // ISO 8601
  endAt: string                // ISO 8601
  duration: number             // minutes
  locationId: string
  teamMemberId?: string
  serviceVariationId?: string
  serviceVariationVersion?: bigint
  available: boolean
}

export interface BookingDetails {
  slotId: string
  customerId: string
  eventType: string
  guestCount?: number
  addOns?: string[]            // add-on catalog IDs
  specialRequests?: string
  orderIdRef?: string          // links to payment order
}

export interface Booking {
  id: string
  status: 'pending' | 'confirmed' | 'cancelled'
  slot: TimeSlot
  customerId: string
  eventType: string
  createdAt: string
}

export interface BookingProvider {
  searchAvailability(params: {
    startDate: string          // ISO 8601 date
    endDate: string            // ISO 8601 date
    locationId: string
    serviceVariationId?: string
    teamMemberId?: string
  }): Promise<TimeSlot[]>

  createBooking(details: BookingDetails): Promise<Booking>

  cancelBooking(bookingId: string, bookingVersion: number): Promise<void>

  getBooking(bookingId: string): Promise<Booking>
}
```

### PaymentProvider

```ts
// src/providers/interfaces/payment.ts
export interface LineItem {
  catalogObjectId?: string     // from Square catalog, or null for ad-hoc
  name: string                 // human-readable name
  quantity: number
  pricePerUnit: number         // cents
}

export interface Discount {
  name: string
  type: 'percent' | 'fixed'
  value: number                // percentage (10 = 10%) or cents
  scope: 'order' | 'line_item'
  lineItemIndex?: number       // if scope is line_item
}

export interface Order {
  id: string
  lineItems: LineItem[]
  discounts: Discount[]
  totalAmount: number          // cents
  currency: string
  status: 'draft' | 'open' | 'completed' | 'cancelled'
}

export interface Payment {
  id: string
  orderId: string
  amount: number               // cents
  status: 'completed' | 'failed' | 'pending'
  receiptUrl?: string
}

export interface PaymentClientConfig {
  appId: string
  locationId: string
  environment: 'sandbox' | 'production'
}

export interface PaymentProvider {
  createOrder(params: {
    locationId: string
    customerId: string
    lineItems: LineItem[]
    discounts?: Discount[]
  }): Promise<Order>

  processPayment(params: {
    orderId: string
    paymentToken: string       // from Web Payments SDK tokenization
    amount: number             // cents
    currency: string
  }): Promise<Payment>

  getClientConfig(): PaymentClientConfig
}
```

### CatalogProvider

```ts
// src/providers/interfaces/catalog.ts
export interface EventType {
  id: string
  name: string
  description: string
  category: string             // "workshop", "birthday", "adult", "corporate"
  imageUrl?: string
  variations: EventVariation[]
  modifiers: AddOn[]           // available add-ons
  flow: 'booking' | 'quote'
  duration: number             // minutes
  baseCapacity?: number
}

export interface EventVariation {
  id: string
  name: string                 // "Standard Seat", "Base (up to 12 kids)", "Extra Child"
  priceAmount: number          // cents
  priceCurrency: string
}

export interface AddOn {
  id: string
  name: string                 // "Chocolate Fountain"
  priceAmount: number          // cents
  priceCurrency: string
}

export interface CatalogProvider {
  getEventTypes(params?: {
    category?: string
  }): Promise<EventType[]>

  getAddOns(eventTypeId: string): Promise<AddOn[]>

  getPricing(eventTypeId: string, variationId: string): Promise<EventVariation>
}
```

### CapacityProvider

```ts
// src/providers/interfaces/capacity.ts
export interface CapacityInfo {
  slotId: string
  totalCapacity: number
  availableCapacity: number    // remaining seats
}

export interface CapacityProvider {
  // Returns capacity info for given slot IDs
  // Returns null for slots where capacity is unknown
  // Returns 0 availableCapacity for full slots
  getAvailableCapacity(slotIds: string[]): Promise<Map<string, CapacityInfo | null>>
}
```

### CustomerProvider

```ts
// src/providers/interfaces/customer.ts
export interface Customer {
  id: string
  email: string
  givenName: string
  familyName: string
  phone?: string
}

export interface CustomerProvider {
  findOrCreate(params: {
    email: string
    givenName: string
    familyName: string
    phone?: string
  }): Promise<Customer>

  subscribe(email: string): Promise<void>  // newsletter signup
}
```

### NotificationProvider

```ts
// src/providers/interfaces/notification.ts
export type NotificationType =
  | 'corporate-inquiry'        // someone submitted a corporate event form
  | 'api-failure'              // an API call failed (especially internal)
  | 'payment-failure'          // payment processing failed
  | 'consecutive-failures'     // 3+ failures on same endpoint

export interface NotificationPayload {
  type: NotificationType
  title: string
  details: Record<string, any>
  severity: 'info' | 'warning' | 'critical'
  timestamp: string
}

export interface NotificationProvider {
  send(payload: NotificationPayload): Promise<void>
}
```

### Provider wiring

```ts
// src/config/providers.ts
import type { SiteConfig } from './site.config'
import { SquareBookingProvider } from '../providers/square/booking'
import { SquarePaymentProvider } from '../providers/square/payment'
import { SquareCatalogProvider } from '../providers/square/catalog'
import { SquareInternalCapacityProvider } from '../providers/square/capacity'
import { SquareCustomerProvider } from '../providers/square/customer'
import { SlackNotificationProvider } from '../providers/slack/notification'
import { MockBookingProvider } from '../providers/mock/booking'
// ... other mock imports

export function createProviders(config: SiteConfig) {
  const useMock = config.providers.booking.type === 'mock'

  return {
    booking: useMock
      ? new MockBookingProvider()
      : new SquareBookingProvider(config.providers.booking.config),
    payment: useMock
      ? new MockPaymentProvider()
      : new SquarePaymentProvider(config.providers.payment.config),
    catalog: useMock
      ? new MockCatalogProvider()
      : new SquareCatalogProvider(config.providers.catalog.config),
    capacity: config.providers.capacity.type === 'none'
      ? new NullCapacityProvider()
      : useMock
        ? new MockCapacityProvider()
        : new SquareInternalCapacityProvider(config.providers.capacity.config),
    customer: useMock
      ? new MockCustomerProvider()
      : new SquareCustomerProvider(config.providers.customer.config),
    notification: new SlackNotificationProvider(config.providers.notification.config),
  }
}
```

---

## 3. Config System

Everything about a deployment lives in one config file. Setting up a new site means editing this file + swapping assets.

```ts
// src/config/site.config.ts

export interface SiteConfig {
  // === Identity ===
  name: string                          // "Homegrown Craft Studio"
  tagline: string                       // "Create. Celebrate. Connect."
  logo: string                          // path to logo asset in public/
  contactEmail: string
  contactPhone: string
  address: {
    street: string
    city: string
    state: string
    zip: string
  }

  // === Theme ===
  theme: {
    colors: {
      primary: string                   // "#7c3aed"
      secondary: string
      accent: string
      background: string
      text: string
      muted: string                     // for subtle text, borders
    }
    fonts: {
      heading: string                   // Google Font name, e.g. "Playfair Display"
      body: string                      // e.g. "Inter"
    }
    borderRadius: 'none' | 'sm' | 'md' | 'lg' | 'full'
    textures: {
      background: 'linen' | 'paper' | 'clean' | 'none'
      cards: 'soft-shadow' | 'bordered' | 'flat'
    }
    animations: {
      particles: boolean                // subtle shimmer/sparkle
      fadeIn: boolean                   // scroll-triggered fade-ins
      hoverEffects: 'lift' | 'glow' | 'none'
    }
    style: 'organic' | 'minimal' | 'bold'
  }

  // === Features (toggles) ===
  features: {
    workshops: boolean
    parties: {
      enabled: boolean
      types: EventTypeConfig[]
    }
    newsletter: boolean
    coupons: boolean
    gallery: boolean
  }

  // === Event Types (configurable, not hardcoded) ===
  eventTypes: EventTypeConfig[]

  // === Provider Configuration ===
  providers: {
    booking: {
      type: 'square' | 'mock'
      config: SquareConfig | Record<string, never>
    }
    payment: {
      type: 'square' | 'mock'
      config: SquareConfig | Record<string, never>
    }
    catalog: {
      type: 'square' | 'mock'
      config: SquareConfig | Record<string, never>
    }
    capacity: {
      type: 'square-internal' | 'none'
      config?: SquareInternalConfig
    }
    customer: {
      type: 'square' | 'mock'
      config: SquareConfig | Record<string, never>
    }
    notification: {
      type: 'slack'
      config: SlackConfig
    }
  }

  // === Analytics ===
  analytics: {
    provider: 'posthog' | 'plausible' | 'ga4' | 'none'
    config: Record<string, string>      // { apiKey, host } for PostHog, etc.
  }

  // === Navigation (auto-generated from features, but overridable) ===
  nav?: NavItem[]
}

export interface EventTypeConfig {
  id: string                            // "birthday"
  name: string                          // "Birthday Party"
  description: string
  icon?: string                         // icon name or path
  flow: 'booking' | 'quote'            // booking = full checkout, quote = inquiry form
  baseCapacity?: number                 // 12 for birthday parties
  duration: number                      // minutes
  allowAddOns: boolean
  allowExtraGuests: boolean
  extraGuestPrice?: number              // cents, per-head overage
  catalogItemId?: string                // maps to provider's catalog
}

export interface SquareConfig {
  accessToken: string                   // from environment variable
  environment: 'sandbox' | 'production'
  locationId: string
  applicationId: string                 // for Web Payments SDK
}

export interface SquareInternalConfig {
  unitToken: string                     // location token for internal API
}

export interface SlackConfig {
  webhookUrl: string                    // Slack incoming webhook URL
  channel?: string
}

export interface NavItem {
  label: string
  href: string
  icon?: string
}
```

### Coupon codes

```json
// src/config/coupons.json
{
  "WELCOME10": {
    "type": "percent",
    "value": 10,
    "description": "10% off your first booking",
    "active": true,
    "expiresAt": "2026-12-31"
  },
  "SPRING25": {
    "type": "fixed",
    "value": 2500,
    "description": "$25 off",
    "active": true,
    "expiresAt": null
  }
}
```

Validated server-side only. Never exposed to the client. Coupon validation endpoint returns `{ valid: boolean, description: string, discount: Discount }`.

---

## 4. Pages & Features

### 4a: Static Pages (zero JS, prerendered)

**Home** (`src/pages/index.astro`)
- Hero section: configurable heading, subheading, background image, CTA button
- "What We Offer" grid: auto-generated from `config.features` — shows cards for enabled features (workshops, party types)
- Testimonials section (optional, config-driven)
- Newsletter signup component (React island, only if `config.features.newsletter`)

**About** (`src/pages/about.astro`)
- Configurable content blocks: story, team members, values
- Content from markdown files in `src/content/about/` (Astro content collections)

**Gallery** (`src/pages/gallery.astro`, only rendered if `config.features.gallery`)
- Masonry/grid layout of images with optional captions/tags
- Images from `src/content/gallery/`
- Lightbox viewer (minimal React island)

### 4b: Workshops Page (SSR, interactive)

**Page:** `src/pages/workshops.astro`
**Main component:** `src/components/workshops/WorkshopExplorer.tsx`

Two togglable views:
- **Calendar view** — month grid, dots on dates with workshops, click to expand day
- **Search/filter view** — list with text search, category filter, date range filter

Each workshop card shows:
- Name, description, date/time, duration, price
- Remaining seats: shown if `CapacityProvider` returns a number, hidden if `null`, entire listing hidden if `0`
- "Book Seat" button → navigates to checkout with workshop pre-selected

**Data flow:**
1. Astro page calls providers server-side: `catalog.getEventTypes({ category: 'workshop' })` + `booking.searchAvailability()` + `capacity.getAvailableCapacity()`
2. Merged data passed to React island via props
3. Client-side filtering/search operates on pre-fetched data (no additional API calls for filtering)
4. "Book Seat" navigates to checkout page with workshop ID as URL param

### 4c: Party Builder Wizard (SSR, interactive)

**Page:** `src/pages/book.astro`
**Main component:** `src/components/booking/PartyWizard.tsx`

State managed via `useReducer` in `WizardContext.tsx`. Each step is its own component.

**Step 1 — Event Type** (`EventTypeStep.tsx`)
- Cards for each enabled event type from `config.eventTypes`
- Shows name, description, icon, starting price
- Selecting one stores `eventType` in wizard state, advances to step 2

**Step 2 — Date Selection** (`DateSelectionStep.tsx`)
- Date range picker or specific date picker
- For `flow: 'quote'` events (corporate): also asks desired duration
- On date selection, calls `POST /api/booking/availability.json` with date range + event type
- Shows loading state while fetching

**Step 3 — Available Slots** (`AvailableSlotsStep.tsx`)
- Shows available time slots for selected date(s)
- Each slot shows: date, time, duration, availability status
- User picks one, stored in wizard state

**Step 4 — Customize** (`CustomizeStep.tsx`)
- For `flow: 'booking'` events:
  - Headcount input (base capacity shown, overage pricing shown per extra guest)
  - Add-on checkboxes with prices (from `CatalogProvider`)
  - Running price total updates live
- For `flow: 'quote'` events:
  - Common option checkboxes (configurable per event type)
  - Free text textarea for special requests
  - No pricing shown (it's a quote)

**Step 5a — Checkout** (`CheckoutStep.tsx`, for `flow: 'booking'`)
- Customer info: name, email, phone
- Coupon code input with inline validation (`POST /api/checkout/validate-coupon.json`)
- Order summary with all line items and total
- Square Web Payments SDK card iframe
- "Book & Pay" button:
  1. `POST /api/customer/find-or-create.json` → get customerId
  2. `POST /api/checkout/create-order.json` → get orderId
  3. Tokenize card via SDK → get paymentToken
  4. `POST /api/checkout/process-payment.json` → get payment confirmation
  5. `POST /api/booking/create.json` → create booking with orderId linked
  6. Show confirmation screen with receipt URL

**Step 5b — Submit Inquiry** (`InquiryStep.tsx`, for `flow: 'quote'`)
- Customer info: name, email, phone
- Review all details from previous steps
- "Submit Inquiry" button:
  1. `POST /api/customer/find-or-create.json` → get customerId
  2. `POST /api/inquiry/submit.json` → sends Slack notification to owner
  3. Show confirmation screen ("We'll get back to you within 24 hours")

---

## 5. Data Flow & API Routes

Every provider call goes through an Astro API route. Frontend React components call these routes, never providers directly.

### API Route Map

```
src/pages/api/
  workshops/
    list.json.ts              GET   → CatalogProvider.getEventTypes({ category: 'workshop' })
                                      + CapacityProvider.getAvailableCapacity()
    availability.json.ts      POST  → BookingProvider.searchAvailability()
                                      + CapacityProvider.getAvailableCapacity()

  booking/
    availability.json.ts      POST  → BookingProvider.searchAvailability()
    create.json.ts            POST  → BookingProvider.createBooking()
                                      Body: { slotId, customerId, eventType, guestCount, addOns, specialRequests, orderIdRef }
                                      Returns: Booking
    cancel.json.ts            POST  → BookingProvider.cancelBooking()
                                      Body: { bookingId, bookingVersion }

  catalog/
    event-types.json.ts       GET   → CatalogProvider.getEventTypes()
                                      Query: ?category=workshop|birthday|adult|corporate
    add-ons.json.ts           GET   → CatalogProvider.getAddOns(eventTypeId)
                                      Query: ?eventTypeId=xxx
    pricing.json.ts           GET   → CatalogProvider.getPricing()
                                      Query: ?eventTypeId=xxx&variationId=yyy

  checkout/
    create-order.json.ts      POST  → PaymentProvider.createOrder()
                                      Body: { locationId, customerId, lineItems, discounts }
                                      Returns: Order
    process-payment.json.ts   POST  → PaymentProvider.processPayment()
                                      Body: { orderId, paymentToken, amount, currency }
                                      Returns: Payment
    validate-coupon.json.ts   POST  → validates against coupons.json
                                      Body: { code }
                                      Returns: { valid, description, discount } | { valid: false, error }
    client-config.json.ts     GET   → PaymentProvider.getClientConfig()
                                      Returns: { appId, locationId, environment }

  customer/
    find-or-create.json.ts    POST  → CustomerProvider.findOrCreate()
                                      Body: { email, givenName, familyName, phone }
                                      Returns: Customer
    subscribe.json.ts         POST  → CustomerProvider.subscribe()
                                      Body: { email }

  inquiry/
    submit.json.ts            POST  → NotificationProvider.send()
                                      Body: { customerId, eventType, dates, duration, details, specialRequests }

  webhooks/
    square.json.ts            POST  → Webhook handler for Square events
                                      Validates HMAC-SHA256 signature
                                      Handles: booking.created, booking.updated, payment.created, payment.updated
```

### Standard API route pattern

Every API route follows this exact pattern for consistency and agent-team handoff:

```ts
// Example: src/pages/api/workshops/list.json.ts
import type { APIRoute } from 'astro'
import { createLogger } from '../../../lib/logger'
import { providers } from '../../../config/providers'

export const GET: APIRoute = async ({ request }) => {
  const logger = createLogger('api:workshops:list')
  const startTime = Date.now()

  try {
    const eventTypes = await providers.catalog.getEventTypes({ category: 'workshop' })
    const slotIds = eventTypes.flatMap(e => e.variations.map(v => v.id))
    const capacityMap = await providers.capacity.getAvailableCapacity(slotIds)

    // Filter out full workshops (capacity === 0)
    const available = eventTypes.filter(e => {
      const cap = capacityMap.get(e.id)
      return cap === null || cap === undefined || cap.availableCapacity > 0
    })

    logger.info('Fetched workshops', {
      total: eventTypes.length,
      available: available.length,
      duration_ms: Date.now() - startTime,
    })

    return new Response(JSON.stringify({ data: available }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Failed to fetch workshops', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })

    await providers.notification.send({
      type: 'api-failure',
      title: 'Workshop list fetch failed',
      details: { route: 'workshops/list', error: String(error) },
      severity: 'warning',
      timestamp: new Date().toISOString(),
    })

    return new Response(JSON.stringify({ error: 'Failed to load workshops' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
```

---

## 6. Square Setup & Catalog Structure

Square catalog must be set up before connecting real data. During development, mock providers serve placeholder data.

### Catalog structure

```
Category: "Workshops"
  └─ Item: "Candle Making Workshop"
       └─ Variation: "Standard Seat" — $45.00
  └─ Item: "Pottery Basics"
       └─ Variation: "Standard Seat" — $55.00

Category: "Birthday Parties"
  └─ Item: "Birthday Party Package"
       └─ Variation: "Base Package (up to 12 kids)" — $350.00
       └─ Variation: "Extra Child" — $25.00 each
       Modifier List: "Party Add-Ons"
         └─ Modifier: "Chocolate Fountain" — $75.00
         └─ Modifier: "Balloon Arch" — $50.00
         └─ Modifier: "Extra 30 Minutes" — $100.00

Category: "Adult Parties"
  └─ Item: "Adult Party Package"
       └─ Variation: "Base Package (up to 12 guests)" — $400.00
       └─ Variation: "Extra Guest" — $30.00 each
       Modifier List: "Party Add-Ons" (shared with birthday)

Category: "Corporate Events"
  └─ (No catalog items — quote-only flow, no online pricing)
```

### Booking custom attribute definitions

Created via API during setup. These attach metadata to bookings.

| Key | Type | Purpose |
|-----|------|---------|
| `event_type` | String | "birthday", "adult", "corporate", "workshop" |
| `guest_count` | Number | Total headcount |
| `add_ons` | String | JSON array of selected add-on modifier IDs |
| `order_id` | String | Links booking to its payment order |
| `special_requests` | String | Customer notes/requests |

### Square Loyalty program

- Accrual rule: 1 point per workshop attended
- Reward tier: 50% off a workshop at 10 points
- Set up manually in Square Dashboard (Loyalty API reads programs, doesn't create them)

### Webhook subscriptions

Created via API during setup. Endpoint: `https://{domain}/api/webhooks/square`

Events subscribed:
- `booking.created`
- `booking.updated` (includes cancellations)
- `payment.created`
- `payment.updated`
- `order.created`
- `order.updated`

### Setup script

A setup script (`scripts/setup-square.ts`) will:
1. Create booking custom attribute definitions
2. Create webhook subscriptions
3. Validate catalog structure exists (warn if missing)
4. Output a summary of what was created

Run once per deployment: `npx tsx scripts/setup-square.ts`

---

## 7. Monitoring, Logging & Error Handling

### Structured logging

```ts
// src/lib/logger.ts
export interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  source: string                    // "provider:square:booking", "api:workshops:list"
  message: string
  data?: Record<string, any>
  duration_ms?: number
  provider?: string                 // "square", "square-internal", "mock"
  is_internal_api?: boolean         // true for undocumented Square endpoints
}

export function createLogger(source: string) {
  return {
    info: (message: string, data?: Record<string, any>) => { /* ... */ },
    warn: (message: string, data?: Record<string, any>) => { /* ... */ },
    error: (message: string, data?: Record<string, any>) => { /* ... */ },
  }
}
```

Internal API calls tagged `is_internal_api: true` for easy filtering.

### Slack notifications

**Triggered on:**
- Any internal (undocumented) API failure — immediate, severity: critical
- Any payment processing failure — immediate, severity: critical
- 3+ consecutive failures on any endpoint — severity: warning
- Corporate event inquiry submitted — severity: info

**Not triggered on:**
- Successful calls (just logged)
- Client-side validation errors
- 404s, expected user errors

### Error handling by layer

| Layer | Behavior |
|-------|----------|
| **Provider** | Throws typed errors: `ProviderError`, `CapacityUnavailableError`, `PaymentFailedError`, `BookingConflictError` |
| **API route** | Catches errors, logs with context, sends Slack notification if applicable, returns clean JSON `{ error: string }` with appropriate HTTP status |
| **React component** | Receives error responses, shows user-friendly message with retry option, never exposes stack traces or internal details |

### Typed errors

```ts
// src/lib/errors.ts
export class ProviderError extends Error {
  constructor(
    message: string,
    public provider: string,
    public isInternal: boolean = false,
    public originalError?: unknown,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export class CapacityUnavailableError extends ProviderError {
  constructor(provider: string) {
    super('Capacity data unavailable', provider, true)
    this.name = 'CapacityUnavailableError'
  }
}

export class PaymentFailedError extends ProviderError {
  constructor(provider: string, public reason: string) {
    super(`Payment failed: ${reason}`, provider)
    this.name = 'PaymentFailedError'
  }
}

export class BookingConflictError extends ProviderError {
  constructor(provider: string) {
    super('Booking slot no longer available', provider)
    this.name = 'BookingConflictError'
  }
}
```

### Capacity degradation

- Internal API returns data → show seat count on workshop card
- Internal API fails → log error + Slack alert → return `null` → UI hides seat count, workshop still visible and bookable
- Internal API returns `0` available capacity → listing hidden entirely from UI

### Analytics

**PostHog** (free tier: 1M events/month, 5K session replays/month)

```ts
// in site.config.ts
analytics: {
  provider: 'posthog',
  config: {
    apiKey: 'phc_...',
    host: 'https://us.i.posthog.com',
  },
}
```

Key events to track:
- `wizard_started` — user enters party builder
- `wizard_step_completed` — each step with step name
- `wizard_abandoned` — user leaves without completing (with last step reached)
- `booking_completed` — successful booking with event type
- `workshop_seat_booked` — workshop seat purchased
- `inquiry_submitted` — corporate inquiry sent
- `coupon_applied` — coupon code used (with code name, not the code itself)
- `newsletter_subscribed` — email captured

---

## 8. Design Aesthetic

**Target audience:** Primarily women booking creative experiences.

**Aesthetic direction:** Classy, modern, organic. Elevated craft — not kitchy DIY. Think Anthropologie, not Etsy.

**Key design principles:**
- **Texture over flash** — linen, paper, fabric-like CSS background patterns. Not glass morphism or neon gradients.
- **Muted naturals** — warm whites, sage, lavender, terracotta, soft gold. Earthy and calming.
- **Subtle shimmer** — gentle CSS particle effects or soft light animations. Elevated, not distracting.
- **Generous whitespace** — let content breathe. No cramped layouts.
- **Clean typography** — serif headings (Playfair Display or similar), clean sans-serif body (Inter or similar).
- **Soft interactions** — lift on hover, smooth fade-ins on scroll, gentle transitions.

**Theme config for Homegrown Craft Studio:**

```ts
theme: {
  colors: {
    primary: '#7c3aed',       // soft purple
    secondary: '#a78bfa',     // lighter purple
    accent: '#d4a574',        // warm gold/terracotta
    background: '#faf8f5',    // warm off-white
    text: '#374151',          // soft dark gray (not pure black)
    muted: '#9ca3af',         // gray for subtle elements
  },
  fonts: {
    heading: 'Playfair Display',
    body: 'Inter',
  },
  borderRadius: 'md',
  textures: {
    background: 'linen',
    cards: 'soft-shadow',
  },
  animations: {
    particles: true,
    fadeIn: true,
    hoverEffects: 'lift',
  },
  style: 'organic',
}
```

---

## 9. Square API Capabilities & Limitations

### What we CAN do via official APIs

| Capability | API | Notes |
|------------|-----|-------|
| Create/cancel/update bookings | Bookings API | Requires Appointments Plus subscription |
| Attach metadata to bookings | Booking Custom Attributes API | Separate call after CreateBooking |
| Process card-not-present payments | Payments API + Web Payments SDK | SDK handles PCI compliance via iframe |
| Create complex orders | Orders API | Line items, quantities, discounts |
| Model packages with variations | Catalog API | Items + variations + modifier lists |
| Customer CRUD | Customers API | Search by email/phone, create/update |
| Loyalty account lookup | Loyalty API | Search by phone or customer ID |
| Redeem loyalty rewards | Loyalty API | CreateReward + RedeemReward |
| Webhook notifications | Webhooks API | Booking, payment, order, customer events |

### What we CANNOT do via official APIs

| Gap | Workaround |
|-----|-----------|
| **Remaining seat count for workshops** | Internal API (`buyer/classes/class_schedule_instances/search`). Undocumented, uses `unit_token` auth + spoofed browser headers. |
| **Coupon code validation** | Custom coupon system (coupons.json + validation endpoint). Apply as ad-hoc discounts via Orders API. |
| **Class details in one call** | Internal API provides name/description/price/staff inline. Official API requires Catalog + Bookings + Team Members lookups. |

### Internal API details

```
POST https://app.squareup.com/appointments/api/buyer/classes/class_schedule_instances/search
  ?unit_token={locationId}

Headers:
  Content-Type: application/json
  Origin: https://book.squareup.com
  Referer: https://book.squareup.com/

Body:
  {
    "class_schedule_filter": {
      "status": "CLASS_SCHEDULE_ACTIVE"
    }
  }

Returns:
  - class_schedule_instances[]: { id, start_at, end_at, available_capacity, class_schedule_id }
  - included_resources.class_schedules[]: { id, name, description, description_html, duration_minutes, price_amount, price_currency, staff_name, team_member_id, status }
```

**Risk:** Undocumented, could break without notice. No SLA, versioning, or deprecation policy. Mitigation: logging, Slack alerts on failure, graceful degradation to hiding seat counts.

---

## 10. Development Strategy

### Build order
1. Config system + provider interfaces (the contracts)
2. Mock providers (fake data for all interfaces)
3. Static pages (home, about, gallery) with theme system
4. Workshops page with mock data
5. Party builder wizard with mock data
6. Checkout flow with mock payment
7. Square providers (swap mocks for real implementations)
8. Square catalog setup (real data in Square Dashboard)
9. Internal API provider (workshop capacity)
10. Monitoring (logging, Slack notifications)
11. Analytics (PostHog integration)
12. Coupon system
13. Newsletter capture
14. Webhook handler

### Netlify deployment strategy
- `dev` branch: free deploy previews, push freely
- `main` branch: production deploys (15 credits each, ~20/month on free plan)
- Always test locally first: `npm run dev` at http://localhost:4321

### Agent team boundaries
Each of these is an independent workstream with explicit interfaces:

| Agent | Scope | Depends on | Produces |
|-------|-------|------------|----------|
| Config Agent | `src/config/`, interfaces | Nothing | Config types, site.config.ts, provider wiring |
| Provider Agent (interfaces) | `src/providers/interfaces/` | Config types | All provider interfaces |
| Provider Agent (mock) | `src/providers/mock/` | Provider interfaces | Mock implementations with fake data |
| Provider Agent (Square) | `src/providers/square/` | Provider interfaces, Square SDK | Square implementations |
| Static Pages Agent | `src/pages/index,about,gallery.astro`, `src/layouts/` | Config types, theme config | Themed static pages |
| Workshops Agent | `src/pages/workshops.astro`, `src/components/workshops/` | Provider interfaces, config | Workshop explorer with calendar + search |
| Wizard Agent | `src/pages/book.astro`, `src/components/booking/` | Provider interfaces, config | Multi-step party builder wizard |
| Checkout Agent | `src/components/checkout/` | PaymentProvider interface, config | Order summary, coupon input, payment form |
| API Routes Agent | `src/pages/api/` | Provider interfaces, config | All API route files |
| Monitoring Agent | `src/lib/logger.ts`, `src/lib/errors.ts`, notification provider | Provider interfaces | Logging, error types, Slack integration |
| Analytics Agent | PostHog integration in Layout | Config types | Analytics tracking |
| Setup Script Agent | `scripts/setup-square.ts` | Square SDK, config | One-time setup script |

Each agent receives: the provider interfaces it depends on, the config types, and explicit file paths to create. No implicit knowledge required.

---

## 11. Cost Summary

| Service | Cost |
|---------|------|
| Astro + React | Free |
| Netlify (free tier) | Free |
| Square APIs | Free (transaction processing fees apply) |
| PostHog | Free (1M events/month) |
| Slack notifications | Free |
| Domain | Already owned |
| **Total monthly** | **$0** (plus Square processing fees on transactions) |
