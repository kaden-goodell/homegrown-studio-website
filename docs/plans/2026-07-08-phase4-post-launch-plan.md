# Phase 4: Post-Launch Hardening & Experiment Implementation Plan

> **Roadmap:** docs/plans/2026-07-08-launch-roadmap-README.md ← READ THIS FIRST (shared context, git rules)
> **Depends on:** Phases 1–3 deployed. This phase runs in August 2026, after opening.
> **For agents:** Use sdd (sequential). Steps use checkbox (`- [ ]`) syntax. Work on `dev`. Never push `main` without user approval.

**Goal:** Cut Square API load with caching, validate API inputs, add Event structured data for workshops, shrink oversized assets, and write the runbook the owners will use to decide the open-studio-vs-party experiment.

**Architecture:** A tiny in-memory TTL cache wraps the hottest read paths (safe on Netlify: each function instance keeps its own cache; a cold start just misses once). Zod validates the two money-handling POST bodies. The experiment runbook is a doc, not code — the schedule itself lives in Square (owner decision 2026-07-08), so the runbook reads Square data via `scripts/revenue-report.mjs`.

**Tech Stack:** Astro 5 SSR, zod (new dep), vitest.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/ttl-cache.ts` | Create | Generic in-memory TTL cache |
| `tests/lib/ttl-cache.test.ts` | Create | Cache behavior |
| `src/lib/calendar-events.ts` | Modify | Cache month events (60s) |
| `src/pages/api/workshops.json.ts` | Modify | Cache workshop list (5 min) |
| `src/pages/workshops.astro` | Modify | Share cached list + Event JSON-LD |
| `src/lib/validation.ts` | Create | Zod schemas for booking POST bodies |
| `src/pages/api/party/book.json.ts` | Modify | Zod-validate body |
| `src/pages/api/workshops/book.json.ts` | Modify | Zod-validate body |
| `package.json` | Modify | zod dependency |
| `public/favicon.png` | Modify | Shrink 812KB → <20KB |
| `docs/experiment-runbook.md` | Create | How to decide the A/B experiment |

---

### Task 1: TTL cache (TDD)

**Files:** Create: `src/lib/ttl-cache.ts`, `tests/lib/ttl-cache.test.ts`

- [ ] **Step 1: Failing test** — `tests/lib/ttl-cache.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { TtlCache } from '@lib/ttl-cache'

describe('TtlCache', () => {
  it('returns cached value within TTL and refetches after expiry', async () => {
    vi.useFakeTimers()
    const cache = new TtlCache<string>(1000)
    let calls = 0
    const fetcher = async () => `v${++calls}`

    expect(await cache.get('k', fetcher)).toBe('v1')
    expect(await cache.get('k', fetcher)).toBe('v1') // cached
    vi.advanceTimersByTime(1500)
    expect(await cache.get('k', fetcher)).toBe('v2') // expired → refetch
    vi.useRealTimers()
  })

  it('does not cache failures', async () => {
    const cache = new TtlCache<string>(1000)
    let calls = 0
    const flaky = async () => {
      calls++
      if (calls === 1) throw new Error('boom')
      return 'ok'
    }
    await expect(cache.get('k', flaky)).rejects.toThrow('boom')
    expect(await cache.get('k', flaky)).toBe('ok')
  })

  it('deduplicates concurrent fetches for the same key', async () => {
    const cache = new TtlCache<string>(1000)
    let calls = 0
    const slow = () => new Promise<string>((r) => setTimeout(() => r(`v${++calls}`), 10))
    const [a, b] = await Promise.all([cache.get('k', slow), cache.get('k', slow)])
    expect(a).toBe('v1')
    expect(b).toBe('v1')
    expect(calls).toBe(1)
  })
})
```

- [ ] **Step 2:** Run: `npx vitest run tests/lib/ttl-cache.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** — `src/lib/ttl-cache.ts`:

