# Phase 1: Production-Ready Implementation Plan

> **Roadmap:** docs/plans/2026-07-08-launch-roadmap-README.md ← READ THIS FIRST (shared context, git rules, required inputs)
> **For agents:** Use sdd (sequential) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Work on the `dev` branch. Never push `main` without user approval.

**Goal:** Make the deployed site truthful, crawlable, and safe: real business info, full SEO head/schema/sitemap, server-rendered content on the money pages, two security fixes, then one deliberate production deploy.

**Architecture:** All head/meta work funnels through a new shared `SeoHead.astro` used by both layouts. Data-fetching logic currently living only in API routes gets extracted to `src/lib` so pages can server-render initial content and the API routes stay for client refresh. No new dependencies.

**Tech Stack:** Astro 5 SSR (`output: 'server'`, Netlify adapter), React 19 islands, vitest.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `package.json` | Modify | Add `test` script |
| `astro.config.mjs` | Modify | Add `site` URL |
| `src/config/site.config.ts` | Modify | Real NAP + hours + opening date; fix testimonial |
| `src/components/shared/SeoHead.astro` | Create | Canonical, OG/Twitter, theme-color, LocalBusiness JSON-LD |
| `src/layouts/Layout.astro` | Modify | Use SeoHead |
| `src/layouts/StaticLayout.astro` | Modify | Use SeoHead |
| `src/components/shared/Footer.astro` | Modify | Show hours; address handled via config |
| `src/pages/index.astro` | Modify | Hero copy: what/where/when + opening date |
| `public/robots.txt` | Create | Allow all, block /api/, point at sitemap |
| `src/pages/sitemap.xml.ts` | Create | Static sitemap endpoint |
| `src/pages/404.astro` | Create | Branded not-found page |
| `src/lib/calendar-events.ts` | Create | Extracted month-events logic (from calendar.json.ts) |
| `src/pages/api/calendar.json.ts` | Modify | Delegate to lib |
| `src/pages/calendar.astro` | Modify | SSR initial month of events |
| `src/pages/workshops.astro` | Modify | SSR initial workshop list |
| `src/pages/api/workshops/book.json.ts` | Modify | Remove payment-token logging |
| `src/providers/square/booking.ts` | Modify | Deterministic idempotency key on create |
| `tests/lib/calendar-events.test.ts` | Create | Lib exists + shape check (mock mode) |

Tasks 2–6 are independent of 7–10 and could run in parallel; 11 (verify/deploy) is last.

---

### Task 1: Test script

**Files:** Modify: `package.json`

- [ ] **Step 1:** In `package.json`, change the `scripts` block to:

```json
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "astro": "astro",
    "test": "vitest run"
  },
```

- [ ] **Step 2:** Run: `npm test` — Expected: vitest runs the existing `tests/` suite. If any test was ALREADY failing before your changes, note it in the final report; do not fix unrelated failures silently.
- [ ] **Step 3:** Commit: `git add package.json && git commit -m "chore(tooling): add npm test script"`

---

### Task 2: Real business info in site config

**Files:** Modify: `src/config/site.config.ts`
**Dependencies:** ⚠️ USER INPUT: real street address, city, zip, phone (see roadmap README "Required inputs"). If unavailable, set `street: ''` and `contactPhone: ''` — downstream components in this plan render nothing for empty values. NEVER keep the fake values.

- [ ] **Step 1:** In `src/config/site.config.ts`, add to the `SiteConfig` interface (after the `address` field, before `theme`):

```ts
  /** Structured business hours: `days` are schema.org day names for JSON-LD; `label` is display copy. */
  hours: { days: string[]; opens: string; closes: string; label: string }[]
  /** ISO date of grand opening; used for pre-launch messaging. */
  openingDate: string
```

- [ ] **Step 2:** In the `siteConfig` object literal, replace the current placeholder contact block:

```ts
  contactEmail: 'hello@homegrowncraftstudio.com',
  contactPhone: '(555) 123-4567',
  address: {
    street: '123 Main St',
    city: 'Anytown',
    state: 'CA',
    zip: '90210',
  },
```

