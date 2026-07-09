# Phase 3: Launch-Week Polish Implementation Plan

> **Roadmap:** docs/plans/2026-07-08-launch-roadmap-README.md ← READ THIS FIRST (shared context, git rules, required inputs)
> **Depends on:** Phase 1 + Phase 2 completed (SeoHead, sitemap, policies/FAQ pages, deposit flow, real catalog).
> **For agents:** Use sdd (sequential). Steps use checkbox (`- [ ]`) syntax. Work on `dev`. Never push `main` without user approval.

**Goal:** Everything a first-time visitor needs in launch week: gift cards, an Open Studio landing page, transparent party pricing examples, a grand-opening announcement banner, and a corporate/group inquiry path.

**Architecture:** All content pages are prerendered static Astro pages using the existing `StaticLayout` + glass styling. The Open Studio page pulls upcoming windows from Square (via the existing `parseOpenStudioWindows` path) at request time — Square remains the scheduling source of truth. The announcement banner is a tiny Astro component in both layouts that self-expires after opening weekend.

**Tech Stack:** Astro 5 SSR, React 19 (no new islands needed), Square catalog data via existing providers.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/config/site.config.ts` | Modify | `giftCardUrl` field; nav tweak |
| `src/pages/gift-cards.astro` | Create | Gift card page (Square hosted eGift link) |
| `src/pages/open-studio.astro` | Create | Open Studio explainer + upcoming windows from Square |
| `src/components/party/PartyLanding.tsx` | Modify | Worked pricing examples |
| `src/components/shared/AnnouncementBanner.astro` | Create | Grand-opening banner (self-expiring) |
| `src/layouts/Layout.astro` | Modify | Mount banner |
| `src/layouts/StaticLayout.astro` | Modify | Mount banner |
| `src/pages/book.astro` | Modify | Corporate/group inquiry section |
| `src/pages/index.astro` | Modify | Offerings card for Open Studio |
| `src/pages/sitemap.xml.ts` | Modify | Add new pages |

Tasks 1, 2, 3, 4, 5 are independent of each other; 6 (verify/deploy) last.

---

### Task 1: Gift cards page

**Files:** Create: `src/pages/gift-cards.astro` · Modify: `src/config/site.config.ts`, `src/pages/sitemap.xml.ts`
**Dependencies:** ⚠️ USER INPUT: the Square hosted eGift ordering URL (Square Dashboard → Payments → Gift Cards → eGift Cards → "ordering page"). If not provided, ship the page with `giftCardUrl: ''` — it renders an email fallback.

- [ ] **Step 1:** In `src/config/site.config.ts`, add to the `SiteConfig` interface (near `contactEmail`):

```ts
  /** Square hosted eGift ordering page URL; empty string hides the buy button. */
  giftCardUrl: string
```

and to the `siteConfig` literal (same area):

```ts
  giftCardUrl: '<URL FROM KADEN or empty string>',
```

- [ ] **Step 2:** Create `src/pages/gift-cards.astro`:

```astro
---
export const prerender = true
import Layout from '@layouts/StaticLayout.astro'
import { siteConfig } from '@config/site.config'
---

<Layout title="Gift Cards" description="Give the gift of making — Homegrown Studio gift cards work for workshops, open studio visits, and parties.">
  <section class="max-w-3xl mx-auto px-4 sm:px-6 py-28 text-center">
    <p class="uppercase tracking-[0.2em] text-xs font-semibold mb-3" style="color: var(--color-accent);">Give Creativity</p>
    <h1 class="text-4xl sm:text-5xl font-heading font-bold mb-6" style="color: var(--color-dark);">Gift Cards</h1>
    <p class="text-lg leading-relaxed mb-10 mx-auto" style="color: var(--color-muted); max-width: 44ch;">
      A Homegrown Studio gift card covers anything we do — an evening workshop,
      an open studio visit, or a chunk of a private party. Delivered by email,
      no expiration.
    </p>
    <div class="glass rounded-2xl px-8 py-12">
      {siteConfig.giftCardUrl ? (
        <a
          href={siteConfig.giftCardUrl}
          class="inline-block rounded-full px-12 py-4 text-white font-semibold text-lg no-underline"
          style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent)); box-shadow: 0 8px 30px rgba(150, 112, 91, 0.3);"
        >
          Buy a Gift Card
        </a>
      ) : (
        <p style="color: var(--color-text);">
          Gift cards are almost here! Email{' '}
          <a href={`mailto:${siteConfig.contactEmail}`} style="color: var(--color-primary);">{siteConfig.contactEmail}</a>{' '}
          and we'll set one up for you personally.
        </p>
      )}
      <p class="mt-6 text-sm" style="color: var(--color-muted);">
        Popular amounts: $50 covers a workshop seat or an open studio craft · $100+ makes a serious dent in a private event.
      </p>
    </div>
  </section>