```ts
/**
 * Minimal in-memory TTL cache with in-flight deduplication. Per-instance on
 * Netlify functions (cold starts miss once) — good enough to keep repeated
 * page loads from hammering Square. Not for correctness-critical data.
 */
interface Entry<T> {
  value: T
  expiresAt: number
}

export class TtlCache<T> {
  private store = new Map<string, Entry<T>>()
  private inflight = new Map<string, Promise<T>>()

  constructor(private ttlMs: number) {}

  async get(key: string, fetcher: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key)
    if (hit && hit.expiresAt > Date.now()) return hit.value

    const pending = this.inflight.get(key)
    if (pending) return pending

    const p = fetcher()
      .then((value) => {
        this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs })
        return value
      })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, p)
    return p
  }

  invalidate(key?: string): void {
    if (key === undefined) this.store.clear()
    else this.store.delete(key)
  }
}
```

- [ ] **Step 4:** Run: `npx vitest run tests/lib/ttl-cache.test.ts` — Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat(perf): in-memory TTL cache with inflight dedup"`

---

### Task 2: Cache the hot read paths

**Files:** Modify: `src/lib/calendar-events.ts`, `src/pages/api/workshops.json.ts`
**Dependencies:** Task 1

One calendar page view currently triggers 4+ live Square calls; the workshop list refetches on every visit.

- [ ] **Step 1:** In `src/lib/calendar-events.ts`, add:

```ts
import { TtlCache } from '@lib/ttl-cache'

const monthCache = new TtlCache<CalendarEvent[]>(60_000)
```

(match the events type actually used in the file — if Phase 1 fell back to `ReturnType<typeof buildCalendarEvents>`, reuse that). Rename the existing exported function to `fetchMonthEvents` (not exported) and export a cached wrapper preserving the old name so callers don't change:

```ts
export function getMonthEvents(month: string): Promise<CalendarEvent[]> {
  return monthCache.get(month, () => fetchMonthEvents(month))
}
```

- [ ] **Step 2:** In `src/pages/api/workshops.json.ts`, wrap the fetch:

```ts
import { TtlCache } from '@lib/ttl-cache'
import type { WorkshopData } from '@components/workshops/WorkshopExplorer'

const workshopCache = new TtlCache<WorkshopData[]>(300_000)
```

and inside the GET handler replace the try body's fetch with:

```ts
    workshops = await workshopCache.get('all', async () => {
      const list = await providers.workshop.listWorkshops()
      return list.map(toWorkshopData)
    })
```