with (substituting real values from Kaden; empty string street/phone if not provided):

```ts
  contactEmail: 'hello@homegrowncraftstudio.com',
  contactPhone: '<REAL PHONE or empty string>',
  address: {
    street: '<REAL STREET or empty string>',
    city: 'Huntsville',
    state: 'AL',
    zip: '<REAL ZIP or empty string>',
  },
  hours: [
    { days: ['Thursday', 'Friday'], opens: '16:00', closes: '21:00', label: 'Thu–Fri · 4–9 PM' },
    { days: ['Saturday'], opens: '09:00', closes: '21:00', label: 'Sat · 9 AM–9 PM' },
    { days: ['Sunday'], opens: '14:00', closes: '20:00', label: 'Sun · 2–8 PM' },
  ],
  openingDate: '2026-07-31',
```

- [ ] **Step 3:** Fix the testimonial that references a non-existent offering. In the `testimonials.items` array, change the third item's `detail` from `'Corporate Event'` to `'Group Event'`.
- [ ] **Step 4:** Run: `npm run build` — Expected: succeeds (TypeScript will flag any page still assuming the old shape; there should be none — `Footer.astro` reads `street/city/state/zip` which still exist).
- [ ] **Step 5:** Commit: `git commit -am "fix(config): real business info, hours, opening date; fix testimonial"`

---

### Task 3: SeoHead component + layouts

**Files:** Create: `src/components/shared/SeoHead.astro` · Modify: `astro.config.mjs`, `src/layouts/Layout.astro`, `src/layouts/StaticLayout.astro`
**Dependencies:** Task 2 (hours/openingDate in config)

- [ ] **Step 1:** In `astro.config.mjs`, add `site` to the config object:

```js
export default defineConfig({
  site: 'https://homegrowncraftstudio.com',
  output: 'server',
  adapter: netlify(),
  integrations: [
    react(),
    tailwind(),
  ],
})
```

- [ ] **Step 2:** Create `src/components/shared/SeoHead.astro`:

```astro
---
import { siteConfig } from '@config/site.config'

interface Props {
  title: string
  description: string
  /** Absolute or root-relative path to a social share image. */
  image?: string
  noindex?: boolean
}

const { title, description, image = '/og-image.png', noindex = false } = Astro.props
const site = Astro.site ?? new URL('https://homegrowncraftstudio.com')
const canonical = new URL(Astro.url.pathname, site).href
const imageUrl = new URL(image, site).href

const { street, city, state, zip } = siteConfig.address
const localBusiness: Record<string, unknown> = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: siteConfig.name,
  description: 'Hands-on craft studio offering workshops, open studio walk-in sessions, and private parties.',
  url: site.href,
  email: siteConfig.contactEmail,
  ...(siteConfig.contactPhone ? { telephone: siteConfig.contactPhone } : {}),
  address: {
    '@type': 'PostalAddress',
    ...(street ? { streetAddress: street } : {}),
    addressLocality: city,
    addressRegion: state,
    ...(zip ? { postalCode: zip } : {}),
    addressCountry: 'US',
  },
  openingHoursSpecification: siteConfig.hours.map((h) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: h.days,
    opens: h.opens,
    closes: h.closes,
  })),
}
---

<meta name="description" content={description} />
<link rel="canonical" href={canonical} />
<meta name="theme-color" content={siteConfig.theme.colors.primary} />
{noindex && <meta name="robots" content="noindex" />}
<meta property="og:site_name" content={siteConfig.name} />
<meta property="og:title" content={title} />
<meta property="og:description" content={description} />
<meta property="og:type" content="website" />
<meta property="og:url" content={canonical} />
<meta property="og:image" content={imageUrl} />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content={title} />
<meta name="twitter:description" content={description} />
<meta name="twitter:image" content={imageUrl} />
<script type="application/ld+json" set:html={JSON.stringify(localBusiness)} />
```

- [ ] **Step 3:** In BOTH `src/layouts/Layout.astro` AND `src/layouts/StaticLayout.astro` (they are near-identical), make the same edit. Add the import at the top of the frontmatter:

