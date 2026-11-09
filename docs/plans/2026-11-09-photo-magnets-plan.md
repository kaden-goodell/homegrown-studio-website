# Photo Magnets Shop Implementation Plan

> **Design:** brainstorm with Kaden, 2026-11-09 (decisions recorded below — no separate design doc)
> **For agents:** Use team-dev (parallel) or sdd (sequential) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Follow the `tdd` skill (red → green → commit).

**Goal:** A `/shop` page where anyone can order 2×2" photo magnets in sets of 6 ($18 a set), crop each photo themselves, pay online, and pick up or have them shipped — plus an owner Orders tab that prints the exact Canva template sheet.

**Architecture:** The browser crops every photo to a 600×600 JPEG (2" at 300 dpi) and uploads each finished square to a draft in Netlify Blobs before payment. The order endpoint prices everything on the server, charges through the existing `PaymentProvider` (Square order + payment, idempotent per attempt), and saves the order record. `/admin` gets an Orders tab and a print page that lays the photos out 12 to a letter sheet at the template's exact positions. A daily job deletes abandoned drafts after 24 h and finished orders' photos after 30 days.

**Tech Stack:** Astro 5 SSR + React 19 islands, Netlify Blobs via `makeKvStore`, Square via `providers.payment` / `providers.customer`, nodemailer `sendEmail`, vitest + jsdom.

---

## Decisions (from Kaden, 2026-11-09)

| Topic | Decision |
|---|---|
| Product | Photo Magnets, 2"×2" square, sold in sets of 6. $3 a magnet = $18 a set. 1–10 sets per order. |
| Photos | One photo per magnet; the same photo may fill several magnets. Each is cropped by the customer in a 2×2 square with a dashed safe-area line, drag + zoom. Close-up hint shown; low-resolution warning shown. |
| Delivery | Customer chooses pickup at the studio (free) or shipping ($6 flat, address required). |
| Tax | 9% on magnets only, attached explicitly to the magnet line (order-level `taxes` with `scope: LINE_ITEM` + `appliedTaxes` on that line). **Proven 2026-11-09 with Square `orders/calculate` (no write):** plain lines → $0 tax (the current provider never taxes); `autoApplyTaxes` → taxes shipping too ($45.78 for 2 sets shipped); explicit line tax → **$45.24 = our quote**. Shipping is its own untaxed catalog item until Chris says otherwise. |
| Tax report | New `shop` bucket (category "Shop") reported as **sales** tax, like kits. Shipping is a catalog item in "Shop", so it lands there too, not in "unsure". |
| Preview orders | Previews share production's blob stores, so simulated orders are hidden from the live admin list (shown only on preview/dev). |
| Webhooks / archive | Square's webhook already posts a notice for every order/payment; the owner email is the useful one and the webhook stays as is. The magnet stores are deliberately NOT added to the weekly archive (photos would bloat it). |
| Turnaround | "Ready within 7 days" in copy and email. |
| Where | New `/shop` page, top-level "Shop" in the menu, live with the next prod push (no feature flag). |
| Staff side | `/admin` Orders tab (Catherine on an iPad): photos, a Print button → Canva template layout, statuses New → Made → Ready for pickup / Shipped → Picked up. "Ready" and "Shipped" email the customer. |
| Print template | Canva "fridge Magnet Template 01" page 1: letter, 3 across × 4 down, 2.5" cut frame with 45° clipped corners (0.463" legs), 2" photo inset 0.25", a 1px black hairline around the photo (as in the template), edges blank (no "Add Your Text"). |
| Privacy | Photos are owner-only, deleted 30 days after an order is Picked up / Shipped; abandoned drafts deleted after 24 h. |
| Copy | All customer copy lives in `src/config/shop-content.ts` as a DRAFT and must be shown to Kaden and approved before the prod push. No colons in customer copy. |

## Contract (transposed)

