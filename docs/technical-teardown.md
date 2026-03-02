# Homegrown Studio — Technical Teardown

> Last updated: 2026-03-01
> Purpose: Document how the v1 site technically works, including lessons learned, before rebuilding.

---

## Architecture Overview

**Stack:** Astro 5.16 + Tailwind CSS 3.4 + DaisyUI 5.5 + Square SDK 43.2, deployed on Netlify with SSR.

```
Browser Request
    ↓
Netlify Edge/Serverless
    ↓
Astro SSR (Node 20)
    ↓
Square APIs (Catalog, Bookings, Classes)
    ↓
HTML Response → Client JS for interactivity
```

### Dependencies

| Package | Version | Purpose |
|---|---|---|
| `astro` | 5.16.8 | Core framework — SSR, file-based routing, component system |
| `@astrojs/netlify` | 6.6.3 | Adapter to deploy Astro on Netlify serverless |
| `@astrojs/node` | 9.5.1 | Node.js adapter (included as fallback option) |
| `square` | 43.2.1 | Official Square SDK for catalog, bookings, payments |
| `tailwindcss` | 3.4.19 | Utility-first CSS framework |
| `daisyui` | 5.5.14 | Component library on top of Tailwind |
| `@astrojs/tailwind` | 6.0.2 | Tailwind integration for Astro |

### Project Structure

```
homegrownStudio/
├── public/
│   └── favicon.svg              # Only static asset
├── src/
│   ├── components/
│   │   ├── ClassCard.astro      # Workshop/class card component
│   │   ├── Footer.astro         # Site footer
│   │   └── Header.astro         # Navigation header
│   ├── layouts/
│   │   └── Layout.astro         # Master page wrapper (global styles, meta)
│   ├── lib/
│   │   └── workshop.ts          # TypeScript types, Workshop utility class, helpers
│   └── pages/
│       ├── index.astro          # Homepage (static)
│       ├── about.astro          # About page (static)
│       ├── booking.astro        # Booking page (static, placeholder)
│       ├── gallery.astro        # Gallery page (static, placeholder)
│       ├── workshops.astro      # Workshop listings (SSR, ~900 lines)
│       └── api/
│           ├── workshops.json.ts          # Catalog items in "Workshop" category
│           ├── square-classes.json.ts     # Class schedule instances (internal API)
│           ├── test-availability.json.ts  # Debug: bookings search
│           ├── debug-square.json.ts       # Debug: workshop catalog items
│           └── debug-catalog-all.json.ts  # Debug: entire catalog dump
├── astro.config.mjs             # output: 'server', netlify adapter, tailwind
├── tailwind.config.cjs          # Custom "homegrown" DaisyUI theme
├── tsconfig.json                # Strict TypeScript
├── netlify.toml                 # Build: npm run build, publish: dist, Node 20
└── .env                         # SQUARE_ACCESS_TOKEN, SQUARE_ENVIRONMENT
```

---

## Rendering Model

The site uses `output: 'server'` in `astro.config.mjs`, making SSR the default. Individual pages opt into static generation with `export const prerender = true`.

| Page | Mode | Behavior |
|---|---|---|
| `/` (home) | `prerender = true` | Built once at deploy time. Static HTML. Free to serve. |
| `/about` | `prerender = true` | Static |
| `/gallery` | `prerender = true` | Static |
| `/booking` | `prerender = true` | Static |
| `/workshops` | `prerender = false` | **SSR** — server runs on every request. Fetches live data from Square. Costs Netlify compute credits. |
| `/api/*` | SSR (default) | Server-side API routes, run per-request |

**Key implication:** Every visit to `/workshops` triggers server-side rendering + live Square API calls. No caching is configured — `Cache-Control: no-cache, no-store, must-revalidate` is explicitly set.

---

## Square API Integration — Two Separate Systems

This is the most important technical detail. The site pulls data from **two completely different Square APIs** using **two different authentication methods**, then merges the results.

### Source 1: Square Internal/Buyer Classes API (Raw HTTP)

```
POST https://app.squareup.com/appointments/api/buyer/classes/class_schedule_instances/search
```

- **NOT the official SDK** — this is a raw `fetch()` call to Square's internal buyer-facing API
- **Authentication:** Location token in URL parameter (`unit_token=${locationId}`), not the access token
- **Headers mimic a browser:** Sets `Origin: https://book.squareup.com` and `Referer: https://book.squareup.com/` to appear like the Square booking widget
- **Why it exists:** The official Square SDK does not have a "Classes" endpoint. This internal API is what Square's own booking widget uses under the hood.
- **Risk:** If Square changes this internal API, it will break silently. There are no official docs or stability guarantees.

**What it returns:**
- Class schedule instances (individual class sessions)
- Availability capacity per instance
- Requires a second lookup to get schedule details (name, description, price) — merged via Map