```astro
import SeoHead from '@components/shared/SeoHead.astro'
```

Then in the `<head>`, replace the single line:

```astro
    <meta name="description" content={pageDescription} />
```

with:

```astro
    <SeoHead title={pageTitle} description={pageDescription} />
```

Also in both layouts' frontmatter, improve the default description — replace:

```astro
const pageDescription = description || siteConfig.tagline
```

with:

```astro
const pageDescription =
  description ||
  `${siteConfig.name} — Huntsville's hands-on craft studio. Workshops, open studio walk-ins, and private parties. Open Thu–Sun.`
```

- [ ] **Step 4:** Create the OG image at `public/og-image.png` (1200×630). Write this HTML to `/tmp/og.html`:

```html
<!doctype html><html><head><style>
  body { margin:0; width:1200px; height:630px; display:flex; flex-direction:column;
    align-items:center; justify-content:center; background:#faf8f5;
    font-family: Georgia, 'Times New Roman', serif; }
  .card { text-align:center; padding:60px 90px; border-radius:32px;
    background:rgba(255,255,255,.7); border:1px solid rgba(150,112,91,.15);
    box-shadow:0 20px 60px rgba(150,112,91,.15); }
  h1 { font-size:96px; margin:0 0 16px; color:#5c4433; letter-spacing:-1px; }
  p { font-size:40px; margin:0; color:#96705B; }
  .sub { font-size:28px; color:#6b7280; margin-top:24px; font-family: Helvetica, Arial, sans-serif; }
</style></head><body><div class="card">
  <h1>Homegrown Studio</h1>
  <p>Create. Celebrate. Connect.</p>
  <div class="sub">Workshops · Open Studio · Private Parties — Huntsville, AL</div>
</div></body></html>
```

Then run:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --screenshot=public/og-image.png --window-size=1200,630 --hide-scrollbars /tmp/og.html
```

If Chrome is unavailable, skip and add "create og-image.png manually" to the final report — the meta tags degrade gracefully.

- [ ] **Step 5:** Run: `npm run build && npm test` — Expected: both pass. Then `npm run dev`, `curl -s http://localhost:4321/ | grep -o 'og:title\|canonical\|application/ld+json'` — Expected: all three appear.
- [ ] **Step 6:** Commit: `git add -A && git commit -m "feat(seo): canonical, OG/Twitter cards, theme-color, LocalBusiness JSON-LD via shared SeoHead"`

---

### Task 4: Hours in footer

**Files:** Modify: `src/components/shared/Footer.astro`
**Dependencies:** Task 2

- [ ] **Step 1:** In `Footer.astro`, the contact block currently is:

```astro
      <!-- Contact -->
      <div class="footer-contact">
        <a href={`mailto:${siteConfig.contactEmail}`} class="footer-link">
          {siteConfig.contactEmail}
        </a>
        <a href={`tel:${siteConfig.contactPhone.replace(/[^+\d]/g, '')}`} class="footer-link">
          {siteConfig.contactPhone}
        </a>
        <span class="footer-address">{street}, {city}, {state} {zip}</span>
      </div>
```

Replace it with (phone/address render only when set; hours always render):

```astro
      <!-- Contact -->
      <div class="footer-contact">
        <a href={`mailto:${siteConfig.contactEmail}`} class="footer-link">
          {siteConfig.contactEmail}
        </a>
        {siteConfig.contactPhone && (
          <a href={`tel:${siteConfig.contactPhone.replace(/[^+\d]/g, '')}`} class="footer-link">
            {siteConfig.contactPhone}
          </a>
        )}
        <span class="footer-address">
          {street ? `${street}, ` : ''}{city}, {state}{zip ? ` ${zip}` : ''}
        </span>
        <div class="footer-hours">
          {siteConfig.hours.map((h) => (
            <span class="footer-address">{h.label}</span>
          ))}
        </div>
      </div>
```

- [ ] **Step 2:** Add to the `<style>` block:

```css
  .footer-hours {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin-top: 0.35rem;
  }
```

- [ ] **Step 3:** Verify with `npm run dev` — footer shows city/state, hours lines, and no "(555)" anywhere.
- [ ] **Step 4:** Commit: `git commit -am "feat(footer): business hours; hide unset phone/street"`

---

### Task 5: Hero rewrite (what / where / when)

**Files:** Modify: `src/pages/index.astro`
**Dependencies:** Task 2

- [ ] **Step 1:** In `src/pages/index.astro`, the hero glass panel currently contains an `<h1>` with `{siteConfig.tagline}` and this paragraph:

```astro
        <p class="fade-in text-lg sm:text-xl leading-relaxed mb-10 mx-auto" style="color: var(--color-muted); max-width: 34ch;">
          Handcrafted workshops, birthday parties, and creative experiences for all ages
        </p>
```

Keep the `<h1>` (the tagline is the brand statement), and replace the paragraph with:

```astro
        <p class="fade-in text-lg sm:text-xl leading-relaxed mb-4 mx-auto" style="color: var(--color-text); max-width: 44ch;">
          Huntsville's hands-on craft studio — pottery, candles, watercolor, macramé
          and more. Evening workshops, walk-in open studio, and private events for
          every occasion and skill level.
        </p>
        <p class="fade-in text-sm sm:text-base mb-10 mx-auto" style="color: var(--color-muted);">
          Open Thu–Fri 4–9 · Sat 9–9 · Sun 2–8 &nbsp;·&nbsp; Grand opening July 31
        </p>
```

- [ ] **Step 2:** In the same file, the offerings array item for workshops has `description: 'Hands-on crafting sessions for all skill levels.'` — replace with `'Evening crafting sessions for all skill levels — from $35 a seat.'`. The Private Parties item description — replace with `'Rent the whole studio: $200 + your chosen craft per guest. Group discounts for 11+.'`.
- [ ] **Step 3:** Verify: `npm run dev`, view http://localhost:4321 — hero communicates location, crafts, hours, opening date.
- [ ] **Step 4:** Commit: `git commit -am "feat(home): hero states location, crafts, hours, opening date; price hints on offering cards"`

---

### Task 6: robots.txt, sitemap, 404

**Files:** Create: `public/robots.txt`, `src/pages/sitemap.xml.ts`, `src/pages/404.astro`

- [ ] **Step 1:** Create `public/robots.txt`:

```
User-agent: *
Allow: /
Disallow: /api/

Sitemap: https://homegrowncraftstudio.com/sitemap.xml
```

- [ ] **Step 2:** Create `src/pages/sitemap.xml.ts` (static list — the site has a small fixed route set; update when pages are added):

```ts
import type { APIRoute } from 'astro'

export const prerender = true

const SITE = 'https://homegrowncraftstudio.com'
const PAGES = ['/', '/workshops', '/calendar', '/book', '/gallery', '/about']

export const GET: APIRoute = () => {
  const urls = PAGES.map(
    (p) => `  <url><loc>${SITE}${p}</loc><changefreq>weekly</changefreq></url>`
  ).join('\n')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } })
}
```

- [ ] **Step 3:** Create `src/pages/404.astro`:

```astro
---
export const prerender = true
import Layout from '@layouts/StaticLayout.astro'
---

<Layout title="Page Not Found">
  <section class="relative flex flex-col items-center justify-center px-4" style="min-height: calc(100vh - 12rem);">
    <div class="glass-strong rounded-3xl px-10 py-14 text-center max-w-xl">
      <h1 class="font-heading font-bold text-5xl mb-4" style="color: var(--color-dark);">Lost in the studio?</h1>
      <p class="text-lg mb-8" style="color: var(--color-muted);">
        That page doesn't exist — but plenty of creative things do.
      </p>
      <div class="flex flex-wrap gap-3 justify-center">
        <a href="/" class="rounded-full px-8 py-3 text-white font-semibold no-underline" style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent));">Home</a>
        <a href="/workshops" class="rounded-full px-8 py-3 font-semibold no-underline glass" style="color: var(--color-primary);">Workshops</a>
        <a href="/calendar" class="rounded-full px-8 py-3 font-semibold no-underline glass" style="color: var(--color-primary);">What's On</a>
      </div>
    </div>
  </section>
</Layout>
```

- [ ] **Step 4:** Verify: `npm run build` succeeds; `npm run dev` then `curl -s http://localhost:4321/sitemap.xml` returns XML with 6 URLs; visiting a bogus path shows the branded 404.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat(seo): robots.txt, sitemap.xml endpoint, branded 404 page"`

---

### Task 7: Extract calendar month-events into a lib

**Files:** Create: `src/lib/calendar-events.ts`, `tests/lib/calendar-events.test.ts` · Modify: `src/pages/api/calendar.json.ts`

The full month-building logic currently lives inside the GET handler of `src/pages/api/calendar.json.ts`. Move it verbatim into a lib function so `calendar.astro` (Task 8) can reuse it. Phase 2 will also edit this lib.

- [ ] **Step 1:** Create `src/lib/calendar-events.ts`. Copy the ENTIRE body of the current GET handler in `src/pages/api/calendar.json.ts` — everything between the `month` validation and the final `Response` — into this shape (imports moved from the API file; only the wrapper is new):

```ts
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { createSquareClient } from '@providers/square/client'
import { partyConfig } from '@config/party.config'
import type { SquareConfig } from '@config/site.config'
import { parseOpenStudioWindows } from '@lib/open-studio'
import { offeredPartyStarts } from '@lib/party-slots'
import {
  buildCalendarEvents,
  type CalendarEvent,
  type PartyAvailabilitySlot,
  type PartyBookedSlot,
} from '@components/calendar/calendar-view-model'
import { createLogger } from '@lib/logger'

const logger = createLogger('lib:calendar-events')

/**
 * Builds calendar events for one month (`month` = 'YYYY-MM'): workshops,
 * Open Studio windows, available party slots, booked parties.
 * Extracted from /api/calendar.json so pages can server-render the first month.
 */
export async function getMonthEvents(month: string): Promise<CalendarEvent[]> {
  const monthStart = new Date(`${month}-01T00:00:00Z`)
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 23, 59, 59))
  const now = new Date()
  const locationId = siteConfig.providers.booking.config.locationId || ''

  // ... [PASTE the workshops / openStudioWindows / partyVariationId /
  //      partyAvailable / partyBooked blocks from the API route UNCHANGED] ...

  return buildCalendarEvents(workshops, openStudioWindows, partyAvailable, partyBooked)
}
```

Note: if `calendar-view-model.ts` does not export a `CalendarEvent` type under that name, check the actual export (`grep "export" src/components/calendar/calendar-view-model.ts`) and use whatever the events array type is; `ReturnType<typeof buildCalendarEvents>` is an acceptable fallback.

- [ ] **Step 2:** Rewrite `src/pages/api/calendar.json.ts` to delegate:

```ts
import type { APIRoute } from 'astro'
import { getMonthEvents } from '@lib/calendar-events'

export const prerender = false

/** Calendar events for one month (?month=YYYY-MM). Logic lives in @lib/calendar-events. */
export const GET: APIRoute = async ({ url }) => {
  const month = url.searchParams.get('month')
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return new Response(JSON.stringify({ error: 'month=YYYY-MM required' }), { status: 400 })
  }
  const events = await getMonthEvents(month)
  return new Response(JSON.stringify({ events }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  })
}
```

- [ ] **Step 3:** Create `tests/lib/calendar-events.test.ts` (runs in mock provider mode — no Square env needed):

```ts
import { describe, it, expect } from 'vitest'
import { getMonthEvents } from '@lib/calendar-events'

describe('getMonthEvents', () => {
  it('returns an array for a valid month without throwing', async () => {
    const events = await getMonthEvents('2026-08')
    expect(Array.isArray(events)).toBe(true)
  })
})
```

- [ ] **Step 4:** Run: `npm test` — Expected: PASS. Run `npm run build` — Expected: success.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "refactor(calendar): extract month-events builder to lib for SSR reuse"`

---

### Task 8: Server-render initial content on /calendar and /workshops

**Files:** Modify: `src/pages/calendar.astro`, `src/pages/workshops.astro`
**Dependencies:** Task 7

Both island components ALREADY accept initial-data props (`WhatsOnCalendar({ events })`, `WorkshopExplorer({ workshops })`). Crawlers currently see empty skeletons. Fetch server-side with a 2.5s cap so a slow Square API can't hang navigation (the original reason these went client-side) — on timeout we pass `[]` and the client fetch takes over as today.

- [ ] **Step 1:** Replace the frontmatter of `src/pages/calendar.astro` with:

```astro
---
export const prerender = false

import Layout from '@layouts/Layout.astro'
import WhatsOnCalendar from '@components/calendar/WhatsOnCalendar'
import { getMonthEvents } from '@lib/calendar-events'

// Server-render the current month so crawlers (and no-JS visitors) see real
// events; capped at 2.5s so slow Square calls can't block navigation. The
// component still re-fetches per-month client-side after mount.
const now = new Date()
const monthParam = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
type Events = Awaited<ReturnType<typeof getMonthEvents>>
let initialEvents: Events = []
try {
  initialEvents = await Promise.race<Events>([
    getMonthEvents(monthParam),
    new Promise<Events>((resolve) => setTimeout(() => resolve([]), 2500)),
  ])
} catch {
  // client-side fetch will populate
}
---
```

and change the component usage from `<WhatsOnCalendar client:load />` to:

```astro
    <WhatsOnCalendar events={initialEvents} client:load />
```

- [ ] **Step 2:** Replace the frontmatter of `src/pages/workshops.astro` with:

```astro
---
export const prerender = false

import Layout from '@layouts/Layout.astro'
import WorkshopExplorer from '@components/workshops/WorkshopExplorer'
import { providers } from '@config/providers'
import { toWorkshopData } from '@components/workshops/workshop-view-model'

// Server-render the workshop list (capped at 2.5s) so crawlers see real
// content; falls back to the existing client-side fetch on timeout/error.
type WorkshopList = ReturnType<typeof toWorkshopData>[]
let initialWorkshops: WorkshopList = []
try {
  const list = await Promise.race([
    providers.workshop.listWorkshops(),
    new Promise<never[]>((resolve) => setTimeout(() => resolve([]), 2500)),
  ])
  initialWorkshops = (list as any[]).map(toWorkshopData)
} catch {
  // client-side fetch will populate
}
---
```

and change `<WorkshopExplorer client:load />` to:

```astro
    <WorkshopExplorer workshops={initialWorkshops} client:load />
```

- [ ] **Step 3:** Verify: `npm run dev`, then `curl -s http://localhost:4321/workshops | grep -c 'workshop'` — with mock provider mode, Expected: workshop names present in raw HTML (mock provider returns sample data). Same idea for `/calendar`. Run `npm run build`.
- [ ] **Step 4:** Commit: `git commit -am "feat(seo): server-render initial workshops and calendar month with 2.5s cap"`

---

### Task 9: Stop logging payment material

**Files:** Modify: `src/pages/api/workshops/book.json.ts`

- [ ] **Step 1:** Two log calls leak sensitive data. First, the `'Booking created'` call (~line 97) logs `contactToken` and the full customer object. Replace:

```ts
    logger.info('Booking created', {
      bookingId,
      orderId: classBooking.order_id,
      contactToken,
      customerId,
      customerObj: JSON.stringify(classBooking.customer),
    })
```

with:

```ts
    logger.info('Booking created', {
      bookingId,
      orderId: classBooking.order_id,
      hasContactToken: !!contactToken,
    })
```

Second, the `'Calling /complete'` call (~line 119) logs a payment token prefix and the full request body (which contains the token). Replace:

```ts
    logger.info('Calling /complete', {
      bookingId,
      customerIdUsed: contactToken || customerId,
      paymentTokenPrefix: paymentToken?.substring(0, 20),
      hasVerificationToken: !!verificationToken,
      completeBody: JSON.stringify(completeBody),
    })
```

with:

```ts
    logger.info('Calling /complete', {
      bookingId,
      hasVerificationToken: !!verificationToken,
    })
```

- [ ] **Step 2:** Sweep for other leaks: `grep -rn "paymentToken\|payment_source_id" src/pages/api src/providers | grep -i "log"` — Expected: no logger lines containing token values remain.
- [ ] **Step 3:** Run: `npm run build && npm test`. Commit: `git commit -am "fix(security): stop logging payment tokens and PII in workshop booking"`

---

### Task 10: Idempotency key on Square booking creation

**Files:** Modify: `src/providers/square/booking.ts`

A retried request (network flake, double-click) currently creates two bookings. Square's `bookings.create` accepts a top-level `idempotencyKey`; a deterministic key from (customer, slot, service) makes retries return the original booking.

- [ ] **Step 1:** Add to the imports at the top of `src/providers/square/booking.ts`:

```ts
import { createHash } from 'node:crypto'
```

- [ ] **Step 2:** In `createBooking`, the create call currently reads:

```ts
    const response = await this.client.bookings.create({
      booking: bookingPayload,
    } as any)
```

Replace with:

```ts
    // Deterministic key: a retry of the same customer/slot/service returns the
    // original booking instead of double-booking.
    const idempotencyKey = createHash('sha256')
      .update(`${details.customerId}|${details.slotId}|${details.serviceVariationId ?? ''}`)
      .digest('hex')
      .slice(0, 45)

    const response = await this.client.bookings.create({
      idempotencyKey,
      booking: bookingPayload,
    } as any)
```

- [ ] **Step 3:** Run: `npm run build && npm test` — Expected: pass (provider tests use mocks; if a provider unit test asserts the exact create payload, update its expectation to include `idempotencyKey: expect.any(String)`).
- [ ] **Step 4:** Commit: `git commit -am "fix(square): deterministic idempotency key on booking creation"`

---

### Task 11: Full verification, push dev, propose production deploy

**Dependencies:** All previous tasks

- [ ] **Step 1:** Run the full gate: `npm run build && npm test` — both must pass.
- [ ] **Step 2:** Manual smoke test with `npm run dev`:
  - `/` — new hero, hours, no fake phone/address anywhere
  - `view-source` any page — canonical, og:*, twitter:*, JSON-LD present
  - `/sitemap.xml`, `/robots.txt` (robots only after build/deploy since it's in public/ — `curl http://localhost:4321/robots.txt` works in dev too), bogus URL → 404 page
  - `/workshops` and `/calendar` — content in initial HTML (curl, not browser)
- [ ] **Step 3:** Push: `git push origin dev`. Check the Netlify deploy-preview URL renders correctly (free).
- [ ] **Step 4:** **STOP — ask the user:** "Phase 1 is verified on the dev preview: <preview URL>. Production (`main`) is currently broken (/calendar 404s, workshops never load). Deploying to production costs 15 Netlify credits. Deploy now?" Only on explicit yes: `git checkout main && git merge dev && git push origin main && git checkout dev`.
- [ ] **Step 5:** Remind the user (do not do it yourself): set up **Google Business Profile** for "Homegrown Studio, Huntsville AL" the same day production deploys — it is the single highest-impact local-marketing action.

---

## Verification summary

| Check | Command | Expected |
|---|---|---|
| Build | `npm run build` | exit 0 |
| Tests | `npm test` | all pass |
| Meta | `curl -s localhost:4321/ \| grep -c 'og:'` | ≥ 8 |
| JSON-LD | `curl -s localhost:4321/ \| grep -c 'LocalBusiness'` | 1 |
| SSR content | `curl -s localhost:4321/workshops` | workshop names in HTML |
| No fake NAP | `grep -rn "555) 123\|Anytown" src/` | no matches |
| No token logs | `grep -rn "paymentTokenPrefix\|completeBody" src/` | no matches |