</Layout>
```

- [ ] **Step 3:** Add `'/gift-cards'` to `PAGES` in `src/pages/sitemap.xml.ts`. Add `{ label: 'Gift Cards', href: '/gift-cards' },` to the `nav` array in `site.config.ts` ONLY if the header still fits on a 390px-wide viewport (check in devtools); otherwise rely on the footer nav (same array — in that case skip the nav change and instead link gift cards from the homepage offerings grid in Task 5).
- [ ] **Step 4:** Verify render; `npm run build`. Commit: `git add -A && git commit -m "feat(content): gift cards page with Square hosted eGift link"`

---

### Task 2: Open Studio landing page (Square-driven dates)

**Files:** Create: `src/pages/open-studio.astro` · Modify: `src/pages/sitemap.xml.ts`

The calendar shows Open Studio windows, but nothing explains what Open Studio *is* or costs. Upcoming windows come from Square at request time — same source the calendar uses (do NOT hardcode dates; Square owns the schedule).

- [ ] **Step 1:** Create `src/pages/open-studio.astro`:

```astro
---
export const prerender = false

import Layout from '@layouts/Layout.astro'
import { providers } from '@config/providers'
import { partyConfig } from '@config/party.config'
import { parseOpenStudioWindows } from '@lib/open-studio'

// Upcoming Open Studio windows straight from Square (programDates custom
// attribute on the Open Studio display item) — capped at 2.5s like other pages.
type Win = { date: string; startTime: string; endTime: string }
let windows: Win[] = []
try {
  const eventTypes = (await Promise.race([
    providers.catalog.getEventTypes(),
    new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 2500)),
  ])) as any[]
  const openStudio =
    eventTypes.find((et: any) => et.id === partyConfig.square.openStudioItemId) ??
    eventTypes.find((et: any) => (et.flow as string) === 'display')
  const today = new Date().toISOString().slice(0, 10)
  windows = parseOpenStudioWindows(openStudio?.programDates ?? '')
    .filter((w) => w.date >= today)
    .slice(0, 12)
} catch {
  // page still renders; the list section shows the fallback copy
}

function fmtDate(ymd: string): string {
  return new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })
}
function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour} ${ampm}` : `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}
---