(keep the surrounding try/catch and logging; adjust the `workshops` variable's type to `WorkshopData[]`).

- [ ] **Step 3:** Trade-off note (leave as a comment where the caches are created): availability/booked-party data inside month events can be up to 60s stale — acceptable; Square rejects genuinely unavailable bookings at create time.
- [ ] **Step 4:** `npm run build && npm test`. Verify: `npm run dev`, load `/calendar` twice — server logs show Square calls only on the first load within a minute.
- [ ] **Step 5:** Commit: `git commit -am "perf(square): cache month events (60s) and workshop list (5m)"`

---

### Task 3: Zod validation on money-handling endpoints

**Files:** Create: `src/lib/validation.ts` · Modify: `src/pages/api/party/book.json.ts`, `src/pages/api/workshops/book.json.ts`, `package.json`

- [ ] **Step 1:** `npm install zod`
- [ ] **Step 2:** Create `src/lib/validation.ts`:

```ts
import { z } from 'zod'
import { partyConfig } from '../config/party.config'

export const partyBookSchema = z.object({
  startTime: z.string().datetime({ offset: true }).or(z.string().datetime()),
  serviceVariationId: z.string().min(1),
  serviceVariationVersion: z.number().int().positive(),
  durationMinutes: z.number().int().min(30).max(480),
  craft: z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(120),
    perHeadCents: z.number().int().min(0).max(50_000),
  }),
  people: z.number().int().min(1).max(partyConfig.maxGuests),
  customer: z.object({
    firstName: z.string().min(1).max(80),
    lastName: z.string().min(1).max(80),
    email: z.string().email(),
    phone: z.string().max(30).optional().default(''),
  }),
  paymentToken: z.string().min(1),
})

export const workshopBookSchema = z.object({
  classScheduleId: z.string().min(1),
  startAt: z.string().min(1),
  seats: z.number().int().min(1).max(20).optional().default(1),
  customer: z.object({
    givenName: z.string().min(1).max(80),
    familyName: z.string().max(80).optional().default(''),
    email: z.string().email(),
  }),
  paymentToken: z.string().min(1),
  verificationToken: z.string().optional(),
})
```

- [ ] **Step 3:** In `src/pages/api/party/book.json.ts`, import `partyBookSchema` and replace the manual validation block (everything from `// --- Validation ---` through the `maxGuests` check) with:

```ts
  const parsed = partyBookSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(`${first.path.join('.')}: ${first.message}`, 400)
  }
  const data = parsed.data
  const people = data.people
```

then replace subsequent `body.` references in the handler with `data.` (grep `body\.` in the file — `data` is the validated, defaulted version). Field-shape note: `customer.email` etc. match the existing `BookRequest` interface, which can be deleted in favor of `z.infer<typeof partyBookSchema>`.

- [ ] **Step 4:** In `src/pages/api/workshops/book.json.ts`, same pattern with `workshopBookSchema`: replace the manual `if (!classScheduleId ...)` checks; destructure from `parsed.data`. The existing `seatCount` clamp becomes unnecessary (schema enforces 1–20) but is harmless to keep.
- [ ] **Step 5:** `npm run build && npm test` — if API tests in `tests/api/` assert the old error message strings, update those expectations to the new `field: message` format.
- [ ] **Step 6:** Commit: `git add -A && git commit -m "feat(api): zod validation on booking endpoints"`

---

### Task 4: Event JSON-LD for workshops

**Files:** Modify: `src/pages/workshops.astro`
**Dependencies:** Phase 1 Task 8 (SSR `initialWorkshops` exists in this page's frontmatter)

- [ ] **Step 1:** In `src/pages/workshops.astro` frontmatter, after `initialWorkshops` is populated, add:

```ts
const eventsLd = initialWorkshops.slice(0, 20).map((w) => ({
  '@context': 'https://schema.org',
  '@type': 'Event',
  name: w.name,
  description: w.description,
  startDate: `${w.date}T${w.startTime}`,
  eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
  eventStatus: 'https://schema.org/EventScheduled',
  location: {
    '@type': 'Place',
    name: 'Homegrown Studio',
    address: { '@type': 'PostalAddress', addressLocality: 'Huntsville', addressRegion: 'AL', addressCountry: 'US' },
  },
  offers: {
    '@type': 'Offer',
    price: (w.price / 100).toFixed(2),
    priceCurrency: w.currency || 'USD',
    availability:
      w.remainingSeats === 0
        ? 'https://schema.org/SoldOut'
        : 'https://schema.org/InStock',
    url: `https://homegrowncraftstudio.com/workshops?w=${w.id}`,
  },
}))
```

Check the actual `WorkshopData` field shapes first (`grep -A8 "interface WorkshopData" src/components/workshops/WorkshopExplorer.tsx`): `date` is a string, `startTime` a string, `price` a number — verify whether `price` is cents or dollars by looking at `toWorkshopData` in `src/components/workshops/workshop-view-model.ts`, and adjust the `price` line accordingly (schema.org wants decimal dollars).

- [ ] **Step 2:** In the template, directly after `<Layout ...>`, add:

```astro
  {eventsLd.length > 0 && <script type="application/ld+json" set:html={JSON.stringify(eventsLd)} />}
```

- [ ] **Step 3:** Verify: `curl -s localhost:4321/workshops | grep -c '"@type":"Event"'` ≥ 1 (mock mode provides sample workshops). Paste one page's JSON-LD into https://validator.schema.org if possible. `npm run build`.
- [ ] **Step 4:** Commit: `git commit -am "feat(seo): Event JSON-LD for upcoming workshops"`

---

### Task 5: Asset diet

**Files:** Modify: `public/favicon.png`

- [ ] **Step 1:** The favicon is 812KB. Shrink it (macOS built-in):

```bash
cp public/favicon.png /tmp/favicon-original.png
sips -Z 180 public/favicon.png --out public/favicon.png
ls -la public/favicon.png
```

Expected: < 60KB (typically ~15–30KB at 180px). The `<link rel="icon">` in the layouts needs no change.

- [ ] **Step 2:** Check remaining oversized assets: `find public src -type f \( -name '*.png' -o -name '*.jpg' \) -size +200k` — report anything found (gallery photos, if Phase 3 added them, should be resized to ≤1600px wide with `sips -Z 1600`).
- [ ] **Step 3:** Commit: `git add public && git commit -m "perf(assets): shrink favicon from 812KB"`

---

### Task 6: Experiment runbook

**Files:** Create: `docs/experiment-runbook.md`

- [ ] **Step 1:** Create `docs/experiment-runbook.md`:

```markdown
# Open Studio vs. Party — Experiment Runbook

