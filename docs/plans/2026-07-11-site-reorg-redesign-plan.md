# Site Reorg & Homepage Redesign Implementation Plan

> **Design:** Approved in-conversation 2026-07-11 (brainstorm: homepage-as-storefront, Open Studio page, What's On list-first, gallery killed, waiver exposed). No separate design doc.
> **For agents:** Use team-dev (parallel) or sdd (sequential) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the site around four purchasable offerings (Open Studio, Workshops, Parties, future Take-Home Kits) and rebuild the homepage as a photo-forward storefront, applying the party page's conversion formula site-wide.

**Architecture:** Astro SSR pages with React islands (existing pattern). All changes are presentation-layer: `site.config.ts` gains `hours` + nav changes, one new page (`/open-studio`), one new island (`UpcomingWorkshops`), one new island (`CraftMenu`), simplification of `WorkshopExplorer`, and a list-first default view inside `WhatsOnCalendar`. No API or provider changes — every data need is served by existing endpoints (`/api/workshops.json`, `/api/calendar.json`, `/api/party/service-info.json`).

**Tech Stack:** Astro 4 (ViewTransitions), React 18 islands, Tailwind utilities + inline `var(--color-*)` styles, existing glass/texture CSS (`glass`, `glass-strong`, `hover-card`, `fade-in`, `cta-glow`).

**Branch:** `kaden/site-reorg` (format `{username}/{kebab-title}`, per jig.config.md). Commits follow the repo's conventional style (`feat(scope): …`, `fix(scope): …`).

**Content placeholders policy (approved):** Kaden supplies real photos + about story AFTER the reorg. Structure must accept content drops with zero code changes: offering-card images live at fixed paths under `public/images/home/`, and the about story is one markdown file. Temporary images are copies of `party-hero.jpg` so nothing 404s. Placeholder copy must be TRUE (no invented founders/dates) — the current fake "Elena Marchand 2019" copy is a bug this plan removes.

---

## Known-true facts used in copy (do not invent beyond these)

- Business name: **Homegrown Studio** (never "Homegrown Craft Studio").
- Location: 525 Hughes Rd, Suite F, Madison, AL 35758.
- Grand opening: **Tuesday, September 1, 2026**.
- Hours (America/Chicago): Thu & Fri 4–9 PM · Sat 9 AM–9 PM · Sun 2–8 PM.
- Offerings: Open Studio (walk-in, pay per craft, no booking), Workshops (per-seat), Private Parties (whole room, $300 + craft/head), Take-Home Kits (future, color themes: gold, silver, rainbow, blue…).
- Audience: everyone, ages 8+, any occasion — never kids-only framing.
- Crafts from $15/person; workshops from $30; parties from $300.
- Waiver: `/waiver` (self-serve signing page, already built).

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/config/site.config.ts` | Modify | `features.gallery: false`, add `hours` + `openingDate`, reorder `nav`, add `navCta` |
| `src/components/shared/Header.astro` | Modify | Render `navCta` as a pill button (desktop + mobile drawer) |
| `src/components/shared/Footer.astro` | Modify | Add Waiver link, hours block; nav from `siteConfig.nav` + CTA |
| `src/pages/gallery.astro` | Replace | 301 redirect to `/` (feature killed) |
| `src/content/about/story.md` | Replace | Remove fabricated copy; short true placeholder awaiting Kaden's story |
| `src/pages/open-studio.astro` | Create | Walk-in explainer: hero, how-it-works, hours, craft menu, waiver link |
| `src/components/open-studio/CraftMenu.tsx` | Create | Island: fetches `/api/party/service-info.json`, renders craft cards w/ prices |
| `src/pages/index.astro` | Replace | Storefront homepage (see Task 5 for full section list) |
| `src/components/home/UpcomingWorkshops.tsx` | Create | Island: next 3 workshops from `/api/workshops.json`, links to `/workshops?w=<id>` |
| `public/images/home/open-studio.jpg` + `workshops.jpg` + `parties.jpg` + `take-home.jpg` | Create | Offering-card images (temp copies of `party-hero.jpg`; Kaden swaps files later) |
| `src/components/workshops/WorkshopExplorer.tsx` | Modify | Remove search/calendar toggle + filters; chronological card grid; keep deeplink + modal |
| `src/components/workshops/SearchView.tsx` | Delete | Superseded (after grep confirms no other importers) |
| `src/components/workshops/CalendarView.tsx` | Delete | Superseded by What's On (after grep confirms no other importers) |
| `src/components/calendar/WhatsOnCalendar.tsx` | Modify | Add list-first default view; month grid behind a toggle |
| `src/pages/book.astro` | Modify | Take-Home Kits "coming soon" teaser section |
| `src/pages/workshops.astro` | Modify | Copy tweak only (subtitle mentions What's On) |
| `package.json` | Modify | Add `"test": "vitest run"` script (repo has none; all gates depend on it) |
| `src/content.config.ts` + `src/content/gallery/*.md` | Delete gallery collection | Orphaned fake-content collection removed with the gallery page |
| `tests/components/workshops/WorkshopExplorer.test.tsx` | Rewrite | Asserts chronological grid + empty state + deeplink (old toggle assertions die with the toggle) |

Existing tests: full suite must stay green (`npm test` after Task 1 wires the script — 313 passing baseline via vitest). New logic worth unit-testing is the list-view grouping helper (Task 8) and the workshop sort (Task 7); pages/islands are verified by build + browser pass (Task 10).

---

## Task 1: Config groundwork — gallery off, hours, nav, CTA

**Files:**
- Modify: `src/config/site.config.ts`

**Dependencies:** none (everything else depends on this)

- [ ] **Step 1: Add `hours`, `openingDate`, `navCta` to the `SiteConfig` interface**

In the interface block of `site.config.ts`, add:

```ts
  /** Public walk-in hours, displayed in footer / Open Studio / homepage. */
  hours: { days: string; time: string }[]
  /** Grand-opening date (ISO). Drives the pre-launch banner; remove after opening. */
  openingDate: string
  /** Header call-to-action button (rendered as a pill, not a text link). */
  navCta: { label: string; href: string }
```

- [ ] **Step 2: Update the config object**

In the `siteConfig` literal: set `features.gallery: false` (currently `true`, line ~304), and add below `address`:

```ts
  hours: [
    { days: 'Thursday & Friday', time: '4 – 9 PM' },
    { days: 'Saturday', time: '9 AM – 9 PM' },
    { days: 'Sunday', time: '2 – 8 PM' },
  ],
  openingDate: '2026-09-01',
```

Replace the `nav` array (currently Home/Workshops/Calendar/Book a Party/Gallery/About) with:

```ts
  nav: [
    { label: 'Open Studio', href: '/open-studio' },
    { label: 'Workshops', href: '/workshops' },
    { label: 'Parties', href: '/book' },
    { label: "What's On", href: '/calendar' },
    { label: 'About', href: '/about' },
  ],
  navCta: { label: 'Book a Party', href: '/book' },
```

(`Home` is the logo; `/calendar` URL is kept so nothing external breaks — only the label changes.)

- [ ] **Step 3: Wire up `npm test` (repo has no test script)**

`package.json` scripts are only `dev`/`build`/`preview`/`astro`; the 313-test suite runs via vitest directly. Add to `package.json` scripts so every later gate in this plan works:

```json
    "test": "vitest run"
```

(There is no `@astrojs/check`/`typescript` devDependency, so this plan uses `npm run build` as the type gate — do NOT use `npx astro check`.)

- [ ] **Step 4: Tests**

Run: `npm test 2>&1 | tail -5`
Expected: suite green, 313 passing baseline. (`validateConfig` only checks `name`; the two `: SiteConfig` literals in `tests/config/providers.test.ts` spread `...siteConfig`, so the new required fields don't break them — verified.)

- [ ] **Step 5: Commit**

```bash
git add src/config/site.config.ts package.json
git commit -m "feat(config): hours + opening date + nav reorder, gallery feature off"
```

---

## Task 2: Header CTA button + Footer waiver/hours

**Files:**
- Modify: `src/components/shared/Header.astro`
- Modify: `src/components/shared/Footer.astro`

**Dependencies:** Task 1

- [ ] **Step 1: Header — render the CTA pill after the nav links**

In `Header.astro`, after the `header-links` `<ul>` closes (line ~66), insert:

```astro
    {siteConfig.navCta && (
      <a href={siteConfig.navCta.href} class="header-cta">{siteConfig.navCta.label}</a>
    )}
```

Add to the component `<style>`:

```css
  .header-cta {
    display: none;
    padding: 0.5rem 1.25rem;
    border-radius: 9999px;
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: white;
    text-decoration: none;
    background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
    box-shadow: 0 4px 15px rgba(150, 112, 91, 0.25);
    transition: box-shadow 0.3s ease, transform 0.3s ease;
  }
  .header-cta:hover { box-shadow: 0 6px 20px rgba(150, 112, 91, 0.35); transform: translateY(-1px); text-decoration: none; }
  @media (min-width: 768px) { .header-cta { display: inline-block; } }
```

In the mobile drawer, append the CTA as the last `mobile-link` (visible on mobile where `.header-cta` is hidden):

```astro
          <li>
            <a href={siteConfig.navCta.href} class="mobile-link" style="color: var(--color-primary); font-weight: 600;">
              {siteConfig.navCta.label} →
            </a>
          </li>
```

Note: `Header.astro` (and `Footer.astro`) contain a fallback branch that builds `navItems` from feature flags when `siteConfig.nav` is empty — the fallback pushes a Gallery item guarded by `features.gallery`, which is now false, so it is already correct. Leave the fallback alone.

- [ ] **Step 2: Footer — waiver link + hours**

In `Footer.astro`, the footer nav maps `navItems`; after that loop add two static links:

```astro
        <a href="/waiver" class="footer-link">Waiver</a>
        <a href={`https://maps.google.com/?q=${encodeURIComponent(`${siteConfig.name}, ${street}, ${city}, ${state} ${zip}`)}`} class="footer-link" rel="noopener" target="_blank">Directions</a>
```

In the `footer-contact` div, above the address line, add hours:

```astro
        <div class="footer-hours">
          {siteConfig.hours.map((h) => (
            <span class="footer-address">{h.days}: {h.time}</span>
          ))}
        </div>
```

with style (inside existing `<style>`):

```css
  .footer-hours { display: flex; flex-direction: column; gap: 0.25rem; align-items: inherit; }
```

- [ ] **Step 3: Visual check**

Run: dev server already running → load `http://localhost:4321/` and one inner page.
Expected: pill button in header (desktop), CTA row in mobile drawer, footer shows Waiver + Directions links and three hours lines. No Gallery link anywhere.

- [ ] **Step 4: Commit**

```bash
git add src/components/shared/Header.astro src/components/shared/Footer.astro
git commit -m "feat(nav): header Book-a-Party pill + footer waiver, directions, hours"
```

---

## Task 3: Kill gallery page + truthful About copy

**Files:**
- Replace: `src/pages/gallery.astro`
- Replace: `src/content/about/story.md`

**Dependencies:** Task 1 (flag already off; this removes the orphan page)

- [ ] **Step 1: Replace `src/pages/gallery.astro` entirely with a redirect**

```astro
---
// Gallery is retired (socials cover this). Redirect keeps old links working.
export const prerender = false
return Astro.redirect('/', 301)
---
```

- [ ] **Step 1b: Delete the orphaned gallery content collection**

The `gallery` collection in `src/content.config.ts` and its 8 markdown files (`src/content/gallery/*.md`) are fake placeholder content with no route once the page redirects. Remove the collection definition from `src/content.config.ts` (delete the `gallery` const and its entry in the exported `collections`) and `git rm -r src/content/gallery`.

- [ ] **Step 2: Replace `src/content/about/story.md`**

The current file contains fabricated template copy ("Founded in 2019 by Elena Marchand…"). Replace the full file with:

```markdown
---
title: Our Story
order: 1
---

<!-- PLACEHOLDER — Kaden will replace this with the real story. Everything below is true; keep it true. -->

Homegrown Studio is a family-run craft studio in Madison, Alabama — opening its doors on **September 1, 2026**.

We built Homegrown around one idea: making something with your hands is for everyone. Walk in during open studio hours and pick a craft, grab a seat at a workshop, or take over the whole studio for a private party. No experience needed, ages 8 and up, every occasion welcome.

We can't wait to make something with you.
```

- [ ] **Step 3: Verify**

Run: `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:4321/gallery && curl -s http://localhost:4321/about | grep -c "Elena Marchand"`
Expected: `301 http://localhost:4321/` and `0` (fake founder gone; note `grep -c` exits 1 on zero matches — that IS the pass condition).

- [ ] **Step 4: Commit**

```bash
git add -A src/pages/gallery.astro src/content/about/story.md src/content.config.ts src/content/gallery
git commit -m "fix(content): retire gallery page + collection, replace fabricated about copy with true placeholder"
```

---

## Task 4: Open Studio page

**Files:**
- Create: `src/pages/open-studio.astro`
- Create: `src/components/open-studio/CraftMenu.tsx`

**Dependencies:** Task 1 (hours in config)

- [ ] **Step 1: Create `src/components/open-studio/CraftMenu.tsx`**

Fetches the same craft list the party flow uses (`/api/party/service-info.json` → `crafts[]` with `name`, `perHeadCents`, `description`, `imageUrl`). Renders read-only menu cards — no booking, this page sells walking in.

```tsx
import { useEffect, useState } from 'react'

interface Craft {
  id: string
  name: string
  perHeadCents: number
  perHeadMaxCents: number
  description?: string
  imageUrl?: string
  popular?: boolean
}

/** A craft can have multiple priced variations — show a range when min ≠ max. */
function formatPrice(c: Craft): string {
  if (!c.perHeadCents) return ''
  const min = (c.perHeadCents / 100).toFixed(0)
  if (c.perHeadMaxCents > c.perHeadCents) return `$${min}–$${(c.perHeadMaxCents / 100).toFixed(0)}`
  return `$${min}`
}

export default function CraftMenu() {
  const [crafts, setCrafts] = useState<Craft[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(false)
    // NOTE: this endpoint wraps its payload as { data: { crafts, ... } } —
    // unwrap exactly like PartyLanding/PartyModal do (json.data ?? json).
    fetch('/api/party/service-info.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`service-info ${r.status}`))))
      .then((json: { data?: { crafts?: Craft[] }; crafts?: Craft[] }) => {
        if (cancelled) return
        const data = json.data ?? json
        setCrafts(Array.isArray(data?.crafts) ? data.crafts : [])
      })
      .catch(() => {
        // Distinct from an empty catalog: a transient API blip must not read
        // as "we have no menu".
        if (!cancelled) {
          setError(true)
          setCrafts([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (crafts === null) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))', gap: '1.5rem' }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="animate-pulse glass" style={{ borderRadius: '1rem', height: '18rem' }} />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <p style={{ textAlign: 'center', color: 'var(--color-muted)' }}>
        The menu is being slow to load —{' '}
        <button
          onClick={() => window.location.reload()}
          style={{ color: 'var(--color-primary)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}
        >
          give it another try
        </button>
        , or come see today&rsquo;s crafts in person.
      </p>
    )
  }

  if (crafts.length === 0) {
    return (
      <p style={{ textAlign: 'center', color: 'var(--color-muted)' }}>
        Craft menu coming soon — follow us for the latest.
      </p>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))', gap: '1.5rem' }}>
      {crafts.map((c) => (
        <div key={c.id} className="glass hover-card" style={{ borderRadius: '1rem', overflow: 'hidden' }}>
          {c.imageUrl && (
            <img src={c.imageUrl} alt={c.name} loading="lazy" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover' }} />
          )}
          <div style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
              <h3 className="font-heading" style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-dark)' }}>{c.name}</h3>
              {formatPrice(c) && (
                <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-primary)', whiteSpace: 'nowrap' }}>
                  {formatPrice(c)}
                </span>
              )}
            </div>
            {c.description && (
              <p
                style={{
                  marginTop: '0.5rem',
                  fontSize: '0.875rem',
                  lineHeight: 1.6,
                  color: 'var(--color-muted)',
                  display: '-webkit-box',
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {c.description}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create `src/pages/open-studio.astro`**

```astro
---
export const prerender = true

import Layout from '@layouts/StaticLayout.astro'
import { siteConfig } from '@config/site.config'
import CraftMenu from '@components/open-studio/CraftMenu'

const steps = [
  { n: '1', title: 'Walk in', text: 'No booking, no reservation — come by any time during open hours.' },
  { n: '2', title: 'Pick a craft', text: 'Choose from the craft menu below. Pay per craft — no studio fee, no minimum.' },
  { n: '3', title: 'Make it yours', text: 'Grab a seat, take your time, and leave with something you made.' },
]
---

<Layout title="Open Studio" description="Walk-in crafting at Homegrown Studio — no booking needed. Pick a craft, grab a seat, pay per craft.">
  <section class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-28">
    <div class="text-center mb-16 fade-in">
      <p class="uppercase tracking-[0.2em] text-xs font-semibold mb-3" style="color: var(--color-accent);">Open Studio</p>
      <h1 class="text-4xl sm:text-5xl lg:text-6xl font-heading font-bold" style="color: var(--color-dark);">
        Just walk in and make something
      </h1>
      <p class="text-lg mt-4 max-w-xl mx-auto" style="color: var(--color-muted);">
        No booking, no studio fee — pick a craft from the menu and pay for what you make. Ages 8+, everyone welcome.
      </p>
    </div>

    <!-- How it works -->
    <div class="grid gap-5 sm:grid-cols-3 mb-16">
      {steps.map((s) => (
        <div class="glass rounded-2xl p-8 text-center fade-in">
          <div class="mx-auto mb-4 w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent));">
            {s.n}
          </div>
          <h3 class="font-heading font-bold text-lg mb-2" style="color: var(--color-dark);">{s.title}</h3>
          <p class="text-sm leading-relaxed" style="color: var(--color-muted);">{s.text}</p>
        </div>
      ))}
    </div>

    <!-- Hours -->
    <div class="glass-strong rounded-2xl px-8 py-10 sm:px-12 text-center mb-16 fade-in">
      <h2 class="text-2xl sm:text-3xl font-heading font-bold mb-6" style="color: var(--color-dark);">Walk-in hours</h2>
      <div class="flex flex-wrap justify-center gap-x-10 gap-y-3">
        {siteConfig.hours.map((h) => (
          <div>
            <span class="block text-sm font-semibold" style="color: var(--color-dark);">{h.days}</span>
            <span class="block text-sm" style="color: var(--color-muted);">{h.time}</span>
          </div>
        ))}
      </div>
      <p class="mt-6 text-sm" style="color: var(--color-muted);">
        {siteConfig.address.street}, {siteConfig.address.city}, {siteConfig.address.state} —
        <a href="/calendar" class="underline" style="color: var(--color-primary);">see what's on this week</a>
      </p>
    </div>

    <!-- Craft menu -->
    <div class="text-center mb-10 fade-in">
      <h2 class="text-3xl sm:text-4xl font-heading font-bold" style="color: var(--color-dark);">The craft menu</h2>
      <p class="text-base mt-3 max-w-xl mx-auto" style="color: var(--color-muted);">
        Every craft is priced per person — make one, or make a few.
      </p>
    </div>
    <CraftMenu client:visible />

    <!-- Waiver + party cross-sell -->
    <div class="mt-16 text-center fade-in">
      <p class="text-sm" style="color: var(--color-muted);">
        First visit? <a href="/waiver" class="underline" style="color: var(--color-primary);">Sign the waiver ahead of time</a> and skip the paperwork at the door.
      </p>
      <p class="mt-3 text-sm" style="color: var(--color-muted);">
        Bringing a group? <a href="/book" class="underline" style="color: var(--color-primary);">Book the whole studio</a> for a private party.
      </p>
    </div>
  </section>
</Layout>
```

- [ ] **Step 3: Verify**

Run: load `http://localhost:4321/open-studio` in the browser.
Expected: hero + 3 steps + hours block (Thu/Fri, Sat, Sun) + craft cards with the 4 live crafts (Patch & Personalize $25, Bedazzle & Bling $15, Junk Journaling $15, Keychain Bar $15) + waiver link. Nav highlights "Open Studio".

- [ ] **Step 4: Commit**

```bash
git add src/pages/open-studio.astro src/components/open-studio/CraftMenu.tsx
git commit -m "feat(open-studio): walk-in landing page with hours and live craft menu"
```

---

## Task 5: Homepage storefront

**Files:**
- Replace: `src/pages/index.astro`
- Create: `src/components/home/UpcomingWorkshops.tsx`
- Create: `public/images/home/open-studio.jpg`, `workshops.jpg`, `parties.jpg`, `take-home.jpg` (temp copies)

**Dependencies:** Task 1 (hours/openingDate), Task 4 (`/open-studio` route exists)

- [ ] **Step 1: Placeholder images**

```bash
mkdir -p public/images/home
for f in open-studio workshops parties take-home; do cp public/images/party-hero.jpg "public/images/home/$f.jpg"; done
```

(Kaden replaces these files later — paths are the contract, no code change needed.)

- [ ] **Step 2: Create `src/components/home/UpcomingWorkshops.tsx`**

Next 3 upcoming workshops; each card links to `/workshops?w=<id>` (existing deeplink auto-opens the booking modal there — no modal needed on the homepage). Renders nothing if the fetch fails or returns empty, so the homepage never shows a broken section.

```tsx
import { useEffect, useState } from 'react'

interface Workshop {
  id: string
  name: string
  imageUrl?: string
  date: string // YYYY-MM-DD
  startTime: string // full ISO datetime (workshop-view-model sets startTime: w.startAt) — MUST be formatted before display
  price: number // cents
  remainingSeats: number | null
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Mirrors WorkshopCard.tsx's formatTime — startTime is a raw ISO datetime.
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function UpcomingWorkshops() {
  const [workshops, setWorkshops] = useState<Workshop[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/workshops.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`workshops ${r.status}`))))
      .then((d: { workshops?: Workshop[] }) => {
        if (cancelled) return
        const list = (Array.isArray(d?.workshops) ? d.workshops : [])
          .slice()
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, 3)
        setWorkshops(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (workshops.length === 0) return null

  return (
    <section style={{ padding: '3rem 1rem' }}>
      <div style={{ maxWidth: '64rem', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <p className="uppercase" style={{ letterSpacing: '0.2em', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--color-accent)' }}>
            Coming Up
          </p>
          <h2 className="font-heading" style={{ fontSize: 'clamp(1.875rem, 4vw, 3rem)', fontWeight: 700, color: 'var(--color-dark)' }}>
            Upcoming Workshops
          </h2>
        </div>
        <div style={{ display: 'grid', gap: '1.25rem', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' }}>
          {workshops.map((w) => (
            <a key={w.id} href={`/workshops?w=${w.id}`} className="glass hover-card" style={{ borderRadius: '1rem', overflow: 'hidden', textDecoration: 'none', display: 'block' }}>
              {w.imageUrl && <img src={w.imageUrl} alt={w.name} loading="lazy" style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover' }} />}
              <div style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                  <span>{formatDate(w.date)} · {formatTime(w.startTime)}</span>
                  <span>${(w.price / 100).toFixed(0)}</span>
                </div>
                <h3 className="font-heading" style={{ marginTop: '0.5rem', fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-dark)' }}>{w.name}</h3>
                {w.remainingSeats !== null && w.remainingSeats <= 5 && (
                  <p style={{ marginTop: '0.375rem', fontSize: '0.75rem', fontWeight: 600, color: '#a15d3b' }}>Only {w.remainingSeats} seats left</p>
                )}
                <span style={{ display: 'inline-block', marginTop: '0.75rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-primary)' }}>Grab a seat →</span>
              </div>
            </a>
          ))}
        </div>
        <p style={{ textAlign: 'center', marginTop: '2rem' }}>
          <a href="/workshops" style={{ fontSize: '0.9375rem', fontWeight: 500, color: 'var(--color-primary)' }}>See all workshops →</a>
        </p>
      </div>
    </section>
  )
}
```

Data-shape notes (verified against `workshop-view-model.ts` + `WorkshopCard.tsx`): `/api/workshops.json` returns `{ workshops }` with NO `data` envelope (unlike service-info); `price` is in **cents**; `startTime` is a **raw ISO datetime** (`toWorkshopData` sets `startTime: w.startAt`) — hence the `formatTime` helper above, mirroring `WorkshopCard.tsx`. `listWorkshops()` already filters to upcoming and sorts ascending, so `.sort().slice(0, 3)` is belt-and-suspenders.

- [ ] **Step 3: Replace `src/pages/index.astro`**

Full new file. Section order: opening banner → hero → offerings (4 photo cards) → how it works → UpcomingWorkshops island → visit us → testimonials (kept conditional; currently empty = hidden) → newsletter.

```astro
---
export const prerender = true

import Layout from '@layouts/StaticLayout.astro'
import { siteConfig } from '@config/site.config'
import Newsletter from '@components/shared/Newsletter'
import UpcomingWorkshops from '@components/home/UpcomingWorkshops'

const offerings = [
  {
    title: 'Open Studio',
    price: 'Crafts from $15 · no booking needed',
    description: 'Walk in during open hours, pick a craft from the menu, and make it yours. Pay per craft — that’s it.',
    href: '/open-studio',
    cta: 'How it works',
    image: '/images/home/open-studio.jpg',
    alt: 'Craft supplies laid out on a studio table',
  },
  {
    title: 'Workshops',
    price: 'From $30 a seat',
    description: 'Guided sessions with everything included. Come solo or bring a friend — all skill levels, ages 8+.',
    href: '/workshops',
    cta: 'Browse workshops',
    image: '/images/home/workshops.jpg',
    alt: 'A workshop table set for a guided craft session',
  },
  {
    title: 'Private Parties',
    price: 'Whole studio · from $300',
    description: 'The whole room for your people — birthdays, girls’ nights, showers, team nights, or just because.',
    href: '/book',
    cta: 'Plan your party',
    image: '/images/home/parties.jpg',
    alt: 'A party table set with crafts at Homegrown Studio',
  },
  {
    title: 'Take-Home Kits',
    price: 'Coming soon',
    description: 'The party-in-a-box: a themed craft kit for your crew, at your place. Gold, silver, rainbow, and more.',
    href: null,
    cta: 'On the way',
    image: '/images/home/take-home.jpg',
    alt: 'A boxed take-home craft kit',
  },
]

const steps = [
  { n: '1', title: 'Pick your thing', text: 'A craft off the menu, a workshop seat, or the whole studio.' },
  { n: '2', title: 'Pick your time', text: 'Walk in, grab a seat online, or choose your party slot — takes about a minute.' },
  { n: '3', title: 'Show up and make', text: 'Everything’s set up when you arrive. We handle the rest.' },
]

const showOpeningBanner = new Date() < new Date(siteConfig.openingDate + 'T00:00:00-05:00')
const openingLabel = new Date(siteConfig.openingDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
const testimonials = siteConfig.testimonials?.items ?? []
---

<Layout title="Home" description="Homegrown Studio — walk-in crafting, workshops, and private parties in Madison, AL. Everyone welcome, ages 8+.">
  {showOpeningBanner && (
    <div id="opening-banner" class="text-center px-4 py-2.5 text-sm font-medium" style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent)); color: white;">
      Grand opening {openingLabel} — <a href="/book" class="underline font-semibold" style="color: white;">now booking opening-month parties</a>
    </div>
  )}
  {showOpeningBanner && (
    <script is:inline define:vars={{ openingDate: siteConfig.openingDate }}>
      // Page is prerendered; without this, a stale build would keep announcing the
      // opening after Sept 1 until the next production deploy. Self-hide at runtime.
      if (new Date() >= new Date(openingDate + 'T00:00:00-05:00')) {
        document.getElementById('opening-banner')?.remove()
      }
    </script>
  )}

  <!-- Hero -->
  <section class="relative flex flex-col items-center justify-center px-4 pt-16 pb-12 sm:pt-24">
    <div class="relative z-10 max-w-4xl mx-auto text-center">
      <h1 class="fade-in font-heading font-bold text-4xl sm:text-6xl lg:text-7xl" style="color: var(--color-dark); letter-spacing: -0.01em;">
        Make something you&rsquo;ll actually keep
      </h1>
      <p class="fade-in text-lg sm:text-xl leading-relaxed mt-6 mx-auto" style="color: var(--color-muted); max-width: 44ch;">
        A craft studio in Madison, Alabama — walk in and craft, join a workshop, or take over the whole place for a party.
      </p>
      <div class="fade-in mt-8 flex flex-wrap justify-center gap-3">
        <a href="/book" class="cta-glow inline-block rounded-full px-10 py-4 text-white font-semibold text-lg no-underline" style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent)); box-shadow: 0 8px 30px rgba(150, 112, 91, 0.3);">
          Book a Party
        </a>
        <a href="/workshops" class="inline-block rounded-full px-10 py-4 font-semibold text-lg no-underline glass" style="color: var(--color-dark);">
          Browse Workshops
        </a>
      </div>
      <p class="fade-in mt-6 text-sm font-medium" style="color: var(--color-muted);">
        Walk-ins welcome Thu&ndash;Sun · 525 Hughes Rd, Madison, AL · Ages 8+
      </p>
      <img
        src="/images/party-hero.jpg"
        alt="A craft table set up at Homegrown Studio"
        class="fade-in mt-10 mx-auto rounded-2xl w-full max-w-4xl object-cover"
        style="aspect-ratio: 21 / 9; box-shadow: 0 24px 60px rgba(150, 112, 91, 0.18);"
      />
    </div>
  </section>

  <!-- Offerings -->
  <section class="py-12 sm:py-16 px-4 relative z-10">
    <div class="max-w-5xl mx-auto">
      <div class="text-center mb-10 fade-in">
        <p class="uppercase tracking-[0.2em] text-xs font-semibold mb-3" style="color: var(--color-accent);">Four ways to craft</p>
        <h2 class="text-3xl sm:text-4xl lg:text-5xl font-heading font-bold" style="color: var(--color-dark);">Pick your kind of day</h2>
      </div>
      <div class="grid gap-5 grid-cols-1 sm:grid-cols-2">
        {offerings.map((item) => {
          const Tag = item.href ? 'a' : 'div'
          return (
            <Tag href={item.href ?? undefined} class:list={['group block rounded-2xl overflow-hidden glass no-underline', item.href && 'hover-card']}>
              <img src={item.image} alt={item.alt} loading="lazy" class="w-full object-cover" style="aspect-ratio: 16 / 9;" />
              <div class="p-7">
                <div class="flex items-baseline justify-between gap-3">
                  <h3 class="text-xl font-heading font-bold" style="color: var(--color-dark);">{item.title}</h3>
                  <span class="text-xs font-semibold whitespace-nowrap" style="color: var(--color-primary);">{item.price}</span>
                </div>
                <p class="mt-3 text-sm leading-relaxed" style="color: var(--color-muted);">{item.description}</p>
                <div class="mt-5 flex items-center gap-2 text-sm font-medium transition-all duration-300 group-hover:gap-3" style={`color: ${item.href ? 'var(--color-primary)' : 'var(--color-muted)'};`}>
                  <span>{item.cta}</span>
                  {item.href && (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                  )}
                </div>
              </div>
            </Tag>
          )
        })}
      </div>
    </div>
  </section>

  <!-- How it works -->
  <section class="py-12 sm:py-16 px-4">
    <div class="max-w-5xl mx-auto">
      <div class="text-center mb-10 fade-in">
        <h2 class="text-3xl sm:text-4xl font-heading font-bold" style="color: var(--color-dark);">Easy as one, two, craft</h2>
      </div>
      <div class="grid gap-5 sm:grid-cols-3">
        {steps.map((s) => (
          <div class="glass rounded-2xl p-8 text-center fade-in">
            <div class="mx-auto mb-4 w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent));">
              {s.n}
            </div>
            <h3 class="font-heading font-bold text-lg mb-2" style="color: var(--color-dark);">{s.title}</h3>
            <p class="text-sm leading-relaxed" style="color: var(--color-muted);">{s.text}</p>
          </div>
        ))}
      </div>
    </div>
  </section>

  <!-- Upcoming workshops (live from Square; hides itself if none) -->
  <UpcomingWorkshops client:visible />

  <!-- Visit us -->
  <section class="py-12 sm:py-16 px-4">
    <div class="glass-strong rounded-2xl max-w-4xl mx-auto px-8 py-12 sm:px-14 text-center fade-in">
      <h2 class="text-3xl sm:text-4xl font-heading font-bold mb-6" style="color: var(--color-dark);">Come see us</h2>
      <p class="text-base font-medium" style="color: var(--color-dark);">
        {siteConfig.address.street}, {siteConfig.address.city}, {siteConfig.address.state} {siteConfig.address.zip}
      </p>
      <div class="mt-5 flex flex-wrap justify-center gap-x-10 gap-y-3">
        {siteConfig.hours.map((h) => (
          <div>
            <span class="block text-sm font-semibold" style="color: var(--color-dark);">{h.days}</span>
            <span class="block text-sm" style="color: var(--color-muted);">{h.time}</span>
          </div>
        ))}
      </div>
      <a
        href={`https://maps.google.com/?q=${encodeURIComponent(`${siteConfig.name}, ${siteConfig.address.street}, ${siteConfig.address.city}, ${siteConfig.address.state} ${siteConfig.address.zip}`)}`}
        target="_blank"
        rel="noopener"
        class="inline-block mt-7 rounded-full px-8 py-3 text-sm font-semibold no-underline glass"
        style="color: var(--color-primary);"
      >
        Get directions →
      </a>
    </div>
  </section>

  <!-- Testimonials (hidden until real ones exist) -->
  {testimonials.length > 0 && (
    <section class="py-12 sm:py-16 px-4">
      <div class="max-w-5xl mx-auto">
        <div class="text-center mb-10 fade-in">
          <p class="uppercase tracking-[0.2em] text-xs font-semibold mb-3" style="color: var(--color-accent);">Testimonials</p>
          <h2 class="text-3xl sm:text-4xl lg:text-5xl font-heading font-bold" style="color: var(--color-dark);">
            {siteConfig.testimonials?.heading || 'What Our Guests Say'}
          </h2>
        </div>
        <div class="grid gap-6 md:grid-cols-3">
          {testimonials.map((t) => (
            <blockquote class="glass rounded-2xl p-8 sm:p-10 hover-card" style="display: flex; flex-direction: column; justify-content: space-between;">
              <p class="font-heading italic text-lg sm:text-xl leading-relaxed mb-8" style="color: var(--color-dark); display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden;">
                &ldquo;{t.quote}&rdquo;
              </p>
              <footer class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs" style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent));">
                  {t.name.charAt(0)}
                </div>
                <div>
                  <span class="block font-semibold text-sm" style="color: var(--color-dark);">{t.name}</span>
                  <span class="block text-xs" style="color: var(--color-muted);">{t.detail}</span>
                </div>
              </footer>
            </blockquote>
          ))}
        </div>
      </div>
    </section>
  )}

  <!-- Newsletter -->
  {siteConfig.features.newsletter && (
    <section class="py-12 sm:py-16 px-4">
      <div class="glass rounded-2xl max-w-2xl mx-auto px-8 py-14 sm:px-14">
        <Newsletter client:visible />
      </div>
    </section>
  )}
</Layout>
```

Notes locked in by design: hero is no longer 100vh (content above the fold), scroll-chevron removed, gallery card gone, Take-Home Kits card is non-clickable with "Coming soon" price line. The banner is prerendered but self-hides at runtime via the inline script above once `openingDate` passes (no deploy required); delete both banner blocks entirely whenever convenient after opening.

- [ ] **Step 4: Verify**

Run: load `http://localhost:4321/` — check hero CTAs, four cards render with images, kits card not clickable, how-it-works, upcoming workshops shows Y2K Mom's Night Out, visit-us hours, banner says "Grand opening September 1".
Then: `npm run build 2>&1 | tail -5` → build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/pages/index.astro src/components/home/UpcomingWorkshops.tsx public/images/home
git commit -m "feat(home): storefront redesign — hero, offering cards, how-it-works, live workshops, visit-us"
```

---

## Task 6: Take-Home Kits teaser on the party page

**Files:**
- Modify: `src/pages/book.astro`

**Dependencies:** none (independent)

- [ ] **Step 1: Add teaser section**

In `book.astro`, after `<PartyLanding client:load />` and before `<PartyFaq />`:

```astro
    <div class="glass rounded-2xl px-8 py-10 sm:px-12 text-center mt-16 fade-in">
      <p class="uppercase tracking-[0.2em] text-xs font-semibold mb-3" style="color: var(--color-accent);">Coming Soon</p>
      <h2 class="text-2xl sm:text-3xl font-heading font-bold mb-3" style="color: var(--color-dark);">Take-Home Party Kits</h2>
      <p class="text-base max-w-xl mx-auto leading-relaxed" style="color: var(--color-muted);">
        Want the party without booking the studio? We&rsquo;re boxing up themed craft kits — gold, silver, rainbow, and more —
        so you can host at home. Join the newsletter and you&rsquo;ll be the first to know.
      </p>
    </div>
```

- [ ] **Step 2: Verify + commit**

Load `http://localhost:4321/book` → teaser renders between craft section and FAQ; party flow unaffected (open the modal once to confirm).

```bash
git add src/pages/book.astro
git commit -m "feat(book): take-home party kits coming-soon teaser"
```

---

## Task 7: Workshops page simplification

**Files:**
- Modify: `src/components/workshops/WorkshopExplorer.tsx`
- Delete: `src/components/workshops/SearchView.tsx`, `src/components/workshops/CalendarView.tsx`
- Modify: `src/pages/workshops.astro` (subtitle copy)

**Dependencies:** Task 8 SHOULD land with or before this in the same deploy (What's On list view replaces the calendar toggle's job), but there is no code dependency.

- [ ] **Step 1: Check for other importers before deleting — INCLUDING tests**

Run: `grep -rn "SearchView\|CalendarView\|DateRangePicker" src tests --include='*.tsx' --include='*.ts' --include='*.astro' | grep -v "components/workshops/"`
Known hit: `tests/components/workshops/WorkshopExplorer.test.tsx` mocks `@components/workshops/CalendarView` and asserts the Search/Calendar toggle buttons + the "Search workshops…" placeholder — all removed by this task. That test file MUST be rewritten in this same commit (Step 3b) or the suite goes red. `DateRangePicker` lives in `shared/` and may have other importers; if so, keep the file and only stop importing it. Record findings in the commit message.

- [ ] **Step 2: Rewrite `WorkshopExplorer` body**

Keep: `WorkshopData` interface, fetch effect, deeplink effect, skeleton, booking modal. Remove: `View` type, view state, toggle buttons, `SearchView`/`CalendarView` imports. Replace the return with a sorted chronological grid using the existing `WorkshopCard`:

```tsx
import WorkshopCard from './WorkshopCard'
// (remove SearchView + CalendarView imports; delete the `type View` line and view state)

  const sorted = [...workshops].sort(
    (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
  )

  return (
    <div>
      {loading ? (
        <WorkshopSkeleton />
      ) : sorted.length === 0 ? (
        <div className="glass" style={{ borderRadius: '1rem', padding: '3rem 2rem', textAlign: 'center' }}>
          <p className="font-heading" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-dark)' }}>
            New workshops are on the way
          </p>
          <p style={{ marginTop: '0.5rem', fontSize: '0.9375rem', color: 'var(--color-muted)' }}>
            Join the newsletter and you&rsquo;ll hear about them first — or{' '}
            <a href="/calendar" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>see what else is on</a>.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))', gap: '1.5rem' }}>
          {sorted.map((w) => (
            <WorkshopCard key={w.id} workshop={w} onBook={setBookingWorkshop} />
          ))}
        </div>
      )}

      {bookingWorkshop && (
        <WorkshopBookingModal workshop={bookingWorkshop} onClose={() => setBookingWorkshop(null)} />
      )}
    </div>
  )
```

Check `WorkshopCard`'s actual prop names first (`workshop`/`onBook` assumed from `SearchView` usage — mirror exactly what `SearchView` passed).

- [ ] **Step 3: Delete superseded files, update page copy**

```bash
git rm src/components/workshops/SearchView.tsx src/components/workshops/CalendarView.tsx
```

In `workshops.astro`, change the subtitle `<p>` to:

```astro
        Guided crafting sessions, everything included — grab a seat before they fill up. Want the full picture? <a href="/calendar" class="underline" style="color: var(--color-primary);">See what's on</a>.
      </p>
```

- [ ] **Step 3b: Rewrite `tests/components/workshops/WorkshopExplorer.test.tsx`**

Replace the toggle/search assertions with the new behavior: (1) renders one `WorkshopCard` per workshop in date order (mock `WorkshopCard` the same way the file currently mocks `CalendarView`), (2) shows the empty-state copy ("New workshops are on the way") when the fetch returns `[]`, (3) `?w=<id>` deeplink still opens `WorkshopBookingModal`. Keep the file's existing fetch-mocking setup; drop the `CalendarView` mock.

- [ ] **Step 4: Verify**

Run: `npm test 2>&1 | tail -3`, then load `/workshops` and `/workshops?w=<id>` (grab an id from `/api/workshops.json`) — deeplink still opens the modal.
Expected: green tests, chronological cards, working deeplink.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/workshops src/pages/workshops.astro tests/components/workshops
git commit -m "refactor(workshops): chronological list replaces search/calendar views"
```

---

## Task 8: What's On — list-first view

**Files:**
- Modify: `src/components/calendar/WhatsOnCalendar.tsx`
- Modify: `src/components/calendar/calendar-view-model.ts` (add + test grouping helper)
- Test: `tests/calendar-view-model.test.ts` (or the repo's existing test location for this module — check `git grep -l calendar-view-model tests/ src/` first and follow suit)

**Dependencies:** none (independent of Tasks 5–7)

The month grid stays exactly as-is; it becomes the secondary view behind a `List | Month` toggle (List default). The list view answers "what can I actually come to?" without hunting through empty grid cells.

- [ ] **Step 1: Write the failing test for the grouping helper**

Add to the view-model test file (create it if the module has no tests yet, following the repo's test-runner conventions — check how existing tests import and name things first):

```ts
import { describe, it, expect } from 'vitest'
import { groupEventsByDay } from '../src/components/calendar/calendar-view-model'
import type { CalendarEvent } from '../src/components/calendar/calendar-view-model'

const ev = (over: Partial<CalendarEvent>): CalendarEvent =>
  ({ id: 'x', kind: 'workshop', title: 'T', date: '2026-07-18', ...over }) as CalendarEvent

describe('groupEventsByDay', () => {
  it('groups events by date ascending and drops past days', () => {
    const days = groupEventsByDay(
      [
        ev({ id: 'a', date: '2026-07-18' }),
        ev({ id: 'b', date: '2026-07-12' }),
        ev({ id: 'c', date: '2026-07-18', kind: 'open-studio' }),
        ev({ id: 'past', date: '2026-07-01' }),
      ],
      '2026-07-11' // "today"
    )
    expect(days.map((d) => d.date)).toEqual(['2026-07-12', '2026-07-18'])
    expect(days[1].events.map((e) => e.id)).toEqual(['a', 'c'])
  })

  it('collapses multiple party-available slots into one summary entry per day', () => {
    const days = groupEventsByDay(
      [
        ev({ id: 'p1', date: '2026-07-18', kind: 'party-available' }),
        ev({ id: 'p2', date: '2026-07-18', kind: 'party-available' }),
      ],
      '2026-07-11'
    )
    expect(days[0].events).toHaveLength(1)
    expect(days[0].events[0].kind).toBe('party-available')
    expect(days[0].events[0].title).toMatch(/2 party times open/)
    // Collapsed summary must link to the DAY, not inherit the first slot's
    // slot-specific href — same convention as the month grid's aggregation.
    expect(days[0].events[0].href).toBe('/book?date=2026-07-18')
  })
})
```

Adjust the `ev` factory to satisfy `CalendarEvent`'s real required fields (read the type first — it likely includes times/href; fill with real-shaped values, not `as any`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 groupEventsByDay`
Expected: FAIL — `groupEventsByDay is not exported`.

- [ ] **Step 3: Implement `groupEventsByDay` in `calendar-view-model.ts`**

```ts
export interface DayGroup {
  date: string // YYYY-MM-DD
  events: CalendarEvent[]
}

/**
 * List-view shape: upcoming days only (>= today), ascending, with each day's
 * party-available slots collapsed to a single "N party times open" entry
 * (mirrors the month grid's aggregation — detail lives on /book).
 */
export function groupEventsByDay(events: CalendarEvent[], today: string): DayGroup[] {
  const byDate = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    if (e.date < today) continue
    const list = byDate.get(e.date) ?? []
    list.push(e)
    byDate.set(e.date, list)
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayEvents]) => {
      const partySlots = dayEvents.filter((e) => e.kind === 'party-available')
      if (partySlots.length <= 1) return { date, events: dayEvents }
      const rest = dayEvents.filter((e) => e.kind !== 'party-available')
      const summary: CalendarEvent = {
        ...partySlots[0],
        title: `🎉 ${partySlots.length} party times open`,
        // Rebuild the href: partySlots[0].href is slot-specific (/book?start=<ts>);
        // the collapsed row must link date-scoped, matching aggregatePartySlots.
        href: `/book?date=${encodeURIComponent(date)}`,
      }
      return { date, events: [...rest, summary] }
    })
}
```

(If `WhatsOnCalendar`'s private `aggregatePartySlots` duplicates this collapse logic, refactor it to call this exported helper — one implementation, not two.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -3`
Expected: PASS, suite green.

- [ ] **Step 5: Add the List|Month toggle + list rendering to `WhatsOnCalendar.tsx`**

State: `const [view, setView] = useState<'list' | 'month'>('list')`. Toggle buttons use this pill pattern (inlined here because Task 7 deletes the WorkshopExplorer original — do NOT go looking for it there):

```tsx
// className="px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300"
const pillStyle = (active: boolean): React.CSSProperties =>
  active
    ? {
        background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
        color: 'white',
        boxShadow: '0 4px 15px rgba(150, 112, 91, 0.2)',
      }
    : {
        background: 'rgba(255, 255, 255, 0.75)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(150, 112, 91, 0.06)',
        color: 'var(--color-text)',
      }
```

The toggle's `onClick` must also call `setSelectedDay(null)` — the existing selected-day detail panel is a sibling of the grid and would otherwise keep rendering (stale) under the list view. Additionally, wrap that existing detail panel in `view === 'month' && …`. `view === 'month'` renders the existing grid unchanged. `view === 'list'` renders:

```tsx
{view === 'list' && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '44rem', margin: '0 auto' }}>
    {dayGroups.length === 0 && (
      <p style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '3rem 0' }}>
        Nothing else on this month — <button onClick={goToNextMonth} style={{ color: 'var(--color-primary)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>peek at next month</button>
      </p>
    )}
    {dayGroups.map((day) => (
      <div key={day.date} className="glass" style={{ borderRadius: '1rem', padding: '1.25rem 1.5rem' }}>
        <p className="font-heading" style={{ fontWeight: 700, color: 'var(--color-dark)', marginBottom: '0.75rem' }}>
          {formatDayHeading(day.date)} {/* e.g. "Saturday, July 18" */}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {day.events.map((e) => (
            <a
              key={e.id}
              href={eventHref(e)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none', padding: '0.5rem 0.75rem', borderRadius: '0.625rem', transition: 'background 0.2s ease' }}
              onMouseEnter={(ev) => (ev.currentTarget.style.background = 'rgba(150,112,91,0.06)')}
              onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
            >
              <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '9999px', background: KIND_COLORS[e.kind], flexShrink: 0 }} />
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-muted)', width: '5.5rem', flexShrink: 0 }}>{e.startTime ?? ''}</span>
              <span style={{ fontSize: '0.9375rem', color: 'var(--color-dark)', flex: 1 }}>{e.title}</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: KIND_COLORS[e.kind], flexShrink: 0 }}>{KIND_LABELS[e.kind]}</span>
            </a>
          ))}
        </div>
      </div>
    ))}
  </div>
)}
```

Where: `dayGroups = groupEventsByDay(monthEvents, todayISO())`, and `eventHref(e)` is:

```tsx
// CalendarEvent.href is already correct per kind (workshop → /workshops?w=<realId>,
// collapsed party summary → /book?date=<date> from groupEventsByDay). Do NOT build
// /workshops?w=${e.id} — event ids are prefixed ("workshop-<id>") and would break
// the deeplink matcher in WorkshopExplorer.
function eventHref(e: CalendarEvent): string | null {
  if (e.kind === 'party-booked') return null // sold out — informational only
  if (e.kind === 'open-studio') return '/open-studio'
  return e.href ?? null
}
```

Render a `<div>` (no link styling/hover) when `eventHref(e)` is null. Below the day cards, ALWAYS render a centered footer button — `Peek at next month →` calling the existing next-month handler — so a visitor landing in the last days of a month isn't stranded with a near-empty list (the list is month-scoped by the existing fetch; this is the accepted mitigation). Month navigation arrows + month title move ABOVE the toggle so they control both views. Reuse the component's existing "today" derivation if it has one; otherwise `todayISO()` = `new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })` (en-CA gives YYYY-MM-DD; America/Chicago because studio-local "today" is what matters).

- [ ] **Step 6: Verify in browser**

Load `/calendar`: list view default — July shows Sat/Sun day cards with "4 party times open"/"2 party times open" rows linking to `/book?date=…`; toggle to Month shows the old grid; arrows page months in both views.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar tests/
git commit -m "feat(whats-on): list-first view with day cards; month grid behind toggle"
```

---

## Task 9: Page title/copy sync for What's On

**Files:**
- Modify: `src/pages/calendar.astro`

**Dependencies:** Task 8

- [ ] **Step 1:** Update the header block: eyebrow `This Month` → `What's On`, h1 stays "What's On at the Studio", subtitle to:

```astro
        Workshops, open studio hours, and open party dates — tap anything to grab your spot
      </p>
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/calendar.astro
git commit -m "feat(whats-on): page copy matches list-first design"
```

---

## Task 10: Full verification pass

**Files:** none (verification only)

**Dependencies:** all previous tasks

- [ ] **Step 1: Static + test gates**

Run: `npm test 2>&1 | tail -3 && npm run build 2>&1 | tail -3`
Expected: 313+ tests green (313 baseline + new view-model tests, minus rewritten WorkshopExplorer assertions), production build succeeds (build is the type gate — repo has no `astro check`).

- [ ] **Step 2: Browser pass (dev server), desktop + mobile width**

Every route, both viewports (~1300px and ~390px):
- `/` — banner, hero, 4 cards, steps, upcoming workshops, visit-us, newsletter; no gallery anywhere
- `/open-studio` — hours + 4 live crafts; nav highlights correctly
- `/workshops` — chronological cards; `?w=<id>` deeplink opens modal
- `/book` — party flow UNTOUCHED end-to-end through the payment step (do not pay); kits teaser present
- `/calendar` — list default, month toggle, month paging
- `/about` — no fake copy
- `/gallery` — redirects to `/`
- `/waiver` — still reachable, now linked from footer
- Header/footer on all: new nav order, CTA pill, waiver + hours in footer; mobile drawer includes CTA

- [ ] **Step 3: Push to dev (free preview deploy)**

```bash
git push origin dev
```

Production merge is Kaden's call (15 credits).

---

## Explicitly OUT of scope (approved)

- Workshops booking-flow push (share links, group signups) — its own future project
- Take-Home Kits as a real purchasable product — teaser only for now
- Real photography + real about story — Kaden supplies after this lands (file-drop, no code)
- Testimonials content — section stays hidden until real quotes exist
- Theme changes — palette, fonts, shimmer, glass all stay