```
[DATA] shop.config.ts holds price, set size, max sets, shipping, tax %, turnaround, Square ids
[DATA] KvStore gains delete(key) in both Blobs and disk modes
[DATA] magnet photos stored per draft, keyed p-<draftId>-<ms>-<rand>, base64 JPEG ≤ 400 KB
[DATA] magnet order record (reference M-XXXXXX, status, sets, magnets[], delivery, address, contact, amounts, Square ids, doneAt, photosDeletedAt)
[DATA] Square catalog item "Photo Magnets – Set of 6" $18 with the 9% tax, category "Shop"
[LOGIC] quoteMagnets(sets, delivery) → subtotal, tax, shipping, total (server is the only source of the charged price)
[LOGIC] crop math: cover-fit minimum zoom, offset clamping, source rect, print-quality check (< 400 source px = "may print blurry")
[LOGIC] sheet layout: 12 cells per letter page at the template's positions, in order, repeats included
[LOGIC] status rules: new/made/ready/shipped/picked_up; ready only for pickup, shipped only for ship; done = picked_up|shipped sets doneAt
[LOGIC] cleanup: drafts with no order older than 24 h deleted; photos of orders done > 30 days deleted, photosDeletedAt set
[API] POST /api/shop/magnet-photo.json — validated JPEG upload to a draft, rate limited
[API] POST /api/shop/magnet-order.json — validate, price, charge (idempotent), save, email, report
[API] GET/POST /api/admin/magnet-orders.json — list, change status (emails on ready/shipped)
[API] GET /api/admin/magnet-photo — serve one photo to owners
[API] POST /api/jobs/shop-cleanup.json + netlify/functions/shop-cleanup.ts daily
[UI] /shop page + Shop in nav
[UI] MagnetCropper (drag, pinch, zoom slider, dashed safe area, warnings)
[UI] MagnetOrderModal on BookingPanel: Photos → Delivery & contact → Pay → confirmation
[UI] Admin Orders tab + MagnetOrderCard + /admin/magnets-print print page
[LOGIC] emails: customer confirmation, owner new-order notice, ready / shipped notices
[LOGIC] analytics: 'shop' booking kind on client + server events
```

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/config/shop.config.ts` | Create | Prices, limits, Square ids |
| `src/config/shop-content.ts` | Create | All customer copy (DRAFT, needs Kaden's OK) |
| `src/lib/magnet-pricing.ts` | Create | `quoteMagnets`, `isValidSets` |
| `src/lib/magnet-crop.ts` | Create | Pure crop math |
| `src/lib/magnet-sheet.ts` | Create | Pure print-sheet layout |
| `src/lib/blob-store.ts` | Modify | Add `delete(key)` |
| `src/lib/magnet-orders.ts` | Create | Photo + order persistence, statuses, cleanup |
| `src/lib/magnet-emails.ts` | Create | Customer + owner emails |
| `src/lib/analytics.ts` | Modify | `'shop'` in `BookingKindForAnalytics` |
| `src/lib/posthog-server.ts` | Modify | `'shop'` in `ServerBooking.kind` |
| `src/pages/api/shop/magnet-photo.json.ts` | Create | Upload endpoint |
| `src/pages/api/shop/magnet-order.json.ts` | Create | Checkout endpoint |
| `src/pages/api/admin/magnet-orders.json.ts` | Create | Owner list + status |
| `src/pages/api/admin/magnet-photo.ts` | Create | Owner photo serving |
| `src/pages/api/jobs/shop-cleanup.json.ts` | Create | Cleanup job endpoint |
| `netlify/functions/shop-cleanup.ts` | Create | Daily trigger |
| `src/pages/admin/magnets-print.astro` | Create | Print sheet page |
| `src/components/shop/MagnetCropper.tsx` | Create | Crop UI |
| `src/components/shop/MagnetOrderModal.tsx` | Create | Order flow |
| `src/components/shop/MagnetOrderButton.tsx` | Create | Island that opens the modal |
| `src/pages/shop.astro` | Create | Shop page |
| `src/config/site.config.ts` | Modify | "Shop" nav item |
| `src/components/admin/MagnetOrderCard.tsx` | Create | One order in admin |
| `src/components/admin/AdminApp.tsx` | Modify | Orders tab |
| `scripts/seed-shop.ts` | Create | Square catalog items: magnets (taxed) + shipping (preview default, `--apply`) |
| `src/lib/magnet-status.ts` | Create | Client-safe statuses, labels, `MagnetOrder` type |
| `src/providers/interfaces/payment.ts` | Modify | `LineItem.tax` |
| `src/providers/square/payment.ts` | Modify | Order-level taxes + `appliedTaxes` per line |
| `src/providers/mock/payment.ts` | Modify | Mock adds line tax |
| `src/lib/tax-report.ts` | Modify | `shop` bucket → sales tax |
| `src/pages/sitemap.xml.ts` | Modify | `/shop` |
| `tests/lib/magnet-pricing.test.ts` | Create | |
| `tests/lib/magnet-crop.test.ts` | Create | |
| `tests/lib/magnet-sheet.test.ts` | Create | |
| `tests/lib/blob-store-delete.test.ts` | Create | |
| `tests/lib/magnet-orders.test.ts` | Create | |
| `tests/api/shop-magnet-photo.test.ts` | Create | |
| `tests/api/shop-magnet-order.test.ts` | Create | |
| `tests/api/admin-magnet-orders.test.ts` | Create | |
| `tests/api/jobs-shop-cleanup.test.ts` | Create | |
| `tests/components/shop/MagnetCropper.test.tsx` | Create | |
| `tests/components/shop/MagnetOrderModal.test.tsx` | Create | |
| `tests/components/admin/MagnetOrderCard.test.tsx` | Create | |

Test command everywhere: `npx vitest run <path>`; full suite `npm test`.

## Review amendments (2026-11-09) — binding

The plan review swarm + logic reviewer found the issues below. Each is fixed **in the task text**; this list is the index.

| # | Fix | Task |
|---|---|---|
| A1 | Square never taxed API orders. New **T9a** adds per-line tax to `PaymentProvider.createOrder` (Square + mock). | T9a, T9 |
| A2 | Crop test expected flipped signs. Corrected numbers. | T3 |
| A3 | `KvStore.list(prefix?)` so draft lookups don't scan every photo. | T5, T6 |
| A4 | Client-safe `src/lib/magnet-status.ts` (statuses, labels, types) so admin UI never imports `node:crypto`. | T6, T16 |
| A5 | Cleanup: pending markers keep paid-but-unsaved drafts; one map built once; per-record parse guard; re-read before write; `dryRun`. | T6, T17 |
| A6 | Statuses: same-status = no-op (no email); emails recorded on the order; `cancelled` added; no moving back once photos are deleted. | T6, T11 |
| A7 | Order endpoint: simulated path before the Square-id check; one order per draft; pending marker before charging; `findOrderPayment` on retry; unknown outcome returns `unknown_outcome`, never "not charged". | T9 |
| A8 | Admin hides simulated orders outside preview/dev. | T6, T11 |
| A9 | Print page CSS uses `define:vars` (Astro does not interpolate `<style>`); verify by seeding an order directly. | T12 |
| A10 | Cropper drag uses functional state updates. | T13 |
| A11 | Modal: `matchMedia` stub in test; new attempt id when quote inputs change; error cleared on step change; no close or double-submit while paying; missing-photo answer clears those slots. | T14 |
| A12 | `/shop` in the sitemap. | T15 |
| A13 | New **T17a**: tax report `shop` bucket → sales tax. | T17a |
| A14 | Seed split into T18a (script, no deps) / T18b (apply + ids, needs T1, Kaden's go); stable idempotency key; Shipping item; rollback note. | T18a/b |

## Dependency graph

```
T1 config ─┬─ T2 pricing
           ├─ T3 crop math ── T13 cropper ── T14 modal ── T15 shop page + nav
           └─ T18b apply Square ids (Kaden's go)
T4 sheet layout (no deps) ── T12 print page
T5 kv.delete + list(prefix) ── T6 orders store ─┬─ T7 emails ── T11 admin API ─┬─ T12 print page
                                                ├─ T8 photo API                 └─ T16 admin tab
                                                └─ T17 cleanup job
T9a provider line tax ─┐
T10 analytics kind ────┼─ T9 order API (needs T2, T6, T7, T9a, T10)
T17a tax report bucket (no deps)
T18a seed script (no deps)
T19 copy + launch gate (last; needs T18b)
```

Parallel-safe groups: {T1, T4, T5, T9a, T10, T17a, T18a} first; {T2, T3} after T1; {T7, T8, T17} after T6; T11 after T7; {T12, T16} after T11 (T12 also needs T4); T9 after T2+T6+T7+T9a+T10; T13 after T3; T14 after T8+T9+T13.

---

### Task 1: Shop config + copy draft

**Files:**
- Create: `src/config/shop.config.ts`
- Create: `src/config/shop-content.ts`

**Dependencies:** none

- [ ] **Step 1: Create the config**

```ts
// src/config/shop.config.ts
/**
 * The online shop (Kaden, 2026-11-09). First product: 2"×2" photo magnets,
 * sold in sets of 6. The server prices every order from here — never from
 * the browser.
 */
export const shopConfig = {
  magnets: {
    name: 'Photo Magnets',
    setSize: 6,
    setPriceCents: 1800,
    maxSets: 10,
    shippingCents: 600,
    /** The 9% tax on the Square item (XKZ3OIRJ3SPPO4TO64UUDFA4). Shipping is untaxed. */
    taxPercent: 9,
    taxId: 'XKZ3OIRJ3SPPO4TO64UUDFA4',
    readyDays: 7,
    /** Each finished magnet photo: 2" at 300 dpi. */
    outputPx: 600,
    /** Below this many source pixels across the crop the print may look soft. */
    minSharpSourcePx: 400,
    /** Dashed safe-area line, as a fraction of the square kept clear on each side. */
    safeInset: 0.08,
    /** Filled by `scripts/seed-shop.ts --apply`. Empty = the order endpoint refuses (503). */
    square: {
      itemId: '',
      variationId: '',
      shippingVariationId: '',
    },
  },
  maxPhotoBytes: 400_000,
  maxPhotosPerDraft: 60,
  draftRetentionHours: 24,
  photoRetentionDays: 30,
} as const

export type Delivery = 'pickup' | 'ship'
```

- [ ] **Step 2: Create the copy draft** (every string here is shown to Kaden before prod — Task 19)

```ts
// src/config/shop-content.ts
/**
 * DRAFT customer copy for the shop — Kaden approves before prod (no colons,
 * "Hometown Studio", plain and short).
 */
export const shopContent = {
  pageEyebrow: 'Shop',
  pageTitle: 'Little things you can take home',
  pageLead: 'Made by us at the studio, from your photos.',
  magnets: {
    title: 'Photo Magnets',
    blurb: 'Your favorite photos as 2 inch square fridge magnets. Sold in sets of 6.',
    price: '$18 for a set of 6',
    button: 'Make your magnets',
    readyLine: 'Ready within 7 days. Pick up at the studio or we ship for $6.',
  },
  modal: {
    title: 'Photo Magnets',
    stepPhotos: 'Your photos',
    stepDelivery: 'Pickup or shipping',
    stepPay: 'Payment',
    setsLabel: 'How many magnets',
    photosHint: 'Pick a photo for each magnet. You can use the same photo more than once.',
    closeUpHint: 'Photos with a little space around the subject work best. Anything past the dashed line may wrap around the edge.',
    blurryWarning: 'This photo is small, so the magnet may print a little blurry.',
    addPhoto: 'Add photo',
    usePhotoAgain: 'Use again',
    remove: 'Remove',
    pickupLabel: 'Pick up at the studio',
    pickupNote: 'Free. We email you when they are ready.',
    shipLabel: 'Ship to me',
    shipNote: '$6 shipping.',
    addressLabel: 'Shipping address',
    nameLabel: 'Your name',
    emailLabel: 'Email',
    phoneLabel: 'Phone',
    leaveTitle: 'Leave without ordering?',
    leaveBody: 'Your photos are not saved until you pay.',
    keep: 'Keep going',
    leave: 'Close',
    uploading: 'Saving your photos…',
    confirmedHeading: 'Your magnets are ordered',
  },
} as const
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "shop\.config|shop-content" || echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add src/config/shop.config.ts src/config/shop-content.ts
git commit -m "feat(shop): config and draft copy for photo magnets"
```

---

### Task 2: Pricing

**Files:**
- Create: `src/lib/magnet-pricing.ts`
- Test: `tests/lib/magnet-pricing.test.ts`

**Dependencies:** Task 1

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/magnet-pricing.test.ts
import { describe, it, expect } from 'vitest'
import { quoteMagnets, isValidSets } from '@lib/magnet-pricing'

describe('quoteMagnets', () => {
  it('prices one set for pickup with 9% tax', () => {
    expect(quoteMagnets(1, 'pickup')).toEqual({ sets: 1, magnets: 6, subtotalCents: 1800, taxCents: 162, shippingCents: 0, totalCents: 1962 })
  })
  it('adds $6 untaxed shipping', () => {
    expect(quoteMagnets(2, 'ship')).toEqual({ sets: 2, magnets: 12, subtotalCents: 3600, taxCents: 324, shippingCents: 600, totalCents: 4524 })
  })
})

describe('isValidSets', () => {
  it('accepts 1 to 10 whole sets', () => {
    expect(isValidSets(1)).toBe(true)
    expect(isValidSets(10)).toBe(true)
  })
  it('refuses 0, 11, fractions and non-numbers', () => {
    for (const v of [0, 11, 1.5, -1, '2', null, NaN]) expect(isValidSets(v)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/magnet-pricing.test.ts`
Expected: FAIL — cannot resolve `@lib/magnet-pricing`

- [ ] **Step 3: Implement**

```ts
// src/lib/magnet-pricing.ts
import { shopConfig, type Delivery } from '@config/shop.config'
import { taxCents } from '@lib/tax'

export interface MagnetQuote {
  sets: number
  magnets: number
  subtotalCents: number
  taxCents: number
  shippingCents: number
  totalCents: number
}

export function isValidSets(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= shopConfig.magnets.maxSets
}

/** The only place an order's price comes from. Tax on magnets only. */
export function quoteMagnets(sets: number, delivery: Delivery): MagnetQuote {
  const m = shopConfig.magnets
  const subtotalCents = sets * m.setPriceCents
  const tax = taxCents(subtotalCents, m.taxPercent)
  const shippingCents = delivery === 'ship' ? m.shippingCents : 0
  return { sets, magnets: sets * m.setSize, subtotalCents, taxCents: tax, shippingCents, totalCents: subtotalCents + tax + shippingCents }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/magnet-pricing.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/magnet-pricing.ts tests/lib/magnet-pricing.test.ts
git commit -m "feat(shop): server-side magnet pricing"
```

---

### Task 3: Crop math

**Files:**
- Create: `src/lib/magnet-crop.ts`
- Test: `tests/lib/magnet-crop.test.ts`

**Dependencies:** Task 1

The crop state is `{ zoom, x, y }`: `zoom` ≥ 1 multiplies the cover-fit scale; `x`/`y` are the image centre's offset from the square's centre, in source pixels, clamped so the image always covers the square.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/magnet-crop.test.ts
import { describe, it, expect } from 'vitest'
import { coverScale, clampCrop, sourceRect, printQuality, type Crop } from '@lib/magnet-crop'

const landscape = { w: 4000, h: 3000 }

describe('coverScale', () => {
  it('fits the short side to the square', () => {
    expect(coverScale(landscape, 300)).toBeCloseTo(0.1)
  })
})

describe('sourceRect', () => {
  it('centres a square on the short side at zoom 1', () => {
    expect(sourceRect(landscape, { zoom: 1, x: 0, y: 0 })).toEqual({ sx: 500, sy: 0, side: 3000 })
  })
  it('halves the side at zoom 2 and follows the offset', () => {
    // positive x = the image was dragged right, so the visible square moves LEFT (sx goes down)
    expect(sourceRect(landscape, { zoom: 2, x: 200, y: -100 })).toEqual({ sx: 1050, sy: 850, side: 1500 })
  })
})

describe('clampCrop', () => {
  it('keeps zoom at least 1 and at most 6', () => {
    expect(clampCrop(landscape, { zoom: 0.5, x: 0, y: 0 }).zoom).toBe(1)
    expect(clampCrop(landscape, { zoom: 9, x: 0, y: 0 }).zoom).toBe(6)
  })
  it('stops the image from leaving the square', () => {
    const c: Crop = clampCrop(landscape, { zoom: 1, x: 5000, y: 5000 })
    expect(c).toEqual({ zoom: 1, x: 500, y: 0 })
  })
})

describe('printQuality', () => {
  it('flags crops under 400 source pixels', () => {
    expect(printQuality({ w: 800, h: 600 }, { zoom: 2, x: 0, y: 0 })).toBe('low')
    expect(printQuality(landscape, { zoom: 1, x: 0, y: 0 })).toBe('good')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/magnet-crop.test.ts`
Expected: FAIL — cannot resolve `@lib/magnet-crop`

- [ ] **Step 3: Implement**

```ts
// src/lib/magnet-crop.ts
import { shopConfig } from '@config/shop.config'

export interface Size { w: number; h: number }
/** zoom ≥ 1 on top of cover-fit; x/y = image centre offset from the square's centre, in source px. */
export interface Crop { zoom: number; x: number; y: number }
export const MAX_ZOOM = 6

/** Scale that makes the image's short side exactly fill a square of `boxPx`. */
export function coverScale(img: Size, boxPx: number): number {
  return boxPx / Math.min(img.w, img.h)
}

/** The square of the source image the magnet shows. */
export function sourceRect(img: Size, crop: Crop): { sx: number; sy: number; side: number } {
  const side = Math.min(img.w, img.h) / crop.zoom
  return { sx: img.w / 2 - crop.x - side / 2, sy: img.h / 2 - crop.y - side / 2, side }
}

export function clampCrop(img: Size, crop: Crop): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom))
  const side = Math.min(img.w, img.h) / zoom
  const maxX = (img.w - side) / 2
  const maxY = (img.h - side) / 2
  const clamp = (v: number, m: number) => Math.min(m, Math.max(-m, v))
  return { zoom, x: clamp(crop.x, maxX), y: clamp(crop.y, maxY) }
}

export function printQuality(img: Size, crop: Crop): 'good' | 'low' {
  return sourceRect(img, crop).side < shopConfig.magnets.minSharpSourcePx ? 'low' : 'good'
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/magnet-crop.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/magnet-crop.ts tests/lib/magnet-crop.test.ts
git commit -m "feat(shop): crop math for square magnet photos"
```

---

### Task 4: Print-sheet layout

**Files:**
- Create: `src/lib/magnet-sheet.ts`
- Test: `tests/lib/magnet-sheet.test.ts`

**Dependencies:** none

Positions are measured from the Canva template (96-dpi px ÷ 96 = inches): columns 32.524 / 287.984 / 543.443, rows 27.969 / 281.312 / 534.655 / 787.999, frame 240.03 (2.5"), photo 2" inset 0.25", corner legs 139 px at 300 dpi = 0.463".

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/magnet-sheet.test.ts
import { describe, it, expect } from 'vitest'
import { layoutSheets, SHEET, framePolygon } from '@lib/magnet-sheet'

describe('layoutSheets', () => {
  it('puts 12 on a page, left to right then down', () => {
    const pages = layoutSheets(Array.from({ length: 14 }, (_, i) => `p${i}`))
    expect(pages).toHaveLength(2)
    expect(pages[0]).toHaveLength(12)
    expect(pages[1]).toHaveLength(2)
    expect(pages[0][0]).toMatchObject({ photoId: 'p0', left: SHEET.cols[0], top: SHEET.rows[0] })
    expect(pages[0][2]).toMatchObject({ photoId: 'p2', left: SHEET.cols[2], top: SHEET.rows[0] })
    expect(pages[0][3]).toMatchObject({ photoId: 'p3', left: SHEET.cols[0], top: SHEET.rows[1] })
  })
  it('keeps repeats as separate cells', () => {
    expect(layoutSheets(['a', 'a', 'a'])[0].map((c) => c.photoId)).toEqual(['a', 'a', 'a'])
  })
})

describe('framePolygon', () => {
  it('is a 2.5in square with 45° corners clipped', () => {
    const pts = framePolygon()
    expect(pts).toHaveLength(8)
    expect(pts[0]).toEqual([SHEET.corner, 0])
    expect(pts[1]).toEqual([SHEET.frame - SHEET.corner, 0])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/magnet-sheet.test.ts`
Expected: FAIL — cannot resolve `@lib/magnet-sheet`

- [ ] **Step 3: Implement**

```ts
// src/lib/magnet-sheet.ts
/**
 * The Canva "fridge Magnet Template 01" page 1 (2×2), measured 2026-11-09.
 * All values in inches on a letter page.
 */
export const SHEET = {
  pageW: 8.5,
  pageH: 11,
  cols: [32.524 / 96, 287.984 / 96, 543.443 / 96],
  rows: [27.969 / 96, 281.312 / 96, 534.655 / 96, 787.999 / 96],
  frame: 2.5,
  photoInset: 0.25,
  photo: 2,
  corner: 0.463,
  perPage: 12,
} as const

export interface SheetCell { photoId: string; left: number; top: number }

export function layoutSheets(photoIds: string[]): SheetCell[][] {
  const pages: SheetCell[][] = []
  photoIds.forEach((photoId, i) => {
    const onPage = i % SHEET.perPage
    if (onPage === 0) pages.push([])
    pages[pages.length - 1].push({ photoId, left: SHEET.cols[onPage % 3], top: SHEET.rows[Math.floor(onPage / 3)] })
  })
  return pages
}

/** The cut line, clockwise from the top-left clipped corner, in inches inside one frame. */
export function framePolygon(): [number, number][] {
  const s = SHEET.frame
  const c = SHEET.corner
  return [[c, 0], [s - c, 0], [s, c], [s, s - c], [s - c, s], [c, s], [0, s - c], [0, c]]
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/magnet-sheet.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/magnet-sheet.ts tests/lib/magnet-sheet.test.ts
git commit -m "feat(shop): print-sheet layout matching the Canva magnet template"
```

---

### Task 5: `KvStore.delete` + `list(prefix?)`

**Files:**
- Modify: `src/lib/blob-store.ts`
- Test: `tests/lib/blob-store-delete.test.ts`

**Dependencies:** none

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/blob-store-delete.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeKvStore } from '@lib/blob-store'

describe('KvStore.delete', () => {
  it('removes a key on disk and is quiet when it is already gone', async () => {
    const kv = makeKvStore('t', 't', { fsDirOverride: mkdtempSync(join(tmpdir(), 'kv-del-')) })
    await kv.set('a', '"x"')
    await kv.delete('a')
    expect(await kv.get('a')).toBeNull()
    await expect(kv.delete('a')).resolves.toBeUndefined()
  })
  it('calls the blob store delete', async () => {
    const deleted: string[] = []
    const kv = makeKvStore('t', 't', { _blobStore: { delete: async (k: string) => { deleted.push(k) } } })
    await kv.delete('b')
    expect(deleted).toEqual(['b'])
  })
})

describe('KvStore.list(prefix)', () => {
  it('filters on disk', async () => {
    const kv = makeKvStore('t', 't', { fsDirOverride: mkdtempSync(join(tmpdir(), 'kv-pre-')) })
    await kv.set('p-a-1', '1'); await kv.set('p-b-1', '1'); await kv.set('order-x', '1')
    expect((await kv.list('p-a-')).sort()).toEqual(['p-a-1'])
    expect((await kv.list()).length).toBe(3)
  })
  it('passes the prefix to the blob store', async () => {
    let seen: unknown
    const kv = makeKvStore('t', 't', { _blobStore: { list: async (opts: unknown) => { seen = opts; return { blobs: [{ key: 'p-a-1' }] } } } })
    expect(await kv.list('p-a-')).toEqual(['p-a-1'])
    expect(seen).toEqual({ prefix: 'p-a-' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/blob-store-delete.test.ts`
Expected: FAIL — `kv.delete is not a function`

- [ ] **Step 3: Implement** — in `src/lib/blob-store.ts`:

Add to the `KvStore` interface, after `list(): Promise<string[]>`:

```ts
  /** Remove a key. Quiet when it does not exist. */
  delete(key: string): Promise<void>
```

Change `list(): Promise<string[]>` in the interface to `list(prefix?: string): Promise<string[]>`, and replace the `list()` implementation with:

```ts
    async list(prefix) {
      const store = await resolveBlobStore()
      if (store) {
        const { blobs } = await store.list(prefix ? { prefix } : undefined)
        return blobs.map((b: { key: string }) => b.key)
      }
      try {
        const { readdir } = await import('node:fs/promises')
        const files = await readdir(await fsDir())
        return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).filter((k) => !prefix || k.startsWith(prefix))
      } catch {
        return []
      }
    },
```

Add to the returned object, after `list()`:

```ts
    async delete(key) {
      const store = await resolveBlobStore()
      if (store) {
        await store.delete(key)
        logger.info('kv delete', { key })
        return
      }
      const { rm } = await import('node:fs/promises')
      await rm(await fsPath(key), { force: true })
    },
```

- [ ] **Step 4: Run it to verify it passes, plus every test that builds a fake KvStore**

Run: `npx vitest run tests/lib/blob-store-delete.test.ts && npm test 2>&1 | tail -5`
Expected: PASS (4 tests); full suite green. If a test's hand-written `KvStore` object fails to type-check, add `delete: async () => {}` to it. Existing callers of `list()` are unchanged (no prefix = everything).

- [ ] **Step 5: Commit**

```bash
git add src/lib/blob-store.ts tests/lib/blob-store-delete.test.ts
git commit -m "feat(blob-store): delete a key and list by prefix"
```

---

### Task 6: Order + photo store

**Files:**
- Create: `src/lib/magnet-status.ts` (client-safe: no node imports — the admin UI imports this)
- Create: `src/lib/magnet-orders.ts`
- Test: `tests/lib/magnet-orders.test.ts`

**Dependencies:** Tasks 1, 5

Rules (review A3–A6, A8):
- One order per draft. Photos are listed by prefix `p-<draftId>-`, never by scanning the store.
- Before charging, the order endpoint writes a **pending marker** `pending-<draftId>` (orders store). Cleanup never deletes a draft that has a marker or an order. The marker is removed after the order saves; markers older than 30 days are removed by cleanup (photos with them only after that).
- Statuses: `new → made → ready (pickup) / shipped (ship) → picked_up`, plus `cancelled` (refund done in Square). `picked_up`, `shipped`, `cancelled` are **done** (sets `doneAt`). Same status again = no change, no email. Once photos are deleted the status can't move off a done state.
- Customer emails sent are recorded in `emailed` so a status can't email twice.
- `listOrders({ includeSimulated })`: simulated orders are hidden unless asked (previews share prod's stores).

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/magnet-orders.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  savePhoto, getPhoto, draftPhotoIds, saveOrder, getOrder, listOrders, setOrderStatus, cleanup,
  isDraftId, newReference, orderForDraft, markPending, clearPending, markEmailed,
} from '@lib/magnet-orders'
import { STATUSES, type MagnetOrder } from '@lib/magnet-status'

const DRAFT = '0f8fad5b-d9cb-469f-a165-70867728950e'
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

beforeEach(() => { process.env.BLOB_STORE_FS_DIR = mkdtempSync(join(tmpdir(), 'mag-')) })

function order(over: Partial<MagnetOrder> = {}): MagnetOrder {
  return {
    id: newReference(), createdAt: '2026-11-09T12:00:00.000Z', status: 'new', draftId: DRAFT,
    sets: 1, magnets: [], delivery: 'pickup', address: null,
    contact: { name: 'Test Person', email: 'kaden+magnets@ourhometownstudio.com', phone: '4029802907' },
    amounts: { subtotalCents: 1800, taxCents: 162, shippingCents: 0, totalCents: 1962 },
    squareOrderId: 'sq', paymentId: 'pay', receiptUrl: null, doneAt: null, photosDeletedAt: null, emailed: {}, ...over,
  }
}

describe('photos', () => {
  it('saves and reads a photo under its draft', async () => {
    const id = await savePhoto(DRAFT, jpeg, new Date('2026-11-09T12:00:00Z'))
    expect(await getPhoto(DRAFT, id)).toEqual(jpeg)
    expect(await draftPhotoIds(DRAFT)).toEqual([id])
  })
  it('only accepts uuid draft ids', () => {
    expect(isDraftId(DRAFT)).toBe(true)
    expect(isDraftId('../x')).toBe(false)
  })
})

describe('orders', () => {
  it('saves, lists newest first, finds by draft, and hides simulated unless asked', async () => {
    const a = order({ createdAt: '2026-11-08T12:00:00.000Z', draftId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427' })
    const b = order({ createdAt: '2026-11-09T12:00:00.000Z' })
    const sim = order({ createdAt: '2026-11-10T12:00:00.000Z', simulated: true, draftId: '6fa459ea-ee8a-3ca4-894e-db77e160355e' })
    await saveOrder(a); await saveOrder(b); await saveOrder(sim)
    expect((await listOrders()).map((o) => o.id)).toEqual([b.id, a.id])
    expect((await listOrders({ includeSimulated: true })).map((o) => o.id)).toEqual([sim.id, b.id, a.id])
    expect(await getOrder(a.id)).toEqual(a)
    expect((await orderForDraft(DRAFT))?.id).toBe(b.id)
  })
  it('skips a corrupt record instead of failing the list', async () => {
    await saveOrder(order())
    const { makeKvStore } = await import('@lib/blob-store')
    await makeKvStore('magnet-orders', 'magnet-orders').set('order-M-BROKEN', '{nope')
    expect(await listOrders()).toHaveLength(1)
  })
  it('refuses ready for a shipped order and shipped for a pickup order', async () => {
    const p = order(); const s = order({ delivery: 'ship', address: '1 Main St, Madison AL', draftId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427' })
    await saveOrder(p); await saveOrder(s)
    expect(await setOrderStatus(p.id, 'shipped')).toBe('wrong_delivery')
    expect(await setOrderStatus(s.id, 'ready')).toBe('wrong_delivery')
  })
  it('same status is no change; done stamps doneAt; moving back clears it', async () => {
    const p = order(); await saveOrder(p)
    expect(await setOrderStatus(p.id, 'new')).toMatchObject({ changed: false })
    const done = await setOrderStatus(p.id, 'picked_up', new Date('2026-11-10T00:00:00Z'))
    expect(typeof done === 'object' && done.order.doneAt).toBe('2026-11-10T00:00:00.000Z')
    const back = await setOrderStatus(p.id, 'made')
    expect(typeof back === 'object' && back.order.doneAt).toBeNull()
  })
  it('will not move off a done state once photos are deleted', async () => {
    const p = order({ status: 'picked_up', doneAt: '2026-10-01T00:00:00.000Z', photosDeletedAt: '2026-11-01T00:00:00.000Z' })
    await saveOrder(p)
    expect(await setOrderStatus(p.id, 'made')).toBe('photos_deleted')
  })
  it('records an email once', async () => {
    const p = order(); await saveOrder(p)
    expect(await markEmailed(p.id, 'ready', new Date('2026-11-10T00:00:00Z'))).toBe(true)
    expect(await markEmailed(p.id, 'ready')).toBe(false)
  })
  it('lists the statuses in order', () => {
    expect(STATUSES).toEqual(['new', 'made', 'ready', 'shipped', 'picked_up', 'cancelled'])
  })
})

describe('cleanup', () => {
  const NOW = new Date('2026-11-09T12:00:00Z')
  it('deletes abandoned drafts after 24h and finished orders photos after 30 days', async () => {
    const old = new Date('2026-11-01T00:00:00Z')
    const orphan = '1b4e28ba-2fa1-11d2-883f-0016d3cca427'
    await savePhoto(orphan, jpeg, old)
    const kept = await savePhoto(DRAFT, jpeg, old)
    const o = order({ magnets: [kept], status: 'picked_up', doneAt: '2026-10-01T00:00:00.000Z' })
    await saveOrder(o)
    const fresh = '6fa459ea-ee8a-3ca4-894e-db77e160355e'
    await savePhoto(fresh, jpeg, new Date('2026-11-09T11:00:00Z'))

    expect(await cleanup(NOW, { dryRun: true })).toMatchObject({ draftsDeleted: 1, ordersCleared: 1, dryRun: true })
    expect(await draftPhotoIds(orphan)).toHaveLength(1)

    expect(await cleanup(NOW)).toMatchObject({ draftsDeleted: 1, ordersCleared: 1 })
    expect(await draftPhotoIds(orphan)).toEqual([])
    expect(await draftPhotoIds(DRAFT)).toEqual([])
    expect((await getOrder(o.id))?.photosDeletedAt).toBe('2026-11-09T12:00:00.000Z')
    expect(await draftPhotoIds(fresh)).toHaveLength(1)
  })
  it('keeps a draft with a pending marker (paid but not saved)', async () => {
    const d = '1b4e28ba-2fa1-11d2-883f-0016d3cca427'
    await savePhoto(d, jpeg, new Date('2026-11-01T00:00:00Z'))
    await markPending(d, { attemptId: 'a', email: 'kaden+m@ourhometownstudio.com' }, new Date('2026-11-01T00:00:00Z'))
    await cleanup(NOW)
    expect(await draftPhotoIds(d)).toHaveLength(1)
    await clearPending(d)
    await cleanup(NOW)
    expect(await draftPhotoIds(d)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/magnet-orders.test.ts`
Expected: FAIL — cannot resolve `@lib/magnet-orders`

- [ ] **Step 3: Implement the client-safe status module**

```ts
// src/lib/magnet-status.ts
/** Client-safe pieces of magnet orders (no node imports): the admin UI imports this. */
import type { Delivery } from '@config/shop.config'

export const STATUSES = ['new', 'made', 'ready', 'shipped', 'picked_up', 'cancelled'] as const
export type MagnetStatus = (typeof STATUSES)[number]
export const STATUS_LABEL: Record<MagnetStatus, string> = {
  new: 'New', made: 'Made', ready: 'Ready for pickup', shipped: 'Shipped', picked_up: 'Picked up', cancelled: 'Cancelled',
}
export const DONE_STATUSES: MagnetStatus[] = ['shipped', 'picked_up', 'cancelled']
export const PICKUP_STATUSES: MagnetStatus[] = ['new', 'made', 'ready', 'picked_up', 'cancelled']
export const SHIP_STATUSES: MagnetStatus[] = ['new', 'made', 'shipped', 'cancelled']

export interface MagnetOrder {
  id: string
  createdAt: string
  status: MagnetStatus
  draftId: string
  sets: number
  /** One photo id per magnet, in print order; repeats allowed. */
  magnets: string[]
  delivery: Delivery
  address: string | null
  contact: { name: string; email: string; phone: string }
  amounts: { subtotalCents: number; taxCents: number; shippingCents: number; totalCents: number }
  squareOrderId: string
  paymentId: string
  receiptUrl: string | null
  simulated?: boolean
  doneAt: string | null
  photosDeletedAt: string | null
  /** Customer emails already sent, by status → ISO time. */
  emailed: Partial<Record<'ready' | 'shipped', string>>
}
```

- [ ] **Step 4: Implement the store**

```ts
// src/lib/magnet-orders.ts
/**
 * Photo magnet orders and their photos (Netlify Blobs; `.data/` on disk in dev).
 *
 * Photos: store `magnet-photos`, key `p-<draftId>-<uploadedMs>-<rand>`, value =
 * JSON string of the base64 JPEG. Upload time lives in the key so cleanup
 * never reads a photo to know its age.
 * Orders: store `magnet-orders`, keys `order-<reference>` and `pending-<draftId>`.
 * Deliberately NOT in the weekly archive (netlify/functions/archive-records.ts):
 * photos would bloat it.
 */
import { randomBytes } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import { shopConfig } from '@config/shop.config'
import { DONE_STATUSES, type MagnetOrder, type MagnetStatus } from '@lib/magnet-status'

export * from '@lib/magnet-status'

const logger = createLogger('magnet-orders')
const photos = () => makeKvStore('magnet-photos', 'magnet-photos')
const orders = () => makeKvStore('magnet-orders', 'magnet-orders')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PHOTO_ID_RE = /^\d{13}-[0-9a-f]{8}$/
const REF_RE = /^M-[A-Z0-9]{6}$/
export const isDraftId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)
export const isPhotoId = (v: unknown): v is string => typeof v === 'string' && PHOTO_ID_RE.test(v)
export const isReference = (v: unknown): v is string => typeof v === 'string' && REF_RE.test(v)

export function newReference(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return `M-${Array.from(randomBytes(6), (b) => abc[b % abc.length]).join('')}`
}

const photoKey = (draftId: string, photoId: string) => `p-${draftId}-${photoId}`
function parsePhotoKey(key: string): { draftId: string; photoId: string; at: number } | null {
  const m = /^p-([0-9a-f-]{36})-((\d{13})-[0-9a-f]{8})$/.exec(key)
  return m ? { draftId: m[1], photoId: m[2], at: Number(m[3]) } : null
}
const parse = <T>(raw: string | null, key: string): T | null => {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { logger.error('corrupt magnet record skipped', { key }); return null }
}

// --- photos ---
export async function savePhoto(draftId: string, jpeg: Buffer, now = new Date()): Promise<string> {
  const photoId = `${String(now.getTime()).padStart(13, '0')}-${randomBytes(4).toString('hex')}`
  await photos().set(photoKey(draftId, photoId), JSON.stringify(jpeg.toString('base64')))
  return photoId
}

export async function getPhoto(draftId: string, photoId: string): Promise<Buffer | null> {
  if (!isDraftId(draftId) || !isPhotoId(photoId)) return null
  const raw = await photos().get(photoKey(draftId, photoId))
  return raw ? Buffer.from(JSON.parse(raw) as string, 'base64') : null
}

export async function draftPhotoIds(draftId: string): Promise<string[]> {
  return (await photos().list(`p-${draftId}-`)).map(parsePhotoKey).filter((p) => p?.draftId === draftId).map((p) => p!.photoId).sort()
}

async function deleteDraft(draftId: string): Promise<void> {
  const kv = photos()
  for (const photoId of await draftPhotoIds(draftId)) await kv.delete(photoKey(draftId, photoId))
}

// --- pending markers (paid-or-maybe-paid, order not yet saved) ---
export async function markPending(draftId: string, info: { attemptId: string; email: string; squareOrderId?: string }, now = new Date()): Promise<void> {
  await orders().set(`pending-${draftId}`, JSON.stringify({ ...info, at: now.toISOString() }))
}
export async function clearPending(draftId: string): Promise<void> {
  await orders().delete(`pending-${draftId}`)
}

// --- orders ---
export async function saveOrder(order: MagnetOrder): Promise<void> {
  await orders().set(`order-${order.id}`, JSON.stringify(order))
}

export async function getOrder(id: string): Promise<MagnetOrder | null> {
  if (!isReference(id)) return null
  return parse<MagnetOrder>(await orders().get(`order-${id}`), id)
}

export async function listOrders({ includeSimulated = false } = {}): Promise<MagnetOrder[]> {
  const kv = orders()
  const keys = await kv.list('order-')
  const all = await Promise.all(keys.map(async (k) => parse<MagnetOrder>(await kv.get(k), k)))
  return all
    .filter((o): o is MagnetOrder => !!o && (includeSimulated || !o.simulated))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function orderForDraft(draftId: string): Promise<MagnetOrder | null> {
  return (await listOrders({ includeSimulated: true })).find((o) => o.draftId === draftId) ?? null
}

export type StatusResult = { order: MagnetOrder; changed: boolean } | 'not_found' | 'wrong_delivery' | 'photos_deleted'

/** Last write wins between two owners; the second tap simply re-applies. */
export async function setOrderStatus(id: string, status: MagnetStatus, now = new Date()): Promise<StatusResult> {
  const order = await getOrder(id)
  if (!order) return 'not_found'
  if (order.status === status) return { order, changed: false }
  if ((status === 'ready' || status === 'picked_up') && order.delivery !== 'pickup') return 'wrong_delivery'
  if (status === 'shipped' && order.delivery !== 'ship') return 'wrong_delivery'
  if (order.photosDeletedAt && !DONE_STATUSES.includes(status)) return 'photos_deleted'
  const updated: MagnetOrder = { ...order, status, doneAt: DONE_STATUSES.includes(status) ? (order.doneAt ?? now.toISOString()) : null }
  await saveOrder(updated)
  return { order: updated, changed: true }
}

/** True the first time; false if that email was already sent. */
export async function markEmailed(id: string, kind: 'ready' | 'shipped', now = new Date()): Promise<boolean> {
  const order = await getOrder(id)
  if (!order || order.emailed?.[kind]) return false
  await saveOrder({ ...order, emailed: { ...order.emailed, [kind]: now.toISOString() } })
  return true
}

// --- cleanup ---
export interface CleanupResult { draftsDeleted: number; ordersCleared: number; dryRun: boolean; drafts: string[]; orders: string[] }

/** Drafts nobody paid for (> 24 h, no order, no pending marker) and finished orders' photos (> 30 days after done). */
export async function cleanup(now = new Date(), { dryRun = false } = {}): Promise<CleanupResult> {
  const kv = orders()
  const all = await listOrders({ includeSimulated: true })
  const keep = new Set(all.map((o) => o.draftId))
  const pendingCutoff = now.getTime() - shopConfig.photoRetentionDays * 86_400_000
  for (const key of await kv.list('pending-')) {
    const p = parse<{ at: string }>(await kv.get(key), key)
    const draftId = key.slice('pending-'.length)
    if (p && Date.parse(p.at) > pendingCutoff) keep.add(draftId)
    else if (!dryRun) await kv.delete(key)
  }

  const draftCutoff = now.getTime() - shopConfig.draftRetentionHours * 3_600_000
  const newest = new Map<string, number>()
  for (const p of (await photos().list('p-')).map(parsePhotoKey)) if (p) newest.set(p.draftId, Math.max(newest.get(p.draftId) ?? 0, p.at))
  const drafts = [...newest].filter(([d, at]) => !keep.has(d) && at <= draftCutoff).map(([d]) => d)

  const doneCutoff = now.getTime() - shopConfig.photoRetentionDays * 86_400_000
  const done = all.filter((o) => !o.photosDeletedAt && o.doneAt && Date.parse(o.doneAt) <= doneCutoff).map((o) => o.id)

  if (!dryRun) {
    for (const d of drafts) await deleteDraft(d)
    for (const id of done) {
      const fresh = await getOrder(id) // re-read: an owner may have changed it during the run
      if (!fresh || fresh.photosDeletedAt || !fresh.doneAt || Date.parse(fresh.doneAt) > doneCutoff) continue
      await deleteDraft(fresh.draftId)
      await saveOrder({ ...fresh, photosDeletedAt: now.toISOString() })
    }
  }
  return { draftsDeleted: drafts.length, ordersCleared: done.length, dryRun, drafts, orders: done }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run tests/lib/magnet-orders.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/magnet-status.ts src/lib/magnet-orders.ts tests/lib/magnet-orders.test.ts
git commit -m "feat(shop): magnet order and photo store with safe cleanup"
```

---

### Task 7: Emails

**Files:**
- Create: `src/lib/magnet-emails.ts`
- Test: `tests/lib/magnet-emails.test.ts`

**Dependencies:** Task 6

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/magnet-emails.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const { send } = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue({ sent: true }) }))
vi.mock('@lib/email', () => ({ sendEmail: send }))
import { sendMagnetConfirmation, sendMagnetOwnerNotice, sendMagnetStatusEmail } from '@lib/magnet-emails'
import type { MagnetOrder } from '@lib/magnet-status'

const o: MagnetOrder = {
  id: 'M-ABC234', createdAt: '2026-11-09T12:00:00.000Z', status: 'new', draftId: 'x', sets: 2, magnets: [],
  delivery: 'pickup', address: null, contact: { name: 'Test Person', email: 'kaden+m@ourhometownstudio.com', phone: '4029802907' },
  amounts: { subtotalCents: 3600, taxCents: 324, shippingCents: 0, totalCents: 3924 },
  squareOrderId: 's', paymentId: 'p', receiptUrl: null, doneAt: null, photosDeletedAt: null, emailed: {},
}

beforeEach(() => send.mockClear())

describe('magnet emails', () => {
  it('confirms to the customer with count, total and turnaround', async () => {
    await sendMagnetConfirmation(o)
    const msg = send.mock.calls[0][0]
    expect(msg.to).toBe('kaden+m@ourhometownstudio.com')
    expect(msg.subject).toContain('M-ABC234')
    expect(msg.text).toContain('12 photo magnets')
    expect(msg.text).toContain('$39.24')
    expect(msg.text).toContain('7 days')
  })
  it('tells the owners with an admin link', async () => {
    await sendMagnetOwnerNotice(o, 'https://ourhometownstudio.com/admin')
    expect(send.mock.calls.length).toBeGreaterThan(0)
    expect(send.mock.calls[0][0].text).toContain('https://ourhometownstudio.com/admin')
  })
  it('sends ready for pickup and shipped notices only', async () => {
    expect((await sendMagnetStatusEmail(o, 'ready')).sent).toBe(true)
    expect(send.mock.calls[0][0].subject).toContain('ready')
    expect((await sendMagnetStatusEmail(o, 'made')).sent).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/magnet-emails.test.ts`
Expected: FAIL — cannot resolve `@lib/magnet-emails`

- [ ] **Step 3: Implement** (customer wording is part of the Task 19 copy review)

```ts
// src/lib/magnet-emails.ts
import { sendEmail } from '@lib/email'
import { formatMoney } from '@lib/money'
import { siteConfig } from '@config/site.config'
import { shopConfig } from '@config/shop.config'
import type { MagnetOrder, MagnetStatus } from '@lib/magnet-orders'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const paras = (lines: string[]) => lines.map((l) => `<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:15px;color:#3d3229">${esc(l)}</p>`).join('')
const first = (name: string) => name.trim().split(/\s+/)[0] || 'there'

export function sendMagnetConfirmation(o: MagnetOrder) {
  const n = o.magnets.length || o.sets * shopConfig.magnets.setSize
  const lines = [
    `Hi ${first(o.contact.name)},`,
    `Thank you for ordering ${n} photo magnets from Hometown Studio. Your order number is ${o.id}.`,
    o.delivery === 'pickup'
      ? `They will be ready within ${shopConfig.magnets.readyDays} days. We will email you when you can pick them up at the studio.`
      : `We will ship them within ${shopConfig.magnets.readyDays} days to ${o.address}.`,
    `Total paid ${formatMoney(o.amounts.totalCents)}.`,
    o.receiptUrl ? `Your receipt ${o.receiptUrl}` : '',
    `Questions? Reply to this email or call ${siteConfig.contactPhone}.`,
  ].filter(Boolean)
  return sendEmail({ to: o.contact.email, subject: `Your photo magnets are ordered (${o.id})`, text: lines.join('\n\n'), html: paras(lines) })
}

export async function sendMagnetOwnerNotice(o: MagnetOrder, adminUrl: string): Promise<{ sent: boolean }> {
  const lines = [
    `New photo magnet order ${o.id}`,
    `${o.magnets.length} magnets (${o.sets} set${o.sets === 1 ? '' : 's'}), ${o.delivery === 'pickup' ? 'pickup' : `ship to ${o.address}`}`,
    `${o.contact.name} · ${o.contact.email} · ${o.contact.phone}`,
    `Paid ${formatMoney(o.amounts.totalCents)}`,
    `Print it from ${adminUrl}`,
  ]
  const results = await Promise.all(siteConfig.ownerEmails.map((to) =>
    sendEmail({ to, subject: `New magnet order ${o.id}`, text: lines.join('\n'), html: paras(lines) })))
  return { sent: results.some((r) => r.sent) }
}

export async function sendMagnetStatusEmail(o: MagnetOrder, status: MagnetStatus): Promise<{ sent: boolean }> {
  if (status !== 'ready' && status !== 'shipped') return { sent: false }
  const lines = status === 'ready'
    ? [`Hi ${first(o.contact.name)},`, `Your photo magnets are ready to pick up at Hometown Studio. Your order number is ${o.id}.`, `Come by any time we are open. ${siteConfig.contactPhone}`]
    : [`Hi ${first(o.contact.name)},`, `Your photo magnets are on their way to ${o.address}. Your order number is ${o.id}.`, `Thank you for ordering from Hometown Studio.`]
  return sendEmail({
    to: o.contact.email,
    subject: status === 'ready' ? `Your photo magnets are ready (${o.id})` : `Your photo magnets shipped (${o.id})`,
    text: lines.join('\n\n'),
    html: paras(lines),
  })
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/magnet-emails.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/magnet-emails.ts tests/lib/magnet-emails.test.ts
git commit -m "feat(shop): magnet order emails"
```

---

### Task 8: Photo upload endpoint

**Files:**
- Create: `src/pages/api/shop/magnet-photo.json.ts`
- Test: `tests/api/shop-magnet-photo.test.ts`

**Dependencies:** Task 6

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/shop-magnet-photo.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { POST } from '../../src/pages/api/shop/magnet-photo.json'
import { getPhoto } from '@lib/magnet-orders'

const DRAFT = '0f8fad5b-d9cb-469f-a165-70867728950e'
const jpegUrl = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]).toString('base64')}`
let ip = 0
const call = (body: unknown) => POST({
  clientAddress: `198.51.100.${++ip}`,
  request: new Request('https://ourhometownstudio.com/api/shop/magnet-photo.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
} as any)

beforeEach(() => { process.env.BLOB_STORE_FS_DIR = mkdtempSync(join(tmpdir(), 'mag-api-')) })

describe('POST /api/shop/magnet-photo.json', () => {
  it('saves a JPEG and returns its id', async () => {
    const res = await call({ draftId: DRAFT, image: jpegUrl })
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(await getPhoto(DRAFT, data.photoId)).not.toBeNull()
  })
  it('refuses a bad draft id', async () => {
    expect((await call({ draftId: 'nope', image: jpegUrl })).status).toBe(400)
  })
  it('refuses something that is not a JPEG', async () => {
    const png = `data:image/jpeg;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}`
    expect((await call({ draftId: DRAFT, image: png })).status).toBe(400)
  })
  it('refuses a photo over 400 KB', async () => {
    const big = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(400_001)]).toString('base64')}`
    expect((await call({ draftId: DRAFT, image: big })).status).toBe(413)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/api/shop-magnet-photo.test.ts`
Expected: FAIL — cannot resolve the endpoint

- [ ] **Step 3: Implement**

```ts
// src/pages/api/shop/magnet-photo.json.ts
import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { shopConfig } from '@config/shop.config'
import { isDraftId, savePhoto, draftPhotoIds } from '@lib/magnet-orders'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:shop:magnet-photo')
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** POST { draftId, image: data:image/jpeg;base64,… } → { data: { photoId } }. One finished 600×600 magnet photo. */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`magnet-photo:${clientAddress}`, 80, 10 * 60_000)) return json(429, { error: 'Too many photos at once. Give it a minute.' })
  const body = await request.json().catch(() => null)
  if (!isDraftId(body?.draftId)) return json(400, { error: 'Missing order draft.' })
  const m = typeof body?.image === 'string' ? /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(body.image) : null
  if (!m) return json(400, { error: 'That photo did not come through. Try again.' })
  const buf = Buffer.from(m[1], 'base64')
  if (buf.length > shopConfig.maxPhotoBytes) return json(413, { error: 'That photo is too large.' })
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return json(400, { error: 'That photo did not come through. Try again.' })
  try {
    if ((await draftPhotoIds(body.draftId)).length >= shopConfig.maxPhotosPerDraft) return json(400, { error: 'That is the most photos one order can hold.' })
    const photoId = await savePhoto(body.draftId, buf)
    return json(200, { data: { photoId } })
  } catch (err) {
    logger.error('photo save failed', { error: err instanceof Error ? err.message : String(err) })
    return json(500, { error: 'We could not save that photo. Try again.' })
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/api/shop-magnet-photo.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/shop/magnet-photo.json.ts tests/api/shop-magnet-photo.test.ts
git commit -m "feat(shop): magnet photo upload endpoint"
```

---

### Task 9a: Per-line tax on orders (provider)

**Files:**
- Modify: `src/providers/interfaces/payment.ts` (`LineItem`)
- Modify: `src/providers/square/payment.ts` (`createOrder`)
- Modify: `src/providers/mock/payment.ts` (`createOrder`)
- Test: `tests/providers/square/payment.test.ts`, `tests/providers/mock/payment.test.ts`

**Dependencies:** none

Square only taxes an API order when told to. Proven with `orders/calculate` (2026-11-09, no write): explicit order-level tax + `appliedTaxes` on the magnet line gives 2 sets + shipping = $45.24 with $3.24 tax and $0 on shipping. Every existing caller passes no `tax`, so their orders are byte-identical.

- [ ] **Step 1: Write the failing tests**

Add to `tests/providers/square/payment.test.ts` inside `describe('createOrder')`:

```ts
    it('applies a catalog tax only to the lines that ask for it', async () => {
      mockOrdersCreate.mockResolvedValue({ order: { id: 'o', version: 1, state: 'OPEN', totalMoney: { amount: BigInt(4524), currency: 'USD' } } })
      await provider.createOrder({
        locationId: 'loc-123', customerId: 'c',
        lineItems: [
          { catalogObjectId: 'var-mag', name: 'Magnets', quantity: 2, pricePerUnit: 1800, tax: { catalogObjectId: 'TAX9', percent: 9 } },
          { catalogObjectId: 'var-ship', name: 'Shipping', quantity: 1, pricePerUnit: 600 },
        ],
      })
      const order = mockOrdersCreate.mock.calls[0][0].order
      expect(order.taxes).toEqual([{ uid: 'tax-TAX9', catalogObjectId: 'TAX9', scope: 'LINE_ITEM' }])
      expect(order.lineItems[0].appliedTaxes).toEqual([{ taxUid: 'tax-TAX9' }])
      expect(order.lineItems[1].appliedTaxes).toBeUndefined()
    })
    it('sends no taxes when no line asks', async () => {
      mockOrdersCreate.mockResolvedValue({ order: { id: 'o', version: 1, state: 'OPEN', totalMoney: { amount: BigInt(100), currency: 'USD' } } })
      await provider.createOrder({ locationId: 'loc-123', customerId: 'c', lineItems: [{ name: 'X', quantity: 1, pricePerUnit: 100 }] })
      expect(mockOrdersCreate.mock.calls[0][0].order.taxes).toBeUndefined()
    })
```

Add to `tests/providers/mock/payment.test.ts`:

```ts
import { MockPaymentProvider } from '../../../src/providers/mock/payment'
describe('MockPaymentProvider line tax', () => {
  it('adds tax for taxed lines only', async () => {
    const p = new MockPaymentProvider()
    const o = await p.createOrder({ locationId: 'l', customerId: 'c', lineItems: [
      { name: 'Magnets', quantity: 2, pricePerUnit: 1800, tax: { catalogObjectId: 'T', percent: 9 } },
      { name: 'Shipping', quantity: 1, pricePerUnit: 600 },
    ] })
    expect(o.totalAmount).toBe(4524)
  })
})
```

(Open `src/providers/mock/payment.ts` first: if the class is not exported as `MockPaymentProvider` or its constructor takes arguments, match the existing `tests/providers/mock/payment.test.ts` setup.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/providers/square/payment.test.ts tests/providers/mock/payment.test.ts`
Expected: FAIL — `order.taxes` undefined / total 4200

- [ ] **Step 3: Implement**

`src/providers/interfaces/payment.ts`, in `LineItem`:

```ts
  /** Tax this line with a Square catalog tax. `percent` is for the mock provider and our own price checks. */
  tax?: { catalogObjectId: string; percent: number }
```

`src/providers/square/payment.ts`, in `createOrder`, inside the `lineItems` map before `return base`:

```ts
      if (item.tax) base.appliedTaxes = [{ taxUid: `tax-${item.tax.catalogObjectId}` }]
```

and before `this.client.orders.create`:

```ts
    const taxIds = [...new Set(params.lineItems.flatMap((i) => (i.tax ? [i.tax.catalogObjectId] : [])))]
    const taxes = taxIds.map((id) => ({ uid: `tax-${id}`, catalogObjectId: id, scope: 'LINE_ITEM' }))
```

and in the `order` object:

```ts
        taxes: taxes.length > 0 ? (taxes as any) : undefined,
```

`src/providers/mock/payment.ts`, in `createOrder`, after the line-item `reduce`:

```ts
    total += params.lineItems.reduce((t, item) => t + (item.tax ? Math.round((item.quantity * item.pricePerUnit * item.tax.percent) / 100) : 0), 0)
```

- [ ] **Step 4: Run to verify they pass, and the whole suite**

Run: `npx vitest run tests/providers && npm test 2>&1 | tail -4`
Expected: PASS; suite green (existing callers unchanged)

- [ ] **Step 5: Commit**

```bash
git add src/providers/interfaces/payment.ts src/providers/square/payment.ts src/providers/mock/payment.ts tests/providers
git commit -m "feat(payments): tax individual order lines with a Square catalog tax"
```

---

### Task 9: Order + payment endpoint

**Files:**
- Create: `src/pages/api/shop/magnet-order.json.ts`
- Test: `tests/api/shop-magnet-order.test.ts`

**Dependencies:** Tasks 2, 6, 7, 9a, 10

Flow (review A7):
1. Validate. **Simulated path** (`paymentBypassEnabled`) runs before the Square-id check, so previews work before T18b.
2. Real path needs `square.variationId` + `square.shippingVariationId` (else 503).
3. **One order per draft**: if `orderForDraft(draftId)` exists → 200 with that order's reference (`already: true`) — a retry after a lost answer lands on the confirmation instead of charging twice.
4. `createOrder` with idempotency `attemptKey(attemptId,'order')`, magnet line taxed (T9a), shipping as its own untaxed catalog line. Check `order.totalAmount === quote.totalCents`, else cancel → 500 `invalid`.
5. **Retry check**: `findOrderPayment(order.id)` — if Square already has a completed payment (same attempt, earlier try), use it.
6. Write the **pending marker**, then `processPayment` with `attemptKey(attemptId,'pay')`. On throw: `chargeOutcomeOf(err)` → `not_charged` = 402 "not charged" (clear marker); `unknown` = 502 code `unknown_outcome` ("we're not sure… check your email", keep marker so photos are kept).
7. `failed` → cancel, clear marker, 402. Completed → save order (one retry), clear marker; if save fails, keep marker, log `ORPHANED PAID MAGNET ORDER` with `draftId`, 500.
8. Emails + `reportBooking({ kind: 'shop' })`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/shop-magnet-order.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { bypass } = vi.hoisted(() => ({ bypass: vi.fn().mockReturnValue(false) }))
vi.mock('@lib/dev-flags', () => ({ paymentBypassEnabled: bypass }))
vi.mock('@lib/magnet-emails', () => ({
  sendMagnetConfirmation: vi.fn().mockResolvedValue({ sent: true }),
  sendMagnetOwnerNotice: vi.fn().mockResolvedValue({ sent: true }),
}))
vi.mock('@lib/posthog-server', () => ({ reportBooking: vi.fn().mockResolvedValue(undefined) }))
const { ids } = vi.hoisted(() => ({ ids: { itemId: 'item', variationId: 'var', shippingVariationId: 'ship-var' } }))
vi.mock('@config/shop.config', async (orig) => {
  const real: any = await orig()
  return { ...real, shopConfig: { ...real.shopConfig, magnets: { ...real.shopConfig.magnets, square: ids } } }
})
const createOrder = vi.fn(); const processPayment = vi.fn(); const cancelOrder = vi.fn(); const findOrderPayment = vi.fn(); const findOrCreate = vi.fn()
vi.mock('@config/providers', () => ({
  providers: {
    payment: {
      createOrder: (...a: any[]) => createOrder(...a), processPayment: (...a: any[]) => processPayment(...a),
      cancelOrder: (...a: any[]) => cancelOrder(...a), findOrderPayment: (...a: any[]) => findOrderPayment(...a),
    },
    customer: { findOrCreate: (...a: any[]) => findOrCreate(...a), appendNote: vi.fn().mockResolvedValue(undefined) },
  },
}))

import { POST } from '../../src/pages/api/shop/magnet-order.json'
import { savePhoto, listOrders } from '@lib/magnet-orders'
import { makeKvStore } from '@lib/blob-store'

const DRAFT = '0f8fad5b-d9cb-469f-a165-70867728950e'
const ATTEMPT = '9b2f6a52-7c1e-4d7a-9a51-1f1f1f1f1f1f'
let ip = 0
const call = (body: unknown) => POST({
  clientAddress: `203.0.113.${++ip}`,
  request: new Request('https://ourhometownstudio.com/api/shop/magnet-order.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
} as any)
/** What Square would total: taxed lines get their tax, others don't (T9a). */
const squareTotal = (lineItems: any[]) => lineItems.reduce((t, l) => t + l.quantity * l.pricePerUnit + (l.tax ? Math.round((l.quantity * l.pricePerUnit * l.tax.percent) / 100) : 0), 0)

let photo: string
beforeEach(async () => {
  process.env.BLOB_STORE_FS_DIR = mkdtempSync(join(tmpdir(), 'mag-order-'))
  vi.clearAllMocks()
  bypass.mockReturnValue(false)
  photo = await savePhoto(DRAFT, Buffer.from([0xff, 0xd8, 0xff, 1]))
  findOrCreate.mockResolvedValue({ id: 'cust' })
  findOrderPayment.mockResolvedValue(null)
  createOrder.mockImplementation(async ({ lineItems }: any) => ({ id: 'sq-order', version: 1, lineItems, discounts: [], currency: 'USD', status: 'open', totalAmount: squareTotal(lineItems) }))
  processPayment.mockResolvedValue({ id: 'pay', orderId: 'sq-order', amount: 0, status: 'completed', receiptUrl: 'https://r' })
})

const good = () => ({
  draftId: DRAFT, attemptId: ATTEMPT, sets: 1, magnets: Array(6).fill(photo), delivery: 'pickup',
  contact: { name: 'Test Person', email: 'kaden+magnets@ourhometownstudio.com', phone: '(402) 980-2907' }, paymentToken: 'tok',
})
const pendingKeys = () => makeKvStore('magnet-orders', 'magnet-orders').list('pending-')

describe('POST /api/shop/magnet-order.json', () => {
  it('charges the server price with the magnet line taxed and saves the order', async () => {
    const res = await call(good())
    expect(res.status).toBe(200)
    expect(createOrder.mock.calls[0][0].lineItems).toEqual([
      { catalogObjectId: 'var', name: 'Photo Magnets – Set of 6', quantity: 1, pricePerUnit: 1800, tax: { catalogObjectId: 'XKZ3OIRJ3SPPO4TO64UUDFA4', percent: 9 } },
    ])
    expect(processPayment.mock.calls[0][0]).toMatchObject({ amount: 1962, idempotencyKey: `${ATTEMPT}:pay`, paymentToken: 'tok' })
    const [saved] = await listOrders()
    expect(saved).toMatchObject({ sets: 1, delivery: 'pickup', status: 'new', amounts: { totalCents: 1962 }, emailed: {} })
    expect(saved.magnets).toHaveLength(6)
    expect(await pendingKeys()).toEqual([])
  })
  it('adds an untaxed $6 shipping line and needs an address', async () => {
    expect((await call({ ...good(), delivery: 'ship' })).status).toBe(400)
    const res = await call({ ...good(), delivery: 'ship', address: '123 Main St, Madison, AL 35758' })
    expect(res.status).toBe(200)
    expect(createOrder.mock.calls[0][0].lineItems[1]).toEqual({ catalogObjectId: 'ship-var', name: 'Shipping', quantity: 1, pricePerUnit: 600 })
    expect(processPayment.mock.calls[0][0].amount).toBe(2562)
  })
  it('refuses the wrong number of photos, and a photo not in the draft', async () => {
    expect((await call({ ...good(), magnets: Array(5).fill(photo) })).status).toBe(400)
    expect((await call({ ...good(), magnets: [...Array(5).fill(photo), '1700000000000-deadbeef'] })).status).toBe(400)
  })
  it('cancels the Square order when the total does not match', async () => {
    createOrder.mockResolvedValueOnce({ id: 'sq-order', version: 1, totalAmount: 1800, lineItems: [], discounts: [], currency: 'USD', status: 'open' })
    expect((await call(good())).status).toBe(500)
    expect(cancelOrder).toHaveBeenCalled()
    expect(processPayment).not.toHaveBeenCalled()
  })
  it('says declined, cancels, and clears the marker on a failed payment', async () => {
    processPayment.mockResolvedValueOnce({ id: 'pay', orderId: 'sq-order', amount: 0, status: 'failed' })
    expect((await call(good())).status).toBe(402)
    expect(cancelOrder).toHaveBeenCalled()
    expect(await listOrders()).toEqual([])
    expect(await pendingKeys()).toEqual([])
  })
  it('says unknown (not "not charged") and keeps the photos when the charge outcome is unclear', async () => {
    processPayment.mockRejectedValueOnce(new Error('socket hang up'))
    const res = await call(good())
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('unknown_outcome')
    expect(await pendingKeys()).toEqual([`pending-${DRAFT}`])
  })
  it('uses an earlier payment on retry instead of charging again', async () => {
    findOrderPayment.mockResolvedValueOnce({ id: 'pay-earlier', orderId: 'sq-order', amount: 1962, status: 'completed', receiptUrl: 'https://r' })
    expect((await call(good())).status).toBe(200)
    expect(processPayment).not.toHaveBeenCalled()
    expect((await listOrders())[0].paymentId).toBe('pay-earlier')
  })
  it('answers with the existing order when the draft is already ordered', async () => {
    await call(good())
    const again = await call({ ...good(), attemptId: '1c2f6a52-7c1e-4d7a-9a51-1f1f1f1f1f1f' })
    expect(again.status).toBe(200)
    expect((await again.json()).data.already).toBe(true)
    expect(processPayment).toHaveBeenCalledTimes(1)
  })
  it('simulates without Square ids on previews', async () => {
    bypass.mockReturnValue(true)
    Object.assign(ids, { variationId: '', shippingVariationId: '' })
    const res = await call({ ...good(), paymentToken: undefined })
    Object.assign(ids, { variationId: 'var', shippingVariationId: 'ship-var' })
    expect(res.status).toBe(200)
    expect(createOrder).not.toHaveBeenCalled()
    expect((await listOrders({ includeSimulated: true }))[0].simulated).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/api/shop-magnet-order.test.ts`
Expected: FAIL — cannot resolve the endpoint

- [ ] **Step 3: Implement** (also add `shippingVariationId: ''` to `shopConfig.magnets.square` in `src/config/shop.config.ts`, and `taxId: 'XKZ3OIRJ3SPPO4TO64UUDFA4'` beside `taxPercent`)

```ts
// src/pages/api/shop/magnet-order.json.ts
import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { shopConfig } from '@config/shop.config'
import { rateLimited } from '@lib/rate-limit'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { isAttemptId, attemptKey, chargeOutcomeOf, type CheckoutErrorCode } from '@lib/checkout-attempt'
import { isValidSets, quoteMagnets } from '@lib/magnet-pricing'
import { isDraftId, isPhotoId, draftPhotoIds, newReference, saveOrder, orderForDraft, markPending, clearPending, type MagnetOrder } from '@lib/magnet-orders'
import { sendMagnetConfirmation, sendMagnetOwnerNotice } from '@lib/magnet-emails'
import { reportBooking } from '@lib/posthog-server'
import { cleanAttribution } from '@lib/attribution'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:shop:magnet-order')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ITEM_NAME = 'Photo Magnets – Set of 6'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const fail = (status: number, detail: string, code?: CheckoutErrorCode) =>
  json(status, { error: 'Unable to complete magnet order', code: code ?? (status === 400 ? 'invalid' : status === 402 ? 'card_declined' : 'unavailable'), detail })
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const m = shopConfig.magnets
  if (rateLimited(`magnet-order:${clientAddress}`, 5, 60_000)) return fail(429, 'Too many tries. Give it a minute.')
  const body = await request.json().catch(() => null)
  if (!body) return fail(400, 'Invalid request.')

  // --- Validate ---
  if (!isDraftId(body.draftId) || !isAttemptId(body.attemptId)) return fail(400, 'Your order expired. Close it and start again.')
  if (!isValidSets(body.sets)) return fail(400, `Pick between 1 and ${m.maxSets} sets.`)
  const delivery = body.delivery === 'ship' ? 'ship' : body.delivery === 'pickup' ? 'pickup' : null
  if (!delivery) return fail(400, 'Choose pickup or shipping.')
  const address = str(body.address, 300)
  if (delivery === 'ship' && address.length < 8) return fail(400, 'Add your shipping address.')
  const name = str(body.contact?.name, 120)
  const email = str(body.contact?.email, 200).toLowerCase()
  const phone = str(body.contact?.phone, 40).replace(/\D/g, '')
  if (!name) return fail(400, 'Add your name.')
  if (!EMAIL_RE.test(email)) return fail(400, 'Check your email address.')
  if (!(phone.length === 10 || (phone.length === 11 && phone.startsWith('1')))) return fail(400, 'Check your phone number.')
  const magnets: unknown[] = Array.isArray(body.magnets) ? body.magnets : []
  if (magnets.length !== body.sets * m.setSize || !magnets.every(isPhotoId)) return fail(400, 'Pick a photo for every magnet.')

  const existing = await orderForDraft(body.draftId)
  if (existing) return json(200, { data: { reference: existing.id, totalCents: existing.amounts.totalCents, receiptUrl: existing.receiptUrl, emailSent: true, already: true } })

  const uploaded = new Set(await draftPhotoIds(body.draftId))
  const missing = [...new Set((magnets as string[]).filter((p) => !uploaded.has(p)))]
  if (missing.length) return json(400, { error: 'Unable to complete magnet order', code: 'invalid', detail: 'Some photos did not save. Add them again.', missingPhotos: missing })

  const quote = quoteMagnets(body.sets, delivery)
  const id = newReference()
  const record = (over: Pick<MagnetOrder, 'squareOrderId' | 'paymentId' | 'receiptUrl'> & { simulated?: boolean }): MagnetOrder => ({
    id, createdAt: new Date().toISOString(), status: 'new', draftId: body.draftId, sets: body.sets, magnets: magnets as string[],
    delivery, address: delivery === 'ship' ? address : null, contact: { name, email, phone },
    amounts: { subtotalCents: quote.subtotalCents, taxCents: quote.taxCents, shippingCents: quote.shippingCents, totalCents: quote.totalCents },
    doneAt: null, photosDeletedAt: null, emailed: {}, ...over,
  })
  const adminUrl = `${new URL(request.url).origin}/admin`
  const finish = async (saved: MagnetOrder, receiptUrl: string | null) => {
    const { sent } = await sendMagnetConfirmation(saved).catch(() => ({ sent: false }))
    await sendMagnetOwnerNotice(saved, adminUrl).catch(() => ({ sent: false }))
    return json(200, { data: { reference: saved.id, totalCents: saved.amounts.totalCents, receiptUrl, emailSent: sent } })
  }

  // --- Preview / dev: no card charged, no Square ids needed ---
  if (paymentBypassEnabled(request)) {
    const saved = record({ squareOrderId: `dev_${Date.now().toString(36)}`, paymentId: 'dev_pay', receiptUrl: null, simulated: true })
    await saveOrder(saved)
    return finish(saved, null)
  }
  if (!m.square.variationId || !m.square.shippingVariationId) return fail(503, 'Magnets are not available yet.')
  if (!body.paymentToken) return fail(400, 'Missing payment information.')

  const locationId = siteConfig.providers.payment.config.locationId
  let order: Awaited<ReturnType<typeof providers.payment.createOrder>>
  try {
    const [givenName, ...rest] = name.split(/\s+/)
    const customer = await providers.customer.findOrCreate({ email, givenName, familyName: rest.join(' ') || undefined, phone })
    order = await providers.payment.createOrder({
      locationId, customerId: customer.id, idempotencyKey: attemptKey(body.attemptId, 'order'),
      lineItems: [
        { catalogObjectId: m.square.variationId, name: ITEM_NAME, quantity: body.sets, pricePerUnit: m.setPriceCents, tax: { catalogObjectId: m.taxId, percent: m.taxPercent } },
        ...(quote.shippingCents ? [{ catalogObjectId: m.square.shippingVariationId, name: 'Shipping', quantity: 1, pricePerUnit: quote.shippingCents }] : []),
      ],
    })
  } catch (err) {
    logger.error('order create failed', { error: msg(err) })
    return fail(502, 'We could not start your order. Your card was not charged. Try again.')
  }

  const cancel = async () => {
    try { await providers.payment.cancelOrder({ orderId: order.id, version: order.version, locationId }) }
    catch (err) { logger.error('ORPHANED ORDER — cancel failed', { orderId: order.id, error: msg(err) }) }
  }
  if (order.totalAmount !== quote.totalCents) {
    logger.error('magnet price mismatch', { expected: quote.totalCents, square: order.totalAmount })
    await cancel()
    return fail(500, `Something did not add up on our side. Your card was not charged. Call ${siteConfig.contactPhone} and we will sort it out.`)
  }

  let payment = await providers.payment.findOrderPayment(order.id).catch(() => null)
  if (!payment) {
    await markPending(body.draftId, { attemptId: body.attemptId, email, squareOrderId: order.id })
    try {
      payment = await providers.payment.processPayment({ orderId: order.id, paymentToken: body.paymentToken, amount: order.totalAmount, currency: 'USD', buyerEmailAddress: email, idempotencyKey: attemptKey(body.attemptId, 'pay') })
    } catch (err) {
      if (chargeOutcomeOf(err) === 'not_charged') {
        await clearPending(body.draftId)
        return fail(402, 'Your card was not charged. Check the details or try another card.')
      }
      logger.error('magnet payment outcome unknown', { draftId: body.draftId, orderId: order.id, error: msg(err) })
      return fail(502, `We are not sure your payment went through. Check your email for a receipt before trying again, or call ${siteConfig.contactPhone}.`, 'unknown_outcome')
    }
    if (payment.status === 'failed') { await cancel(); await clearPending(body.draftId); return fail(402, 'Your card was declined. Nothing was charged. Try another card.') }
  }

  const saved = record({ squareOrderId: order.id, paymentId: payment.id, receiptUrl: payment.receiptUrl ?? null })
  let ok = false
  for (let i = 0; i < 2 && !ok; i++) { try { await saveOrder(saved); ok = true } catch { /* retry once */ } }
  if (!ok) {
    logger.error('ORPHANED PAID MAGNET ORDER', { id, draftId: body.draftId, squareOrderId: order.id, paymentId: payment.id, email })
    return fail(500, `Your card was charged but we could not save your order. Call ${siteConfig.contactPhone} with order ${id} and keep your receipt.`)
  }
  await clearPending(body.draftId).catch(() => undefined)

  await reportBooking({
    requestUrl: request.url, kind: 'shop', bookingId: id, amountCents: quote.totalCents, email,
    firstName: name.split(/\s+/)[0], lastName: name.split(/\s+/).slice(1).join(' '),
    items: [{ item_id: m.square.variationId, item_name: ITEM_NAME, item_category: 'shop', price: m.setPriceCents / 100, quantity: body.sets }],
    attribution: cleanAttribution(body.attribution), posthogId: body.posthogId, extra: { delivery, magnets: quote.magnets },
  })
  return finish(saved, payment.receiptUrl ?? null)
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/api/shop-magnet-order.test.ts`
Expected: PASS (9 tests). If `chargeOutcomeOf` classifies a plain `Error('socket hang up')` as `not_charged`, read `src/lib/checkout-attempt.ts:81` and make the test throw the shape it treats as unknown (no Square 4xx).

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/shop/magnet-order.json.ts src/config/shop.config.ts tests/api/shop-magnet-order.test.ts
git commit -m "feat(shop): magnet order checkout endpoint"
```

---

### Task 10: 'shop' analytics kind

**Files:**
- Modify: `src/lib/analytics.ts`
- Modify: `src/lib/posthog-server.ts`

**Dependencies:** none

- [ ] **Step 1: Change the types**

In `src/lib/analytics.ts`:
```ts
export type BookingKindForAnalytics = 'party' | 'workshop' | 'kit' | 'shop' | 'other'
```
In `src/lib/posthog-server.ts` (`ServerBooking`):
```ts
  kind: 'party' | 'workshop' | 'kit' | 'shop'
```

- [ ] **Step 2: Run the suite**

Run: `npm test 2>&1 | tail -5`
Expected: all green

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics.ts src/lib/posthog-server.ts
git commit -m "feat(analytics): shop booking kind"
```

---

### Task 11: Admin orders + photo endpoints

**Files:**
- Create: `src/pages/api/admin/magnet-orders.json.ts`
- Create: `src/pages/api/admin/magnet-photo.ts`
- Test: `tests/api/admin-magnet-orders.test.ts`

**Dependencies:** Tasks 6, 7 (T7 must be finished first)

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/admin-magnet-orders.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { statusEmail } = vi.hoisted(() => ({ statusEmail: vi.fn().mockResolvedValue({ sent: true }) }))
vi.mock('@lib/magnet-emails', () => ({ sendMagnetStatusEmail: statusEmail }))
import { GET, POST } from '../../src/pages/api/admin/magnet-orders.json'
import { GET as PHOTO } from '../../src/pages/api/admin/magnet-photo'
import { adminCookie } from '@lib/admin-auth'
import { saveOrder, savePhoto, newReference, type MagnetOrder } from '@lib/magnet-orders'

const DRAFT = '0f8fad5b-d9cb-469f-a165-70867728950e'
const signedIn = () => adminCookie().split(';')[0]
const req = (url: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`https://x.test${url}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) } })

let o: MagnetOrder
beforeEach(async () => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  process.env.BLOB_STORE_FS_DIR = mkdtempSync(join(tmpdir(), 'mag-admin-'))
  statusEmail.mockClear()
  const photo = await savePhoto(DRAFT, Buffer.from([0xff, 0xd8, 0xff, 7]))
  o = { id: newReference(), createdAt: '2026-11-09T12:00:00.000Z', status: 'new', draftId: DRAFT, sets: 1, magnets: Array(6).fill(photo),
    delivery: 'pickup', address: null, contact: { name: 'T', email: 'kaden+m@ourhometownstudio.com', phone: '4029802907' },
    amounts: { subtotalCents: 1800, taxCents: 162, shippingCents: 0, totalCents: 1962 }, squareOrderId: 's', paymentId: 'p', receiptUrl: null, doneAt: null, photosDeletedAt: null, emailed: {} }
  await saveOrder(o)
})
afterEach(() => vi.unstubAllEnvs())

describe('admin magnet orders', () => {
  it('needs the owner sign-in', async () => {
    expect((await GET({ request: req('/api/admin/magnet-orders.json') } as any)).status).toBe(401)
    expect((await PHOTO({ request: req('/api/admin/magnet-photo'), url: new URL('https://x.test/api/admin/magnet-photo') } as any)).status).toBe(401)
  })
  it('lists orders', async () => {
    const res = await GET({ request: req('/api/admin/magnet-orders.json', { cookie: signedIn() }) } as any)
    expect((await res.json()).data.orders[0].id).toBe(o.id)
  })
  it('moves to ready and emails the customer', async () => {
    const res = await POST({ request: req('/api/admin/magnet-orders.json', { method: 'POST', cookie: signedIn(), body: JSON.stringify({ id: o.id, status: 'ready' }) }) } as any)
    expect(res.status).toBe(200)
    expect((await res.json()).data.order.status).toBe('ready')
    expect(statusEmail).toHaveBeenCalledWith(expect.objectContaining({ id: o.id }), 'ready')
  })
  it('does not email twice for the same status', async () => {
    const post = () => POST({ request: req('/api/admin/magnet-orders.json', { method: 'POST', cookie: signedIn(), body: JSON.stringify({ id: o.id, status: 'ready' }) }) } as any)
    await post(); await post()
    expect(statusEmail).toHaveBeenCalledTimes(1)
  })
  it('hides test orders on the live site', async () => {
    await saveOrder({ ...o, id: newReference(), simulated: true })
    const res = await GET({ request: req('/api/admin/magnet-orders.json', { cookie: signedIn() }) } as any)
    expect((await res.json()).data.orders).toHaveLength(1)
  })
  it('refuses shipped on a pickup order', async () => {
    const res = await POST({ request: req('/api/admin/magnet-orders.json', { method: 'POST', cookie: signedIn(), body: JSON.stringify({ id: o.id, status: 'shipped' }) }) } as any)
    expect(res.status).toBe(400)
  })
  it('serves a photo to owners', async () => {
    const url = new URL(`https://x.test/api/admin/magnet-photo?draft=${DRAFT}&photo=${o.magnets[0]}`)
    const res = await PHOTO({ request: req(url.pathname + url.search, { cookie: signedIn() }), url } as any)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/api/admin-magnet-orders.test.ts`
Expected: FAIL — cannot resolve the endpoints

- [ ] **Step 3: Implement**

```ts
// src/pages/api/admin/magnet-orders.json.ts
import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { isPreviewOrDev } from '@lib/deploy-context'
import { listOrders, setOrderStatus, markEmailed, STATUSES, type MagnetStatus } from '@lib/magnet-orders'
import { sendMagnetStatusEmail } from '@lib/magnet-emails'

export const prerender = false
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * GET: every magnet order, newest first (test orders only on preview/dev — previews share prod's stores).
 * POST { id, status }: move one. Ready / shipped email the customer once. Owners only.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  return json(200, { data: { orders: await listOrders({ includeSimulated: isPreviewOrDev(request) }) } })
}

export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => ({}))
  if (!STATUSES.includes(body?.status)) return json(400, { error: 'Unknown status.' })
  const status = body.status as MagnetStatus
  const result = await setOrderStatus(String(body?.id ?? ''), status)
  if (result === 'not_found') return json(404, { error: 'Order not found.' })
  if (result === 'wrong_delivery') return json(400, { error: status === 'shipped' ? 'This order is a pickup.' : 'This order ships.' })
  if (result === 'photos_deleted') return json(409, { error: 'The photos for this order were deleted, so it can\'t be reopened.' })
  let emailed = false
  if (result.changed && (status === 'ready' || status === 'shipped') && (await markEmailed(result.order.id, status))) {
    emailed = (await sendMagnetStatusEmail(result.order, status).catch(() => ({ sent: false }))).sent
  }
  return json(200, { data: { order: result.order, emailed } })
}
```

```ts
// src/pages/api/admin/magnet-photo.ts
import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { getPhoto } from '@lib/magnet-orders'

export const prerender = false

/** GET ?draft=&photo= → one magnet photo. Owners only. */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return new Response('Sign in first.', { status: 401 })
  const photo = await getPhoto(url.searchParams.get('draft') ?? '', url.searchParams.get('photo') ?? '')
  if (!photo) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(photo), { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } })
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/api/admin-magnet-orders.test.ts`
Expected: PASS (7 tests). `isPreviewOrDev` reads the request host/env; if the test host `x.test` counts as dev, stub it with `vi.mock('@lib/deploy-context', () => ({ isPreviewOrDev: () => false }))`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/admin/magnet-orders.json.ts src/pages/api/admin/magnet-photo.ts tests/api/admin-magnet-orders.test.ts
git commit -m "feat(admin): magnet orders and photos for owners"
```

---

### Task 12: Print page

**Files:**
- Create: `src/pages/admin/magnets-print.astro`

**Dependencies:** Tasks 4, 6, 11

Server-checks the owner cookie, loads the order, and renders one letter page per 12 magnets at exact inches. Catherine taps Print; the page tells her to print at "Actual size" / 100%.

- [ ] **Step 1: Create the page**

```astro
---
// src/pages/admin/magnets-print.astro
export const prerender = false
import { adminAuthorized } from '@lib/admin-auth'
import { getOrder } from '@lib/magnet-orders'
import { layoutSheets, framePolygon, SHEET } from '@lib/magnet-sheet'

if (!adminAuthorized(Astro.request)) return Astro.redirect('/admin')
const order = await getOrder(Astro.url.searchParams.get('id') ?? '')
if (!order) return new Response('Order not found', { status: 404 })
const pages = layoutSheets(order.magnets)
const poly = framePolygon().map(([x, y]) => `${x},${y}`).join(' ')
const src = (photoId: string) => `/api/admin/magnet-photo?draft=${order.draftId}&photo=${photoId}`
---
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex" />
  <title>Print {order.id}</title>
  <style define:vars={{ pageW: `${SHEET.pageW}in`, pageH: `${SHEET.pageH - 0.01}in`, frame: `${SHEET.frame}in`, inset: `${SHEET.photoInset}in`, photo: `${SHEET.photo}in` }}>
    @page { size: letter; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; background: #eee; }
    .bar { padding: 12px 16px; display: flex; gap: 12px; align-items: center; background: #fff; border-bottom: 1px solid #ddd; }
    .bar button { font-size: 18px; padding: 10px 22px; border-radius: 10px; border: 0; background: #7a4a2e; color: #fff; }
    .sheet { position: relative; width: var(--pageW); height: var(--pageH); margin: 16px auto; background: #fff; overflow: hidden; break-after: page; }
    .sheet:last-of-type { break-after: auto; }
    .cell { position: absolute; width: var(--frame); height: var(--frame); }
    .cell svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .cell img { position: absolute; left: var(--inset); top: var(--inset); width: var(--photo); height: var(--photo); object-fit: cover; outline: 1px solid #000; }
    @media print { body { background: #fff; } .bar { display: none; } .sheet { margin: 0; } }
  </style>
</head>
<body>
  <div class="bar">
    <button type="button" onclick="window.print()">Print</button>
    <span>{order.id} · {order.magnets.length} magnets · {pages.length} page{pages.length === 1 ? '' : 's'}. Print at Actual size (100%).</span>
  </div>
  {order.photosDeletedAt ? <p style="padding:16px">These photos were deleted on {order.photosDeletedAt.slice(0, 10)}.</p> : pages.map((cells) => (
    <section class="sheet">
      {cells.map((c) => (
        <div class="cell" style={`left:${c.left}in;top:${c.top}in`}>
          <svg viewBox={`0 0 ${SHEET.frame} ${SHEET.frame}`}><polygon points={poly} fill="none" stroke="#333" stroke-width="0.008" /></svg>
          <img src={src(c.photoId)} alt="" />
        </div>
      ))}
    </section>
  ))}
</body>
</html>
```

- [ ] **Step 2: Verify locally against the template**

Seed a dev order without the modal (Astro `<style>` is plain CSS — sizes come only from `define:vars`, so this check matters):

```bash
cat > scripts/_tmp-seed-magnet.mts <<'TS'
import { savePhoto, saveOrder, newReference } from '../src/lib/magnet-orders'
import { readFileSync } from 'node:fs'
const draft = '0f8fad5b-d9cb-469f-a165-70867728950e'
const jpg = readFileSync(process.argv[2])
const ids = [] as string[]
for (let i = 0; i < 14; i++) ids.push(await savePhoto(draft, jpg))
const id = newReference()
await saveOrder({ id, createdAt: new Date().toISOString(), status: 'new', draftId: draft, sets: 2, magnets: [...ids.slice(0, 12)],
  delivery: 'pickup', address: null, contact: { name: 'Test', email: 'kaden+magnets@ourhometownstudio.com', phone: '4029802907' },
  amounts: { subtotalCents: 3600, taxCents: 324, shippingCents: 0, totalCents: 3924 }, squareOrderId: 'dev', paymentId: 'dev', receiptUrl: null,
  simulated: true, doneAt: null, photosDeletedAt: null, emailed: {} })
console.log(id)
TS
npx tsx scripts/_tmp-seed-magnet.mts <any 600x600 jpg>; rm scripts/_tmp-seed-magnet.mts
```

Run `npm run dev`, sign in at `http://localhost:4321/admin`, open `/admin/magnets-print?id=<printed id>`, Print → Save as PDF, render with `pdftoppm -r 100 -png <file>.pdf <scratch>/sheet`, and overlay on the Canva export (`template.png`): frames and photos within 1/32". Exactly 1 page for 12 magnets (no blank page).
Expected: positions match; edges blank. **Then repeat on Catherine's iPad (AirPrint has no "actual size" setting): print, measure the photo square with a ruler = 2.00".** Note the iPad result in the commit message.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/magnets-print.astro
git commit -m "feat(admin): print page for magnet orders in the Canva template layout"
```

---

### Task 13: MagnetCropper

**Files:**
- Create: `src/components/shop/MagnetCropper.tsx`
- Test: `tests/components/shop/MagnetCropper.test.tsx`

**Dependencies:** Task 3

Shows the photo in a square with a dashed safe-area line; one-finger / mouse drag pans, two-finger pinch or the slider zooms; "Done" renders the 600×600 JPEG and calls `onDone(dataUrl, quality)`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/shop/MagnetCropper.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MagnetCropper from '@components/shop/MagnetCropper'

describe('MagnetCropper', () => {
  it('shows the safe-area line, the close-up hint and a zoom slider', () => {
    render(<MagnetCropper src="blob:x" size={{ w: 4000, h: 3000 }} onDone={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByTestId('safe-area')).toBeTruthy()
    expect(screen.getByText(/dashed line/i)).toBeTruthy()
    expect(screen.getByRole('slider', { name: /zoom/i })).toBeTruthy()
  })
  it('warns when the crop is too small to print sharp', () => {
    render(<MagnetCropper src="blob:x" size={{ w: 500, h: 500 }} onDone={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByRole('slider', { name: /zoom/i }), { target: { value: '2' } })
    expect(screen.getByText(/blurry/i)).toBeTruthy()
  })
  it('cancels', () => {
    const onCancel = vi.fn()
    render(<MagnetCropper src="blob:x" size={{ w: 4000, h: 3000 }} onDone={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/shop/MagnetCropper.test.tsx`
Expected: FAIL — cannot resolve the component

- [ ] **Step 3: Implement**

```tsx
// src/components/shop/MagnetCropper.tsx
import { useRef, useState } from 'react'
import { clampCrop, coverScale, printQuality, sourceRect, MAX_ZOOM, type Crop, type Size } from '@lib/magnet-crop'
import { shopConfig } from '@config/shop.config'
import { shopContent } from '@config/shop-content'

const BOX = 280 // on-screen square, CSS px

export interface MagnetCropperProps {
  src: string
  size: Size
  initial?: Crop
  onDone: (jpegDataUrl: string, crop: Crop, quality: 'good' | 'low') => void
  onCancel: () => void
}

export async function renderMagnet(src: string, size: Size, crop: Crop): Promise<string> {
  const out = shopConfig.magnets.outputPx
  const img = new Image()
  img.src = src
  await img.decode()
  const { sx, sy, side } = sourceRect(size, crop)
  const canvas = document.createElement('canvas')
  canvas.width = out
  canvas.height = out
  canvas.getContext('2d')!.drawImage(img, sx, sy, side, side, 0, 0, out, out)
  return canvas.toDataURL('image/jpeg', 0.88)
}

export default function MagnetCropper({ src, size, initial, onDone, onCancel }: MagnetCropperProps) {
  const [crop, setCrop] = useState<Crop>(initial ?? { zoom: 1, x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null)

  const scale = coverScale(size, BOX) * crop.zoom // screen px per source px
  const update = (next: Crop | ((c: Crop) => Crop)) => setCrop((c) => clampCrop(size, typeof next === 'function' ? next(c) : next))
  const quality = printQuality(size, crop)
  const inset = shopConfig.magnets.safeInset * 100

  function onPointerDown(e: React.PointerEvent) {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: crop.zoom }
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()]
      const zoom = pinchStart.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinchStart.current.dist)
      update((c) => ({ ...c, zoom }))
    } else if (pointers.current.size === 1) {
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      // functional update: several moves can arrive before React re-renders
      update((c) => { const sc = coverScale(size, BOX) * c.zoom; return { ...c, x: c.x + dx / sc, y: c.y + dy / sc } })
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchStart.current = null
  }

  async function done() {
    setBusy(true)
    try { onDone(await renderMagnet(src, size, crop), crop, quality) } finally { setBusy(false) }
  }

  const imgW = size.w * scale
  const imgH = size.h * scale
  return (
    <div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'center' }}>
      <div
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        style={{ position: 'relative', width: BOX, height: BOX, overflow: 'hidden', borderRadius: 4, touchAction: 'none', background: '#000', cursor: 'grab' }}
      >
        <img src={src} alt="" draggable={false} style={{
          position: 'absolute', width: imgW, height: imgH, maxWidth: 'none',
          left: BOX / 2 - imgW / 2 + crop.x * scale, top: BOX / 2 - imgH / 2 + crop.y * scale, userSelect: 'none', pointerEvents: 'none',
        }} />
        <div data-testid="safe-area" aria-hidden style={{ position: 'absolute', inset: `${inset}%`, border: '2px dashed rgba(255,255,255,0.9)', boxShadow: '0 0 0 1px rgba(0,0,0,0.35)', pointerEvents: 'none' }} />
      </div>
      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', width: BOX }}>
        <span style={{ fontSize: '0.85rem' }}>Zoom</span>
        <input type="range" aria-label="Zoom" min={1} max={MAX_ZOOM} step={0.01} value={crop.zoom} onChange={(e) => update({ ...crop, zoom: Number(e.target.value) })} style={{ flex: 1 }} />
      </label>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text)', maxWidth: BOX, textAlign: 'center' }}>{shopContent.modal.closeUpHint}</p>
      {quality === 'low' && <p role="status" style={{ margin: 0, fontSize: '0.85rem', color: '#9a3412', maxWidth: BOX, textAlign: 'center' }}>{shopContent.modal.blurryWarning}</p>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={done} disabled={busy}>Done</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/components/shop/MagnetCropper.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/shop/MagnetCropper.tsx tests/components/shop/MagnetCropper.test.tsx
git commit -m "feat(shop): square magnet cropper with safe area and blur warning"
```

---

### Task 14: MagnetOrderModal

**Files:**
- Create: `src/components/shop/MagnetOrderModal.tsx`
- Test: `tests/components/shop/MagnetOrderModal.test.tsx`

**Dependencies:** Tasks 2, 8, 9, 10, 13

Steps on `BookingPanel`: **photos** (sets stepper 1–10 → magnets grid; tap an empty slot → pick a file → crop → upload; filled slot → re-crop / remove / "use again" copies into the next empty slot) → **delivery** (pickup or ship + `AddressInput`; name, email, phone) → **pay** (`PaymentForm`, total from `quoteMagnets`, `attemptId` from `newAttemptId()`) → `BookingConfirmed`. Footer button disabled until the step is complete. A photo upload happens right after "Done" in the cropper; the slot shows a spinner until it returns a `photoId`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/shop/MagnetOrderModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
vi.mock('@components/checkout/PaymentForm', () => ({ default: () => <div>card form</div> }))
// BookingPanel calls window.matchMedia; jsdom has none (same stub as PartyModal.test.tsx)
beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }))
})
import MagnetOrderModal, { canContinueFromPhotos, slotsFor } from '@components/shop/MagnetOrderModal'

describe('MagnetOrderModal helpers', () => {
  it('makes 6 slots per set and keeps existing photos when sets grow', () => {
    const slots = slotsFor(1, [])
    expect(slots).toHaveLength(6)
    expect(slotsFor(2, slots.map((_, i) => ({ photoId: `p${i}`, preview: 'x', quality: 'good' as const })))).toHaveLength(12)
  })
  it('only continues when every slot has a saved photo', () => {
    expect(canContinueFromPhotos(slotsFor(1, []))).toBe(false)
    expect(canContinueFromPhotos(Array(6).fill({ photoId: 'p', preview: 'x', quality: 'good' }))).toBe(true)
    expect(canContinueFromPhotos([...Array(5).fill({ photoId: 'p', preview: 'x', quality: 'good' }), { photoId: null, preview: 'x', quality: 'good' }])).toBe(false)
  })
})

describe('MagnetOrderModal', () => {
  it('opens on the photos step with $18 for one set', () => {
    render(<MagnetOrderModal onClose={vi.fn()} />)
    expect(screen.getByText(/your photos/i)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /add photo/i })).toHaveLength(6)
    fireEvent.click(screen.getByRole('button', { name: /more magnets/i }))
    expect(screen.getAllByRole('button', { name: /add photo/i })).toHaveLength(12)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/shop/MagnetOrderModal.test.tsx`
Expected: FAIL — cannot resolve the component

- [ ] **Step 3: Implement**

```tsx
// src/components/shop/MagnetOrderModal.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import BookingPanel from '@components/shared/BookingPanel'
import BookingConfirmed from '@components/shared/BookingConfirmed'
import AddressInput from '@components/shared/AddressInput'
import PaymentForm, { type PaymentFormRef } from '@components/checkout/PaymentForm'
import MagnetCropper from '@components/shop/MagnetCropper'
import { shopConfig, type Delivery } from '@config/shop.config'
import { shopContent } from '@config/shop-content'
import { quoteMagnets } from '@lib/magnet-pricing'
import { formatMoney } from '@lib/money'
import { newAttemptId } from '@lib/checkout-attempt'
import { readAttribution } from '@lib/attribution'
import { posthogId, trackBeginCheckout, trackPaymentCompleted, trackPaymentFailed } from '@lib/analytics'
import type { Crop, Size } from '@lib/magnet-crop'

export interface Slot { photoId: string | null; preview: string; quality: 'good' | 'low' }
type Step = 'photos' | 'delivery' | 'pay'
const C = shopContent.modal
const STEP_NAMES: Record<Step, string> = { photos: C.stepPhotos, delivery: C.stepDelivery, pay: C.stepPay }

export function slotsFor(sets: number, current: (Slot | null)[]): (Slot | null)[] {
  const n = sets * shopConfig.magnets.setSize
  return Array.from({ length: n }, (_, i) => current[i] ?? null)
}
export function canContinueFromPhotos(slots: (Slot | null)[]): boolean {
  return slots.length > 0 && slots.every((s) => !!s?.photoId)
}

function uuid(): string { return newAttemptId() }

export default function MagnetOrderModal({ onClose }: { onClose: () => void }) {
  const [draftId] = useState(uuid)
  const [step, setStep] = useState<Step>('photos')
  const [sets, setSets] = useState(1)
  const [slots, setSlots] = useState<(Slot | null)[]>(() => slotsFor(1, []))
  const [editing, setEditing] = useState<{ index: number; src: string; size: Size } | null>(null)
  const [delivery, setDelivery] = useState<Delivery>('pickup')
  const [address, setAddress] = useState('')
  const [contact, setContact] = useState({ name: '', email: '', phone: '' })
  const [attemptId, setAttemptId] = useState(uuid)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ reference: string; emailSent: boolean } | null>(null)
  const [askToLeave, setAskToLeave] = useState(false)
  const [paymentReady, setPaymentReady] = useState(false)
  const payRef = useRef<PaymentFormRef>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pickFor = useRef<number>(0)

  const [unknownOutcome, setUnknownOutcome] = useState(false)
  const quote = useMemo(() => quoteMagnets(sets, delivery), [sets, delivery])
  // A changed order is a new attempt — unless an earlier charge's outcome is still unknown.
  useEffect(() => { if (!unknownOutcome) setAttemptId(uuid()) }, [sets, delivery, address]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setError(null), [step])
  const changeSets = (n: number) => { const s = Math.min(shopConfig.magnets.maxSets, Math.max(1, n)); setSets(s); setSlots((cur) => slotsFor(s, cur)) }

  function pickPhoto(index: number) { pickFor.current = index; fileRef.current?.click() }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const src = URL.createObjectURL(file)
    const bmp = await createImageBitmap(file)
    setEditing({ index: pickFor.current, src, size: { w: bmp.width, h: bmp.height } })
    bmp.close()
  }
  async function onCropped(jpeg: string, _crop: Crop, quality: 'good' | 'low') {
    const index = editing!.index
    setEditing(null)
    setSlots((cur) => cur.map((s, i) => (i === index ? { photoId: null, preview: jpeg, quality } : s)))
    const res = await fetch('/api/shop/magnet-photo.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId, image: jpeg }) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { setError(body?.error ?? 'We could not save that photo. Try again.'); setSlots((cur) => cur.map((s, i) => (i === index ? null : s))); return }
    setSlots((cur) => cur.map((s, i) => (i === index ? { photoId: body.data.photoId, preview: jpeg, quality } : s)))
  }
  function useAgain(index: number) {
    const empty = slots.findIndex((s) => !s)
    if (empty >= 0) setSlots((cur) => cur.map((s, i) => (i === empty ? cur[index] : s)))
  }
  const remove = (index: number) => setSlots((cur) => cur.map((s, i) => (i === index ? null : s)))

  const deliveryValid = contact.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim()) &&
    contact.phone.replace(/\D/g, '').length >= 10 && (delivery === 'pickup' || address.trim().length >= 8)

  async function pay(e?: React.FormEvent, walletToken?: string) {
    e?.preventDefault()
    if (processing) return
    setProcessing(true); setError(null)
    try {
      const token = walletToken ?? (await payRef.current!.tokenize()).token
      const res = await fetch('/api/shop/magnet-order.json', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, attemptId, sets, magnets: slots.map((s) => s!.photoId), delivery, address, contact, paymentToken: token, attribution: readAttribution(), posthogId: posthogId() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body?.detail ?? 'Something went wrong. Try again.')
        trackPaymentFailed('shop', body?.code ?? `http_${res.status}`)
        if (body?.code === 'unknown_outcome') { setUnknownOutcome(true); return } // keep the attempt id: a retry must find the same charge
        if (Array.isArray(body?.missingPhotos)) {
          const gone = new Set<string>(body.missingPhotos)
          setSlots((cur) => cur.map((sl) => (sl?.photoId && gone.has(sl.photoId) ? null : sl)))
          setStep('photos')
        }
        setUnknownOutcome(false)
        setAttemptId(uuid()) // we know nothing was charged
        return
      }
      setUnknownOutcome(false)
      trackPaymentCompleted(quote.totalCents / 100, { kind: 'shop', transactionId: body.data.reference, items: [{ item_id: 'photo-magnets', item_name: 'Photo Magnets', price: shopConfig.magnets.setPriceCents / 100, quantity: sets }] } as any)
      setDone({ reference: body.data.reference, emailSent: !!body.data.emailSent })
    } catch {
      setError('Check your card details and try again.')
    } finally { setProcessing(false) }
  }

  const footer = done ? (
    <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
  ) : step === 'photos' ? (
    <button type="button" className="btn btn-primary" disabled={!canContinueFromPhotos(slots)} onClick={() => setStep('delivery')}>Continue</button>
  ) : step === 'delivery' ? (
    <button type="button" className="btn btn-primary" disabled={!deliveryValid} onClick={() => { trackBeginCheckout?.('shop' as any, quote.totalCents / 100 as any); setStep('pay') }}>Continue</button>
  ) : (
    <button type="submit" form="magnet-pay" className="btn btn-primary" disabled={processing || !paymentReady}>{processing ? 'Processing…' : `Pay ${formatMoney(quote.totalCents)}`}</button>
  )

  const input = { width: '100%', padding: '0.7rem 0.8rem', borderRadius: 10, border: '1px solid rgba(122,74,46,0.25)', fontSize: '1rem' } as const

  return (
    <BookingPanel
      title={C.title}
      onRequestClose={done ? onClose : () => { if (!processing) setAskToLeave(true) }}
      stepKey={done ? 'confirmed' : editing ? 'crop' : step}
      stepName={done ? undefined : STEP_NAMES[step]}
      stepNumber={done ? undefined : step === 'photos' ? 1 : step === 'delivery' ? 2 : 3}
      stepCount={done ? undefined : 3}
      summary={done ? undefined : <p style={{ margin: 0 }}>{quote.magnets} magnets · {formatMoney(quote.subtotalCents)}</p>}
      onBack={!done && !editing && step !== 'photos' && !processing && !unknownOutcome ? () => setStep(step === 'pay' ? 'delivery' : 'photos') : undefined}
      footer={editing ? undefined : footer}
      leavePrompt={askToLeave && !done ? { title: C.leaveTitle, body: C.leaveBody, keepLabel: C.keep, leaveLabel: C.leave, onKeep: () => setAskToLeave(false), onLeave: onClose } : null}
    >
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      {error && <p role="alert" style={{ color: '#9a3412', margin: '0 0 0.75rem' }}>{error}</p>}
      {done ? (
        <BookingConfirmed heading={C.confirmedHeading} what={<>{quote.magnets} photo magnets · order {done.reference}</>} email={contact.email} emailSent={done.emailSent}>
          <p>{shopContent.magnets.readyLine}</p>
        </BookingConfirmed>
      ) : editing ? (
        <MagnetCropper src={editing.src} size={editing.size} onDone={onCropped} onCancel={() => setEditing(null)} />
      ) : step === 'photos' ? (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span>{C.setsLabel}</span>
            <button type="button" className="btn btn-secondary" aria-label="Fewer magnets" onClick={() => changeSets(sets - 1)} disabled={sets <= 1}>−</button>
            <strong>{quote.magnets}</strong>
            <button type="button" className="btn btn-secondary" aria-label="More magnets" onClick={() => changeSets(sets + 1)} disabled={sets >= shopConfig.magnets.maxSets}>+</button>
          </div>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>{C.photosHint}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem' }}>
            {slots.map((s, i) => s ? (
              <div key={i} style={{ position: 'relative' }}>
                <img src={s.preview} alt={`Magnet ${i + 1}`} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6, opacity: s.photoId ? 1 : 0.5 }} />
                {s.quality === 'low' && <span title={C.blurryWarning} style={{ position: 'absolute', top: 4, left: 4, background: '#fff7ed', color: '#9a3412', borderRadius: 999, padding: '0 6px', fontSize: 12 }}>!</span>}
                <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: 12 }} onClick={() => useAgain(i)} disabled={!s.photoId || slots.every(Boolean)}>{C.usePhotoAgain}</button>
                  <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: 12 }} onClick={() => remove(i)}>{C.remove}</button>
                </div>
              </div>
            ) : (
              <button key={i} type="button" aria-label="Add photo" onClick={() => pickPhoto(i)} style={{ aspectRatio: '1', borderRadius: 6, border: '2px dashed rgba(122,74,46,0.35)', background: 'transparent', fontSize: 28, color: 'var(--color-primary)' }}>+</button>
            ))}
          </div>
        </div>
      ) : step === 'delivery' ? (
        <div style={{ display: 'grid', gap: '0.8rem' }}>
          {(['pickup', 'ship'] as const).map((d) => (
            <label key={d} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
              <input type="radio" name="delivery" checked={delivery === d} onChange={() => setDelivery(d)} />
              <span><strong>{d === 'pickup' ? C.pickupLabel : C.shipLabel}</strong><br /><small>{d === 'pickup' ? C.pickupNote : C.shipNote}</small></span>
            </label>
          ))}
          {delivery === 'ship' && <label>{C.addressLabel}<AddressInput value={address} onChange={setAddress} style={input} /></label>}
          <label>{C.nameLabel}<input style={input} value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} autoComplete="name" /></label>
          <label>{C.emailLabel}<input style={input} type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} autoComplete="email" /></label>
          <label>{C.phoneLabel}<input style={input} type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} autoComplete="tel" /></label>
        </div>
      ) : (
        <form id="magnet-pay" onSubmit={pay} style={{ display: 'grid', gap: '0.75rem' }}>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.25rem 1rem', margin: 0 }}>
            <dt>{quote.magnets} magnets</dt><dd style={{ margin: 0 }}>{formatMoney(quote.subtotalCents)}</dd>
            <dt>Tax</dt><dd style={{ margin: 0 }}>{formatMoney(quote.taxCents)}</dd>
            {quote.shippingCents > 0 && (<><dt>Shipping</dt><dd style={{ margin: 0 }}>{formatMoney(quote.shippingCents)}</dd></>)}
            <dt><strong>Total</strong></dt><dd style={{ margin: 0 }}><strong>{formatMoney(quote.totalCents)}</strong></dd>
          </dl>
          <PaymentForm ref={payRef} bookingKind="shop" environmentOverride="production" onReadyChange={setPaymentReady}
            wallet={{ amount: (quote.totalCents / 100).toFixed(2), label: 'Hometown Photo Magnets' }}
            onWalletToken={(t) => pay(undefined, t)} canPayWithWallet={() => (processing ? 'Paying…' : null)} />
        </form>
      )}
    </BookingPanel>
  )
}
```

Note for the implementer: before writing the `trackBeginCheckout` / `trackPaymentCompleted` / `trackPaymentFailed` calls, open `src/lib/analytics.ts` and use their exact signatures (drop the `as any` casts once they match). After an `unknown_outcome` answer the pay button stays, Back is hidden, and the error tells them to check their email — retrying with the same attempt lets the server find an earlier charge.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/components/shop/MagnetOrderModal.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/shop/MagnetOrderModal.tsx tests/components/shop/MagnetOrderModal.test.tsx
git commit -m "feat(shop): photo magnet order modal"
```

