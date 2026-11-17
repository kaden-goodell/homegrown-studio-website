# Private Event Quotes Implementation Plan

> **Spec:** docs/plans/2026-11-17-event-value-quote-spec.md
> **PRD:** docs/plans/2026-11-17-event-value-quote-prd.md
> **Design:** https://claude.ai/artifact/HkGgP7AZV8GKChJAA7ZMFi (artboard "C · The Invitation"; source files in the canvas `project/Invitation.dc.html`)
> **For agents:** Use team-dev (parallel) or sdd (sequential) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Follow the `tdd` skill: failing test first.

**Goal:** Owners turn a private-event request into an invitation-style quote page with up to three packages; the customer pays a deposit and it becomes a booked party of ours.

**Architecture:** New `src/lib/quotes/` module (pure math + stores + lifecycle), quotes stored in Postgres via `PG_STORES`, every quote write under `withPartyLock(quote.partyId)`. Holds live in the existing party book under the party id minted at draft. Payment reuses the pay-link core (`payBalance`) by creating the party record with a single unpaid deposit item first.

**Tech Stack:** Astro SSR routes, React islands, Netlify Blobs/Postgres kv (`makeKvStore`), Square REST/SDK, vitest + jsdom.

**Plan form (time-boxed, Kaden 2026-11-17 "build it today"):** Task 1 fixes the shared types and pure math in full. Later tasks give exact files, the spec items they own, concrete test cases with expected values, and the existing functions to call. Implementers write the code against Task 1's types and the named existing APIs; every task still starts with its failing tests.

