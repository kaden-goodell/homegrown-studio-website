# Spec Gap Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close all 16 gaps between the booking platform spec and current implementation.

**Architecture:** No new architecture — filling in missing files and fixing bugs in the existing provider/config/component structure. PaymentForm gets SDK-ready stub pattern (loads real SDK when config has appId, mock fallback otherwise). Catalog content populated with spec items as defaults.

**Tech Stack:** Astro 5, React 19, Square Web Payments SDK, TypeScript, Vitest

---

## Phase A — Foundation Fixes

### Task 1: Fix SquarePaymentProvider environment bug

**Files:**
- Modify: `src/providers/square/payment.ts:33`
- Modify: `tests/providers/square/payment.test.ts`

**Step 1: Fix the constructor**

In `src/providers/square/payment.ts`, line 33, change:

```ts
this.client = new SquareClient({ token: config.accessToken })
```

to:

```ts
this.client = new SquareClient({ token: config.accessToken, environment: config.environment })
```

**Step 2: Verify existing tests still pass**

Run: `npx vitest run tests/providers/square/payment.test.ts`
Expected: All existing tests pass

**Step 3: Commit**

```bash
git add src/providers/square/payment.ts
git commit -m "fix: add environment to SquarePaymentProvider constructor"
```

---

### Task 2: Fix webhook-verify timing-safe comparison

**Files:**
- Modify: `src/lib/webhook-verify.ts`
- Modify: `tests/api/webhooks.test.ts`

**Step 1: Update webhook-verify.ts**

Replace the entire file with:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifySquareSignature(
  body: string,
  signature: string,
  signatureKey: string,
  webhookUrl: string
): boolean {
  if (!signature || !signatureKey) return false

  const hmac = createHmac('sha256', signatureKey)
    .update(webhookUrl + body)
    .digest('base64')

  // Use timing-safe comparison to prevent timing oracle attacks
  const expected = Buffer.from(hmac, 'utf8')
  const actual = Buffer.from(signature, 'utf8')

  if (expected.length !== actual.length) return false

  return timingSafeEqual(expected, actual)
}
```

**Step 2: Verify existing webhook tests still pass**

Run: `npx vitest run tests/api/webhooks.test.ts`
Expected: All 13 tests pass (behavior is identical, just timing-safe)

**Step 3: Commit**

```bash
git add src/lib/webhook-verify.ts
git commit -m "fix: use timingSafeEqual in webhook signature verification"
```

---

### Task 3: Create src/lib/types.ts

**Files:**
- Create: `src/lib/types.ts`

**Step 1: Create the file**

```ts
/**
 * Shared TypeScript types used across the application.
 * Provider-specific types live in src/providers/interfaces/.
 */

/** Standard API route success response */
export interface ApiResponse<T> {
  data: T
}

/** Standard API route error response */
export interface ApiError {
  error: string
}

/** Workshop data assembled for the frontend (catalog + availability + capacity) */
export interface WorkshopData {
  id: string
  name: string
  description: string
  date: string
  startTime: string
  endTime: string
  duration: number
  price: number
  currency: string
  remainingSeats: number | null
  slotId: string
}

/** Customer info collected in the booking wizard */
export interface CustomerInfo {
  name: string
  email: string
  phone: string
}
```

**Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add shared types module"
```

---

### Task 4: Create src/lib/utils.ts

**Files:**
- Create: `src/lib/utils.ts`
- Create: `tests/lib/utils.test.ts`

**Step 1: Write tests**

```ts
import { describe, it, expect } from 'vitest'
import { formatCents, formatDate, formatTime, formatDuration } from '@lib/utils'

describe('formatCents', () => {
  it('formats whole dollar amounts', () => {
    expect(formatCents(4500)).toBe('$45.00')
  })

  it('formats amounts with cents', () => {
    expect(formatCents(4599)).toBe('$45.99')
  })

  it('formats zero', () => {
    expect(formatCents(0)).toBe('$0.00')
  })
})

describe('formatDate', () => {
  it('formats ISO date string', () => {
    const result = formatDate('2026-03-15')
    expect(result).toContain('Mar')
    expect(result).toContain('15')
    expect(result).toContain('2026')
  })
})

describe('formatTime', () => {
  it('formats ISO datetime to time string', () => {
    const result = formatTime('2026-03-15T10:00:00Z')
    expect(result).toBeTruthy()
  })
})

describe('formatDuration', () => {
  it('formats minutes to human-readable', () => {
    expect(formatDuration(90)).toBe('1h 30m')
  })

  it('formats exact hours', () => {
    expect(formatDuration(120)).toBe('2h')
  })

  it('formats minutes only', () => {
    expect(formatDuration(45)).toBe('45m')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/utils.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```ts