**Request body structure:**
```json
{
  "class_schedule_instance_filter": {
    "start_at": "<ISO date with timezone offset>",
    "end_at": "<ISO date 5 years out>",
    "class_schedule_filter": {
      "location_id": "LTHCH1W1J3Y4Q",
      "status": ["ACTIVE"]
    }
  },
  "limit": 50
}
```

### Source 2: Square Official SDK (Bookings + Catalog)

```typescript
const client = new squarePkg.SquareClient({
  token: import.meta.env.SQUARE_ACCESS_TOKEN,
  environment: squarePkg.SquareEnvironment.Production,
});

// Fetch catalog items
for await (const item of client.catalog.list({ types: ['ITEM'] })) { ... }

// Search availability
const availability = await client.bookings.searchAvailability(searchRequest);
```

- **Official SDK** with `SQUARE_ACCESS_TOKEN` from environment variables
- **Catalog API:** Lists all items, filters for `APPOINTMENTS_SERVICE` product type, builds image URLs and category maps
- **Bookings API:** Searches availability for each service variation over the next 31 days
- **Image URLs:** Constructed from Square's S3 bucket: `https://items-images-production.s3.us-west-2.amazonaws.com/files/{imageId}/original.jpeg`

### How They Merge

Both sources get normalized into a common `WorkshopSlot` interface:

```typescript
interface WorkshopSlot {
  id: string;
  serviceVariationId?: string;
  classScheduleId?: string;
  startAt: string;                    // ISO datetime
  startAtFormatted: string;           // "Mon, Jan 1, 12:00 PM (1 hr)"
  durationMinutes: number;
  availableCapacity: number | null;
  isSoldOut: boolean;
  name: string;
  description: string;
  price: number;
  priceFormatted: string;             // "25.00"
  currency: string;                   // "USD"
  imageUrl: string | null;
  teamMemberId?: string;
  staffName?: string;
  source: 'class' | 'appointment';    // Which API it came from
  category: 'Workshop' | 'Party';     // Detected from catalog category
}
```

The `source` field tracks origin. Category is determined by matching against a catalog category named `"Workshop"` — anything not in that category defaults to `"Party"`.

---

## Client-Side Architecture

### Server → Client Data Transfer

Astro's `define:vars` directive serializes server-side data into the client script:

```astro
<script define:vars={{ availabilitySlotsForClient, debugLog }}>
  const parsedSlots = JSON.parse(availabilitySlotsForClient);
</script>
```

This embeds the full JSON blob of all workshop slots directly into the HTML page source. No further API calls happen on the client side.

### Client-Side Features (workshops page)

All filtering/sorting operates in-memory on the embedded data:

- **Search** — filters cards by name/description substring match
- **Category filter** — toggles between All / Workshops / Parties
- **Date range picker** — Litepicker library (loaded via CDN) with custom preset buttons (Next 7/14/30 days, This/Next Month)
- **Sorting** — by date, name, price ascending/descending
- **Book Now buttons** — redirects to `/booking?workshop={id}&variation={id}&datetime={iso}`

Filtering works by toggling `display: none` on existing DOM elements — no re-rendering, no virtual DOM, no framework.

### External Libraries (CDN)

- **Litepicker** — Date range picker (`https://cdn.jsdelivr.net/npm/litepicker/dist/litepicker.js`)
  - ~280 lines of custom CSS to match brand colors
  - Custom preset buttons injected via `render` event

---

## Styling Architecture

Three overlapping systems create inconsistency:

### Layer 1: CSS Custom Properties (Layout.astro)
```css
:root {
  --color-primary: #8b5cf6;
  --color-primary-dark: #7c3aed;
  --color-secondary: #ec4899;
  --color-text: #1f2937;
  --color-text-light: #6b7280;
  --color-bg: #ffffff;
  --color-bg-light: #f9fafb;
  --max-width: 1200px;
}
```

### Layer 2: DaisyUI Theme (tailwind.config.cjs)
```javascript
homegrown: {
  "primary": "#7c3aed",       // ← Different from CSS var (#8b5cf6)
  "secondary": "#db2777",     // ← Different from CSS var (#ec4899)
  "accent": "#f59e0b",
  "neutral": "#1f2937",
  "base-100": "#ffffff",
}
```

### Layer 3: Component-Scoped and Inline Styles
Each `.astro` file has its own `<style>` block. Some use `var(--color-primary)`, others use Tailwind `text-primary`, and others hardcode hex values directly.

**Result:** Changing the brand color requires updating 3+ places with no single source of truth.

---

## API Route Details

### Production Routes

**`/api/workshops.json`** (GET)
- Initializes Square client at module level (reused across requests)
- Calls `catalog.list({ types: ['ITEM'] })`
- Finds category named `"Workshop"`, filters items by that category
- Maps items to clean objects with price in dollars, S3 image URLs
- Handles both camelCase and snake_case response properties
- Accepts optional `?date` query param (not fully implemented)
- Returns: `{ workshops: [...], count: number }`

