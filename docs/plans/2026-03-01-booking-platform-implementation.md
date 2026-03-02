# Booking Platform Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a configurable, white-label booking platform for Homegrown Craft Studio with workshops, party builder wizard, and Square integration.

**Architecture:** Astro 5 + React 19 islands on Netlify. Provider abstraction layer enables swapping Square for other booking/payment providers. Config-driven everything — theme, features, event types, providers.

**Tech Stack:** Astro 5, React 19, TypeScript, Tailwind CSS, Square SDK v43+, PostHog, Vitest, Playwright

**Design Doc:** `docs/plans/2026-03-01-booking-platform-design.md` — the single source of truth for all interfaces, types, and architecture decisions. READ IT BEFORE STARTING ANY TASK.

---

## Phase 0: Project Scaffolding

### Task 0.1: Initialize New Astro Project

**Files:**
- Create: `package.json`
- Create: `astro.config.mjs`
- Create: `tsconfig.json`
- Create: `tailwind.config.cjs`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `netlify.toml`

**Step 1: Scaffold Astro project**

```bash
cd /Users/catherine/source/homegrownStudio
# Remove old v1 src (keep docs/)
rm -rf src/ public/ package.json package-lock.json tsconfig.json tailwind.config.cjs astro.config.mjs netlify.toml
npm create astro@latest . -- --template minimal --typescript strict --install --git false
```

**Step 2: Install dependencies**

```bash
npm install react react-dom @astrojs/react @astrojs/tailwind tailwindcss @astrojs/netlify square
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/react @types/react-dom prettier
```

**Step 3: Configure Astro**

Create `astro.config.mjs`:
```js
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwind from '@astrojs/tailwind'
import netlify from '@astrojs/netlify'

export default defineConfig({
  output: 'server',
  adapter: netlify(),
  integrations: [
    react(),
    tailwind(),
  ],
})
```

**Step 4: Configure Tailwind**

Create `tailwind.config.cjs`:
```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        heading: ['var(--font-heading)', 'serif'],
        body: ['var(--font-body)', 'sans-serif'],
      },
      colors: {
        primary: 'var(--color-primary)',
        secondary: 'var(--color-secondary)',
        accent: 'var(--color-accent)',
        surface: 'var(--color-background)',
        foreground: 'var(--color-text)',
        muted: 'var(--color-muted)',
      },
    },
  },
  plugins: [],
}
```

**Step 5: Configure TypeScript**

Create `tsconfig.json`:
```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "baseUrl": ".",
    "paths": {
      "@config/*": ["src/config/*"],
      "@providers/*": ["src/providers/*"],
      "@components/*": ["src/components/*"],
      "@lib/*": ["src/lib/*"],
      "@layouts/*": ["src/layouts/*"],
      "@styles/*": ["src/styles/*"]
    }
  }
}
```

**Step 6: Create environment template**

Create `.env.example`:
```
# Square API
SQUARE_ACCESS_TOKEN=your_sandbox_token
SQUARE_ENVIRONMENT=sandbox
SQUARE_LOCATION_ID=your_location_id
SQUARE_APPLICATION_ID=your_application_id

# Square Internal API
SQUARE_UNIT_TOKEN=your_unit_token

# Slack
SLACK_WEBHOOK_URL=your_webhook_url

# PostHog
POSTHOG_API_KEY=your_posthog_key
POSTHOG_HOST=https://us.i.posthog.com

# Provider mode: 'mock' or 'square'
PROVIDER_MODE=mock
```

**Step 7: Configure Netlify**

Create `netlify.toml`:
```toml
[build]
  command = "npm run build"
  publish = "dist"

[dev]
  command = "npm run dev"

[[headers]]
  for = "/api/*"
  [headers.values]
    Access-Control-Allow-Origin = "*"
    Access-Control-Allow-Methods = "GET, POST, OPTIONS"
    Access-Control-Allow-Headers = "Content-Type"
```

**Step 8: Configure Vitest**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@config': resolve(__dirname, 'src/config'),
      '@providers': resolve(__dirname, 'src/providers'),
      '@components': resolve(__dirname, 'src/components'),
      '@lib': resolve(__dirname, 'src/lib'),
    },
  },
})
```

Create `tests/setup.ts`:
```ts
import '@testing-library/jest-dom'
```

**Step 9: Verify it builds**

```bash
npm run dev
# Should start at http://localhost:4321 with blank page
# Ctrl+C to stop
npm run build
# Should succeed with no errors
```

**Step 10: Commit**

```bash
git add -A
git commit -m "feat: scaffold Astro 5 + React 19 + Tailwind project"
```

---

## Phase 1: Foundation (Config + Types + Logging)

> **Agent team note:** Phase 1 has NO dependencies. All tasks can run in parallel. Every subsequent phase depends on Phase 1 being complete.

### Task 1.1: Site Config Types and Default Config

**Files:**
- Create: `src/config/site.config.ts`
- Test: `tests/config/site.config.test.ts`

**Step 1: Write the failing test**

```ts
// tests/config/site.config.test.ts
import { describe, it, expect } from 'vitest'
import { siteConfig, validateConfig } from '@config/site.config'