<Layout title="Open Studio" description="Walk-in crafting at Homegrown Studio in Huntsville — no reservation, no studio fee. Just pick a craft and make.">
  <section class="max-w-4xl mx-auto px-4 sm:px-6 py-28">
    <div class="text-center mb-14 fade-in">
      <p class="uppercase tracking-[0.2em] text-xs font-semibold mb-3" style="color: var(--color-accent);">Walk In & Make</p>
      <h1 class="text-4xl sm:text-5xl lg:text-6xl font-heading font-bold" style="color: var(--color-dark);">Open Studio</h1>
      <p class="text-lg mt-4 max-w-xl mx-auto" style="color: var(--color-muted);">
        No reservation, no schedule, no experience needed. Walk in during an Open
        Studio week, pick a craft, and we'll set you up with everything.
      </p>
    </div>

    <div class="grid gap-5 sm:grid-cols-3 mb-14">
      <div class="glass rounded-2xl p-6 text-center">
        <h3 class="font-heading font-bold text-lg mb-2" style="color: var(--color-dark);">1 · Walk in</h3>
        <p class="text-sm" style="color: var(--color-muted);">Any time we're open during an Open Studio week. Solo, date night, or the whole crew.</p>
      </div>
      <div class="glass rounded-2xl p-6 text-center">
        <h3 class="font-heading font-bold text-lg mb-2" style="color: var(--color-dark);">2 · Pick a craft</h3>
        <p class="text-sm" style="color: var(--color-muted);">No studio fee — just pay for what you make (most crafts $30–50). Stay as long as you like.</p>
      </div>
      <div class="glass rounded-2xl p-6 text-center">
        <h3 class="font-heading font-bold text-lg mb-2" style="color: var(--color-dark);">3 · Take it home</h3>
        <p class="text-sm" style="color: var(--color-muted);">Most pieces go home same-day. Fired pieces are ready about a week later.</p>
      </div>
    </div>

    <div class="glass rounded-2xl p-8">
      <h2 class="text-2xl font-heading font-bold mb-5" style="color: var(--color-dark);">Upcoming Open Studio times</h2>
      {windows.length > 0 ? (
        <ul class="space-y-2">
          {windows.map((w) => (
            <li class="flex justify-between text-base" style="color: var(--color-text);">
              <span>{fmtDate(w.date)}</span>
              <span style="color: var(--color-muted);">{fmtTime(w.startTime)} – {fmtTime(w.endTime)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p style="color: var(--color-muted);">
          Fresh dates are being added — check the <a href="/calendar" style="color: var(--color-primary);">What's On calendar</a>.
        </p>
      )}
      <p class="mt-6 text-sm" style="color: var(--color-muted);">
        We alternate weeks between Open Studio and private parties — the
        <a href="/calendar" style="color: var(--color-primary);"> calendar</a> always shows what's on.
      </p>
    </div>
  </section>
</Layout>
```

Pricing note (owner decision 2026-07-08): **there is NO open-studio studio fee** — visitors pay only for the craft they make, at full per-craft price. Keep all copy consistent with that (here, FAQ, policies, homepage card).

- [ ] **Step 2:** Add `'/open-studio'` to `PAGES` in `src/pages/sitemap.xml.ts`.
- [ ] **Step 3:** Verify: renders with windows (mock mode may show none → fallback copy). `npm run build`. Commit: `git add -A && git commit -m "feat(content): open studio landing page with Square-driven upcoming windows"`

---

### Task 3: Party pricing examples on /book

**Files:** Modify: `src/components/party/PartyLanding.tsx`

- [ ] **Step 1:** In `src/components/party/PartyLanding.tsx`, find the existing pricing callout (~lines 101–124; grep `"$200"` or `craft cost`). Directly below it, add worked examples computed from the pricing lib so they can never drift from checkout math. Add imports (match the file's import style):

```tsx
import { partyTotalCents } from '../../lib/party-pricing'
import { partyConfig } from '../../config/party.config'
```

and the JSX block:

```tsx
      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', margin: '1.5rem 0' }}>
        {[
          { label: 'Small & sweet', people: 8, craft: 3500, craftName: '$35 craft' },
          { label: 'The classic', people: 15, craft: 4500, craftName: '$45 craft' },
          { label: 'Whole-crew', people: 25, craft: 4500, craftName: '$45 craft' },
        ].map((ex) => {
          const total = partyTotalCents(ex.craft, ex.people)
          return (
            <div
              key={ex.label}
              style={{
                padding: '1.25rem',
                borderRadius: '1rem',
                background: 'rgba(255,255,255,0.65)',
                border: '1px solid rgba(150,112,91,0.12)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--color-dark)' }}>{ex.label}</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--color-muted)', margin: '0.25rem 0 0.5rem' }}>
                {ex.people} guests · {ex.craftName}
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                ${(total / 100).toFixed(0)}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>
                ≈ ${(total / 100 / ex.people).toFixed(0)}/guest · ${(Math.round(total * (partyConfig.depositPct / 100)) / 100).toFixed(0)} deposit today
              </div>
              {ex.people >= 11 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--color-accent)', marginTop: '0.25rem' }}>
                  includes group discount
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', textAlign: 'center' }}>
        $200 studio rental + your chosen craft per guest. Groups of 11+ get 25% off
        the craft portion, 21+ get 50% off. Crafts run about $30–50 per guest.
      </p>
```

- [ ] **Step 2:** Verify `/book` shows three example cards with sane numbers (8×$35 → $460 total; 15×$45 → $200+10×45+5×33.75 = $818.75 → "$819"). `npm run build && npm test`.
- [ ] **Step 3:** Commit: `git commit -am "feat(party): worked pricing examples on booking landing"`

---

### Task 4: Grand-opening announcement banner

**Files:** Create: `src/components/shared/AnnouncementBanner.astro` · Modify: `src/layouts/Layout.astro`, `src/layouts/StaticLayout.astro`

- [ ] **Step 1:** Create `src/components/shared/AnnouncementBanner.astro`:

```astro
---
import { siteConfig } from '@config/site.config'

// Self-expires two days after opening; server-rendered so no layout shift.
const opening = new Date(`${siteConfig.openingDate}T00:00:00-05:00`)
const expiry = new Date(opening.getTime() + 2 * 86_400_000)
const now = new Date()
const show = now < expiry
const preOpening = now < opening
---

{show && (
  <div class="announce" role="status">
    {preOpening ? (
      <span>
        🎉 <strong>Grand opening Friday, July 31!</strong> Parents' Night Out 6–9pm —{' '}
        <a href="/calendar">see what's on</a>
      </span>
    ) : (
      <span>
        🎉 <strong>We're open!</strong> Come make something with us —{' '}
        <a href="/calendar">see what's on</a>
      </span>
    )}
  </div>
)}

<style>
  .announce {
    text-align: center;
    padding: 0.55rem 1rem;
    font-size: 0.875rem;
    color: #fff;
    background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
  }
  .announce a {
    color: #fff;
    text-decoration: underline;
  }
</style>
```

- [ ] **Step 2:** In BOTH `src/layouts/Layout.astro` and `src/layouts/StaticLayout.astro`: add the import `import AnnouncementBanner from '@components/shared/AnnouncementBanner.astro'` and place `<AnnouncementBanner />` in the `<body>` immediately BEFORE `<Header transition:persist />`.
- [ ] **Step 3:** Verify banner shows on every page above the header; check the hero's `min-height: calc(100vh - 4.5rem)` still looks right (the banner adds ~2.2rem — acceptable; if the hero clips, change that calc to `calc(100vh - 7rem)` in `src/pages/index.astro`). `npm run build`.
- [ ] **Step 4:** Commit: `git add -A && git commit -m "feat(launch): self-expiring grand-opening announcement banner"`

---

### Task 5: Corporate/group inquiry + homepage Open Studio card

**Files:** Modify: `src/pages/book.astro`, `src/pages/index.astro`

- [ ] **Step 1:** In `src/pages/book.astro`, after the `<PartyLanding client:load />` line, add:

```astro
    <div class="glass rounded-2xl max-w-2xl mx-auto mt-14 px-8 py-10 text-center">
      <h2 class="text-2xl font-heading font-bold mb-3" style="color: var(--color-dark);">
        Corporate event or group of 20+?
      </h2>
      <p class="mb-6" style="color: var(--color-muted);">
        Team building, showers, church groups, off-site events — we'll build a
        custom quote around your group and craft.
      </p>
      <a
        href={`mailto:hello@homegrowncraftstudio.com?subject=${encodeURIComponent('Group event inquiry')}`}
        class="inline-block rounded-full px-10 py-3.5 text-white font-semibold no-underline"
        style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent));"
      >
        Email us for a quote
      </a>
    </div>
```

- [ ] **Step 2:** In `src/pages/index.astro`, the offerings array (frontmatter) has entries for Parties / Workshops / Programs / Gallery. Add an Open Studio entry between Workshops and Programs:

```ts
  {
    title: 'Open Studio',
    description: 'Walk in during Open Studio weeks — no reservation, no studio fee. Just pay for the craft you make.',
    href: '/open-studio',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-10 h-10"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>`,
    primary: false,
  },
```

(Plain object entry — no `features.` guard needed; Open Studio is always offered. Note the grid is `sm:grid-cols-2`; five cards means one hangs alone on the last row — acceptable, or add `lg:grid-cols-3` to the grid classes for a 3+2 layout.)

- [ ] **Step 3:** Verify homepage + `/book`; `npm run build && npm test`.
- [ ] **Step 4:** Commit: `git commit -am "feat(content): open studio homepage card, corporate inquiry block"`

---

### Task 6: Full verification, push dev, propose production deploy

- [ ] **Step 1:** `npm run build && npm test`.
- [ ] **Step 2:** Manual pass (`npm run dev`): `/gift-cards`, `/open-studio` (dates or fallback), `/book` (examples + corporate block), homepage (5 offering cards incl. Open Studio), banner on all pages, sitemap includes all new URLs.
- [ ] **Step 3:** Cross-page consistency check: "no studio fee, pay per craft" and the $30–50 craft range appear in FAQ (Phase 2), `/open-studio`, and the homepage card — confirm all three say the same thing.
- [ ] **Step 4:** `git push origin dev`; verify preview.
- [ ] **Step 5:** **STOP — ask the user** to approve the production deploy (15 credits). This is the launch-week deploy; aim for a few days BEFORE July 31, not the morning of.
- [ ] **Step 6:** Remaining gallery item: real studio photos to replace `public/images/gallery/*.svg` placeholders (needs photos from Kaden — when provided, drop them in `src/content/` gallery collection per the existing markdown items' format and use descriptive alt text). Note in the final report if still outstanding.