**`/api/square-classes.json`** (GET)
- Raw HTTP to Square internal classes API
- Fetches class schedule instances + schedule details
- Merges via Map lookup on `classScheduleId`
- Converts prices from cents to dollars
- Sorts by start date ascending
- Returns: `{ classes: [...], total: number, cursor: string | null }`

### Debug Routes (exposed in production)

| Route | What it exposes |
|---|---|
| `/api/test-availability.json` | Raw bookings availability search results |
| `/api/debug-square.json` | Workshop catalog items with full structure |
| `/api/debug-catalog-all.json` | **Entire catalog** grouped by type |

These are publicly accessible and return full Square API response data.

---

## Shared Utilities (src/lib/workshop.ts)

### Workshop Class
Provides parsing, sorting, and filtering methods:

- **Parsing:** Converts Square catalog items to `WorkshopSlot` objects, handles both camelCase/snake_case, converts cents to dollars, generates S3 image URLs
- **Sorting:** `sortByName()`, `sortByPrice()`, `sortByDate()`, `sortByCreated()`
- **Filtering:** `search()`, `filterByPriceRange()`, `filterAvailable()`, `filterByDateRange()`
- **Serialization:** `toJSON()` converts Dates to ISO strings for client transfer

### fetchBookingAvailability()
- Calls `client.bookings.searchAvailability()` for next 3 months
- Returns `Map<serviceVariationId, availabilitySlot[]>`
- Falls back to fetching location ID from `locations.list()` if not provided
- Silently swallows errors (logs but doesn't throw)

### parseDateFromCustomAttributes()
- Extracts dates from Square custom attribute fields
- Searches: `date`, `class_date`, `event_date`, `start_date`, `scheduled_date`
- Tries both `stringValue` and `dateValue` properties

---

## Configuration

### Environment Variables
```
SQUARE_ACCESS_TOKEN    # Square API access token
SQUARE_ENVIRONMENT     # "production" or "sandbox"
SQUARE_LOCATION_ID     # Optional, defaults to LTHCH1W1J3Y4Q
```

Set in `.env` locally and Netlify dashboard for production.

### Hardcoded Values
- Default location ID: `LTHCH1W1J3Y4Q` (fallback in multiple files)
- S3 bucket: `items-images-production.s3.us-west-2.amazonaws.com`
- Image path pattern: `files/{imageId}/original.jpeg`
- Classes API search window: 5 years
- Bookings availability window: 31 days (workshops page), 3 months (utility function)
- Classes per request limit: 50
- Workshop category name: exact match on `"Workshop"`

---

## What's Placeholder / Incomplete

| Feature | Status |
|---|---|
| Booking page | Dashed-border placeholder for Square Booking Widget |
| Gallery | 12 placeholder boxes, filter UI exists but filter logic is a no-op |
| About page | Placeholder circles for team photos, generic bios |
| Footer contact info | `(555) 123-4567`, `hello@homegrownstudio.com` |
| ClassCard images | Commented out in component |
| Customer data handling | None — no forms, no storage, no analytics |
| Error states | Silent failures — shows "No workshops available" |

---

## Lessons Learned / Technical Debt

1. **Two Square APIs, two auth methods.** The internal classes API (`squareup.com/appointments/api/buyer/classes/...`) uses a location token and mimics browser headers. The official SDK uses an access token. If Square changes the internal API, it breaks with no warning or migration path.

2. **SSR burns Netlify credits with no caching.** Every `/workshops` visit = server render + Square API calls. `Cache-Control: no-cache` is explicitly set. On the free plan (300 credits/month, 5 credits/GB-hour compute), this adds up fast.

3. **Debug endpoints are live in production.** `/api/debug-catalog-all.json` exposes the entire Square catalog structure to anyone.

4. **Three color systems with different values.** CSS custom properties say primary is `#8b5cf6`. DaisyUI theme says `#7c3aed`. Some components hardcode hex values. No single source of truth.

5. **The workshops page is ~900 lines.** Server-side data fetching, HTML template, Tailwind classes, scoped CSS, global CSS overrides for Litepicker, and client-side JS all in one file.

6. **`define:vars` embeds all data in HTML.** Every workshop slot is serialized as JSON in the page source. Increases page weight and exposes data structure to anyone viewing source.

7. **No customer data flows through the app.** Booking redirects to a placeholder page. No payments, no forms, no accounts.

8. **No error handling for users.** If Square APIs fail, the page silently shows "No workshops available" with no retry, explanation, or fallback.

9. **Price conversion inconsistency.** Some routes convert cents to dollars with `/100`, others use `.toFixed(2)` on the result. The Workshop class handles both but the API routes do it differently.

10. **BigInt serialization workaround.** Square SDK returns BigInt values which JSON.stringify can't handle. Multiple files have the same custom replacer function rather than sharing one.