---

### Task 15: /shop page + nav

**Files:**
- Create: `src/components/shop/MagnetOrderButton.tsx`
- Create: `src/pages/shop.astro`
- Modify: `src/config/site.config.ts` (nav)
- Modify: `src/pages/sitemap.xml.ts` (`PUBLIC_PAGES`)

**Dependencies:** Task 14

- [ ] **Step 1: Create the island**

```tsx
// src/components/shop/MagnetOrderButton.tsx
import { lazy, Suspense, useState } from 'react'
import { shopContent } from '@config/shop-content'
const MagnetOrderModal = lazy(() => import('@components/shop/MagnetOrderModal'))

export default function MagnetOrderButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>{shopContent.magnets.button}</button>
      {open && <Suspense fallback={null}><MagnetOrderModal onClose={() => setOpen(false)} /></Suspense>}
    </>
  )
}
```

- [ ] **Step 2: Create the page**

```astro
---
// src/pages/shop.astro
export const prerender = true
import Layout from '@layouts/Layout.astro'
import MagnetOrderButton from '@components/shop/MagnetOrderButton'
import { shopContent as c } from '@config/shop-content'
---
<Layout title="Shop" description="Photo magnets made from your photos at Hometown Studio in Madison, AL.">
  <section class="max-w-4xl mx-auto px-4 sm:px-6 pb-20" style="padding-top: 5.5rem;">
    <div class="mb-8 md:text-center fade-in">
      <p class="eyebrow mb-2">{c.pageEyebrow}</p>
      <h1 class="text-4xl sm:text-5xl font-heading font-bold" style="color: var(--color-dark);">{c.pageTitle}</h1>
      <p class="text-base sm:text-lg mt-3" style="color: var(--color-text);">{c.pageLead}</p>
    </div>
    <article class="glass rounded-2xl p-6 sm:p-8 grid gap-4 sm:grid-cols-2 items-center">
      <img src="/images/shop/photo-magnets.jpg" alt="Square photo magnets on a fridge" class="rounded-xl w-full" style="aspect-ratio: 4/3; object-fit: cover;" />
      <div class="grid gap-3">
        <h2 class="text-2xl font-heading font-bold" style="color: var(--color-dark);">{c.magnets.title}</h2>
        <p style="color: var(--color-text);">{c.magnets.blurb}</p>
        <p class="font-semibold" style="color: var(--color-dark);">{c.magnets.price}</p>
        <p class="text-sm" style="color: var(--color-text);">{c.magnets.readyLine}</p>
        <div><MagnetOrderButton client:visible /></div>
      </div>
    </article>
  </section>
</Layout>
```