**Question:** Which earns more per week of studio time: Open Studio (walk-in) weeks
or Party (private booking) weeks? Workshops run every week and are excluded from
the comparison. The schedule itself is managed in Square (party availability via
Square Appointments; open-studio dates via the Open Studio item's `programDates`).

## Weekly ritual (5 minutes, every Monday)

1. Run: `npm run revenue-report -- <experiment-start> <yesterday>`
2. Copy the new week's row into the tracking table below.
3. Cross-check the inferred week type against what was actually scheduled in Square.
4. Add context notes (weather, holiday, promo, school calendar) — these explain outliers.

## Tracking table

| Week of | Type | Party $ (deposits) | POS $ (~open studio + balances + retail) | Online $ (~workshops) | Slots offered | Slots booked | Notes |
|---------|------|-----|-----|-----|----|----|-------|
| | | | | | | | |

"Slots offered/booked" comes from the Square Appointments calendar for party weeks
(count offered party start times vs. booked ones). It distinguishes weak demand
from constrained supply.

## Reading the numbers honestly

- **Don't decide before 3–4 weeks of EACH type** (6–8 weeks total). One birthday
  party can be a whole week's revenue; walk-in traffic ramps with awareness.
- **Open studio starts handicapped.** A brand-new studio has no walk-in habit yet.
  If open-studio weeks trend UP week-over-week, that's a growth signal even if
  party weeks still win on totals.
- **Compare margin, not just revenue.** Party craft costs at the 50%-off tier have
  thin material margins; open-studio crafts sell at full per-craft price (no studio
  fee, no volume discount), so per-piece margins are healthier.
  Approximate contribution: revenue − materials (track material cost per craft once).
- **Watch fill rate.** If party weeks book 100% of offered slots with lead time,
  demand exceeds supply — the true party ceiling is higher than measured.
- **POS is a proxy.** POS bucket = open-studio craft sales + party balances
  + retail. On party weeks, subtract known party balances (each booking's
  `specialRequests` JSON records `balanceDueCents`) before crediting POS to
  "open studio".

## Decision framework (after ≥3 weeks of each)

- Party weeks ≥ 2× open-studio weeks on contribution AND fill rate < 80% →
  shift toward more party weeks (e.g. 2-of-3), keep 1 open-studio week for
  community/funnel.
- Open studio within ~25% of party weeks and trending up → keep alternating
  another month; open studio also feeds workshop signups and party leads (track
  "how did you hear about us" at POS).
- Party fill rate ~100% with waitlist-ish demand → raise party pricing (base
  $200 → $250, or trim the 21+ discount from 50% → 40%) before adding weeks.
- Whatever wins: don't zero out the loser instantly — announce schedule changes
  2+ weeks ahead; update the FAQ ("Why can't I book a party this week?"), the
  /open-studio page copy, and the calendar legend note to match the new cadence.

## Ending or changing the experiment

All schedule changes happen in Square (availability + programDates). The app
adapts automatically. Copy that mentions "we alternate weeks" lives in:
`src/pages/faq.astro`, `src/pages/open-studio.astro`, the PartyModal empty-date
message, and the WhatsOnCalendar legend note — update all four when the cadence
changes.
```

- [ ] **Step 2:** Commit: `git add docs/experiment-runbook.md && git commit -m "docs: open-studio vs party experiment runbook"`

---

### Task 7: Verification + backlog handoff

- [ ] **Step 1:** `npm run build && npm test` — pass. Push dev, verify preview, and (user approval) production deploy alongside the next content update — Phase 4 changes alone may not justify 15 credits; batching with a content change is fine.
- [ ] **Step 2:** Record the remaining known backlog in the final report to the user (not implemented in any phase, deliberately):
  - Consolidate Square booking custom attributes into one JSON blob (10-definition cap is maxed)
  - Retry/backoff on Square 429s; startup config validation (webhook key, catalog IDs)
  - Email confirmations/reminders via Resend (dependency already installed)
  - Admin dashboard (admin.homegrowncraftstudio.com — see project memory)
  - Memberships / "maker pass" once open-studio demand is proven
  - Session replay/heatmaps via PostHog toggle
  - `astro:assets` image pipeline if photo count grows