describe('site config', () => {
  it('has required identity fields', () => {
    expect(siteConfig.name).toBe('Homegrown Craft Studio')
    expect(siteConfig.contactEmail).toBeTruthy()
    expect(siteConfig.contactPhone).toBeTruthy()
  })

  it('has theme with all required color keys', () => {
    const requiredColors = ['primary', 'secondary', 'accent', 'background', 'text', 'muted']
    for (const key of requiredColors) {
      expect(siteConfig.theme.colors).toHaveProperty(key)
      expect(siteConfig.theme.colors[key as keyof typeof siteConfig.theme.colors]).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('has feature toggles', () => {
    expect(typeof siteConfig.features.workshops).toBe('boolean')
    expect(typeof siteConfig.features.newsletter).toBe('boolean')
    expect(typeof siteConfig.features.gallery).toBe('boolean')
    expect(typeof siteConfig.features.coupons).toBe('boolean')
    expect(typeof siteConfig.features.parties.enabled).toBe('boolean')
  })

  it('has at least one event type configured', () => {
    expect(siteConfig.eventTypes.length).toBeGreaterThan(0)
  })

  it('each event type has required fields', () => {
    for (const et of siteConfig.eventTypes) {
      expect(et.id).toBeTruthy()
      expect(et.name).toBeTruthy()
      expect(['booking', 'quote']).toContain(et.flow)
      expect(et.duration).toBeGreaterThan(0)
    }
  })

  it('validates a valid config', () => {
    expect(() => validateConfig(siteConfig)).not.toThrow()
  })

  it('rejects config missing name', () => {
    const bad = { ...siteConfig, name: '' }
    expect(() => validateConfig(bad)).toThrow('name is required')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/config/site.config.test.ts
```
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `src/config/site.config.ts` with all types from the design doc Section 3, plus the Homegrown Craft Studio default config values, plus a `validateConfig()` function that checks required fields.

Key: Copy the EXACT interfaces from the design doc (`SiteConfig`, `EventTypeConfig`, `SquareConfig`, `SquareInternalConfig`, `SlackConfig`, `NavItem`). The default config should use `process.env` for secrets and hardcoded values for Homegrown-specific content (name, colors, event types).

The `siteConfig` export should be the fully populated config for Homegrown Craft Studio. `PROVIDER_MODE` env var determines whether providers are `'mock'` or `'square'`.

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/config/site.config.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/site.config.ts tests/config/site.config.test.ts
git commit -m "feat: add site config types and Homegrown defaults"
```

---

### Task 1.2: Provider Interfaces

**Files:**
- Create: `src/providers/interfaces/booking.ts`
- Create: `src/providers/interfaces/payment.ts`
- Create: `src/providers/interfaces/catalog.ts`
- Create: `src/providers/interfaces/capacity.ts`
- Create: `src/providers/interfaces/customer.ts`
- Create: `src/providers/interfaces/notification.ts`
- Create: `src/providers/interfaces/index.ts`

**Step 1: Create all interface files**

Copy the EXACT interfaces from the design doc Section 2. Each file exports its types and interface. `index.ts` re-exports everything.

These are pure type definitions — no implementation, no tests needed (TypeScript compiler validates them).

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: No errors

**Step 3: Commit**

```bash
git add src/providers/interfaces/
git commit -m "feat: add provider interface definitions"
```

---

### Task 1.3: Typed Errors

**Files:**
- Create: `src/lib/errors.ts`
- Test: `tests/lib/errors.test.ts`

**Step 1: Write the failing test**

```ts
// tests/lib/errors.test.ts
import { describe, it, expect } from 'vitest'
import {
  ProviderError,
  CapacityUnavailableError,
  PaymentFailedError,
  BookingConflictError,
} from '@lib/errors'

describe('typed errors', () => {
  it('ProviderError has provider and isInternal fields', () => {
    const err = new ProviderError('fail', 'square', true)
    expect(err.message).toBe('fail')
    expect(err.provider).toBe('square')
    expect(err.isInternal).toBe(true)
    expect(err).toBeInstanceOf(Error)
  })

  it('CapacityUnavailableError defaults to internal', () => {
    const err = new CapacityUnavailableError('square')
    expect(err.isInternal).toBe(true)
    expect(err.name).toBe('CapacityUnavailableError')
  })

  it('PaymentFailedError includes reason', () => {
    const err = new PaymentFailedError('square', 'card declined')
    expect(err.reason).toBe('card declined')
    expect(err.message).toContain('card declined')
  })

  it('BookingConflictError is not internal by default', () => {
    const err = new BookingConflictError('square')
    expect(err.isInternal).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/errors.test.ts
```

**Step 3: Write the implementation**

Copy the EXACT error classes from design doc Section 7 (`ProviderError`, `CapacityUnavailableError`, `PaymentFailedError`, `BookingConflictError`).

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/lib/errors.test.ts
```

**Step 5: Commit**

```bash
git add src/lib/errors.ts tests/lib/errors.test.ts
git commit -m "feat: add typed error classes for provider layer"
```

---

### Task 1.4: Structured Logger

**Files:**
- Create: `src/lib/logger.ts`
- Test: `tests/lib/logger.test.ts`

**Step 1: Write the failing test**

```ts
// tests/lib/logger.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createLogger } from '@lib/logger'

describe('logger', () => {
  it('creates logger with source', () => {
    const logger = createLogger('api:workshops:list')
    expect(logger.info).toBeTypeOf('function')
    expect(logger.warn).toBeTypeOf('function')
    expect(logger.error).toBeTypeOf('function')
  })

  it('info log includes source and timestamp', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('test:source')
    logger.info('hello', { count: 5 })
    expect(spy).toHaveBeenCalledOnce()
    const logged = JSON.parse(spy.mock.calls[0][0])
    expect(logged.source).toBe('test:source')
    expect(logged.level).toBe('info')
    expect(logged.message).toBe('hello')
    expect(logged.data.count).toBe(5)
    expect(logged.timestamp).toBeTruthy()
    spy.mockRestore()
  })

  it('error log uses console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logger = createLogger('test:source')
    logger.error('bad thing', { error: 'oops' })
    expect(spy).toHaveBeenCalledOnce()
    const logged = JSON.parse(spy.mock.calls[0][0])
    expect(logged.level).toBe('error')
    spy.mockRestore()
  })

  it('supports is_internal_api flag', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('provider:square:capacity')
    logger.info('fetched', { is_internal_api: true })
    const logged = JSON.parse(spy.mock.calls[0][0])
    expect(logged.data.is_internal_api).toBe(true)
    spy.mockRestore()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/logger.test.ts
```

**Step 3: Write the implementation**

Implement `createLogger(source: string)` that returns `{ info, warn, error }`. Each method JSON-serializes a `LogEntry` (from design doc Section 7) and writes to `console.log` (info/warn) or `console.error` (error). Include `timestamp`, `level`, `source`, `message`, and `data`.

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/lib/logger.test.ts
```

**Step 5: Commit**

```bash
git add src/lib/logger.ts tests/lib/logger.test.ts
git commit -m "feat: add structured JSON logger"
```

---

### Task 1.5: Coupon Types and Validator

**Files:**
- Create: `src/config/coupons.json`
- Create: `src/lib/coupons.ts`
- Test: `tests/lib/coupons.test.ts`

**Step 1: Write the failing test**

```ts
// tests/lib/coupons.test.ts
import { describe, it, expect } from 'vitest'
import { validateCoupon } from '@lib/coupons'

describe('coupon validation', () => {
  it('validates a valid percent coupon', () => {
    const result = validateCoupon('WELCOME10')
    expect(result.valid).toBe(true)
    expect(result.discount?.type).toBe('percent')
    expect(result.discount?.value).toBe(10)
  })

  it('validates a valid fixed coupon', () => {
    const result = validateCoupon('SPRING25')
    expect(result.valid).toBe(true)
    expect(result.discount?.type).toBe('fixed')
    expect(result.discount?.value).toBe(2500)
  })

  it('rejects unknown coupon code', () => {
    const result = validateCoupon('FAKECODE')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Invalid coupon code')
  })

  it('is case-insensitive', () => {
    const result = validateCoupon('welcome10')
    expect(result.valid).toBe(true)
  })

  it('rejects inactive coupon', () => {
    // This test requires a coupon with active: false in coupons.json
    const result = validateCoupon('EXPIRED99')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Coupon is no longer active')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/coupons.test.ts
```

**Step 3: Write the implementation**

Create `src/config/coupons.json` with the coupon data from design doc Section 3 (WELCOME10, SPRING25), plus an inactive `EXPIRED99` for testing.

Create `src/lib/coupons.ts` with `validateCoupon(code: string)` that:
1. Uppercases the code
2. Looks it up in coupons.json
3. Checks `active` flag
4. Checks `expiresAt` against current date
5. Returns `{ valid: true, description, discount: { name, type, value, scope: 'order' } }` or `{ valid: false, error: string }`

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/lib/coupons.test.ts
```

**Step 5: Commit**

```bash
git add src/config/coupons.json src/lib/coupons.ts tests/lib/coupons.test.ts
git commit -m "feat: add coupon validation system"
```

---

## Phase 2: Mock Providers

> **Agent team note:** Depends on Phase 1 (interfaces + types). All mock providers can be built in parallel.

### Task 2.1: Mock Catalog Provider

**Files:**
- Create: `src/providers/mock/catalog.ts`
- Create: `src/providers/mock/data.ts` (shared fake data)
- Test: `tests/providers/mock/catalog.test.ts`

**Step 1: Write the failing test**

```ts
// tests/providers/mock/catalog.test.ts
import { describe, it, expect } from 'vitest'
import { MockCatalogProvider } from '@providers/mock/catalog'

describe('MockCatalogProvider', () => {
  const provider = new MockCatalogProvider()

  it('returns event types', async () => {
    const types = await provider.getEventTypes()
    expect(types.length).toBeGreaterThan(0)
    for (const t of types) {
      expect(t.id).toBeTruthy()
      expect(t.name).toBeTruthy()
      expect(t.variations.length).toBeGreaterThan(0)
    }
  })

  it('filters by category', async () => {
    const workshops = await provider.getEventTypes({ category: 'workshop' })
    for (const w of workshops) {
      expect(w.category).toBe('workshop')
    }
  })

  it('returns add-ons for event type', async () => {
    const types = await provider.getEventTypes()
    const partyType = types.find(t => t.category === 'birthday')
    if (partyType) {
      const addOns = await provider.getAddOns(partyType.id)
      expect(addOns.length).toBeGreaterThan(0)
      for (const a of addOns) {
        expect(a.name).toBeTruthy()
        expect(a.priceAmount).toBeGreaterThan(0)
      }
    }
  })

  it('returns pricing for variation', async () => {
    const types = await provider.getEventTypes()
    const type = types[0]
    const variation = type.variations[0]
    const pricing = await provider.getPricing(type.id, variation.id)
    expect(pricing.priceAmount).toBeGreaterThan(0)
    expect(pricing.priceCurrency).toBe('USD')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/providers/mock/catalog.test.ts
```

**Step 3: Write the implementation**

Create `src/providers/mock/data.ts` with realistic fake data:
- 3-4 workshops (Candle Making, Pottery Basics, Watercolor, Soap Making)
- Birthday party package with base + extra child variations + add-ons
- Adult party package with base + extra guest variations + add-ons
- Corporate event (quote-only, no variations)
- Each with realistic prices in cents, descriptions, durations

All data uses the `EventType`, `EventVariation`, `AddOn` types from `@providers/interfaces/catalog`.

Create `src/providers/mock/catalog.ts` implementing `CatalogProvider`:
- `getEventTypes()` returns from data.ts, filtered by category if provided
- `getAddOns()` returns modifiers for the given event type ID
- `getPricing()` returns the specific variation

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/providers/mock/catalog.test.ts
```

**Step 5: Commit**

```bash
git add src/providers/mock/ tests/providers/mock/catalog.test.ts
git commit -m "feat: add mock catalog provider with fake workshop/party data"
```

---

### Task 2.2: Mock Booking Provider

**Files:**
- Create: `src/providers/mock/booking.ts`
- Test: `tests/providers/mock/booking.test.ts`

**Step 1: Write the failing test**

```ts
// tests/providers/mock/booking.test.ts
import { describe, it, expect } from 'vitest'
import { MockBookingProvider } from '@providers/mock/booking'

describe('MockBookingProvider', () => {
  const provider = new MockBookingProvider()

  it('returns available time slots for date range', async () => {
    const slots = await provider.searchAvailability({
      startDate: '2026-03-15',
      endDate: '2026-03-22',
      locationId: 'mock-location',
    })
    expect(slots.length).toBeGreaterThan(0)
    for (const slot of slots) {
      expect(slot.id).toBeTruthy()
      expect(slot.startAt).toBeTruthy()
      expect(slot.available).toBe(true)
    }
  })

  it('creates a booking', async () => {
    const booking = await provider.createBooking({
      slotId: 'mock-slot-1',
      customerId: 'mock-customer-1',
      eventType: 'birthday',
    })
    expect(booking.id).toBeTruthy()
    expect(booking.status).toBe('confirmed')
    expect(booking.customerId).toBe('mock-customer-1')
  })

  it('retrieves a created booking', async () => {
    const created = await provider.createBooking({
      slotId: 'mock-slot-2',
      customerId: 'mock-customer-1',
      eventType: 'workshop',
    })
    const retrieved = await provider.getBooking(created.id)
    expect(retrieved.id).toBe(created.id)
  })

  it('cancels a booking', async () => {
    const created = await provider.createBooking({
      slotId: 'mock-slot-3',
      customerId: 'mock-customer-1',
      eventType: 'adult',
    })
    await expect(provider.cancelBooking(created.id, 1)).resolves.toBeUndefined()
  })
})
```

**Step 2: Run test, verify fail, implement, verify pass**

Mock booking provider generates fake time slots spread across the requested date range (2-3 per day, various times). Bookings stored in an in-memory Map.

**Step 3: Commit**

```bash
git add src/providers/mock/booking.ts tests/providers/mock/booking.test.ts
git commit -m "feat: add mock booking provider"
```

---

### Task 2.3: Mock Capacity Provider

**Files:**
- Create: `src/providers/mock/capacity.ts`
- Test: `tests/providers/mock/capacity.test.ts`

**Step 1: Write the failing test**

```ts
// tests/providers/mock/capacity.test.ts
import { describe, it, expect } from 'vitest'
import { MockCapacityProvider, NullCapacityProvider } from '@providers/mock/capacity'

describe('MockCapacityProvider', () => {
  const provider = new MockCapacityProvider()

  it('returns capacity for known slot IDs', async () => {
    const result = await provider.getAvailableCapacity(['slot-1', 'slot-2'])
    expect(result.size).toBe(2)
    const cap1 = result.get('slot-1')
    expect(cap1).not.toBeNull()
    expect(cap1!.availableCapacity).toBeGreaterThanOrEqual(0)
    expect(cap1!.totalCapacity).toBeGreaterThan(0)
  })
})

describe('NullCapacityProvider', () => {
  const provider = new NullCapacityProvider()

  it('returns null for all slot IDs', async () => {
    const result = await provider.getAvailableCapacity(['slot-1', 'slot-2'])
    expect(result.get('slot-1')).toBeNull()
    expect(result.get('slot-2')).toBeNull()
  })
})
```

**Step 2: Run test, verify fail, implement, verify pass**

Mock returns random capacity (0-12) for each slot. `NullCapacityProvider` always returns null (used when `capacity.type === 'none'` in config).

**Step 3: Commit**

```bash
git add src/providers/mock/capacity.ts tests/providers/mock/capacity.test.ts
git commit -m "feat: add mock and null capacity providers"
```

---

### Task 2.4: Mock Payment Provider

**Files:**
- Create: `src/providers/mock/payment.ts`
- Test: `tests/providers/mock/payment.test.ts`

**Step 1: Write tests covering:**
- `createOrder()` returns order with correct line items and total
- `processPayment()` returns completed payment
- `processPayment()` with token `'FAIL'` returns failed payment (for testing error states)
- `getClientConfig()` returns sandbox config

**Step 2: Implement**

Mock calculates order total from line items, applies discounts. `processPayment()` succeeds unless token is `'FAIL'`. Returns mock receipt URL.

**Step 3: Commit**

```bash
git add src/providers/mock/payment.ts tests/providers/mock/payment.test.ts
git commit -m "feat: add mock payment provider"
```

---

### Task 2.5: Mock Customer Provider

**Files:**
- Create: `src/providers/mock/customer.ts`
- Test: `tests/providers/mock/customer.test.ts`

**Step 1: Write tests covering:**
- `findOrCreate()` creates new customer with generated ID
- `findOrCreate()` returns existing customer if same email
- `subscribe()` doesn't throw

**Step 2: Implement**

In-memory Map keyed by email. `findOrCreate` checks map first.

**Step 3: Commit**

```bash
git add src/providers/mock/customer.ts tests/providers/mock/customer.test.ts
git commit -m "feat: add mock customer provider"
```

---

### Task 2.6: Slack Notification Provider

**Files:**
- Create: `src/providers/slack/notification.ts`
- Test: `tests/providers/slack/notification.test.ts`

**Step 1: Write tests covering:**
- `send()` calls fetch with correct webhook URL and formatted payload
- Payload includes title, severity, details
- Doesn't throw if fetch fails (logs error instead)

**Step 2: Implement**

Uses `fetch()` to POST to Slack webhook URL. Formats `NotificationPayload` into Slack Block Kit message with color-coded severity (info=blue, warning=yellow, critical=red). Catches fetch errors and logs them (never throws — notifications failing shouldn't break the app).

**Step 3: Commit**

```bash
git add src/providers/slack/notification.ts tests/providers/slack/notification.test.ts
git commit -m "feat: add Slack notification provider"
```

---

### Task 2.7: Provider Wiring

**Files:**
- Create: `src/config/providers.ts`
- Test: `tests/config/providers.test.ts`

**Step 1: Write tests covering:**
- `createProviders()` with mock config returns all mock providers
- `createProviders()` with `capacity.type === 'none'` returns NullCapacityProvider
- All returned providers implement their interfaces (have the right methods)

**Step 2: Implement**

Copy `createProviders()` from design doc Section 2. Import all mock providers. Square providers will be added later.

**Step 3: Commit**

```bash
git add src/config/providers.ts tests/config/providers.test.ts
git commit -m "feat: add provider wiring with mock/square selection"
```

---

## Phase 3: Theme System + Layouts

> **Agent team note:** Depends on Phase 1 (config). Can run in parallel with Phase 2 (mock providers).

### Task 3.1: Global Styles — CSS Variables, Textures, Animations

**Files:**
- Create: `src/styles/global.css`
- Create: `src/styles/textures.css`
- Create: `src/styles/animations.css`

**Step 1: Create `src/styles/global.css`**

CSS custom properties populated from config theme values (injected by Layout.astro). ONE color system — no DaisyUI, no conflicting variables. Includes:
- `--color-primary`, `--color-secondary`, `--color-accent`, `--color-background`, `--color-text`, `--color-muted`
- `--font-heading`, `--font-body`
- `--radius-sm`, `--radius-md`, `--radius-lg`
- Base reset (box-sizing, margin, font smoothing)
- Body styling using variables
- `.container` utility (max-width, auto margins, padding)

**Step 2: Create `src/styles/textures.css`**

CSS-only texture patterns:
- `.texture-linen` — subtle repeating linen pattern using CSS gradients (no images)
- `.texture-paper` — paper-like texture with slight noise
- `.texture-clean` — solid color only
- Applied to `body` based on `theme.textures.background` config value

**Step 3: Create `src/styles/animations.css`**

- `.fade-in` — opacity 0→1 transition triggered by `IntersectionObserver` adding `.visible` class
- `.hover-lift` — translateY(-2px) + subtle shadow on hover
- `.hover-glow` — subtle glow effect on hover
- `@keyframes shimmer` — gentle sparkle animation for the Shimmer component
- All animations respect `prefers-reduced-motion`

**Step 4: Commit**

```bash
git add src/styles/
git commit -m "feat: add global styles, textures, and animations"
```

---

### Task 3.2: Base Layout

**Files:**
- Create: `src/layouts/Layout.astro`
- Create: `src/components/shared/Header.astro`
- Create: `src/components/shared/Footer.astro`

**Step 1: Create Layout.astro**

- Imports `siteConfig` from `@config/site.config`
- Injects theme colors as CSS custom properties in `<style>` tag
- Loads Google Fonts for `theme.fonts.heading` and `theme.fonts.body`
- Includes `global.css`, `textures.css`, `animations.css`
- Applies texture class to `<body>` based on `config.theme.textures.background`
- Includes PostHog snippet if `config.analytics.provider === 'posthog'`
- `<slot />` for page content
- Includes Header and Footer components

**Step 2: Create Header.astro**

- Logo (from `config.logo`) + site name (from `config.name`)
- Navigation links auto-generated from `config.features`:
  - Always: Home, About
  - If `features.workshops`: Workshops
  - If `features.parties.enabled`: Book a Party
  - If `features.gallery`: Gallery
- Mobile hamburger menu (CSS-only, no JS)
- Reads from `config.nav` override if provided

**Step 3: Create Footer.astro**

- Contact info from config (email, phone, address)
- Social links (configurable)
- Newsletter signup prompt if `config.features.newsletter`
- Copyright with config name

**Step 4: Verify locally**

```bash
npm run dev
# Visit http://localhost:4321 — should see header + footer with Homegrown branding
```

**Step 5: Commit**

```bash
git add src/layouts/ src/components/shared/Header.astro src/components/shared/Footer.astro
git commit -m "feat: add base layout with config-driven header and footer"
```

---

## Phase 4: Static Pages

> **Agent team note:** Depends on Phase 3 (layouts). All pages can be built in parallel.

### Task 4.1: Home Page

**Files:**
- Create: `src/pages/index.astro`
- Create: `src/components/shared/Newsletter.tsx` (React island)

**Step 1: Build home page**

`src/pages/index.astro` — `export const prerender = true`

Sections:
1. **Hero** — full-width background image, heading (config.tagline), subheading, CTA button ("Book a Party" or "Browse Workshops" depending on features enabled). Linen texture overlay.
2. **What We Offer** — grid of cards auto-generated from `config.features`. Each card: icon, title, short description, link. Only shows enabled features.
3. **Newsletter** — if `config.features.newsletter`, render `<Newsletter client:visible />` React island.

**Step 2: Build Newsletter component**

`src/components/shared/Newsletter.tsx`:
- Email input + submit button
- On submit: `POST /api/customer/subscribe.json` with `{ email }`
- Shows success message or error
- Styled with Tailwind, uses theme colors

**Step 3: Verify locally, commit**

```bash
git add src/pages/index.astro src/components/shared/Newsletter.tsx
git commit -m "feat: add home page with hero, offerings grid, newsletter"
```

---

### Task 4.2: About Page

**Files:**
- Create: `src/pages/about.astro`
- Create: `src/content/about/story.md`
- Create: `src/content/config.ts` (Astro content collection config)

About page with configurable content sections. Prerendered. Uses Astro content collections for story content.

**Commit:**
```bash
git commit -m "feat: add about page with content collections"
```

---

### Task 4.3: Gallery Page

**Files:**
- Create: `src/pages/gallery.astro`
- Create: `src/components/shared/Lightbox.tsx` (React island)
- Create: `src/content/gallery/` (placeholder images + captions)

Gallery only renders if `config.features.gallery`. Masonry grid, lightbox on click. Placeholder images for now.

**Commit:**
```bash
git commit -m "feat: add gallery page with lightbox"
```

---

## Phase 5: API Routes

> **Agent team note:** Depends on Phase 1 (interfaces, logger, errors) and Phase 2 (provider wiring). ALL API routes can be built in parallel — they're independent files.

### Task 5.1: Workshop API Routes

**Files:**
- Create: `src/pages/api/workshops/list.json.ts`
- Create: `src/pages/api/workshops/availability.json.ts`
- Test: `tests/api/workshops.test.ts`

Every API route follows the EXACT pattern from design doc Section 5: import logger + providers, try/catch, log with timing, notify on failure, return JSON.

**Tests:** Call the handler functions directly with mock request objects. Verify they return correct status codes and JSON shapes using mock providers.

**Commit:**
```bash
git commit -m "feat: add workshop list and availability API routes"
```

---

### Task 5.2: Booking API Routes

**Files:**
- Create: `src/pages/api/booking/availability.json.ts`
- Create: `src/pages/api/booking/create.json.ts`
- Create: `src/pages/api/booking/cancel.json.ts`
- Test: `tests/api/booking.test.ts`

**Commit:**
```bash
git commit -m "feat: add booking CRUD API routes"
```

---

### Task 5.3: Catalog API Routes

**Files:**
- Create: `src/pages/api/catalog/event-types.json.ts`
- Create: `src/pages/api/catalog/add-ons.json.ts`
- Create: `src/pages/api/catalog/pricing.json.ts`
- Test: `tests/api/catalog.test.ts`

**Commit:**
```bash
git commit -m "feat: add catalog API routes"
```

---

### Task 5.4: Checkout API Routes

**Files:**
- Create: `src/pages/api/checkout/create-order.json.ts`
- Create: `src/pages/api/checkout/process-payment.json.ts`
- Create: `src/pages/api/checkout/validate-coupon.json.ts`
- Create: `src/pages/api/checkout/client-config.json.ts`
- Test: `tests/api/checkout.test.ts`

`validate-coupon.json.ts` uses `validateCoupon()` from `@lib/coupons`.
`client-config.json.ts` returns `PaymentProvider.getClientConfig()` (safe to expose — just app ID and location ID).

**Commit:**
```bash
git commit -m "feat: add checkout and coupon validation API routes"
```

---

### Task 5.5: Customer and Inquiry API Routes

**Files:**
- Create: `src/pages/api/customer/find-or-create.json.ts`
- Create: `src/pages/api/customer/subscribe.json.ts`
- Create: `src/pages/api/inquiry/submit.json.ts`
- Test: `tests/api/customer.test.ts`

`inquiry/submit.json.ts` calls `NotificationProvider.send()` with type `'corporate-inquiry'`.

**Commit:**
```bash
git commit -m "feat: add customer and inquiry API routes"
```

---

## Phase 6: Workshop Explorer

> **Agent team note:** Depends on Phase 5 (API routes) and Phase 3 (layouts).

### Task 6.1: Workshop Card Component

**Files:**
- Create: `src/components/workshops/WorkshopCard.tsx`
- Test: `tests/components/workshops/WorkshopCard.test.tsx`

**Tests:**
- Renders workshop name, date, time, price, duration
- Shows remaining seats when capacity is a number
- Hides seat count when capacity is null
- Shows "Book Seat" button
- Does NOT render at all when capacity is 0

**Commit:**
```bash
git commit -m "feat: add WorkshopCard component with capacity display"
```

---

### Task 6.2: Calendar and Search Views

**Files:**
- Create: `src/components/workshops/CalendarView.tsx`
- Create: `src/components/workshops/SearchView.tsx`
- Create: `src/components/workshops/WorkshopExplorer.tsx`
- Test: `tests/components/workshops/WorkshopExplorer.test.tsx`

**WorkshopExplorer:** Parent component with view toggle (calendar/list). Receives workshop data as props. Client-side filtering (text search, category, date range).

**CalendarView:** Month grid. Days with workshops show dots. Click day to expand and show workshop cards.

**SearchView:** Text search input, category filter dropdown, date range picker. Filters workshop list in real-time.

**Tests:**
- WorkshopExplorer renders toggle and defaults to search view
- Search filters by workshop name
- Category filter works
- View toggle switches between calendar and search

**Commit:**
```bash
git commit -m "feat: add workshop explorer with calendar and search views"
```

---

### Task 6.3: Workshops Astro Page

**Files:**
- Create: `src/pages/workshops.astro`

SSR page (`prerender = false`). Server-side:
1. Calls `providers.catalog.getEventTypes({ category: 'workshop' })`
2. Calls `providers.booking.searchAvailability()` for next 30 days
3. Calls `providers.capacity.getAvailableCapacity()`
4. Merges data, filters out full workshops (capacity === 0)
5. Passes merged data as props to `<WorkshopExplorer client:load />`

**Commit:**
```bash
git commit -m "feat: add workshops page with SSR data fetching"
```

---

## Phase 7: Party Builder Wizard

> **Agent team note:** Depends on Phase 5 (API routes). All wizard steps can be built in parallel once WizardContext exists.

### Task 7.1: Wizard State Management

**Files:**
- Create: `src/components/booking/WizardContext.tsx`
- Test: `tests/components/booking/WizardContext.test.tsx`

**WizardState type:**
```ts
interface WizardState {
  currentStep: number
  eventType: EventTypeConfig | null
  selectedDates: { start: string; end: string } | null
  desiredDuration: number | null       // for corporate
  selectedSlot: TimeSlot | null
  guestCount: number
  selectedAddOns: string[]             // add-on IDs
  specialRequests: string
  customerInfo: { name: string; email: string; phone: string } | null
  couponCode: string | null
  appliedDiscount: Discount | null
  orderId: string | null
  bookingId: string | null
  paymentStatus: 'idle' | 'processing' | 'completed' | 'failed'
  error: string | null
}
```

**Actions:** `SET_EVENT_TYPE`, `SET_DATES`, `SET_SLOT`, `SET_GUEST_COUNT`, `TOGGLE_ADDON`, `SET_SPECIAL_REQUESTS`, `SET_CUSTOMER_INFO`, `APPLY_COUPON`, `SET_ORDER_ID`, `SET_BOOKING_ID`, `SET_PAYMENT_STATUS`, `SET_ERROR`, `GO_TO_STEP`, `RESET`

**Tests:**
- Initial state has step 0, null selections
- SET_EVENT_TYPE advances to step 1
- TOGGLE_ADDON adds/removes from selectedAddOns
- RESET returns to initial state

**Commit:**
```bash
git commit -m "feat: add party builder wizard state management"
```

---

### Task 7.2: Event Type Step

**Files:**
- Create: `src/components/booking/steps/EventTypeStep.tsx`
- Test: `tests/components/booking/steps/EventTypeStep.test.tsx`

Cards for each event type from config. Click dispatches `SET_EVENT_TYPE`. Shows name, description, starting price (from first variation), duration.

**Commit:**
```bash
git commit -m "feat: add event type selection step"
```

---

### Task 7.3: Date Selection Step

**Files:**
- Create: `src/components/booking/steps/DateSelectionStep.tsx`
- Create: `src/components/shared/DateRangePicker.tsx`
- Test: `tests/components/booking/steps/DateSelectionStep.test.tsx`

Date range picker component (can use a lightweight library like `react-day-picker` or custom). For `flow: 'quote'` events, also shows duration selector. On date confirmation, fetches availability from `/api/booking/availability.json`.

**Commit:**
```bash
git commit -m "feat: add date selection step with date range picker"
```

---

### Task 7.4: Available Slots Step

**Files:**
- Create: `src/components/booking/steps/AvailableSlotsStep.tsx`
- Test: `tests/components/booking/steps/AvailableSlotsStep.test.tsx`

Displays available time slots returned from the availability API call. Grouped by date. Each slot shows time, duration. Click selects and advances.

**Commit:**
```bash
git commit -m "feat: add available slots selection step"
```

---

### Task 7.5: Customize Step

**Files:**
- Create: `src/components/booking/steps/CustomizeStep.tsx`
- Test: `tests/components/booking/steps/CustomizeStep.test.tsx`

Two modes based on `eventType.flow`:

**'booking' mode:** Guest count input (shows base capacity, overage price per extra guest), add-on checkboxes (fetched from `/api/catalog/add-ons.json`), running price total that updates live as selections change, special requests textarea.

**'quote' mode:** Common options checkboxes (from event type config), free text textarea, no pricing shown.

**Tests:**
- Booking mode shows guest count and add-ons
- Quote mode shows only options and textarea
- Price total updates when guest count changes
- Price total updates when add-on is toggled

**Commit:**
```bash
git commit -m "feat: add customize step with pricing calculator"
```

---

### Task 7.6: Checkout Step

**Files:**
- Create: `src/components/booking/steps/CheckoutStep.tsx`
- Create: `src/components/checkout/OrderSummary.tsx`
- Create: `src/components/checkout/CouponInput.tsx`
- Create: `src/components/checkout/PaymentForm.tsx`
- Test: `tests/components/booking/steps/CheckoutStep.test.tsx`
- Test: `tests/components/checkout/CouponInput.test.tsx`

**CheckoutStep:** Customer info form (name, email, phone) + OrderSummary + CouponInput + PaymentForm + "Book & Pay" button.

**OrderSummary:** Renders all line items, discounts, total. Purely presentational.

**CouponInput:** Text input + "Apply" button. Calls `/api/checkout/validate-coupon.json`. Shows success (green, discount description) or error (red, error message).

**PaymentForm:** Wrapper around Square Web Payments SDK. Loads SDK from CDN, initializes card form in an iframe. Exposes `tokenize()` method. In mock mode, returns a fake token.

**Checkout flow on "Book & Pay" click (sequential):**
1. Validate all fields
2. `POST /api/customer/find-or-create.json`
3. Build line items from wizard state
4. `POST /api/checkout/create-order.json`
5. Call `PaymentForm.tokenize()`
6. `POST /api/checkout/process-payment.json`
7. `POST /api/booking/create.json` with orderId
8. Show confirmation (receipt URL, booking details)

Each step shows loading state. Errors show user-friendly messages with retry.

**Tests:**
- CouponInput shows discount on valid code
- CouponInput shows error on invalid code
- OrderSummary renders all line items
- OrderSummary applies discount correctly

**Commit:**
```bash
git commit -m "feat: add checkout step with payment, coupons, order summary"
```

---

### Task 7.7: Inquiry Step (Corporate/Quote Flow)

**Files:**
- Create: `src/components/booking/steps/InquiryStep.tsx`
- Test: `tests/components/booking/steps/InquiryStep.test.tsx`

Customer info form + review of all selections + "Submit Inquiry" button. On submit: creates customer, sends notification, shows confirmation.

**Commit:**
```bash
git commit -m "feat: add inquiry submission step for quote-only events"
```

---

### Task 7.8: Party Wizard Shell and Astro Page

**Files:**
- Create: `src/components/booking/PartyWizard.tsx`
- Create: `src/pages/book.astro`
- Test: `tests/components/booking/PartyWizard.test.tsx`

**PartyWizard.tsx:** Wraps WizardContext provider. Renders current step based on `state.currentStep`. Step indicator/progress bar at top. Back button on steps > 0.

**book.astro:** SSR page. Passes `siteConfig.eventTypes` (filtered to enabled party types) as props to `<PartyWizard client:load />`.

**Tests:**
- Renders step 0 (event type) by default
- Advancing through steps renders correct components
- Back button goes to previous step

**Commit:**
```bash
git commit -m "feat: add party wizard shell and book page"
```

---

## Phase 8: Square Providers

> **Agent team note:** Depends on Phase 1 (interfaces). Can start as soon as interfaces exist. Does NOT depend on UI phases.

### Task 8.1: Square Catalog Provider

**Files:**
- Create: `src/providers/square/catalog.ts`
- Test: `tests/providers/square/catalog.test.ts`

Uses Square SDK `catalogApi.listCatalog()` and `catalogApi.retrieveCatalogObject()`. Maps Square `CatalogItem` → our `EventType` interface. Maps `CatalogItemVariation` → `EventVariation`. Maps `CatalogModifier` → `AddOn`.

**Important:** Square SDK returns `BigInt` for money amounts — must convert to `Number` (cents). Use the custom JSON serializer pattern from v1.

**Tests:** Mock the Square SDK client. Verify mapping is correct.

**Commit:**
```bash
git commit -m "feat: add Square catalog provider"
```

---

### Task 8.2: Square Booking Provider

**Files:**
- Create: `src/providers/square/booking.ts`
- Test: `tests/providers/square/booking.test.ts`

Uses Square SDK `bookingsApi.searchAvailability()`, `bookingsApi.createBooking()`, `bookingsApi.cancelBooking()`, `bookingsApi.retrieveBooking()`.

After `createBooking()`, also calls `bookingCustomAttributesApi.bulkUpsertBookingCustomAttributes()` to attach `event_type`, `guest_count`, `add_ons`, `order_id`, `special_requests`.

**Commit:**
```bash
git commit -m "feat: add Square booking provider"
```

---

### Task 8.3: Square Payment Provider

**Files:**
- Create: `src/providers/square/payment.ts`
- Test: `tests/providers/square/payment.test.ts`

Uses Square SDK `ordersApi.createOrder()` and `paymentsApi.createPayment()`. Maps our `LineItem` → Square `OrderLineItem`. Maps our `Discount` → Square `OrderLineItemDiscount`.

`getClientConfig()` returns app ID, location ID, environment from config (safe to expose to frontend).

**Commit:**
```bash
git commit -m "feat: add Square payment provider"
```

---

### Task 8.4: Square Customer Provider

**Files:**
- Create: `src/providers/square/customer.ts`
- Test: `tests/providers/square/customer.test.ts`

Uses `customersApi.searchCustomers()` (by email) → if found, return. If not, `customersApi.createCustomer()`. `subscribe()` is the same as `findOrCreate()` with just email (creates a customer record for newsletter-only signups).

**Important:** New customer profiles take up to 30 seconds to be searchable. `findOrCreate` should handle the race condition by catching "not found" on search and creating.

**Commit:**
```bash
git commit -m "feat: add Square customer provider"
```

---

### Task 8.5: Square Internal Capacity Provider

**Files:**
- Create: `src/providers/square/capacity.ts`
- Test: `tests/providers/square/capacity.test.ts`

Uses the undocumented internal API:
```
POST https://app.squareup.com/appointments/api/buyer/classes/class_schedule_instances/search?unit_token={unitToken}
```

Headers MUST include:
```
Content-Type: application/json
Origin: https://book.squareup.com
Referer: https://book.squareup.com/
```

Maps `class_schedule_instances[].available_capacity` → our `CapacityInfo`.

**Critical:** This provider MUST:
1. Tag all log entries with `is_internal_api: true`
2. Catch ALL errors and return `null` (graceful degradation)
3. Send Slack notification on any failure via `NotificationProvider`
4. Never throw — a capacity failure should not break the workshops page

**Tests:** Mock fetch. Verify correct headers sent. Verify null returned on failure. Verify Slack notification sent on failure.

**Commit:**
```bash
git commit -m "feat: add Square internal capacity provider with graceful degradation"
```

---

## Phase 9: Webhook Handler

### Task 9.1: Square Webhook Handler

**Files:**
- Create: `src/pages/api/webhooks/square.json.ts`
- Create: `src/lib/webhook-verify.ts`
- Test: `tests/api/webhooks.test.ts`

Validates HMAC-SHA256 signature from Square. Handles event types: `booking.created`, `booking.updated`, `payment.created`, `payment.updated`. Logs all events. Returns 200 quickly (within 10 seconds — Square's requirement).

**Commit:**
```bash
git commit -m "feat: add Square webhook handler with signature verification"
```

---

## Phase 10: Analytics

### Task 10.1: PostHog Integration

**Files:**
- Modify: `src/layouts/Layout.astro` (add PostHog script)
- Create: `src/lib/analytics.ts` (wrapper for tracking calls)

`analytics.ts` exports typed tracking functions:
```ts
export function trackWizardStarted(eventType: string): void
export function trackWizardStepCompleted(step: string): void
export function trackBookingCompleted(eventType: string): void
export function trackCouponApplied(codeName: string): void
// etc.
```

Each function calls `window.posthog?.capture()` if PostHog is loaded, no-ops otherwise. This keeps tracking calls clean in components.

**Commit:**
```bash
git commit -m "feat: add PostHog analytics integration"
```

---

## Phase 11: Polish and Integration Testing

### Task 11.1: Shimmer/Particle Effect Component

**Files:**
- Create: `src/components/shared/Shimmer.tsx`

Subtle CSS particle shimmer effect. Renders as a background layer. Only active if `config.theme.animations.particles === true`. Uses CSS `@keyframes` — no heavy JS libraries.

**Commit:**
```bash
git commit -m "feat: add subtle shimmer particle effect component"
```

---

### Task 11.2: Scroll Fade-In Observer

**Files:**
- Create: `src/lib/fade-in.ts`

Small script that uses `IntersectionObserver` to add `.visible` class to `.fade-in` elements when they enter the viewport. Loaded in Layout.astro. Respects `prefers-reduced-motion`.

**Commit:**
```bash
git commit -m "feat: add scroll-triggered fade-in animations"
```

---

### Task 11.3: End-to-End Integration Test

**Files:**
- Create: `tests/e2e/booking-flow.test.ts`

Using Vitest (not Playwright — keep it lightweight for now):
1. Test the full wizard flow with mock providers: select event type → select dates → pick slot → customize → checkout
2. Verify API routes return correct data with mock providers
3. Verify coupon flow works end-to-end

**Commit:**
```bash
git commit -m "test: add end-to-end booking flow integration test"
```

---

### Task 11.4: Final Commit and Deploy Preview

**Step 1: Run all tests**
```bash
npx vitest run
```
Expected: All pass

**Step 2: Build**
```bash
npm run build
```
Expected: No errors

**Step 3: Test locally**
```bash
npm run dev
# Manual smoke test: navigate all pages, run through wizard with mock data
```

**Step 4: Push to dev for free deploy preview**
```bash
git push origin dev
```

**Step 5: Verify Netlify deploy preview**

Check the deploy preview URL. All pages should load. Wizard should work with mock data.

---

## Phase 12: Square Setup (Manual + Script)

> **This phase involves setting up real data in Square. Do this AFTER the site works with mock data.**

### Task 12.1: Setup Script

**Files:**
- Create: `scripts/setup-square.ts`

Script that:
1. Creates booking custom attribute definitions (event_type, guest_count, add_ons, order_id, special_requests)
2. Creates webhook subscriptions for all required events
3. Validates catalog categories exist
4. Outputs summary

Run: `SQUARE_ACCESS_TOKEN=xxx npx tsx scripts/setup-square.ts`

**Commit:**
```bash
git commit -m "feat: add Square setup script for custom attributes and webhooks"
```

---

### Task 12.2: Square Catalog Setup Guide

**Files:**
- Create: `docs/square-setup-guide.md`

Step-by-step instructions for setting up in Square Dashboard:
1. Create categories (Workshops, Birthday Parties, Adult Parties, Corporate Events)
2. Create items with variations and modifier lists
3. Set up Loyalty program
4. Run setup script
5. Switch `PROVIDER_MODE=square` in .env

**Commit:**
```bash
git commit -m "docs: add Square catalog setup guide"
```

---

## Summary: Parallelization Map

```
Phase 0: Scaffolding (sequential, one-time)
  │
  ├── Phase 1: Foundation (all parallel)
  │     ├── 1.1 Config
  │     ├── 1.2 Interfaces
  │     ├── 1.3 Errors
  │     ├── 1.4 Logger
  │     └── 1.5 Coupons
  │
  ├── Phase 2: Mock Providers (all parallel, needs Phase 1)
  │     ├── 2.1 Mock Catalog
  │     ├── 2.2 Mock Booking
  │     ├── 2.3 Mock Capacity
  │     ├── 2.4 Mock Payment
  │     ├── 2.5 Mock Customer
  │     ├── 2.6 Slack Notification
  │     └── 2.7 Provider Wiring
  │
  ├── Phase 3: Theme + Layouts (needs Phase 1, parallel with Phase 2)
  │     ├── 3.1 CSS System
  │     └── 3.2 Layout + Header + Footer
  │
  ├── Phase 4: Static Pages (all parallel, needs Phase 3)
  │     ├── 4.1 Home
  │     ├── 4.2 About
  │     └── 4.3 Gallery
  │
  ├── Phase 5: API Routes (all parallel, needs Phase 2)
  │     ├── 5.1 Workshop Routes
  │     ├── 5.2 Booking Routes
  │     ├── 5.3 Catalog Routes
  │     ├── 5.4 Checkout Routes
  │     └── 5.5 Customer/Inquiry Routes
  │
  ├── Phase 6: Workshop Explorer (needs Phase 5 + 3)
  │     ├── 6.1 WorkshopCard
  │     ├── 6.2 Calendar + Search Views
  │     └── 6.3 Workshops Page
  │
  ├── Phase 7: Party Wizard (needs Phase 5, 7.1 first then rest parallel)
  │     ├── 7.1 WizardContext (first)
  │     ├── 7.2-7.7 Steps (parallel, need 7.1)
  │     └── 7.8 Wizard Shell + Page
  │
  ├── Phase 8: Square Providers (needs Phase 1 only, parallel with everything)
  │     ├── 8.1-8.4 Official API Providers
  │     └── 8.5 Internal Capacity Provider
  │
  ├── Phase 9: Webhooks (needs Phase 1)
  ├── Phase 10: Analytics (needs Phase 3)
  ├── Phase 11: Polish + Testing
  └── Phase 12: Square Setup (last)
```