Photo: ask Kaden for a real photo of finished magnets → `public/images/shop/photo-magnets.jpg` (4:3, ≥1600×1200). Until then, use the craft-copy skill's AI image prompt with Kaden.

- [ ] **Step 3: Add the nav item** — in `src/config/site.config.ts` `nav`, after `{ label: 'Craft Café', href: '/craft-cafe' },`:

```ts
    { label: 'Shop', href: '/shop' },
```

- [ ] **Step 4: Add `/shop` to the sitemap** — in `src/pages/sitemap.xml.ts`, `PUBLIC_PAGES`, add `'/shop'` after `'/craft-cafe'` (update any sitemap test that lists the pages).

- [ ] **Step 5: Verify**

Run: `npm test 2>&1 | tail -5 && npm run build 2>&1 | tail -5`
Expected: tests green (update any nav snapshot/assertion test that counts items); build succeeds and lists `/shop`.

- [ ] **Step 6: Commit**

```bash
git add src/components/shop/MagnetOrderButton.tsx src/pages/shop.astro src/config/site.config.ts src/pages/sitemap.xml.ts tests
git commit -m "feat(shop): /shop page with photo magnets and a Shop menu link"
```

---

### Task 16: Admin Orders tab

**Files:**
- Create: `src/components/admin/MagnetOrderCard.tsx`
- Modify: `src/components/admin/AdminApp.tsx`
- Modify: `tests/components/admin/AdminApp.test.tsx` (fourth fetch mock)
- Test: `tests/components/admin/MagnetOrderCard.test.tsx`

