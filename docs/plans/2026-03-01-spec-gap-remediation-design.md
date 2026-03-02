# Spec Gap Remediation Design

**Date:** 2026-03-01
**Status:** Approved
**Goal:** Close all gaps between the booking platform spec and current implementation

---

## Context

Full audit of site vs spec (`2026-03-01-booking-platform-design.md`) identified ~16 gaps:
- 7 missing files
- 4 functional bugs (payments, pricing, environment, HMAC)
- 5 content/polish gaps (gallery, testimonials, analytics events, webhook events, customer subscribe)

## Design Decisions

### PaymentForm.tsx — SDK-Ready Stub
- Loads Square Web Payments SDK when `PaymentClientConfig.appId` is present
- Falls back to mock token when `appId` is empty/missing
- No new flags — existing `getClientConfig()` controls behavior
- Component initializes card iframe via SDK, exposes `tokenize()` that returns real or mock nonce

### Catalog Content — Spec Items as Defaults
- `site.config.ts` eventTypes populated with spec items (exact prices, durations, capacities)
- Mock data in `providers/mock/data.ts` mirrors config eventTypes
- `catalogItemId` on each eventType maps to Square when `PROVIDER_MODE=square`
- Easy to tweak names/prices later in config

### Gallery — Content Collection with Placeholders
- Create `src/content/gallery/` with Astro content collection
- Refactor `gallery.astro` to use collection instead of hardcoded array
- Styled SVG/CSS gradient placeholders that look intentional

---

## Phase A — Foundation Fixes

1. **SquarePaymentProvider environment bug** — add `environment: config.environment` to SquareClient constructor
2. **webhook-verify timing-safe comparison** — use `crypto.timingSafeEqual` instead of `===`
3. **Create `src/lib/types.ts`** — centralize shared types (API response shapes, common utility types)
4. **Create `src/lib/utils.ts`** — price formatting (`formatCents`), date formatting helpers
5. **Missing analytics events** — add `trackWizardAbandoned`, `trackWorkshopSeatBooked`, `trackNewsletterSubscribed`
6. **Webhook subscription events** — add `order.created`, `order.updated` to setup script's WEBHOOK_EVENTS
7. **SquareCustomerProvider.subscribe** — search for existing customer by email first, only create if not found, don't pass blank names

## Phase B — Catalog & Content

8. **Populate `site.config.ts` eventTypes** — Candle Making ($45, 120min), Pottery Basics ($55, 120min), Birthday Party ($350 base/12 kids, extra child $25), Adult Party ($400 base/12 guests, extra guest $30), Corporate Events (quote-only)
9. **Update mock data** — `providers/mock/data.ts` returns items matching config eventTypes with correct prices, durations, categories, add-ons
10. **Gallery content collection** — create schema in `content.config.ts`, add `src/content/gallery/` entries with placeholder images, refactor `gallery.astro`
11. **Home page testimonials** — add testimonials array to `SiteConfig`, render section in `index.astro` when present

## Phase C — Checkout Critical Path

12. **PaymentForm.tsx** — SDK-ready component: fetch client config, load SDK script, initialize card element, expose `tokenize()`. Mock fallback when no appId.
13. **CheckoutStep pricing fix** — read price from selected variation/event type, pass real `pricePerUnit` into `buildLineItems()`

## Phase D — Polish

14. **StaticLayout.astro** — stripped-down layout for prerendered pages (no dynamic imports, minimal head)
15. **DateRangePicker.tsx** — extract date inputs from DateSelectionStep into reusable shared component
16. **Create `public/fonts/` and `public/images/` directories** — with `.gitkeep` files

---

## Verification

- `tsc` clean after each phase
- All existing 186 tests still pass
- New tests for: PaymentForm tokenization (mock + real paths), CheckoutStep pricing, utils functions, gallery collection rendering
- `astro build` succeeds
- Local dev (`npm run dev`) shows updated content