**Commands:** single test file `npx vitest run <path>`; all tests `npm test`; types `npx tsc --noEmit` (compare error count with the baseline taken in Task 0, don't add new ones).

---

## Milestone Map

| Milestone | Done when | Last tasks |
|-----------|-----------|------------|
| m1 · Quote menu loaded from Square, saved packages work on dev | T3, T9, T12 pass review | T12 |
| m2 · Make and send a quote on dev | T6, T9, T13 pass review | T13 |
| m3 · Customer page and deposit on dev | T7, T10, T14 pass review + $1 card on preview | T14, T16 |
| m4 · PDF flyer on dev | T15 passes review | T15 |
| m5 · Catherine's iPad trial | Out of plan scope (a person) | — |
| m6 · Live on the site | Out of plan scope (Kaden's go) | — |

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/quotes/types.ts` | Create | All quote types and settings defaults (T1) |
| `src/lib/quotes/money.ts` | Create | normalPerPerson, offPct, meter, total, deposit, priceKey (T1) |
| `src/lib/quotes/draft.ts` | Create | targetFor, tierPrices, draftTiers (T1) |
| `src/lib/quotes/menu-store.ts` | Create | quote-menu store: items, packages, settings (T2) |
| `src/lib/quotes/quote-store.ts` | Create | quotes store: q-/t-/r- keys, CAS update, lock wrapper (T2) |
| `src/lib/db/pg-stores.ts` | Modify | add `quotes` (T2) |
| `src/lib/quotes/square-sync.ts` | Create | full-catalog sync merge (T3) |
| `src/lib/quotes/cost-import.ts` | Create | apply `scripts/data/cafe-costs.json` (T3) |
| `scripts/data/cafe-costs.json` | Add (exists, untracked) | café material costs (T3) |
| `src/lib/quotes/holds.ts` | Create | hold transitions table (T4) |
| `src/lib/classes/studio-schedule.ts` | Modify | label quote holds (T4) |
| `src/lib/class-guard.ts` | Modify | warn on live quote holds (T4) |
| `src/lib/party-store.ts` | Modify | `origin`, `quote`, `place`, `address`; item kind `'quote'` (T5a) |
| `src/lib/parties/{pricing,payment-link,staff-money,admin-actions}.ts`, `src/lib/{email,party-terms,party-register}.ts`, `src/pages/api/party/balance.json.ts`, refund-line helper | Modify | quote-party branches (T5a) |
| `src/components/admin/parties/PartySheet.tsx`, `src/components/party/{PartyPayPanel,PartyDashboard}.tsx`, `src/components/staff/{Roster,ThisWeek,Today}.tsx` (whichever list parties) | Modify | quote-party display (T5b) |
| `src/lib/quotes/admin-quotes.ts` | Create | draft/save/send/resend/withdraw/reopen (T6) |
| `src/lib/quotes/messages.ts` | Create | link text + email, owner texts (T6) |
| `src/lib/quotes/pay.ts` | Create | deposit pay flow (T7) |
| `src/lib/quotes/public-view.ts` | Create | public view, pick, view counting (T8) |
| `src/pages/api/admin/quote-menu.json.ts` | Create | menu/packages/settings route (T9) |
| `src/pages/api/admin/quotes/{draft,by-request,save,send,action}.json.ts` | Create | admin quote routes (T9) |
| `src/pages/api/quote/{view,pick,pay}.json.ts` | Create | public routes (T10) |
| `src/pages/api/jobs/waitlist-sweep.json.ts` | Modify | expiry texts (T11) |
| `src/components/admin/quotes/QuoteMenuPage.tsx` (+ `ItemEditor.tsx`, `api.ts`) | Create | Quote menu under More (T12) |
| `src/components/admin/shell/router.ts`, `AdminShell.tsx`, `More.tsx` | Modify | `quote-<requestId>` sheet, `more-quote-menu` (T12, T13) |
| `src/components/admin/quotes/QuoteSheet.tsx` (+ `TierCard.tsx`, `AddLinePicker.tsx`) | Create | quote editor (T13) |
| `src/components/admin/inbox/{InboxSheets.tsx,describe.ts}` | Modify | Make/Open quote, chip, Next hint (T13) |
| `src/pages/quote/[token].astro`, `src/components/quote/QuotePage.tsx` (+ `quote.css`) | Create | customer page (T14) |
| `src/layouts/Layout.astro` / `isPrivatePartyPage` helper | Modify | `/quote/` private path (T14) |
| `src/pages/admin/quote/[id]/flyer.ts`, `src/lib/quotes/flyer.ts` | Create | printable flyer (T15) |
| `tests/lib/quotes/*.test.ts`, `tests/api/quote-*.test.ts`, `tests/components/quotes/*.test.tsx` | Create | tests per task |

## Dependency waves
- **Wave 0:** T0 → T1 → T2
- **Wave 1 (parallel):** T3, T4, T5a
- **Wave 2 (parallel):** T5b (T5a), T6 (T2,T4), T7 (T2,T4,T5a), T8 (T2)
- **Wave 3 (parallel):** T9 (T3,T6), T10 (T7,T8), T11 (T6), T15 (T8)
- **Wave 4 (parallel):** T12 (T9) owns ALL router.ts/AdminShell.tsx edits (adds both `more-quote-menu` and the `quote` sheet kind with a stub); T14 (T10)
- **Wave 5:** T13 (T12) fills the quote sheet
- **Wave 5:** T16 (all)

---

### Task 0: Baseline

- [ ] **Step 1:** `npm test 2>&1 | tail -5` and `npx tsc --noEmit 2>&1 | grep -c "error TS"`; record both numbers in the build log. Nothing to commit.

### Task 1: Shared types and pure math (S-22..S-29, S-24, S-28)

**Files:** Create `src/lib/quotes/types.ts`, `src/lib/quotes/money.ts`, `src/lib/quotes/draft.ts`; Test `tests/lib/quotes/money.test.ts`, `tests/lib/quotes/draft.test.ts`
**Dependencies:** T0

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/quotes/money.test.ts
import { describe, it, expect } from 'vitest'
import { normalPerPerson, offPct, meterOf, totalCents, depositCents, priceKey } from '@lib/quotes/money'
import { DEFAULT_SETTINGS, type Tier } from '@lib/quotes/types'

const tier = (lines: Tier['lines'], priceCents: number): Tier =>
  ({ id: 't1', key: 'pick', name: 'T', photoUrl: null, hidden: false, lines, priceCents })

describe('quote money', () => {
  it('adds per-event lines divided by guests, rounded up', () => {
    const t = tier([
      { itemId: 'a', label: 'Terrarium', photoUrl: null, cents: 4500, per: 'person', costCents: 900 },
      { itemId: 'b', label: 'Travel', photoUrl: null, cents: 5000, per: 'event', costCents: null },
    ], 4000)
    expect(normalPerPerson(t, 30)).toBe(4500 + 167) // ceil(5000/30)=167
  })
  it('offPct is 1 - price/normal', () => {
    const t = tier([{ itemId: 'a', label: 'x', photoUrl: null, cents: 10000, per: 'person', costCents: null }], 7500)
    expect(offPct(t, 10)).toBeCloseTo(0.25)
  })
  it('meter: <20 green, 20..25 yellow, >25 red', () => {
    expect(meterOf(0.19, DEFAULT_SETTINGS)).toBe('green')
    expect(meterOf(0.20, DEFAULT_SETTINGS)).toBe('yellow')
    expect(meterOf(0.25, DEFAULT_SETTINGS)).toBe('yellow')
    expect(meterOf(0.30, DEFAULT_SETTINGS)).toBe('red')
    expect(meterOf(0.30, { ...DEFAULT_SETTINGS, capPct: 30 })).toBe('yellow')
  })
  it('total and 50% deposit', () => {
    expect(totalCents(7500, 30)).toBe(225000)
    expect(depositCents(225000, 50)).toBe(112500)
    expect(depositCents(1001, 50)).toBe(501)
  })
  it('priceKey changes with price, not with note', () => {
    const base = { guests: 30, depositPct: 50, startIso: '2026-12-11T00:00:00Z', place: 'studio' as const }
    const t = tier([{ itemId: 'a', label: 'x', photoUrl: null, cents: 100, per: 'person', costCents: null }], 90)
    const k1 = priceKey({ ...base, tiers: [t] })
    expect(priceKey({ ...base, tiers: [{ ...t, priceCents: 80 }] })).not.toBe(k1)
    expect(priceKey({ ...base, tiers: [t] })).toBe(k1)
  })
})
```

```ts
// tests/lib/quotes/draft.test.ts
import { describe, it, expect } from 'vitest'
import { targetFor, tierPrices, draftTiers } from '@lib/quotes/draft'
import { DEFAULT_SETTINGS, type MenuItem } from '@lib/quotes/types'
import { normalPerPerson } from '@lib/quotes/money'

const item = (id: string, cents: number, tags: string[] = []): MenuItem =>
  ({ id, source: 'own', name: id, photoUrl: null, cents, per: 'person', costCents: null, tags, hidden: false, updatedAt: '' })

describe('draft', () => {
  it('target = budget midpoint / guests, rounded to the dollar', () => {
    expect(targetFor('1000-2500', 25)).toBe(7000)
    expect(targetFor('under-1000', 20)).toBe(2500)
    expect(targetFor('2500-plus', 40)).toBe(7500)
    expect(targetFor('', 25)).toBeNull()
  })
  it('tier prices are 80/100/130% rounded to the dollar', () => {
    expect(tierPrices(7000)).toEqual({ simple: 5600, pick: 7000, all: 9100 })
  })
  it('fills each tier up to price/(1-cap) and omits empty tiers', () => {
    const menu = [item('terr', 4500, ['adults']), item('ear', 3000, ['adults']), item('felt', 800), item('big', 20000)]
    const tiers = draftTiers({ menu, targetCents: 7000, guests: 25, crafters: 'adults', month: 12, theme: '' }, DEFAULT_SETTINGS)
    for (const t of tiers) expect(normalPerPerson(t, 25)).toBeLessThanOrEqual(Math.floor(t.priceCents / 0.75))
    expect(tiers.map(t => t.key)).toEqual(['simple', 'pick', 'all'])
    expect(tiers.every(t => t.lines.length > 0)).toBe(true)
    expect(draftTiers({ menu: [item('big', 20000)], targetCents: 7000, guests: 25, crafters: 'adults', month: 3, theme: '' }, DEFAULT_SETTINGS)).toEqual([])
  })
  it('prefers items tagged for the crafters and holiday in Nov-Dec', () => {
    const menu = [item('kidsthing', 3000, ['kids']), item('adultthing', 3000, ['adults']), item('xmas', 3000, ['holiday'])]
    const [simple] = draftTiers({ menu, targetCents: 3000, guests: 10, crafters: 'adults', month: 12, theme: '' }, DEFAULT_SETTINGS)
    expect(simple.lines[0].itemId === 'adultthing' || simple.lines[0].itemId === 'xmas').toBe(true)
  })
})
```

- [ ] **Step 2:** Run `npx vitest run tests/lib/quotes` → FAIL (modules not found).

- [ ] **Step 3: Implement**

```ts
// src/lib/quotes/types.ts
export type Per = 'person' | 'event'
export interface MenuItem {
  id: string; source: 'square' | 'own'; squareItemId?: string; squareVariationId?: string
  name: string; photoUrl: string | null; cents: number; per: Per; costCents: number | null
  tags: string[]; hidden: boolean; gone?: boolean; updatedAt: string
}
export interface QuoteLine { itemId: string | null; label: string; photoUrl: string | null; cents: number; per: Per; costCents: number | null }
export type TierKey = 'simple' | 'pick' | 'all' | 'custom'
export interface Tier { id: string; key: TierKey; name: string; photoUrl: string | null; hidden: boolean; lines: QuoteLine[]; priceCents: number }
export interface SavedPackage { id: string; name: string; photoUrl: string | null; lines: QuoteLine[]; savedAt: string; by: string }
export interface QuoteSettings { capPct: number; yellowFromPct: number; depositPct: number; expiryDays: number; updatedAt: string }
export const DEFAULT_SETTINGS: QuoteSettings = { capPct: 25, yellowFromPct: 20, depositPct: 50, expiryDays: 14, updatedAt: '' }
export type Crafters = 'kids' | 'adults' | 'both'
export type QuoteStatus = 'draft' | 'sent' | 'picked' | 'paying' | 'paid' | 'withdrawn'
export interface Quote {
  id: string; requestId: string; partyId: string; token: string; version: number; priceKey: string
  status: QuoteStatus; place: 'studio' | 'away'; address: string
  startIso: string | null; endIso: string | null; guests: number; crafters: Crafters
  targetCents: number; note: string; depositPct: number; expiresAt: string; tiers: Tier[]; held: boolean
  sentAt?: string; sentBy?: string; updatedAt?: string; views: number; lastViewedAt?: string
  pickedTierId?: string; paying?: { attemptId: string; at: string }; paidAt?: string; expiryTold?: boolean
  history: { at: string; by: string; what: string }[]
}
export type Meter = 'green' | 'yellow' | 'red'
export const BUDGET_MIDPOINT_CENTS: Record<string, number> = { 'under-1000': 50000, '1000-2500': 175000, '2500-plus': 300000 }
export const TIER_FACTORS = { simple: 0.8, pick: 1, all: 1.3 } as const
export const TIER_NAMES = { simple: 'Simple', pick: 'Our pick', all: 'All out' } as const
```

```ts
// src/lib/quotes/money.ts
import { createHash } from 'node:crypto'
import type { Meter, Quote, QuoteSettings, Tier } from './types'

export function normalPerPerson(t: Pick<Tier, 'lines'>, guests: number): number {
  const person = t.lines.filter(l => l.per === 'person').reduce((s, l) => s + l.cents, 0)
  const event = t.lines.filter(l => l.per === 'event').reduce((s, l) => s + l.cents, 0)
  return person + (event > 0 ? Math.ceil(event / Math.max(1, guests)) : 0)
}
export function offPct(t: Tier, guests: number): number {
  const n = normalPerPerson(t, guests)
  return n <= 0 ? 0 : 1 - t.priceCents / n
}
export function meterOf(off: number, s: QuoteSettings): Meter {
  const pct = Math.round(off * 10000) / 100
  if (pct > s.capPct) return 'red'
  if (pct >= s.yellowFromPct) return 'yellow'
  return 'green'
}
export const totalCents = (pricePerPerson: number, guests: number) => pricePerPerson * guests
export const depositCents = (total: number, depositPct: number) => Math.round((total * depositPct) / 100)
export function costPerPerson(t: Tier, guests: number): number | null {
  if (t.lines.some(l => l.costCents == null)) return null
  const person = t.lines.filter(l => l.per === 'person').reduce((s, l) => s + (l.costCents ?? 0), 0)
  const event = t.lines.filter(l => l.per === 'event').reduce((s, l) => s + (l.costCents ?? 0), 0)
  return person + Math.ceil(event / Math.max(1, guests))
}
export function priceKey(q: Pick<Quote, 'tiers' | 'guests' | 'depositPct' | 'startIso' | 'place'>): string {
  const visible = q.tiers.filter(t => !t.hidden).map(t => [t.id, t.priceCents, t.lines.map(l => [l.label, l.cents, l.per])])
  return createHash('sha256').update(JSON.stringify([visible, q.guests, q.depositPct, q.startIso, q.place])).digest('hex').slice(0, 16)
}
```

```ts
// src/lib/quotes/draft.ts
import { randomUUID } from 'node:crypto'
import { BUDGET_MIDPOINT_CENTS, TIER_FACTORS, TIER_NAMES, type Crafters, type MenuItem, type QuoteLine, type QuoteSettings, type Tier } from './types'
import { normalPerPerson } from './money'

const dollars = (c: number) => Math.round(c / 100) * 100
export function targetFor(budget: string, guests: number): number | null {
  const mid = BUDGET_MIDPOINT_CENTS[budget]
  return mid && guests > 0 ? dollars(mid / guests) : null
}
export function tierPrices(target: number) {
  return { simple: dollars(target * TIER_FACTORS.simple), pick: dollars(target * TIER_FACTORS.pick), all: dollars(target * TIER_FACTORS.all) }
}
export interface DraftInput { menu: MenuItem[]; targetCents: number; guests: number; crafters: Crafters; month: number; theme: string }
function score(i: MenuItem, d: DraftInput): number {
  let s = 0
  if (d.crafters !== 'both' && i.tags.includes(d.crafters)) s += 3
  if (d.crafters === 'both' && (i.tags.includes('kids') || i.tags.includes('adults'))) s += 1
  if ((d.month === 11 || d.month === 12) && i.tags.includes('holiday')) s += 2
  const words = d.theme.toLowerCase().split(/\W+/).filter(w => w.length > 3)
  if (words.some(w => i.name.toLowerCase().includes(w) || i.tags.includes(w))) s += 2
  if (d.crafters === 'adults' && i.tags.includes('kids') && !i.tags.includes('adults')) s -= 3
  if (d.crafters === 'kids' && i.tags.includes('adults') && !i.tags.includes('kids')) s -= 3
  return s
}
export const lineOf = (i: MenuItem): QuoteLine => ({ itemId: i.id, label: i.name, photoUrl: i.photoUrl, cents: i.cents, per: i.per, costCents: i.costCents })
export function fillTier(price: number, d: DraftInput, s: QuoteSettings): QuoteLine[] {
  const ceiling = Math.floor(price / (1 - s.capPct / 100))
  const pool = d.menu.filter(i => !i.hidden && !i.gone && i.cents > 0)
    .sort((a, b) => score(b, d) - score(a, d) || b.cents - a.cents)
  const lines: QuoteLine[] = []
  for (const i of pool) {
    const next = [...lines, lineOf(i)]
    if (normalPerPerson({ lines: next }, d.guests) <= ceiling) lines.push(lineOf(i))
  }
  return lines
}
export function draftTiers(d: DraftInput, s: QuoteSettings): Tier[] {
  const prices = tierPrices(d.targetCents)
  return (['simple', 'pick', 'all'] as const).flatMap(key => {
    const lines = fillTier(prices[key], d, s)
    if (!lines.length) return []
    return [{ id: randomUUID(), key, name: TIER_NAMES[key], photoUrl: lines.find(l => l.photoUrl)?.photoUrl ?? null, hidden: false, lines, priceCents: prices[key] }]
  })
}
```

- [ ] **Step 4:** `npx vitest run tests/lib/quotes` → PASS.
- [ ] **Step 5:** `git add src/lib/quotes tests/lib/quotes && git commit -m "feat(quotes): types, money math and draft tiers"`

### Task 2: Stores (S-1, S-2, S-31)

**Files:** Create `src/lib/quotes/menu-store.ts`, `src/lib/quotes/quote-store.ts`; Modify `src/lib/db/pg-stores.ts`; Test `tests/lib/quotes/stores.test.ts`
**Dependencies:** T1

- [ ] **Step 1: Failing tests** (real temp-dir stores per `tests/setup.ts`):
  - `getSettings()` with no document → `DEFAULT_SETTINGS`; `saveSettings({capPct:30}, by, '')` then `getSettings().capPct === 30`; a second save with a stale `expectedUpdatedAt` throws `QuoteStoreError` with `why:'stale'`.
  - `getMenu()` empty → `{items:[], syncedAt:null}`; `saveMenuItems(fn)` CAS-updates.
  - `listPackages`/`savePackage`/`deletePackage` round-trip.
  - `createQuote(q)` writes `q-<id>`, `t-<token>`, `r-<requestId>`; `getQuoteByToken(token)` and `getQuoteForRequest(requestId)` return it; deleting `r-` key then `getQuoteForRequest` still finds it by scanning `q-` keys.
  - `updateQuote(id, fn)` applies fn and increments nothing on its own; a function returning `null` leaves the record unchanged.
  - `newToken()` returns 32 lowercase hex chars; two calls differ.
  - `PG_STORES` contains `'quotes'`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** `menu-store.ts`: `makeKvStore('quote-menu', 'quote-menu')`, keys `menu` `{items: MenuItem[], syncedAt: string|null}`, `packages` `{list: SavedPackage[]}`, `settings` `QuoteSettings`; writes via `getWithMeta` + `setIfMatch` in `casRetry` (`src/lib/cas-retry.ts`). Exports: `getMenu()`, `saveMenuItems(fn: (items) => MenuItem[], syncedAt?: string)`, `listPackages()`, `savePackage(p)`, `deletePackage(id)`, `getSettings()` (merges DEFAULT_SETTINGS), `saveSettings(patch, by, expectedUpdatedAt)`, class `QuoteStoreError {why}`. `quote-store.ts`: `makeKvStore('quotes', 'quotes')`; exports `newToken()` (`randomBytes(16).toString('hex')`), `newQuoteId()` (`'qt_' + randomBytes(8).toString('hex')`), `partyIdForQuote(id)` = `idFor('pty', 'quote-' + id)` (`src/lib/booking-core/ids.ts`), `createQuote`, `getQuote`, `getQuoteByToken`, `getQuoteForRequest`, `listQuotes()`, `updateQuote(id, fn)` (CAS), `withQuoteLock(q, fn)` = `withPartyLock(q.partyId, fn)` from `src/lib/parties/party-lock.ts` (check its exact signature and mirror `locked` in `admin-actions.ts:179`). Add `'quotes'` to the list in `pg-stores.ts`.
- [ ] **Step 4:** run → PASS; also `npx vitest run tests/lib/db` → PASS.
- [ ] **Step 5:** `git commit -m "feat(quotes): menu and quote stores (quotes in Postgres)"`

### Task 3: Square full-catalog sync + café costs (S-6, S-7, S-45)

**Files:** Create `src/lib/quotes/square-sync.ts`, `src/lib/quotes/cost-import.ts`; Add `scripts/data/cafe-costs.json`; Test `tests/lib/quotes/square-sync.test.ts`
**Dependencies:** T2

- [ ] **Step 1: Failing tests** (`vi.mock('@lib/classes/square-api', ...)` returning paged `/catalog/list` results, pattern `tests/api/admin-crafts.test.ts:75`):
  - Two items in two categories, one with variations "Small"/"Large" → menu gets 3 items named `Terrarium · Small`, `Terrarium · Large`, `Mosaic Coaster`, cents from `price_money.amount`, photo from the IMAGE object url, `source:'square'`, `per:'person'`.
  - Re-sync after owner set `costCents: 900, tags:['adults'], hidden:true` on one → those three fields kept, name/cents updated.
  - Variation missing on a complete sync → `gone:true`; present again → `gone` cleared.
  - Square throws on page 2 → menu unchanged, function throws `QuoteStoreError('sync_failed')`.
  - `applyCafeCosts(items, costs)`: `Terrarium (.5 Gallon)` cost 850 applies to an item named `Terrarium · .5 Gallon` or `Terrarium (.5 Gallon)` (normalize: lowercase, strip punctuation, collapse spaces, ignore " · " vs "()"); unmatched stay null; existing non-null `costCents` never overwritten.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Copy the paging loop of `listCatalog` in `src/lib/crafts/craft-admin.ts:146` (raw `squareFetch('/catalog/list?types=ITEM,CATEGORY,IMAGE&cursor=')`, snake_case fields). `syncSquare(now)`: fetch all pages first, then one `saveMenuItems` merge keyed by `squareVariationId`, then `applyCafeCosts` with `scripts/data/cafe-costs.json` imported as JSON (move nothing; just `git add` the file). Skip items whose `is_deleted` is true.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** `git add scripts/data/cafe-costs.json src/lib/quotes tests/lib/quotes && git commit -m "feat(quotes): full Square catalog sync with café costs"`

### Task 4: Holds, labels, class guard (S-30, S-38, S-39, S-40)

**Files:** Create `src/lib/quotes/holds.ts`; Modify `src/lib/classes/studio-schedule.ts` (~line 141-152 `partyBusy`), `src/lib/class-guard.ts`; Test `tests/lib/quotes/holds.test.ts`
**Dependencies:** T2

- [ ] **Step 1: Failing tests** (real party book on temp dir; see `tests/lib/parties/party-book.test.ts` for setup):
  - `applyHold(prev, next, now)` where prev = not held, next = studio sent, 2026-12-11 18:00–20:00 local, expires 14 days out → `holdsBetween` shows one hold under `next.partyId` with `holdExpiresAt === next.expiresAt`, `state:'held'`; returns `{held:true}`.
  - Clash with an existing party hold at that time → returns `{held:false, clash:{label, startIso}}` and the book is unchanged.
  - Start moved 1 h later → one hold at the new start (via `moveTime`); clash → old hold kept.
  - studio → away → no hold; away → studio → hold.
  - Expiry earlier → hold's `holdExpiresAt` equals the new expiry.
  - Withdraw → no hold.
  - After the TTL passes (`now` past expiry) `partyWarnings(from,to,now)` returns no item mentioning the quote party id, and `freeOrphanHold` refuses it (TTL holds are not lasting).
  - `partyBusy` labels a hold whose id has no party record but has a quote as `Quote hold: <first name>`.
  - `findPartyClashes(classStart, minutes)` includes a live quote hold.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `holds.ts` exporting `applyHold(prev: Quote|null, next: Quote, now: Date): Promise<{held: boolean; clash?: {label: string; startIso: string}}>` implementing the spec §5 hold table with `holdTime`, `moveTime`, `resizeTime`, `extendHold`, `releaseTime` from `src/lib/parties/party-book.ts` and `busyBetween` from `studio-schedule.ts` for the `others` argument; `ttlMinutes = ceil((expiresAt - now)/60000)`. `releaseQuoteHold(q)`. In `partyBusy`, when `getPartyRecord(h.partyId)` is null, look up the quote with `listQuotes()` filtered by `partyId` (cache per call) and use `Quote hold: <first name>`. In `class-guard.ts`, include live (non-expired) holds from `holdsBetween` whose party has no record but a quote.
- [ ] **Step 4:** PASS; `npx vitest run tests/lib/parties tests/lib/classes` still PASS.
- [ ] **Step 5:** `git commit -m "feat(quotes): quote holds in the party book, labelled, class guard aware"`

### Task 5a: Quote parties in the party system, server side (S-3, S-46)

**Files:** Modify `src/lib/party-store.ts`, `src/lib/parties/pricing.ts` (`orderLineItems` ~175), `src/lib/parties/payment-link.ts` (~36-64), `src/lib/email.ts` (pay-link and money emails ~932-983), `src/pages/api/party/balance.json.ts` (~38-49), refund-line helper (`refund-lines.ts`), `src/lib/parties/staff-money.ts` (~40-58), `src/lib/party-terms.ts` (~57), `src/lib/party-register.ts` (~22-27), `src/lib/parties/admin-actions.ts` (~750, ~824-849); Test `tests/lib/parties/quote-party.test.ts`
**Dependencies:** T0 (independent of T1-T4)

- [ ] **Step 1: Failing tests** with a fixture record `{source:'ours', origin:'quote', status:'booked', craftName:'Holiday Glow Night', quote:{quoteId:'qt_1', tierName:'Holiday Glow Night', lines:['Glass terrarium','Earring bar'], guests:30}, items:[deposit paid 112500, balance unpaid 112500 kind 'quote']}`:
  - `orderLineItems` names a quote item `Private event: <label>`.
  - Pay-link text/email body for this record contains `private event` and `$1,125.00 still due`, and contains neither `Crafts are paid at the studio` nor `held for you`.
  - `balance.json` response lists the balance line by label and `extrasOnly` is false for quote parties.
  - Refund line base is the deposit (112500), not the $300 default.
  - `crewPartyMoney(rec)` reports `craftsIncluded: true` and no ring-up per head.
  - `partyTermsFor`/register estimate for the record has no studio fee and no craft minimum.
  - Admin `remove-item` on a `'quote'` item and guest-count edit return a plain refusal: `This is a private event quote. Change it with the owners.`
  - A plain weekend party fixture produces exactly the same outputs as before (snapshot the old strings in the test).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** the type additions (`origin?: 'quote'`, `quote?: {...}`, `place?: 'studio'|'away'`, `address?: string`, `PartyItem.kind: 'package'|'addon'|'quote'`) and each branch. Keep weekend/weeknight paths byte-identical.
- [ ] **Step 4:** PASS; `npx vitest run tests/lib/parties tests/api/party-pay.test.ts tests/api/admin-party*.test.ts` PASS.
- [ ] **Step 5:** `git commit -m "feat(parties): quote-born parties (origin quote) in pricing, pay link, terms, crew money"`

### Task 5b: Quote parties in party screens (S-56)

**Files:** Modify `src/components/admin/parties/PartySheet.tsx` (~165-169, 350-386), `src/components/party/PartyPayPanel.tsx` (~235), `src/components/party/PartyDashboard.tsx` (~44, 324), staff party list components (find with `grep -rn "guestCount" src/components/staff`), `src/pages/api/staff/parties.json.ts` (add `origin`, `quoteLines`, `place`, `address`); Test `tests/components/admin/parties/PartySheet.quote.test.tsx`, `tests/api/staff-parties.test.ts` (extend)
**Dependencies:** T5a (types)

- [ ] **Step 1: Failing tests:** PartySheet with the T5a fixture shows `Private event`, both package lines, `Deposit $1,125.00 paid`, `Balance $1,125.00 due`, and no `+ Add an extra` and no `rung up on the POS`; PartyPayPanel shows no "extras were added since"; staff parties API returns `origin:'quote'`, `quoteLines`, `address` for an away record; staff list renders a `Private event` badge, the lines and the address.
- [ ] **Step 2:** FAIL. **Step 3:** implement branches. **Step 4:** PASS + existing component tests PASS.
- [ ] **Step 5:** `git commit -m "feat(parties): show private-event quotes on party sheet, pay panel and staff"`

### Task 6: Admin quote lifecycle + messages (S-10..S-15, S-26, S-42, S-43)

**Files:** Create `src/lib/quotes/admin-quotes.ts`, `src/lib/quotes/messages.ts`; Test `tests/lib/quotes/admin-quotes.test.ts`
**Dependencies:** T1, T2, T4

- [ ] **Step 1: Failing tests** (fixture request from `tests/fixtures/event-request`; mock `@lib/email` and `@lib/quo`):
  - `draftQuote(requestId, {by, now})` for 25 adults, budget 1000-2500, date 2026-12-11 18:00, length "2 hours", place studio → quote `status:'draft'`, `targetCents:7000`, tier prices 5600/7000/9100 (given a seeded menu), `partyId === partyIdForQuote(id)`, `expiresAt = now + 14 days`, `place:'studio'`; second call returns the same quote; with request place `yours` → `place:'away'`; empty start time → `startIso:null`.
  - On a Booked request without `force` → throws `why:'booked'`.
  - After withdraw, `draftQuote` makes a new quote and `r-` points to it.
  - `saveQuote(q, version)` stale → `why:'stale'`; paid → `why:'paid'`; sent quote with a red tier and no `overCapOk` → `why:'over_cap'`; owner edit bumps `version` and changes `priceKey`; hiding the picked tier sets status `sent` and clears `pickedTierId`.
  - `sendQuote(id, {text:true, email:true})`: no visible tiers → `no_tiers`; `startIso:null` → `incomplete`; red tier → `over_cap` unless `overCapOk`; hold clash → `time_taken` with the clash label and nothing sent; success → status `sent`, `held:true`, request status `quoted`, one text and one email with `/quote/<token>` in them.
  - `quoteAction(id,'withdraw')` → hold released, `withdrawn`, request back to `new` (only if it was `quoted`); on paid → `why:'paid'`.
  - `quoteAction(id,'reopen')` on withdrawn → `sent`, new expiry, held, `expiryTold` cleared.
  - Request status never downgrades from `booked`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** with `withQuoteLock`, re-reading inside the lock; `ownerTimeRefusal` from `src/lib/parties/open-times.ts:219` for `closed`; messages: text `Hi <first>! Your Hometown Studio event ideas are ready: <url>` and an email using the brown pill-button style of `partyMoneyEmail` in `src/lib/email.ts` (add an exported `sendQuoteLinkEmail({to, givenName, url, expiresLabel})`). Request status via `setRequestStatus` from `src/lib/event-requests.ts`. Parse length with `/(\d+(?:\.\d+)?)\s*h/i`, default 2.
- [ ] **Step 4:** PASS. **Step 5:** `git commit -m "feat(quotes): draft, save, send, resend, withdraw, reopen"`

### Task 7: Deposit pay flow (S-19, S-20, S-32..S-37)

**Files:** Create `src/lib/quotes/pay.ts`; Test `tests/lib/quotes/pay.test.ts`
**Dependencies:** T2, T4, T5a

- [ ] **Step 1: Failing tests** (mock Square as in `tests/lib/parties/pay-balance.test.ts`; mock owner-alert/email):
  - Happy path, studio, 30 guests at $75, deposit 50% → `payQuote({token, tierId, priceKey, attemptId, pay})` returns `{partyId}`; party record exists with `origin:'quote'`, deposit item paid (112500, has `chargeId`), balance item unpaid (112500); `holdsBetween` shows exactly one entry for the slot, `state:'booked'`, no overlap; quote `paid`; request `booked`; owners alerted once with `Private event booked`.
  - Repeat call with the same token after success → same `partyId`, Square charge mock called once.
  - Wrong `priceKey` → `price_changed`, no Square calls, no party record.
  - Expired / withdrawn / draft → `closed`; hidden tier → `tier_unavailable`.
  - Slot taken by another party hold → `time_taken`, no charge, no record left behind.
  - Declined card → `declined`, no party record left, quote back to `picked`.
  - Unclear (Square timeout) → `checking`, quote `paying`, record kept, no refund call.
  - While `paying` → second call returns `busy`.
  - After paid, `payBalance` via the record's `payToken` with `expectedCents` 112500 charges only the balance.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** spec §5 Pay steps 1–7 inside `withQuoteLock`, calling `createPartyRecord` (`src/lib/party-store.ts:266`), `extendHold`/`holdTime`, `payBalance` (`src/lib/parties/pay-balance.ts:133`, it does not take the party lock itself; it claims with `claimPaying`), `confirmTime`, `updatePartyRecord` to add the balance item, `alertOwners`, `setRequestStatus`. Party record fields per spec §4 (`craftName` = tier name, `title` = `<first>'s private event`, `durationMinutes`, `endIso`, `dropOff:false`, `hostToken`/`payToken` generated like `checkout.ts` does).
- [ ] **Step 4:** PASS. **Step 5:** `git commit -m "feat(quotes): deposit payment books a private event through the pay-link core"`

### Task 8: Public view and pick (S-16, S-17, S-18)

**Files:** Create `src/lib/quotes/public-view.ts`; Test `tests/lib/quotes/public-view.test.ts`
**Dependencies:** T1, T2

- [ ] **Step 1: Failing tests:** `publicView(token, {isOwner:false})` for a sent quote returns tiers (visible only) with `normalPerPerson`, `priceCents`, totals, deposit, photos, `expiresAt`, `updatedAt`, event facts, `state:'open'`, and `JSON.stringify(view)` contains none of `costCents`, `cost`, `history`, `sentBy`, `targetCents`; views increments by 1 and `version` unchanged; with `isOwner:true` views unchanged; draft, withdrawn, expired and unknown token return deep-equal `{state:'closed'}`; paid returns `state:'paid'` with receipt read from the party record (date, paid, due, pay link url via `payLinkUrl`, host page url); cancelled party → `state:'cancelled'`. `pickTier(token, tierId)` sets `picked` without a version bump; hidden tier → `tier_unavailable`; closed → `closed`.
- [ ] **Step 2–5:** FAIL → implement → PASS → `git commit -m "feat(quotes): public quote view and package pick"`

### Task 9: Admin routes (S-5, S-8, S-9, API side of S-10..S-15)

**Files:** Create `src/pages/api/admin/quote-menu.json.ts`, `src/pages/api/admin/quotes/{draft,by-request,save,send,action}.json.ts`; Test `tests/api/admin-quotes.test.ts`
**Dependencies:** T3, T6

- [ ] **Step 1: Failing tests** (admin cookie pattern of `tests/api/admin-event-requests.test.ts`): each route 401 without the cookie; 503 when `partyWritesRefusal` returns a string (mock `src/lib/parties/test-site.ts`); `GET quote-menu` runs the sync once when never synced (Square mock called once, second GET not); `save-item` 400 on empty name and on `cents:-1`; `save-package` then `GET` lists it; `draft` returns the quote; `send` maps each lib error to the spec status codes (`no_tiers` 400, `incomplete` 400, `over_cap` 409, `time_taken` 409 with `clash`, `closed` 409); every write calls `recordAudit`.
- [ ] **Step 2–5:** FAIL → implement thin routes calling T3/T6 → PASS → `git commit -m "feat(quotes): admin quote routes"`

### Task 10: Public routes (S-11 public side, S-21)

**Files:** Create `src/pages/api/quote/view.json.ts`, `pick.json.ts`, `pay.json.ts`; Test `tests/api/quote-public.test.ts`
**Dependencies:** T7, T8

- [ ] **Step 1: Failing tests:** view counts unless the admin cookie is sent; rate limits (view 60/min, pick 20/min, pay 5/min via `rateLimited` from `@lib/rate-limit`) return 429; pay maps lib outcomes to 200 / 202 `checking` / 402 / 404 / 409 / 410 exactly as spec §3; 503 on `partyWritesRefusal`; responses are `Cache-Control: no-store`.
- [ ] **Step 2–5:** FAIL → implement → PASS → `git commit -m "feat(quotes): public view, pick and pay routes"`

### Task 11: Expiry sweep (S-41)

**Files:** Modify `src/pages/api/jobs/waitlist-sweep.json.ts`; Create `src/lib/quotes/expiry.ts`; Test `tests/lib/quotes/expiry.test.ts`
**Dependencies:** T6

- [ ] **Step 1: Failing tests:** two expired sent quotes, one paid, one not expired → `sweepExpiredQuotes(now)` texts owners twice (`Quote expired: <name>, <date>`) via `alertOwners`; second run texts nothing; if the CAS write of `expiryTold` loses, no text.
- [ ] **Step 2–5:** FAIL → implement and call it from the job route after its existing work (errors logged, never failing the job) → PASS → `git commit -m "feat(quotes): owners hear when a quote expires unpaid"`

### Task 12: Quote menu screen (S-51; m1)

**Files:** Create `src/components/admin/quotes/QuoteMenuPage.tsx`, `ItemEditor.tsx`, `api.ts`; Modify `src/components/admin/shell/router.ts` (`MorePage`, `MORE_PAGES`), `src/components/admin/More.tsx` (`OWNER_ROWS`), `src/components/admin/AdminShell.tsx` (`SheetContent` more switch); Test `tests/components/quotes/QuoteMenuPage.test.tsx`
**Dependencies:** T9

- [ ] **Step 1: Failing tests:** renders items from a mocked `api()`; search filters by name; tag chip filters; "Load from Square" posts `sync-square`; tapping an item opens the editor with name, price, per person/event, cost, tags, hidden, photo upload button; saving posts `save-item`; packages section lists and deletes; settings form saves cap/yellow/deposit/expiry; `parseSheet('#more-quote-menu')` returns the page.
- [ ] **Step 2–5:** FAIL → implement in the admin sheet style (`SheetFrame`, `Seg`, existing field components; photo via `/api/admin/classes/photo.json`) → PASS → `git commit -m "feat(admin): Quote menu under More"`

### Task 13: Quote sheet + request entry (S-47..S-50; m2)

**Files:** Create `src/components/admin/quotes/QuoteSheet.tsx`, `TierCard.tsx`, `AddLinePicker.tsx`; Modify `router.ts` (`Sheet` union `{kind:'quote', requestId}`, `sheetToken`, `parseSheet` list, `homeTabOf` → inbox, `isFormSheet` true), `AdminShell.tsx` (`SheetContent`), `src/components/admin/inbox/InboxSheets.tsx` (button + chip beside the status `Seg`), `src/components/admin/inbox/describe.ts` (Next hint); Test `tests/components/quotes/QuoteSheet.test.tsx`, extend `tests/components/admin/inbox/*`
**Dependencies:** T9

- [ ] **Step 1: Failing tests:** request sheet without a quote shows `Make a quote`; with one shows `Open quote` and the chip text (`Sent`, `Viewed 2×`, `Paid`…); Make a quote on a Booked request shows an in-sheet confirm; QuoteSheet renders three tier cards with `$100 → $75`-style normal/price, total and a meter colour class; remove line, add item from picker, add one-off line, add saved package, rename, set price, hide tier, note, deposit %, expiry all update the draft and mark the sheet dirty; Save posts `save.json`; Send with a red tier shows the in-sheet over-cap confirm first and passes `overCapOk:true` on confirm; a 409 `time_taken` shows the clash label and (studio) `Send without holding`; Withdraw/Reopen/Resend/Preview/Flyer buttons appear per status; paid quotes are read-only with a link to the party; Close returns to `#request-<id>`; no `window.confirm` anywhere (spy asserts not called).
- [ ] **Step 2–5:** FAIL → implement (Catherine-first: big targets, plain words, one primary button) → PASS → `git commit -m "feat(admin): quote sheet from a private-event request"`

### Task 14: Customer quote page (S-52..S-54; m3)

**Files:** Create `src/pages/quote/[token].astro`, `src/components/quote/QuotePage.tsx`, `src/components/quote/quote.css`; Modify `src/layouts/Layout.astro` private-path helper (`isPrivatePartyPage` source) to include `/quote/`; Test `tests/components/quotes/QuotePage.test.tsx`
**Dependencies:** T10

- [ ] **Step 1: Failing tests:** with a mocked `view.json` open state → renders the event facts, `An Evening of Making`, one ticket button per tier with its price, Our pick preselected, dotted-leader lines with normal prices, crossed normal per person and the price, total and deposit, `Kindly reply by`, `Questions? Text us at (256) 464-1710`; picking another ticket calls `pick.json` once; `updatedAt` shows `Updated`; each refusal (402, 409 price_changed, 409 time_taken, 202 checking) shows its one sentence and keeps the tiers; paid state shows the receipt with `Pay the rest` link and no pay form; closed and cancelled states show only their message; `isPrivatePartyPage('/quote/abc')` is true.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** the Invitation artboard (copy its structure, colours `#efe6da`/`#fffdf9`/`#3d3229`/`#c4a882`/`#7a4a2e`, Playfair italic headings, polaroid tilt, dotted leaders) as a React island in the bare layout; polaroids use the visible tiers' photos (fall back to item photos); `PaymentForm` from `src/components/checkout/PaymentForm.tsx` with `wallet={{amount, label}}` and `onWalletToken`/card token → `pay.json` with `priceKey` and a per-page `attemptId` (`crypto.randomUUID()`, reused on retry of the same attempt). 390px: no horizontal scroll.
- [ ] **Step 4–5:** PASS → `git commit -m "feat(quotes): invitation-style customer quote page with deposit"`

### Task 15: Printable flyer (S-55; m4)

**Files:** Create `src/lib/quotes/flyer.ts`, `src/pages/admin/quote/[id]/flyer.ts`; Test `tests/lib/quotes/flyer.test.ts`
**Dependencies:** T8

- [ ] **Step 1: Failing tests:** `quoteFlyerHtml(quote, origin)` contains `@page { size: letter`, each visible tier name and price, an inline `<svg` QR whose encoded URL is `<origin>/quote/<token>` (decode not needed: assert `QRCode.toString` was called with that URL via spy), and no cost strings; route 302s without the admin cookie.
- [ ] **Step 2–5:** FAIL → implement following `src/lib/day-flyer.ts` (`flyerHtml`, print bar, fonts) → PASS → `git commit -m "feat(quotes): printable one-page quote flyer with QR"`

### Task 16: End-to-end, verify, push dev

**Dependencies:** all

- [ ] **Step 1:** Write `tests/lib/quotes/e2e.test.ts`: seed menu → draft from fixture request → save edit → send (hold) → view → pick → pay deposit → party booked with one book entry → pay balance through `payBalance` → party fully paid; and withdraw path releases the hold.
- [ ] **Step 2:** `npm test` (all green, count ≥ baseline + new) and `npx tsc --noEmit` (no new errors vs T0).
- [ ] **Step 3:** `git push origin kaden/event-value-quote` then merge into `dev` and `git push origin dev` (free preview). Never `dev:main`.
- [ ] **Step 4:** On the dev preview: Load from Square, make a quote from a real request, send to Kaden's phone only, pay a $1 test deposit by card (set price to make the deposit $1), confirm the event shows in admin and staff. Record proof in the PRD log.

---

## Plan review fixes (plan-logic reviewer, 2026-11-17) — these override the task text above
1. T5b moved to Wave 2; T13 after T12 (T12 owns router/shell edits).
2. T5a also branches `tellLinkPaid` in `pay-balance.ts` (~456-481) and `sendPartyBookedEmail` in `checkout.ts:406` on `origin==='quote'`: no "Party paid" owner text, private-event confirmation copy computed from `quote.guests` × tier price (balance may not exist yet). T7 sends the single "Private event booked" owner alert.
3. `payQuote` input adds `requestUrl` and maps `pay` to `LinkPay` exactly like `src/pages/api/party/pay.json.ts:28-43` (incl. `paymentBypassEnabled`).
4. T7 adds `deletePartyRecord(id)` to `party-store.ts` (refuses when the record has charges).
5. `money.ts`/`draft.ts` stay browser-safe (already: `priceKey` is in server-only `price-key.ts`).
6. T4: don't touch `class-guard.ts` (holdsBetween already includes quote holds); in `partyBusy` set both `label` and `hostName` for quote holds. Test `freeOrphanHold` BEFORE expiry (expect refusal) and `partyWarnings` AFTER expiry.
7. T5a real names: `partyTermsForStart`, `termsForKind`, `partyEstimateCents` (party-terms.ts:56-99); add `craftsIncluded?: boolean` to `CrewPartyMoney` (`ringUp` stays required: set to null-equivalent per its type). `staff/parties.json.ts:36` branches on `origin` before computing kind (T5b).
8. T13 sheet: `{kind:'quote', id: requestId}` (router uses `id`). T14: private path regex `PRIVATE_PARTY_PATH` in `src/lib/page-key.ts:23-27` and `__hsScrubKeys` (~58) gain `/quote/`.
9. T6 `draftQuote` runs under `withPartyLock('quote-req-' + requestId)` so two quick taps can't make two quotes.

## Self-review
- Coverage: S-1 T2 · S-2 T2 · S-3 T5a · S-4 T1/T6 · S-5 T9 · S-6/S-7 T3/T9 · S-8 T9 · S-9 T9/T13 · S-10 T6/T9 · S-11 T6/T7/T8/T10 · S-12..S-15 T6/T9 · S-16..S-18 T8/T10 · S-19/S-20 T7/T10 · S-21 T10 · S-22..S-29 T1 · S-26 T6 · S-30 T4/T6 · S-31 T2/T6/T7 · S-32..S-37 T7 · S-38..S-40 T4 · S-41 T11 · S-42/S-43 T6 · S-44 T6/T7/T5b · S-45 T3 · S-46 T5a · S-47..S-50 T13 · S-51 T12 · S-52..S-54 T14 · S-55 T15 · S-56 T5b · S-57 T13.
- Types: `Quote`, `Tier`, `QuoteLine`, `MenuItem`, `QuoteSettings`, `partyIdForQuote`, `withQuoteLock`, `applyHold`, `payQuote`, `publicView`, `pickTier`, `draftQuote`, `saveQuote`, `sendQuote`, `quoteAction`, `syncSquare`, `applyCafeCosts`, `sweepExpiredQuotes`, `quoteFlyerHtml` are defined once and used by name.