/**
 * Shared utility functions.
 */

/** Format a price in cents to a dollar string (e.g., 4500 → "$45.00") */
export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100)
}

/** Format an ISO date string to a human-readable date (e.g., "Mar 15, 2026") */
export function formatDate(isoDate: string): string {
  const date = new Date(isoDate + (isoDate.includes('T') ? '' : 'T00:00:00'))
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Format an ISO datetime string to a time string (e.g., "10:00 AM") */
export function formatTime(isoDatetime: string): string {
  return new Date(isoDatetime).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/** Format minutes to human-readable duration (e.g., 90 → "1h 30m") */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/utils.test.ts`
Expected: All pass

**Step 5: Commit**

```bash
git add src/lib/utils.ts tests/lib/utils.test.ts
git commit -m "feat: add shared utility functions with tests"
```

---

### Task 5: Add missing analytics events

**Files:**
- Modify: `src/lib/analytics.ts`
- Modify: `src/components/shared/Newsletter.tsx` (add tracking call)

**Step 1: Add the three missing tracking functions to analytics.ts**

Append before the final closing of the file:

```ts
export function trackWizardAbandoned(lastStep: string, eventType: string): void {
  capture('wizard_abandoned', { lastStep, eventType })
}

export function trackWorkshopSeatBooked(workshopName: string, price: number): void {
  capture('workshop_seat_booked', { workshopName, price })
}

export function trackNewsletterSubscribed(): void {
  capture('newsletter_subscribed')
}
```

**Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add src/lib/analytics.ts
git commit -m "feat: add missing analytics tracking events"
```

---

### Task 6: Add missing webhook subscription events

**Files:**
- Modify: `scripts/setup-square.ts:77-82`

**Step 1: Update WEBHOOK_EVENTS array**

Change:

```ts
const WEBHOOK_EVENTS = [
  'booking.created',
  'booking.updated',
  'payment.created',
  'payment.updated',
]
```

to:

```ts
const WEBHOOK_EVENTS = [
  'booking.created',
  'booking.updated',
  'payment.created',
  'payment.updated',
  'order.created',
  'order.updated',
]
```

**Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add scripts/setup-square.ts
git commit -m "feat: add order.created and order.updated webhook events"
```

---

### Task 7: Fix SquareCustomerProvider.subscribe

**Files:**
- Modify: `src/providers/square/customer.ts:78-85`

**Step 1: Update subscribe method**

Replace the `subscribe` method (lines 78-85):

```ts
  async subscribe(email: string): Promise<void> {
    // Search for existing customer first, only create if not found
    const searchResult = await this.client.customers.search({
      query: {
        filter: {
          emailAddress: { exact: email },
        },
      },
    })

    if (searchResult.customers && searchResult.customers.length > 0) {
      logger.info('Customer already exists for subscription', { email })
      return
    }

    // Create a minimal customer record for newsletter subscription
    await this.client.customers.create({
      emailAddress: email,
    })
    logger.info('Subscribed customer', { email })
  }
```

**Step 2: Verify existing customer tests still pass**

Run: `npx vitest run tests/providers/square/customer.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add src/providers/square/customer.ts
git commit -m "fix: subscribe creates minimal customer record without blank names"
```

---

## Phase B — Catalog & Content

### Task 8: Populate site.config.ts eventTypes with spec items

**Files:**
- Modify: `src/config/site.config.ts`

**Step 1: Update partyTypes and eventTypes arrays**

Replace the `partyTypes` array and the `eventTypes` property in `siteConfig` with:

```ts
const partyTypes: EventTypeConfig[] = [
  {
    id: 'birthday',
    name: 'Birthday Party',
    description: 'A creative birthday celebration with guided crafting activities for kids',
    icon: 'cake',
    flow: 'booking',
    baseCapacity: 12,
    duration: 120,
    allowAddOns: true,
    allowExtraGuests: true,
    extraGuestPrice: 2500, // $25 per extra child
    catalogItemId: 'birthday-party-package',
  },
  {
    id: 'adult-party',
    name: 'Adult Party',
    description: 'Host a private craft workshop for your group with drinks and snacks included',
    icon: 'wine',
    flow: 'booking',
    baseCapacity: 12,
    duration: 150,
    allowAddOns: true,
    allowExtraGuests: true,
    extraGuestPrice: 3000, // $30 per extra guest
    catalogItemId: 'adult-party-package',
  },
]
```

And the `eventTypes` in the siteConfig object:

```ts
  eventTypes: [
    ...partyTypes,
    {
      id: 'workshop-candle',
      name: 'Candle Making Workshop',
      description: 'Learn to create beautiful hand-poured soy candles with custom scents and colors',
      icon: 'flame',
      flow: 'booking',
      baseCapacity: 12,
      duration: 90,
      allowAddOns: false,
      allowExtraGuests: false,
      catalogItemId: 'workshop-candle',
    },
    {
      id: 'workshop-pottery',
      name: 'Pottery Basics',
      description: 'Get your hands dirty with wheel-thrown pottery basics. All skill levels welcome.',
      icon: 'palette',
      flow: 'booking',
      baseCapacity: 8,
      duration: 120,
      allowAddOns: false,
      allowExtraGuests: false,
      catalogItemId: 'workshop-pottery',
    },
    {
      id: 'corporate',
      name: 'Corporate Event',
      description: 'Custom team-building craft experiences for corporate groups',
      icon: 'briefcase',
      flow: 'quote',
      baseCapacity: 30,
      duration: 180,
      allowAddOns: true,
      allowExtraGuests: true,
      catalogItemId: undefined,
    },
  ],
```

Also update `features.parties.types` to use the new `partyTypes`.

**Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add src/config/site.config.ts
git commit -m "feat: populate eventTypes with spec catalog items and prices"
```

---

### Task 9: Update mock data to mirror config

**Files:**
- Modify: `src/providers/mock/data.ts`

**Step 1: Update mockEventTypes**

Update the `mockEventTypes` array so each entry matches the spec prices exactly:

- `workshop-candle`: Standard $45, Deluxe $75 (keep existing)
- `workshop-pottery`: Standard $55 (keep existing)
- `party-birthday`: Base Package $350/12 kids (already `35000`). Update `modifiers` to match spec:
  - Extra Child $25 (already `1500` — **change to `2500`**)
  - Chocolate Fountain $75 (add: `{ id: 'birthday-chocolate-fountain', name: 'Chocolate Fountain', priceAmount: 7500, priceCurrency: 'USD' }`)
  - Balloon Arch $50 (add: `{ id: 'birthday-balloon-arch', name: 'Balloon Arch', priceAmount: 5000, priceCurrency: 'USD' }`)
  - Extra 30 Minutes $100 (add: `{ id: 'birthday-extra-time', name: 'Extra 30 Minutes', priceAmount: 10000, priceCurrency: 'USD' }`)
- `party-adult`: Base Package $400/12 guests (already `40000`). Update modifiers similarly. Extra Guest to `3000`.
- `corporate-event`: Keep as quote-only, $0 placeholder (correct)

Remove mock items not in spec: `workshop-watercolor`, `workshop-soap`. These are extras that clutter the demo and don't match spec.

**Step 2: Verify all tests pass**

Run: `npx vitest run`
Expected: All tests pass (mock data changes may require updating test expectations if any tests reference removed items)

**Step 3: Commit**

```bash
git add src/providers/mock/data.ts
git commit -m "feat: align mock data with spec catalog items and prices"
```

---

### Task 10: Create gallery content collection with placeholders

**Files:**
- Modify: `src/content.config.ts` (add gallery collection schema)
- Create: `src/content/gallery/` directory
- Create: 8 gallery entry files (markdown with frontmatter)
- Create: `public/images/gallery/` directory with placeholder SVGs
- Modify: `src/pages/gallery.astro` (use content collection instead of hardcoded array)

**Step 1: Add gallery schema to content.config.ts**

```ts
import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'

const about = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/about' }),
  schema: z.object({
    title: z.string(),
    order: z.number().optional(),
  }),
})

const gallery = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/gallery' }),
  schema: z.object({
    title: z.string(),
    caption: z.string(),
    image: z.string(),
    order: z.number().optional(),
    tags: z.array(z.string()).optional(),
  }),
})

export const collections = { about, gallery }
```

**Step 2: Create 8 gallery entry files**

Create `src/content/gallery/01-candle-making.md` through `src/content/gallery/08-kids-art.md`, each with frontmatter like:

```md
---
title: "Candle Making Workshop"
caption: "Guests creating custom soy candles"
image: "/images/gallery/candle-making.svg"
order: 1
tags: ["workshop", "candles"]
---
```

**Step 3: Create placeholder SVG images**

Create `public/images/gallery/` directory. For each gallery entry, create a styled SVG placeholder with the entry's color and a relevant icon/text. Example `candle-making.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect width="800" height="600" fill="#c4b5fd" rx="8"/>
  <text x="400" y="280" text-anchor="middle" fill="white" font-family="serif" font-size="32" opacity="0.8">Candle Making Workshop</text>
  <text x="400" y="320" text-anchor="middle" fill="white" font-family="sans-serif" font-size="16" opacity="0.6">Photo coming soon</text>
</svg>
```

**Step 4: Refactor gallery.astro to use content collection**

Replace the hardcoded `galleryItems` array with:

```astro
---
import { getCollection } from 'astro:content'

const galleryEntries = await getCollection('gallery')
const galleryItems = galleryEntries
  .sort((a, b) => (a.data.order ?? 99) - (b.data.order ?? 99))
  .map(entry => ({
    id: entry.id,
    title: entry.data.title,
    caption: entry.data.caption,
    image: entry.data.image,
    tags: entry.data.tags ?? [],
  }))
```

Update the template to render `<img>` tags using `item.image` instead of colored divs.

**Step 5: Verify build**

Run: `npx astro build`
Expected: Build succeeds, gallery page renders with placeholder images

**Step 6: Commit**

```bash
git add src/content.config.ts src/content/gallery/ public/images/gallery/ src/pages/gallery.astro
git commit -m "feat: gallery content collection with placeholder images"
```

---

### Task 11: Add testimonials section to home page

**Files:**
- Modify: `src/config/site.config.ts` (add testimonials to SiteConfig)
- Modify: `src/pages/index.astro` (render testimonials)

**Step 1: Add testimonials type and config**

In `site.config.ts`, add to the `SiteConfig` interface:

```ts
  testimonials?: {
    heading?: string
    items: { quote: string; name: string; detail: string }[]
  }
```

Add to the siteConfig object:

```ts
  testimonials: {
    heading: 'What Our Guests Say',
    items: [
      {
        quote: 'The birthday party was amazing! The kids had so much fun and the staff was incredible.',
        name: 'Sarah M.',
        detail: 'Birthday Party',
      },
      {
        quote: 'Such a relaxing and creative experience. I will definitely be back for more workshops.',
        name: 'Emily R.',
        detail: 'Candle Making Workshop',
      },
      {
        quote: 'Our team building event was the best one we have ever had. Everyone loved it.',
        name: 'David L.',
        detail: 'Corporate Event',
      },
    ],
  },
```

**Step 2: Add testimonials section to index.astro**

Between the "What We Offer" section and the Newsletter section, add:

```astro
  {siteConfig.testimonials && siteConfig.testimonials.items.length > 0 && (
    <section class="py-20 sm:py-28 px-4 bg-white/50">
      <div class="max-w-6xl mx-auto">
        <h2 class="text-3xl sm:text-4xl font-heading font-bold text-center mb-14">
          {siteConfig.testimonials.heading || 'What Our Guests Say'}
        </h2>
        <div class="grid gap-8 sm:grid-cols-3 max-w-5xl mx-auto">
          {siteConfig.testimonials.items.map((t) => (
            <div class="fade-in rounded-xl p-8 bg-white border border-gray-100 shadow-sm">
              <p class="text-gray-600 italic leading-relaxed mb-6">&ldquo;{t.quote}&rdquo;</p>
              <div>
                <p class="font-semibold text-sm">{t.name}</p>
                <p class="text-xs text-[var(--color-muted)]">{t.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )}
```

**Step 3: Verify build**

Run: `npx astro build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/config/site.config.ts src/pages/index.astro
git commit -m "feat: add config-driven testimonials section to home page"
```

---

## Phase C — Checkout Critical Path

### Task 12: PaymentForm.tsx — SDK-ready stub

**Files:**
- Modify: `src/components/checkout/PaymentForm.tsx`
- Create: `tests/components/PaymentForm.test.tsx`

**Step 1: Write tests**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fetch for client-config
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// We'll test the tokenize logic and config detection

describe('PaymentForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns mock token when no appId is configured', async () => {
    // Simulate empty config (no Square SDK)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { appId: '', locationId: '', environment: 'sandbox' } }),
    })

    // Import the module fresh
    const { tokenizePayment } = await import('@components/checkout/payment-utils')
    const token = await tokenizePayment(null)
    expect(token).toBe('mock-payment-token')
  })
})
```

**Step 2: Rewrite PaymentForm.tsx**

```tsx
import { forwardRef, useImperativeHandle, useEffect, useState, useRef } from 'react'

export interface PaymentFormRef {
  tokenize: () => Promise<string>
}

interface PaymentFormProps {}

interface ClientConfig {
  appId: string
  locationId: string
  environment: 'sandbox' | 'production'
}

const PaymentForm = forwardRef<PaymentFormRef, PaymentFormProps>(function PaymentForm(_props, ref) {
  const [config, setConfig] = useState<ClientConfig | null>(null)
  const [sdkReady, setSdkReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cardRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const isMockMode = !config?.appId

  // Fetch client config on mount
  useEffect(() => {
    fetch('/api/checkout/client-config.json')
      .then((res) => res.json())
      .then((data) => setConfig(data.data))
      .catch(() => setError('Failed to load payment config'))
  }, [])

  // Load Square SDK when config has appId
  useEffect(() => {
    if (!config?.appId || sdkReady) return

    const existingScript = document.querySelector('script[src*="square"]')
    if (existingScript) {
      initializeCard()
      return
    }

    const script = document.createElement('script')
    script.src = config.environment === 'production'
      ? 'https://web.squarecdn.com/v1/square.js'
      : 'https://sandbox.web.squarecdn.com/v1/square.js'
    script.onload = () => initializeCard()
    script.onerror = () => setError('Failed to load payment SDK')
    document.head.appendChild(script)
  }, [config])

  async function initializeCard() {
    if (!config?.appId || !containerRef.current) return

    try {
      const payments = (window as any).Square.payments(config.appId, config.locationId)
      const card = await payments.card()
      await card.attach(containerRef.current)
      cardRef.current = card
      setSdkReady(true)
    } catch (err) {
      setError('Failed to initialize payment form')
    }
  }

  useImperativeHandle(ref, () => ({
    tokenize: async () => {
      if (isMockMode) return 'mock-payment-token'

      if (!cardRef.current) throw new Error('Payment form not ready')

      const result = await cardRef.current.tokenize()
      if (result.status === 'OK') return result.token
      throw new Error(result.errors?.[0]?.message ?? 'Tokenization failed')
    },
  }), [isMockMode])

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold text-gray-900">Payment</h3>
        {isMockMode && (
          <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
            Test Mode
          </span>
        )}
      </div>
      {isMockMode ? (
        <div className="rounded-md border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500">
          Card input will appear here when Square is configured
        </div>
      ) : (
        <div
          ref={containerRef}
          id="card-container"
          className="min-h-[56px] rounded-md border border-gray-300"
        />
      )}
    </div>
  )
})

export default PaymentForm
```

**Step 3: Verify tsc and existing tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean, all existing tests pass

**Step 4: Commit**

```bash
git add src/components/checkout/PaymentForm.tsx
git commit -m "feat: SDK-ready PaymentForm with mock fallback"
```

---

### Task 13: Fix CheckoutStep pricing

**Files:**
- Modify: `src/components/booking/steps/CheckoutStep.tsx`

**Step 1: Update buildLineItems to use real prices**

Replace the `buildLineItems` function:

```ts
  function buildLineItems(): LineItem[] {
    const items: LineItem[] = []

    if (state.eventType) {
      // Use first variation price as the base price
      const variation = state.eventType.variations?.[0]
      const basePrice = variation?.priceAmount ?? 0

      items.push({
        name: state.eventType.name,
        quantity: 1,
        pricePerUnit: basePrice,
      })

      // Add extra guest charges
      if (
        state.eventType.allowExtraGuests &&
        state.eventType.extraGuestPrice &&
        state.eventType.baseCapacity &&
        state.guestCount > state.eventType.baseCapacity
      ) {
        const extraGuests = state.guestCount - state.eventType.baseCapacity
        items.push({
          name: `Extra Guest (x${extraGuests})`,
          quantity: extraGuests,
          pricePerUnit: state.eventType.extraGuestPrice,
        })
      }

      // Add selected add-ons
      if (state.selectedAddOns?.length && state.eventType.modifiers?.length) {
        for (const addonId of state.selectedAddOns) {
          const addon = state.eventType.modifiers.find((m) => m.id === addonId)
          if (addon) {
            items.push({
              name: addon.name,
              quantity: 1,
              pricePerUnit: addon.priceAmount,
            })
          }
        }
      }
    }

    return items
  }
```

**Note:** This requires that the wizard state's `eventType` carries `variations`, `modifiers`, `baseCapacity`, and `extraGuestPrice`. Check the WizardContext to confirm the eventType stored includes these fields. If the wizard stores `EventTypeConfig` (from site.config), we need to enrich it with catalog data (variations/modifiers) from the API. If it stores the full `EventType` from the catalog provider, it already has these.

Read `src/components/booking/WizardContext.tsx` to verify the shape of `state.eventType`. If it's `EventTypeConfig`, we need to also check how `CustomizeStep` gets add-on data and ensure CheckoutStep has access to the same enriched data.

**Step 2: Also fix the customer find-or-create call**

The current code sends `name` but the API expects `givenName` and `familyName`. Update the fetch call:

```ts
      const [firstName, ...lastParts] = name.trim().split(' ')
      const customerRes = await fetch('/api/customer/find-or-create.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          givenName: firstName,
          familyName: lastParts.join(' ') || firstName,
          email: email.trim(),
          phone: phone.trim(),
        }),
      })
```

**Step 3: Verify tsc and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Clean

**Step 4: Commit**

```bash
git add src/components/booking/steps/CheckoutStep.tsx
git commit -m "fix: populate real prices in checkout line items and fix customer name fields"
```

---

## Phase D — Polish

### Task 14: Create StaticLayout.astro

**Files:**
- Create: `src/layouts/StaticLayout.astro`
- Modify: `src/pages/index.astro` (switch to StaticLayout)
- Modify: `src/pages/about.astro` (switch to StaticLayout)
- Modify: `src/pages/gallery.astro` (switch to StaticLayout)

**Step 1: Create StaticLayout.astro**

This is a stripped-down version of Layout.astro optimized for prerendered pages — no dynamic imports that aren't needed on static pages.

```astro
---
import { siteConfig } from '@config/site.config'
import Header from '@components/shared/Header.astro'
import Footer from '@components/shared/Footer.astro'
import '@styles/global.css'
import '@styles/textures.css'
import '@styles/animations.css'

interface Props {
  title?: string
  description?: string
}

const { title, description } = Astro.props
const pageTitle = title ? `${title} | ${siteConfig.name}` : siteConfig.name
const pageDescription = description || siteConfig.tagline
const { colors, fonts, textures } = siteConfig.theme
const textureClass = `texture-${textures.background}`

const headingFont = fonts.heading.replace(/ /g, '+')
const bodyFont = fonts.body.replace(/ /g, '+')
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content={pageDescription} />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" href="/favicon.ico" />
    <title>{pageTitle}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href={`https://fonts.googleapis.com/css2?family=${headingFont}:wght@400;500;600;700&display=swap`}
      rel="stylesheet"
    />
    <link
      href={`https://fonts.googleapis.com/css2?family=${bodyFont}:wght@400;500;600;700&display=swap`}
      rel="stylesheet"
    />
    <style
      define:vars={{
        'color-primary': colors.primary,
        'color-secondary': colors.secondary,
        'color-accent': colors.accent,
        'color-background': colors.background,
        'color-text': colors.text,
        'color-muted': colors.muted,
        'font-heading': `'${fonts.heading}', serif`,
        'font-body': `'${fonts.body}', sans-serif`,
      }}
    >
      body {
        font-family: var(--font-body);
        color: var(--color-text);
        background-color: var(--color-background);
      }
      h1, h2, h3, h4, h5, h6,
      .font-heading {
        font-family: var(--font-heading);
      }
    </style>
  </head>
  <body class={textureClass}>
    <Header />
    <main>
      <slot />
    </main>
    <Footer />
    <script>import '@lib/fade-in'</script>
  </body>
</html>
```

Key differences from Layout.astro: no Shimmer component (saves JS), no PostHog analytics script (static pages don't need tracking). These can be added back with the Shimmer component in individual pages if desired.

**Step 2: Update static pages to use StaticLayout**

In `index.astro`, `about.astro`, and `gallery.astro`, change:
```astro
import Layout from '@layouts/Layout.astro'
```
to:
```astro
import Layout from '@layouts/StaticLayout.astro'
```

**Step 3: Verify build**

Run: `npx astro build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/layouts/StaticLayout.astro src/pages/index.astro src/pages/about.astro src/pages/gallery.astro
git commit -m "feat: add StaticLayout for prerendered pages"
```

---

### Task 15: Create DateRangePicker.tsx shared component

**Files:**
- Create: `src/components/shared/DateRangePicker.tsx`
- Modify: `src/components/booking/steps/DateSelectionStep.tsx` (use the new component)

**Step 1: Create DateRangePicker**

```tsx
import { useState } from 'react'

interface DateRangePickerProps {
  startDate: string
  endDate: string
  onStartChange: (date: string) => void
  onEndChange: (date: string) => void
  minDate?: string
}

export default function DateRangePicker({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  minDate,
}: DateRangePickerProps) {
  const today = minDate ?? new Date().toISOString().split('T')[0]

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="drp-start" className="block text-sm font-medium text-gray-700">
          Start Date
        </label>
        <input
          id="drp-start"
          type="date"
          value={startDate}
          min={today}
          onChange={(e) => {
            onStartChange(e.target.value)
            // If end date is before new start, update it
            if (endDate && e.target.value > endDate) {
              onEndChange(e.target.value)
            }
          }}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
        />
      </div>
      <div>
        <label htmlFor="drp-end" className="block text-sm font-medium text-gray-700">
          End Date
        </label>
        <input
          id="drp-end"
          type="date"
          value={endDate}
          min={startDate || today}
          onChange={(e) => onEndChange(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
        />
      </div>
    </div>
  )
}
```

**Step 2: Refactor DateSelectionStep to use it**

Replace the two date input blocks in DateSelectionStep with:

```tsx
import DateRangePicker from '@components/shared/DateRangePicker'

// In the JSX:
<DateRangePicker
  startDate={startDate}
  endDate={endDate}
  onStartChange={setStartDate}
  onEndChange={setEndDate}
/>
```

**Step 3: Verify tsc and build**

Run: `npx tsc --noEmit && npx astro build`
Expected: Clean

**Step 4: Commit**

```bash
git add src/components/shared/DateRangePicker.tsx src/components/booking/steps/DateSelectionStep.tsx
git commit -m "feat: extract DateRangePicker into reusable shared component"
```

---

### Task 16: Create public asset directories

**Files:**
- Create: `public/fonts/.gitkeep`
- Create: `public/images/.gitkeep` (if not already created by Task 10)

**Step 1: Create directories with .gitkeep**

```bash
mkdir -p public/fonts public/images
touch public/fonts/.gitkeep public/images/.gitkeep
```

**Step 2: Commit**

```bash
git add public/fonts/.gitkeep public/images/.gitkeep
git commit -m "chore: add public/fonts and public/images directories"
```

---

## Final Verification

After all tasks complete:

1. `npx tsc --noEmit` — clean
2. `npx vitest run` — all tests pass
3. `npx astro build` — build succeeds
4. `npm run dev` — local dev shows:
   - Home page with testimonials section
   - Gallery with placeholder images from content collection
   - Checkout with SDK-ready payment form (mock mode in dev)
   - Correct prices in order summary
5. Use superpowers:finishing-a-development-branch to complete the work
