# PRD: Workshops Launch — Real Data, Images, Detail Pages

**Date:** 2026-05-25
**Status:** Draft
**Type:** Feature
**Branch:** `kaden/workshops-launch` (TBD — created after PRD approval)

---

## 1. Overview

Replace placeholder workshops with real scheduled workshops (sourced from Square), add card + flyer images that aren't natively supported by Square, and add per-workshop detail pages reachable by clicking a card. Decouple the workshop fetch from Square via a `WorkshopProvider` interface so the site stays provider-agnostic.

## 2. Background & Motivation

- Workshops are currently placeholder data; the studio now has a real schedule and artwork (card images + flyers) to launch with.
- Square stores everything *except* images — it has no native field for class images. We need our own image storage + linking pattern.
- The current `getClassInstances()` call in `src/providers/square/classes.ts` is imported directly by `src/pages/workshops.astro`, leaking Square specifics into the page layer. The rest of the project follows a `CatalogProvider` adapter pattern; workshops should match.
- Customers need a detail page per workshop (full description, flyer, all the info) so a card click leads somewhere useful instead of jumping straight to a booking modal.

---

## 3. API Contract — WorkshopProvider Interface

New file: `src/providers/interfaces/workshop.ts`

```typescript
export interface Workshop {
  id: string                    // classScheduleInstanceId (stable per occurrence)
  scheduleId: string            // classScheduleId (stable per workshop type)
  name: string
  description: string
  descriptionHtml: string
  startAt: string               // ISO 8601
  endAt: string                 // ISO 8601 (derived)
  durationMinutes: number
  priceAmount: number           // cents
  priceCurrency: string
  availableCapacity: number
  staffName: string
  teamMemberId: string
  cardImageUrl?: string         // resolved by image-linker
  flyerImageUrl?: string        // resolved by image-linker; optional
}

export interface WorkshopProvider {
  listWorkshops(): Promise<Workshop[]>
  getWorkshop(id: string): Promise<Workshop | null>
}
```

Acceptance:
- [ ] [API] `WorkshopProvider.listWorkshops()` returns active workshops with `availableCapacity > 0`, sorted by `startAt` ascending
- [ ] [API] `WorkshopProvider.getWorkshop(id)` returns single workshop or `null` (not throws) when not found
- [ ] [API] `SquareWorkshopProvider` implements the interface by wrapping current `getClassInstances()` logic
- [ ] [API] Site code (`src/pages/workshops.astro`, new `[id].astro` route) imports the **interface**, never `src/providers/square/*` directly
- [ ] [API] Provider wired through `providers` registry in `src/config/providers.ts`

---

## 4. Data Model — Image Linking

**Image storage**: `public/images/workshops/` (committed to repo, served by Netlify CDN).

**Naming convention**: filenames keyed by a stable slug, not by raw Square ID (so files are human-readable when browsing the directory).

```
public/images/workshops/
  glass-fusing-101-card.jpg       (required for each workshop)
  glass-fusing-101-flyer.jpg      (optional)
  candle-pouring-card.jpg
  candle-pouring-flyer.jpg
```

**Linking mechanism**: a small mapping file maps Square `classScheduleId` → image slug.

```typescript
// src/data/workshop-images.ts
export const workshopImageMap: Record<string, string> = {
  'CLASS_SCHEDULE_ID_1': 'glass-fusing-101',
  'CLASS_SCHEDULE_ID_2': 'candle-pouring',
  // ...
}
```