**Dependencies:** Task 11

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/admin/MagnetOrderCard.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MagnetOrderCard } from '@components/admin/MagnetOrderCard'
import type { MagnetOrder } from '@lib/magnet-orders'

const o: MagnetOrder = { id: 'M-ABC234', createdAt: '2026-11-09T18:00:00.000Z', status: 'new', draftId: '0f8fad5b-d9cb-469f-a165-70867728950e', sets: 1,
  magnets: Array(6).fill('1700000000000-deadbeef'), delivery: 'pickup', address: null, contact: { name: 'Test Person', email: 'kaden+m@ourhometownstudio.com', phone: '4029802907' },
  amounts: { subtotalCents: 1800, taxCents: 162, shippingCents: 0, totalCents: 1962 }, squareOrderId: 's', paymentId: 'p', receiptUrl: null, doneAt: null, photosDeletedAt: null, emailed: {} }

describe('MagnetOrderCard', () => {
  it('shows the order, a Print link and only the pickup statuses', () => {
    render(<MagnetOrderCard order={o} onMove={vi.fn()} />)
    expect(screen.getByText(/M-ABC234/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /print/i }).getAttribute('href')).toBe('/admin/magnets-print?id=M-ABC234')
    expect(screen.queryByRole('button', { name: 'Shipped' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ready for pickup' })).toBeTruthy()
  })
  it('moves status', () => {
    const onMove = vi.fn()
    render(<MagnetOrderCard order={o} onMove={onMove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Made' }))
    expect(onMove).toHaveBeenCalledWith('M-ABC234', 'made')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/admin/MagnetOrderCard.test.tsx`
Expected: FAIL — cannot resolve the component

- [ ] **Step 3: Implement the card**

```tsx
// src/components/admin/MagnetOrderCard.tsx
import { StatusPills } from '@components/admin/StatusPills'
import { STATUS_LABEL, PICKUP_STATUSES as PICKUP, SHIP_STATUSES as SHIP, type MagnetOrder, type MagnetStatus } from '@lib/magnet-status'
import { formatMoney } from '@lib/money'

export function MagnetOrderCard({ order: o, onMove }: { order: MagnetOrder; onMove: (id: string, s: MagnetStatus) => void }) {
  const when = new Date(o.createdAt).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const unique = [...new Set(o.magnets)]
  return (
    <article className="glass rounded-2xl" style={{ padding: '1.25rem', display: 'grid', gap: '0.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{o.contact.name} · {o.id}</h2>
        <span style={{ fontSize: '0.85rem' }}>{when}{o.simulated ? ' · test' : ''}</span>
      </div>
      <p style={{ margin: 0, fontWeight: 600 }}>
        {o.magnets.length} magnets · {o.delivery === 'pickup' ? 'Pickup' : `Ship to ${o.address}`} · {formatMoney(o.amounts.totalCents)}
      </p>
      <StatusPills name={o.id} current={o.status} statuses={(o.delivery === 'pickup' ? PICKUP : SHIP).map((s) => [s, STATUS_LABEL[s]] as [MagnetStatus, string])} onMove={(s) => onMove(o.id, s)} />
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.9rem' }}>
        <a href={`mailto:${o.contact.email}`}>{o.contact.email}</a>
        <a href={`tel:${o.contact.phone}`}>{o.contact.phone}</a>
      </div>
      {o.photosDeletedAt ? <p style={{ margin: 0, fontSize: '0.85rem' }}>Photos deleted {o.photosDeletedAt.slice(0, 10)}.</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: '0.4rem' }}>
            {unique.map((p) => (
              <img key={p} src={`/api/admin/magnet-photo?draft=${o.draftId}&photo=${p}`} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 4 }} />
            ))}
          </div>
          <a className="btn btn-primary" href={`/admin/magnets-print?id=${o.id}`} target="_blank" rel="noopener" style={{ justifySelf: 'start' }}>Print</a>
        </>
      )}
    </article>
  )
}
```

- [ ] **Step 4: Add the tab to `AdminApp.tsx`** (four edits, matching the existing pattern):
  1. `type Tab = 'events' | 'messages' | 'teachers' | 'orders'`
  2. Add `fetch('/api/admin/magnet-orders.json', { cache: 'no-store' })` to the `Promise.all` in `load()`, include it in the 401 check, and store `data.orders` in a new `const [orders, setOrders] = useState<MagnetOrder[]>([])`.
  3. Add `['orders', tabLabel('Orders', orders)]` as the **first** tab entry (new orders matter most).
  4. Render:
  ```tsx
  {tab === 'orders' && (
    <StatusList title="Orders" items={orders}
      statuses={STATUSES.map((s) => [s, STATUS_LABEL[s]] as [MagnetStatus, string])}
      empty="No magnet orders yet."
      render={(o) => <MagnetOrderCard key={o.id} order={o} onMove={moveOrder} />} />
  )}
  ```
  with
  ```tsx
  async function moveOrder(id: string, status: MagnetStatus) {
    const res = await fetch('/api/admin/magnet-orders.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    const body = await res.json().catch(() => ({}))
    if (res.ok) setOrders((cur) => cur.map((o) => (o.id === id ? body.data.order : o)))
  }
  ```
  and imports `MagnetOrderCard` plus `STATUSES`, `STATUS_LABEL`, `type MagnetOrder`, `type MagnetStatus` **from `@lib/magnet-status`** (never `@lib/magnet-orders`, which imports `node:crypto`). Show the POST's `error` (e.g. "photos were deleted") in the existing admin error spot when `!res.ok`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/components/admin && npm run build 2>&1 | tail -3`
Expected: PASS; build succeeds (update `tests/components/admin/AdminApp.test.tsx` fetch mocks for the fourth request).

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/MagnetOrderCard.tsx src/components/admin/AdminApp.tsx tests/components/admin
git commit -m "feat(admin): Orders tab for photo magnets"
```

---

### Task 17: Daily cleanup job

**Files:**
- Create: `src/pages/api/jobs/shop-cleanup.json.ts`
- Create: `netlify/functions/shop-cleanup.ts`
- Test: `tests/api/jobs-shop-cleanup.test.ts`

**Dependencies:** Task 6

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/jobs-shop-cleanup.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
const { cleanup } = vi.hoisted(() => ({ cleanup: vi.fn().mockResolvedValue({ draftsDeleted: 2, ordersCleared: 1, dryRun: false, drafts: [], orders: [] }) }))
vi.mock('@lib/magnet-orders', () => ({ cleanup }))
import { POST, shopCleanupJobKey } from '../../src/pages/api/jobs/shop-cleanup.json'

const call = (key?: string, q = '') => POST({ request: new Request(`https://x.test/api/jobs/shop-cleanup.json${q}`, { method: 'POST', headers: key ? { 'x-job-key': key } : {} }) } as any)
afterEach(() => vi.unstubAllEnvs())

describe('shop cleanup job', () => {
  it('refuses without the job key', async () => {
    vi.stubEnv('LOOKUP_SIGNING_SECRET', 's3cret')
    expect((await call()).status).toBe(403)
    expect((await call('wrong')).status).toBe(403)
  })
  it('runs with the key', async () => {
    vi.stubEnv('LOOKUP_SIGNING_SECRET', 's3cret')
    const res = await call(shopCleanupJobKey('s3cret'))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ draftsDeleted: 2, ordersCleared: 1 })
    expect(cleanup).toHaveBeenLastCalledWith(expect.any(Date), { dryRun: false })
  })
  it('passes dryRun through', async () => {
    vi.stubEnv('LOOKUP_SIGNING_SECRET', 's3cret')
    await call(shopCleanupJobKey('s3cret'), '?dryRun=1')
    expect(cleanup).toHaveBeenLastCalledWith(expect.any(Date), { dryRun: true })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/api/jobs-shop-cleanup.test.ts`
Expected: FAIL — cannot resolve the endpoint

- [ ] **Step 3: Implement**

```ts
// src/pages/api/jobs/shop-cleanup.json.ts
import type { APIRoute } from 'astro'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cleanup } from '@lib/magnet-orders'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:jobs:shop-cleanup')
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export function shopCleanupJobKey(secret: string): string {
  return createHmac('sha256', secret).update('job:shop-cleanup').digest('hex')
}

function allowed(request: Request): boolean {
  const secret = process.env.LOOKUP_SIGNING_SECRET || (import.meta as any).env?.LOOKUP_SIGNING_SECRET || ''
  if (!secret) return false
  const given = Buffer.from(request.headers.get('x-job-key') ?? '')
  const wanted = Buffer.from(shopCleanupJobKey(secret))
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/** Daily: delete abandoned magnet drafts (24 h) and finished orders' photos (30 days). */
export const POST: APIRoute = async ({ request }) => {
  if (!allowed(request)) return json({ error: 'Forbidden' }, 403)
  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1'
  const result = await cleanup(new Date(), { dryRun })
  logger.info('shop cleanup', result)
  return json({ data: result }, 200)
}
```

```ts
// netlify/functions/shop-cleanup.ts
import type { Config, Context } from '@netlify/functions'
import { createHmac } from 'node:crypto'

export const config: Config = { schedule: '0 9 * * *' }

export default async (_req: Request, context: Context) => {
  const site = (context?.site?.url ?? process.env.URL ?? '').replace(/\/$/, '')
  const secret = process.env.LOOKUP_SIGNING_SECRET
  if (!site || !secret) return new Response('not configured', { status: 500 })
  const key = createHmac('sha256', secret).update('job:shop-cleanup').digest('hex')
  const res = await fetch(`${site}/api/jobs/shop-cleanup.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-job-key': key }, body: '{}' })
  return new Response(await res.text(), { status: res.status })
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/api/jobs-shop-cleanup.test.ts`
Expected: PASS (3 tests). Before the schedule's first real run on prod, call the endpoint once with `?dryRun=1` and check the listed drafts/orders by hand.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/jobs/shop-cleanup.json.ts netlify/functions/shop-cleanup.ts tests/api/jobs-shop-cleanup.test.ts
git commit -m "feat(shop): daily cleanup of magnet drafts and finished photos"
```

---

### Task 17a: Tax report — `shop` bucket

**Files:**
- Modify: `src/lib/tax-report.ts`
- Test: `tests/lib/tax-report.test.ts`

**Dependencies:** none

Today any non-kit, non-class, non-appointment item lands in `cafe` (use tax). Magnets are resold goods like kits → **sales** tax. Everything in the "Shop" category (magnets + the Shipping item) goes to `shop`.

- [ ] **Step 1: Write the failing test** (add to `tests/lib/tax-report.test.ts`)

```ts
import { bucketFor, BUCKET_TAX, BUCKET_LABEL } from '@lib/tax-report'
describe('shop bucket', () => {
  it('puts Shop items in shop, reported as sales tax', () => {
    expect(bucketFor({ productType: 'REGULAR', categoryNames: ['Shop'] })).toBe('shop')
    expect(BUCKET_TAX.shop).toBe('sales')
    expect(BUCKET_LABEL.shop).toBe('Shop (photo magnets)')
    expect(bucketFor({ productType: 'REGULAR', categoryNames: ['Keychains & Clips'] })).toBe('cafe')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/tax-report.test.ts`
Expected: FAIL — `'cafe'` received

- [ ] **Step 3: Implement** in `src/lib/tax-report.ts`:

```ts
export type Bucket = 'classes' | 'cafe' | 'parties' | 'kits' | 'shop' | 'other'
// BUCKET_LABEL: add
  shop: 'Shop (photo magnets)',
// BUCKET_TAX: add
  shop: 'sales',
// bucketFor: add as the first category check
  if (info.categoryNames.some((c) => /^shop$/i.test(c))) return 'shop'
```

Then search for other `Record<Bucket, …>` literals and empty-summary builders (`grep -n "kits:" src/lib/tax-report.ts src/pages/api/jobs/tax-report.json.ts`) and add `shop` to each, keeping row order classes, cafe, parties, kits, shop, other.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/tax-report.test.ts tests/netlify/tax-report.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tax-report.ts src/pages/api/jobs/tax-report.json.ts tests/lib/tax-report.test.ts tests/netlify
git commit -m "feat(tax-report): shop bucket reported as sales tax"
```

---

### Task 18a: Square catalog seed script

**Files:**
- Create: `scripts/seed-shop.ts`

**Dependencies:** none. Writing the script is safe; **running `--apply` is T18b.**

Creates category "Shop" with two items: "Photo Magnets – Set of 6" ($18, carries the 9% tax so in-store POS sales are taxed too) and "Shipping" ($6, no tax). Create-only, matches by name, preview by default, stable idempotency key (a retried timeout can't duplicate), reads back.

- [ ] **Step 1: Create the script**

```ts
// scripts/seed-shop.ts
/**
 * Square catalog for the shop: category "Shop" → "Photo Magnets – Set of 6" $18 (9% tax)
 * and "Shipping" $6 (no tax). Create-only (skips what exists). Prints the ids for
 * src/config/shop.config.ts.
 *
 *   npx tsx scripts/seed-shop.ts            # preview, writes nothing
 *   npx tsx scripts/seed-shop.ts --apply    # write, then read back
 *
 * Undo a wrong --apply: delete the printed ids with client.catalog.batchDelete({ objectIds: [...] }).
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { SquareClient, SquareEnvironment } from 'square'

const APPLY = process.argv.includes('--apply')
const TAX_ID = 'XKZ3OIRJ3SPPO4TO64UUDFA4' // the account's 9% sales tax
const CATEGORY = 'Shop'
const ITEMS = [
  { key: 'magnets', name: 'Photo Magnets – Set of 6', variation: 'Set of 6', cents: 1800, taxed: true },
  { key: 'shipping', name: 'Shipping', variation: 'Flat rate', cents: 600, taxed: false },
] as const
const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment: process.env.SQUARE_ENVIRONMENT === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
})

async function listAll(types: string) {
  const out: any[] = []
  for await (const o of (await client.catalog.list({ types })) as any) out.push(o)
  return out
}

async function main() {
  console.log(`Square env: ${process.env.SQUARE_ENVIRONMENT} · ${APPLY ? 'APPLY' : 'PREVIEW (no writes)'}`)
  const cat = (await listAll('CATEGORY')).find((c) => c.categoryData?.name === CATEGORY && !c.categoryData?.parentCategory?.id)
  const items = await listAll('ITEM')
  const catId = cat?.id ?? '#shop'
  const objects: any[] = []
  if (!cat) objects.push({ type: 'CATEGORY', id: '#shop', presentAtAllLocations: true, categoryData: { name: CATEGORY } })
  for (const it of ITEMS) {
    const found = items.find((i) => i.itemData?.name === it.name && (i.itemData?.categories ?? []).some((c: any) => c.id === cat?.id))
    if (found) { console.log(`Exists: ${it.name} → ${found.id} / ${found.itemData.variations[0].id}`); continue }
    objects.push({
      type: 'ITEM', id: `#${it.key}`, presentAtAllLocations: true,
      itemData: {
        name: it.name, productType: 'REGULAR', categories: [{ id: catId }], reportingCategory: { id: catId },
        ...(it.taxed ? { taxIds: [TAX_ID] } : {}),
        variations: [{ type: 'ITEM_VARIATION', id: `#${it.key}-var`, presentAtAllLocations: true,
          itemVariationData: { name: it.variation, pricingType: 'FIXED_PRICING', priceMoney: { amount: BigInt(it.cents), currency: 'USD' } } }],
      },
    })
  }
  console.log(`Will create: ${objects.map((o) => o.type === 'CATEGORY' ? `category ${CATEGORY}` : `${o.itemData.name} $${Number(o.itemData.variations[0].itemVariationData.priceMoney.amount) / 100}${o.itemData.taxIds ? ' (9% tax)' : ''}`).join(', ') || 'nothing'}`)
  if (!APPLY || !objects.length) return
  const idempotencyKey = createHash('sha256').update(`seed-shop:${objects.map((o) => o.id).join(',')}`).digest('hex').slice(0, 40)
  const res: any = await client.catalog.batchUpsert({ idempotencyKey, batches: [{ objects }] })
  const map = new Map((res.idMappings ?? []).map((m: any) => [m.clientObjectId, m.objectId]))
  for (const it of ITEMS) {
    const id = map.get(`#${it.key}`) as string | undefined
    if (!id) continue
    const got: any = await client.catalog.object.get({ objectId: id })
    const v = got.object.itemData.variations[0]
    console.log(`✅ ${got.object.itemData.name} · $${Number(v.itemVariationData.priceMoney.amount) / 100} · taxIds ${got.object.itemData.taxIds ?? 'none'} → item ${got.object.id}, variation ${v.id}`)
  }
  console.log('Paste into shopConfig.magnets.square: { itemId, variationId (magnets), shippingVariationId (shipping) }')
}

main().catch((e) => { console.error(e?.body ?? e); process.exit(1) })
```

- [ ] **Step 2: Preview only**

Run: `npx tsx scripts/seed-shop.ts`
Expected: `PREVIEW (no writes)` and `Will create: category Shop, Photo Magnets – Set of 6 $18 (9% tax), Shipping $6`

- [ ] **Step 3: Commit (do NOT run `--apply`)**

```bash
git add scripts/seed-shop.ts
git commit -m "chore(shop): Square catalog seed script for photo magnets"
```

---

### Task 18b: Apply the Square items + ids (Kaden's go only)

**Files:**
- Modify: `src/config/shop.config.ts` (`square` ids)

**Dependencies:** Tasks 1, 18a. **Writes to LIVE Square. Ask Kaden first.**

- [ ] **Step 1:** `npx tsx scripts/seed-shop.ts --apply` — read-back lines show the magnets item with the 9% tax and Shipping without.
- [ ] **Step 2:** Prove the tax on the real ids with a no-write calculation: `POST /v2/orders/calculate` with the magnet line (2 sets, `taxes` + `appliedTaxes` as in T9a) + the Shipping line → total `4524`, tax `324`.
- [ ] **Step 3:** Paste `itemId`, `variationId`, `shippingVariationId` into `src/config/shop.config.ts`; `npm test`; commit `chore(shop): Square ids for photo magnets`.

---

### Task 19: Copy + launch gate (human)

**Dependencies:** all, including T18b (until the ids are in, real orders answer 503; simulated preview orders work without them)

- [ ] Show Kaden every string in `src/config/shop-content.ts` and the three email bodies in `src/lib/magnet-emails.ts`, verbatim. Apply his wording exactly. No colons.
- [ ] Get a real photo of finished magnets → `public/images/shop/photo-magnets.jpg`.
- [ ] Confirm the safe-area inset (8%) against a real pressed magnet: print one test sheet from a dev order, press it, check what wraps.
- [ ] Ask Chris whether the $6 shipping is taxable (code treats it as untaxed).
- [ ] Merge to `dev`, push for a free preview, place a simulated order on the preview (`DEV_BYPASS_PAYMENT`), print the sheet from `/admin` on the iPad, and test-press it.
- [ ] Prod only on Kaden's go (batch with other changes).

---

## Self-review (after review amendments)

1. **Coverage:** config T1; kv delete + prefix list T5; photos/orders/statuses/pending/cleanup T6; Square items T18a/b; line tax T9a; pricing T2; crop T3; sheet T4; photo API T8; order API T9; admin APIs T11; print T12; cropper T13; modal T14; /shop + nav + sitemap T15; admin tab T16; cleanup job T17; tax report T17a; emails T7; analytics T10; copy + launch T19. Every review amendment A1–A14 is in its task.
2. **Placeholders:** none in code. Implementer notes name the exact file to open where an existing signature must be matched (analytics track functions T14, mock provider constructor T9a, `isPreviewOrDev` in tests T11).
3. **Types:** `MagnetOrder` (with `emailed`), `MagnetStatus`, `STATUSES` (6), `STATUS_LABEL`, `DONE_/PICKUP_/SHIP_STATUSES` live in `magnet-status.ts` and are re-exported by `magnet-orders.ts`; `setOrderStatus` → `{ order, changed } | 'not_found' | 'wrong_delivery' | 'photos_deleted'`; `cleanup(now, { dryRun })` → `CleanupResult`; `LineItem.tax = { catalogObjectId, percent }`; `shopConfig.magnets.{taxId, square.shippingVariationId}` — used identically in T6–T18b.
4. **Order:** see the dependency graph. No cycles; T11 strictly after T7; T12 after T4 + T11; T9 after T2, T6, T7, T9a, T10; T14 after T8, T9, T13; T19 last.
5. **Commands:** `npx vitest run <path>`, `npm test`, `npm run build`; no typecheck script exists, so T1 uses `npx tsc --noEmit -p .` filtered to its files.