Reasoning for a mapping file over a name-derived slug:
- Decouples filename from Square name (renaming a workshop in Square doesn't break image lookup)
- Explicit — easy to see at a glance which workshops have images
- One file to update when adding a new workshop image

The image-linking helper lives at `src/providers/workshops/image-link.ts` and is called by `SquareWorkshopProvider` during mapping. It checks if `card.jpg` / `card.png` / `card.webp` exists (in that order) at module load time and returns the URL or undefined.

Acceptance:
- [ ] [DATA] `public/images/workshops/` directory exists with at least one real workshop image set
- [ ] [DATA] `src/data/workshop-images.ts` maps Square `classScheduleId` to slug for each workshop
- [ ] [DATA] `src/providers/workshops/image-link.ts` exports `resolveWorkshopImages(scheduleId)` returning `{ cardUrl, flyerUrl }`
- [ ] [DATA] Card image is **required**; flyer is **optional**; resolver returns `undefined` for missing files

---

## 5. Business Logic & Rules

- **Filtering**: `listWorkshops()` returns only workshops with `availableCapacity > 0` (today's behavior).
- **Sort**: Ascending by `startAt`.
- **Image fallback for card display**: If card image is missing, log a warning at module load (not at request time) so missing images are caught in dev; render workshop card without image (text-only) rather than breaking the page.
- **Image fallback for flyer**: If flyer is missing, detail page uses the card image at larger size instead.
- **Workshop not found**: `getWorkshop(id)` returns `null` (not throws). The detail page route returns 404 in that case.
- **Stale capacity**: Detail page is server-rendered per request (Astro `prerender = false`) so capacity is fresh. Card list is also server-rendered.

Acceptance:
- [ ] [LOGIC] Workshops with 0 remaining seats are excluded from the list
- [ ] [LOGIC] Workshops sorted by `startAt` ascending
- [ ] [LOGIC] Missing card image logs a warning at startup but doesn't crash the page
- [ ] [LOGIC] Detail page returns 404 when given an unknown workshop id
- [ ] [LOGIC] Card list and detail page both server-render fresh capacity (no stale cache)

---

## 6. Entry Points & User Flows

### Path A — Workshops Index Page (`/workshops`)

- User lands on `/workshops`, sees a grid of workshop cards (image + name + date + price + remaining seats)
- Each card is a link to `/workshops/{id}` (the detail page)
- Existing search/calendar views remain functional (today's `WorkshopExplorer` component)

### Path B — Workshop Detail Page (`/workshops/{id}`)

- User clicks a card → navigates to `/workshops/{id}` where `id` is the `classScheduleInstanceId`
- Sees flyer image (or card if no flyer), full description, date/time/duration, price, instructor name, remaining seats, and a Book button
- Book button opens the existing `WorkshopBookingModal` flow

### Path C — Direct Link to Detail Page

- Shareable URL: `/workshops/{id}` works directly (deep-linkable, e.g. social media)

Acceptance:
- [ ] [UI] `/workshops` shows cards with images
- [ ] [UI] Clicking a card navigates to `/workshops/{id}`
- [ ] [UI] `/workshops/{id}` loads the workshop detail and works as a direct link
- [ ] [UI] Detail page Book button opens `WorkshopBookingModal` with the right workshop pre-filled

---

## 7. UI States & Layout

### Workshops Index — `/workshops`

- Same hero + heading as today
- `WorkshopExplorer` continues to handle calendar/search/list views
- **Card change**: add an image at the top of the card (16:9 aspect, lazy-loaded). Existing card body unchanged. Card becomes clickable as a whole (wraps in `<a href="/workshops/{id}">`) rather than just having a "Book Seat" button.
- **No image fallback**: gracefully render the card with a subtle gradient header (no broken-image icon).

### Workshop Detail — `/workshops/{id}`

Layout (mobile-first, single column on small screens, two-column on `md+`):

```
[Hero: flyer image, full width]

[Workshop Name]                      [Price]
[Date · Time · Duration · Instructor]
[Capacity remaining badge]

[Full description (HTML or plain text)]

[Book Seat button — primary action]

[Back to workshops link]
```

States:
- **Loading**: server-rendered, no client loading state needed
- **Not found** (`getWorkshop` returns null): 404 page (Astro's standard 404)
- **Sold out** (`availableCapacity === 0`): page still renders, but Book button is disabled with "Sold out" label
- **No flyer**: uses card image at full hero size; if neither exists, page shows text-only hero (no broken image)

Acceptance:
- [ ] [UI] Index card includes lazy-loaded image (16:9 aspect)
- [ ] [UI] Card is fully clickable, navigates to detail page
- [ ] [UI] Detail page shows hero image (flyer with card-image fallback)
- [ ] [UI] Detail page shows name, price, date/time, duration, instructor, capacity
- [ ] [UI] Detail page Book button opens WorkshopBookingModal
- [ ] [UI] Sold-out workshops show disabled Book button with "Sold out" label
- [ ] [UI] 404 page renders for unknown workshop ids

---

## 8. Component Behavior

### `WorkshopCard` (existing — modify)

- **Trigger**: render in workshop grid
- **Behavior**: wrap entire card in `<a href="/workshops/{id}">`; image lazy-loads (`loading="lazy"`); existing "Book Seat" button is removed (whole card is the link to detail)
- **Defaults**: same date/time formatting as today

### Workshop Detail Page (new — `src/pages/workshops/[id].astro`)

- **Trigger**: route navigation
- **Behavior**: server-fetches workshop via `WorkshopProvider.getWorkshop(id)`, renders flyer + content + Book button
- **States**: see UI States above

### `WorkshopBookingModal` (existing — minor change)

- **Trigger**: Book button on detail page
- **Behavior**: unchanged — same flow as today, just opened from detail page instead of index card

Acceptance:
- [ ] [UI] `WorkshopCard` renders as a link to detail page (no separate Book button)
- [ ] [UI] `WorkshopCard` images lazy-load
- [ ] [UI] Detail page Book button opens existing `WorkshopBookingModal` correctly

---

## 9. Settings & Configuration

N/A — no user-configurable settings.

(Implementer note: the image directory and mapping file are dev configuration, not user-facing settings.)

---

## 10. Open Questions

All major questions resolved during refinement (2026-05-25):

- **Card vs flyer art**: Card is 16:9, flyer is taller (separate artwork per workshop). Both image files exist per workshop.
- **Image format**: Auto-detect extension (`.jpg` → `.png` → `.webp`) in the resolver.
- **Placeholder cleanup**: Done via Square API by an implementation task — NOT a manual Square-admin step. See §4 Data and §12 Acceptance.
- **OG / social preview tags**: Deferred to a future PRD. Out of scope here.

---

## 11. Out of Scope

- Workshop creation/editing UI — workshops are managed in Square admin, not here
- Image upload UI / admin dashboard — images are committed to repo, no upload flow
- Search/filter changes on `/workshops` — existing search and calendar views are unchanged
- Pricing variations — workshops have single price (this is the case today)
- Workshop reviews / ratings
- Email notifications / reminders (existing booking flow handles confirmation email via Square)
- Square workshop deletion automation (do this manually in Square admin)

---

## 12. Acceptance Checklist (consolidated)

### API
- [ ] [API] `WorkshopProvider` interface defined in `src/providers/interfaces/workshop.ts`
- [ ] [API] `SquareWorkshopProvider` implements interface, wraps `getClassInstances`
- [ ] [API] `listWorkshops()` returns sorted, filtered list with image URLs resolved
- [ ] [API] `getWorkshop(id)` returns single workshop or null
- [ ] [API] Site code imports the interface, never the Square impl directly
- [ ] [API] Provider registered in `src/config/providers.ts`

### Data
- [ ] [DATA] `public/images/workshops/` exists with real images for current workshops
- [ ] [DATA] `src/data/workshop-images.ts` maps `classScheduleId` → slug
- [ ] [DATA] `src/providers/workshops/image-link.ts` resolves card + flyer URLs by slug
- [ ] [DATA] Placeholder class schedules deleted via Square API (one-shot script in `scripts/`, not manual). Script confirms zero remaining class schedules before proceeding to image work.

### Logic
- [ ] [LOGIC] Workshops with 0 capacity excluded
- [ ] [LOGIC] List sorted by `startAt` ascending
- [ ] [LOGIC] Missing card image warns at startup, doesn't crash
- [ ] [LOGIC] Missing flyer falls back to card image on detail page
- [ ] [LOGIC] Both index and detail pages server-render fresh capacity

### UI
- [ ] [UI] Workshop cards include lazy-loaded image
- [ ] [UI] Cards are fully clickable, navigate to detail page
- [ ] [UI] Detail page at `/workshops/{id}` renders flyer + full info + Book button
- [ ] [UI] Detail page is deep-linkable (works from a direct URL)
- [ ] [UI] Sold-out workshops show disabled Book button
- [ ] [UI] Unknown workshop id returns 404
- [ ] [UI] Book button on detail page opens existing `WorkshopBookingModal` with correct workshop

---

## Pointer for downstream agents

**PRD:** `docs/plans/2026-05-25-workshops-launch-prd.md`

Plans, builds, and reviews should verify each `[ ]` item above against the implementation with file:line references.
