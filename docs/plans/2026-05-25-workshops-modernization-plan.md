# Workshops Modernization Implementation Plan

> **PRD:** none (refactor — no user-facing change)
> **Context:** Pre-work for `docs/plans/2026-05-25-workshops-launch-prd.md`. Audit findings discussed 2026-05-25.
> **For agents:** Use sdd (sequential) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the workshops code path in line with the rest of the project: introduce a `WorkshopProvider` adapter, separate the domain type from view-model types, delete dead code, and move hard-coded config to `siteConfig`. No user-visible behavior change.

**Architecture:** New `WorkshopProvider` interface wraps the buyer-facing classes API (existing `getClassInstances` logic moves into `SquareWorkshopProvider`). Domain type `Workshop` contains only source-of-truth fields from Square. The existing UI prop type `WorkshopData` is now constructed from `Workshop` via a single helper `toWorkshopData`, so all derived UI fields (`date`, `endTime`, etc.) live in one place. Components stay unchanged. Dead `list.json.ts` path is removed.

**Tech Stack:** Astro 5, React, TypeScript, Vitest. Test command: `npx vitest run`.

**Test framework note:** All new tests use Vitest (`describe`, `it`, `expect` from `'vitest'`). Existing pattern: tests under `tests/`, imports use the `@` aliases configured in `vitest.config.ts` (matches the project's tsconfig paths).

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/providers/interfaces/workshop.ts` | Create | `Workshop` domain type + `WorkshopProvider` interface |
| `src/providers/interfaces/index.ts` | Modify | Re-export new `workshop` interface |
| `src/providers/mock/workshop.ts` | Create | `MockWorkshopProvider` with fixture data |
| `src/providers/square/workshop.ts` | Create | `SquareWorkshopProvider` — fetches buyer-classes API, maps to `Workshop[]`, applies capacity filter inside, takes full `SquareConfig` |
| `src/providers/square/classes.ts` | Delete | Orphaned after migration (Task 7) — was the inline `getClassInstances` helper |
| `src/config/providers.ts` | Modify | Add `workshop` to `Providers` interface + `createProviders` |
| `src/config/site.config.ts` | Modify | Add top-level `CLASS_BOOKING_APP_ID` named export (NOT inside SquareConfig — must work in mock mode too) |
| `src/pages/workshops.astro` | Modify | Use `providers.workshop.listWorkshops()`; construct `WorkshopData` via `toWorkshopData` helper |
| `src/pages/api/workshops/availability.json.ts` | Modify | Use `providers.workshop.listWorkshops()`; response shape changes from `ClassInstance[]` to `Workshop[]` (intentional) |
| `src/components/workshops/workshop-view-model.ts` | Create | `toWorkshopData(workshop: Workshop): WorkshopData` helper |
| `src/components/workshops/WorkshopBookingModal.tsx` | Modify | Read `applicationIdOverride` from `CLASS_BOOKING_APP_ID` constant |
| `src/components/reservations/steps/PaymentStep.tsx` | Modify | Same `applicationIdOverride` constant replacement (was independently hard-coded) |
| `src/pages/api/workshops/list.json.ts` | Delete | Dead code — no callers in `src/`, only tests |
| `src/lib/types.ts` | Modify | Delete shadow `WorkshopData` definition (lines 17–29) |
| `tests/api/workshops.test.ts` | Modify/Delete | Remove `list.json` tests; update `availability.json` assertions for the new `Workshop` shape (or delete file if no blocks remain) |
| `tests/e2e/booking-flow.test.ts` | Modify | Add `workshop` + `giftcard: null` to provider mock; add `mockListWorkshops.mockResolvedValueOnce` override for the wizard flow test; remove `list.json` references |
| `tests/providers/square/workshop.test.ts` | Create | Unit test for `SquareWorkshopProvider` mapping (mocked fetch) |
| `tests/providers/mock/workshop.test.ts` | Create | Unit test for `MockWorkshopProvider` |
| `tests/components/workshop-view-model.test.ts` | Create | Unit test for `toWorkshopData` helper |
| `scripts/delete-empty-workshop-category.ts` | Create | One-shot script (dry-run default, `--confirm` to delete) for the empty `"Workshop"` catalog category in Square |

---

## Task 1: Define `Workshop` domain type and `WorkshopProvider` interface

**Files:**
- Create: `src/providers/interfaces/workshop.ts`
- Modify: `src/providers/interfaces/index.ts`

**Dependencies:** none

- [ ] **Step 1: Create the interface file**

```typescript
// src/providers/interfaces/workshop.ts
export interface Workshop {
  /** classScheduleInstanceId — stable per occurrence */
  id: string
  /** classScheduleId — stable per workshop type */
  scheduleId: string
  name: string
  description: string
  descriptionHtml: string
  /** ISO 8601 */
  startAt: string
  durationMinutes: number
  priceCents: number
  priceCurrency: string
  availableCapacity: number
  staffName: string
  teamMemberId: string
  /** Reserved for the workshops-launch feature. Square's class API does not
   *  provide images; this will be populated by an image-linker from
   *  public/images/workshops/ in the next plan. Stays undefined for now. */
  imageUrl?: string
}

export interface WorkshopProvider {
  /** Returns active workshops with availableCapacity > 0, sorted by startAt ascending */
  listWorkshops(): Promise<Workshop[]>
  /** Returns a single workshop by id (or null). Does NOT apply the capacity filter. */
  getWorkshop(id: string): Promise<Workshop | null>
}
```

- [ ] **Step 2: Re-export from the interfaces barrel**

Modify `src/providers/interfaces/index.ts` — add the new line at the end:

```typescript
export * from './booking'
export * from './payment'
export * from './catalog'
export * from './capacity'
export * from './customer'
export * from './notification'
export * from './workshop'
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx astro check 2>&1 | tail -20`
Expected: zero new errors related to the workshop interface (existing project errors, if any, unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/providers/interfaces/workshop.ts src/providers/interfaces/index.ts
git commit -m "$(cat <<'EOF'
refactor(workshops): add WorkshopProvider interface and Workshop domain type

Pre-work for the workshops-launch feature. The domain type contains
only source-of-truth fields from Square's buyer-facing classes API;
derived UI fields (date string, endTime, etc.) will live in a separate
view-model helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Implement `MockWorkshopProvider`

**Files:**
- Create: `src/providers/mock/workshop.ts`

**Dependencies:** Task 1

- [ ] **Step 1: Write the failing test**

Create `tests/providers/mock/workshop.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { MockWorkshopProvider } from '@providers/mock/workshop'

describe('MockWorkshopProvider', () => {
  it('listWorkshops returns workshops sorted by startAt ascending', async () => {
    const provider = new MockWorkshopProvider()
    const workshops = await provider.listWorkshops()
    expect(workshops.length).toBeGreaterThan(0)
    for (let i = 1; i < workshops.length; i++) {
      expect(
        new Date(workshops[i].startAt).getTime()
      ).toBeGreaterThanOrEqual(new Date(workshops[i - 1].startAt).getTime())
    }
  })

  it('listWorkshops excludes workshops with availableCapacity === 0', async () => {
    const provider = new MockWorkshopProvider()
    const workshops = await provider.listWorkshops()
    for (const w of workshops) {
      expect(w.availableCapacity).toBeGreaterThan(0)
    }
  })

  it('getWorkshop returns a workshop even when availableCapacity is 0', async () => {
    const provider = new MockWorkshopProvider()
    const workshop = await provider.getWorkshop('mock-sold-out-1')
    expect(workshop).not.toBeNull()
    expect(workshop!.availableCapacity).toBe(0)
  })

  it('getWorkshop returns null for unknown id', async () => {
    const provider = new MockWorkshopProvider()
    expect(await provider.getWorkshop('does-not-exist')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/providers/mock/workshop.test.ts`
Expected: FAIL — module `@providers/mock/workshop` not found.

- [ ] **Step 3: Implement the mock**

Create `src/providers/mock/workshop.ts`:

```typescript
import type { Workshop, WorkshopProvider } from '../interfaces/workshop'

const NOW = Date.now()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const FIXTURES: Workshop[] = [
  {
    id: 'mock-ws-1',
    scheduleId: 'mock-sched-1',
    name: 'Mock Glass Fusing 101',
    description: 'Beginner glass fusing class.',
    descriptionHtml: '<p>Beginner glass fusing class.</p>',
    startAt: new Date(NOW + 3 * DAY).toISOString(),
    durationMinutes: 120,
    priceCents: 6500,
    priceCurrency: 'USD',
    availableCapacity: 6,
    staffName: 'Mock Instructor',
    teamMemberId: 'TM-mock',
  },
  {
    id: 'mock-ws-2',
    scheduleId: 'mock-sched-2',
    name: 'Mock Candle Pouring',
    description: 'Make your own soy candle.',
    descriptionHtml: '<p>Make your own soy candle.</p>',
    startAt: new Date(NOW + 7 * DAY).toISOString(),
    durationMinutes: 90,
    priceCents: 4500,
    priceCurrency: 'USD',
    availableCapacity: 4,
    staffName: 'Mock Instructor',
    teamMemberId: 'TM-mock',
  },
  {
    id: 'mock-sold-out-1',
    scheduleId: 'mock-sched-3',
    name: 'Mock Sold-Out Workshop',
    description: 'This one is full.',
    descriptionHtml: '<p>This one is full.</p>',
    startAt: new Date(NOW + 10 * DAY).toISOString(),
    durationMinutes: 60,
    priceCents: 3500,
    priceCurrency: 'USD',
    availableCapacity: 0,
    staffName: 'Mock Instructor',
    teamMemberId: 'TM-mock',
  },
]

export class MockWorkshopProvider implements WorkshopProvider {
  async listWorkshops(): Promise<Workshop[]> {
    return FIXTURES
      .filter((w) => w.availableCapacity > 0)
      .slice()
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  }

  async getWorkshop(id: string): Promise<Workshop | null> {
    return FIXTURES.find((w) => w.id === id) ?? null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/providers/mock/workshop.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/mock/workshop.ts tests/providers/mock/workshop.test.ts
git commit -m "$(cat <<'EOF'
refactor(workshops): add MockWorkshopProvider with fixtures

Provides parity with other providers in mock mode. Fixtures include a
sold-out workshop so getWorkshop's capacity-bypass behavior is tested.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Implement `SquareWorkshopProvider`

**Files:**
- Create: `src/providers/square/workshop.ts`
- Create: `tests/providers/square/workshop.test.ts`

**Dependencies:** Task 1

The provider wraps the existing `getClassInstances` fetch logic (in `src/providers/square/classes.ts`) and maps `ClassInstance` → `Workshop`. The class-instance fetcher is kept as a low-level helper that the provider calls; the provider is the public adapter.

- [ ] **Step 1: Write the failing test**

Create `tests/providers/square/workshop.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SquareWorkshopProvider } from '@providers/square/workshop'

const FIXTURE_RESPONSE = {
  class_schedule_instances: [
    { id: 'inst-1', class_schedule_id: 'sched-A', start_at: '2026-06-10T17:00:00Z', available_capacity: 5 },
    { id: 'inst-2', class_schedule_id: 'sched-B', start_at: '2026-06-05T19:00:00Z', available_capacity: 0 },
    { id: 'inst-3', class_schedule_id: 'sched-A', start_at: '2026-06-12T17:00:00Z', available_capacity: 3 },
  ],
  included_resources: {
    class_schedules: [
      { id: 'sched-A', name: 'Glass Fusing', description: 'desc A', description_html: '<p>desc A</p>', duration_minutes: 120, price_amount: 6500, price_currency: 'USD', staff_name: 'Kaden', team_member_id: 'TM1' },
      { id: 'sched-B', name: 'Candle Pouring', description: 'desc B', description_html: '<p>desc B</p>', duration_minutes: 90, price_amount: 4500, price_currency: 'USD', staff_name: 'Kaden', team_member_id: 'TM1' },
    ],
  },
}

describe('SquareWorkshopProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(FIXTURE_RESPONSE), { status: 200 })))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const config = { locationId: 'LOC123', accessToken: 'x', environment: 'sandbox', applicationId: 'app' } as any

  it('listWorkshops returns Workshop[] sorted by startAt ascending and filters availableCapacity === 0', async () => {
    const provider = new SquareWorkshopProvider(config)
    const workshops = await provider.listWorkshops()
    expect(workshops.map(w => w.id)).toEqual(['inst-1', 'inst-3'])
    expect(workshops[0].priceCents).toBe(6500)
    expect(workshops[0].priceCurrency).toBe('USD')
    expect(workshops[0].scheduleId).toBe('sched-A')
    expect(workshops[0].name).toBe('Glass Fusing')
  })

  it('getWorkshop returns a workshop by id even when sold out', async () => {
    const provider = new SquareWorkshopProvider(config)
    const sold = await provider.getWorkshop('inst-2')
    expect(sold).not.toBeNull()
    expect(sold!.id).toBe('inst-2')
    expect(sold!.availableCapacity).toBe(0)
  })

  it('getWorkshop returns null for unknown id', async () => {
    const provider = new SquareWorkshopProvider(config)
    expect(await provider.getWorkshop('nope')).toBeNull()
  })

  it('listWorkshops returns [] when locationId is empty (skip API call silently)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const provider = new SquareWorkshopProvider({ ...config, locationId: '' })
    const workshops = await provider.listWorkshops()
    expect(workshops).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/providers/square/workshop.test.ts`
Expected: FAIL — module `@providers/square/workshop` not found.

- [ ] **Step 3: Implement the provider**

Create `src/providers/square/workshop.ts`:

```typescript
import type { Workshop, WorkshopProvider } from '../interfaces/workshop'
import type { SquareConfig } from '@config/site.config'
import { createLogger } from '../../lib/logger'

const logger = createLogger('square-workshop')
const CLASSES_API_BASE = 'https://app.squareup.com/appointments/api/buyer/classes'

function formatDateWithOffset(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0')
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}${sign}${hours}:${minutes}`
}

export class SquareWorkshopProvider implements WorkshopProvider {
  constructor(private config: SquareConfig) {}

  async listWorkshops(): Promise<Workshop[]> {
    if (!this.config.locationId) {
      // Preserves today's behavior in workshops.astro (which guarded with `if (locationId)`)
      // and avoids logging spurious errors in sandbox/dev environments with no Square location.
      return []
    }
    const all = await this.fetchAll()
    return all
      .filter((w) => w.availableCapacity > 0)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  }

  async getWorkshop(id: string): Promise<Workshop | null> {
    if (!this.config.locationId) return null
    const all = await this.fetchAll()
    return all.find((w) => w.id === id) ?? null
  }

  private async fetchAll(): Promise<Workshop[]> {
    const locationId = this.config.locationId
    const now = new Date()
    const endDate = new Date()
    endDate.setFullYear(endDate.getFullYear() + 1)

    const requestBody = {
      cursor: null,
      sort: { field: 'START_AT' },
      query: {
        filter: {
          location_id: locationId,
          starting_at: {
            start_at: formatDateWithOffset(now),
            end_at: formatDateWithOffset(endDate),
          },
          status: 'CLASS_SCHEDULE_ACTIVE',
        },
      },
      includes: ['CLASS_SCHEDULE'],
      limit: 50,
    }

    const response = await fetch(
      `${CLASSES_API_BASE}/class_schedule_instances/search?unit_token=${locationId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Origin': 'https://book.squareup.com',
          'Referer': 'https://book.squareup.com/',
        },
        body: JSON.stringify(requestBody),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Classes API error', { status: response.status, error: errorText })
      throw new Error(`Square Classes API error: ${response.status}`)
    }

    const data: any = await response.json()
    const scheduleMap = new Map<string, any>()
    for (const schedule of data.included_resources?.class_schedules ?? []) {
      scheduleMap.set(schedule.id, schedule)
    }

    return (data.class_schedule_instances ?? []).map((instance: any): Workshop => {
      const details = scheduleMap.get(instance.class_schedule_id) ?? {}
      return {
        id: instance.id,
        scheduleId: instance.class_schedule_id,
        name: details.name ?? 'Unnamed Workshop',
        description: details.description ?? '',
        descriptionHtml: details.description_html ?? '',
        startAt: instance.start_at,
        durationMinutes: details.duration_minutes ?? 60,
        priceCents: details.price_amount ?? 0,
        priceCurrency: details.price_currency ?? 'USD',
        availableCapacity: instance.available_capacity ?? 0,
        staffName: details.staff_name ?? '',
        teamMemberId: details.team_member_id ?? '',
      }
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/providers/square/workshop.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/square/workshop.ts tests/providers/square/workshop.test.ts
git commit -m "$(cat <<'EOF'
refactor(workshops): add SquareWorkshopProvider wrapping buyer-classes API

Provider owns the Square mapping logic (ClassInstance shape → Workshop
domain type) and the capacity filter. Page/API consumers will use this
instead of importing getClassInstances directly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire `workshop` into the providers registry

**Files:**
- Modify: `src/config/providers.ts`

**Dependencies:** Tasks 2, 3

- [ ] **Step 1: Extend the existing `all providers have the correct methods` test**

Read `tests/config/providers.test.ts` first. It already has an `it('all providers have the correct methods', ...)` block (around lines 47–68) that asserts on every provider's method shape. Extend that block — do NOT add a separate describe — to match the project's canonical pattern:

```typescript
// Inside the existing it('all providers have the correct methods', ...) block,
// alongside the existing booking/payment/catalog/customer/capacity/notification assertions:
expect(typeof providers.workshop.listWorkshops).toBe('function')
expect(typeof providers.workshop.getWorkshop).toBe('function')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config/providers.test.ts`
Expected: FAIL — `providers.workshop` is undefined.

- [ ] **Step 3: Wire into providers.ts**

Modify `src/config/providers.ts`:

Add imports near other provider imports (around line 9–21):
```typescript
import type { WorkshopProvider } from '@providers/interfaces/workshop'
import { MockWorkshopProvider } from '@providers/mock/workshop'
import { SquareWorkshopProvider } from '@providers/square/workshop'
```

Add `workshop` to the `Providers` interface (around line 23–31):
```typescript
export interface Providers {
  booking: BookingProvider
  payment: PaymentProvider
  catalog: CatalogProvider
  capacity: CapacityProvider
  customer: CustomerProvider
  notification: NotificationProvider
  giftcard: GiftCardProvider | null
  workshop: WorkshopProvider
}
```

Inside `createProviders` (around line 37–59), add the `workshop` field after `customer`. Mirror the pattern used by every other Square provider — pass the full `SquareConfig` object (from `config.providers.booking.config`):
```typescript
    workshop: useMock
      ? new MockWorkshopProvider()
      : new SquareWorkshopProvider(config.providers.booking.config as SquareConfig),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config/providers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/providers.ts tests/config/providers.test.ts
git commit -m "$(cat <<'EOF'
refactor(workshops): register WorkshopProvider in the providers registry

Mock or Square is selected by the same useMock check as other providers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add `toWorkshopData` view-model helper

**Files:**
- Create: `src/components/workshops/workshop-view-model.ts`
- Create: `tests/components/workshop-view-model.test.ts`

**Dependencies:** Task 1

The page currently builds `WorkshopData` inline. Move that mapping into a single helper that takes a `Workshop` (domain) and returns a `WorkshopData` (view model). The `WorkshopData` shape stays the same so the four React components are unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/components/workshop-view-model.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { toWorkshopData } from '@components/workshops/workshop-view-model'
import type { Workshop } from '@providers/interfaces/workshop'

const SAMPLE: Workshop = {
  id: 'inst-1',
  scheduleId: 'sched-A',
  name: 'Glass Fusing',
  description: 'A class',
  descriptionHtml: '<p>A class</p>',
  startAt: '2026-06-10T17:00:00Z',
  durationMinutes: 120,
  priceCents: 6500,
  priceCurrency: 'USD',
  availableCapacity: 5,
  staffName: 'Kaden',
  teamMemberId: 'TM1',
}

describe('toWorkshopData', () => {
  it('derives the date string as YYYY-MM-DD from startAt', () => {
    const data = toWorkshopData(SAMPLE)
    expect(data.date).toBe('2026-06-10')
  })

  it('derives endTime by adding durationMinutes to startAt', () => {
    const data = toWorkshopData(SAMPLE)
    const end = new Date(data.endTime)
    const start = new Date(SAMPLE.startAt)
    expect(end.getTime() - start.getTime()).toBe(120 * 60 * 1000)
  })

  it('passes priceCents through as price (cents)', () => {
    const data = toWorkshopData(SAMPLE)
    expect(data.price).toBe(6500)
    expect(data.currency).toBe('USD')
  })

  it('sets remainingSeats from availableCapacity', () => {
    expect(toWorkshopData(SAMPLE).remainingSeats).toBe(5)
  })

  it('sets category to "workshop"', () => {
    expect(toWorkshopData(SAMPLE).category).toBe('workshop')
  })

  it('preserves classScheduleId and classScheduleInstanceId for the booking flow', () => {
    const data = toWorkshopData(SAMPLE)
    expect(data.classScheduleId).toBe('sched-A')
    expect(data.classScheduleInstanceId).toBe('inst-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/workshop-view-model.test.ts`
Expected: FAIL — module `@components/workshops/workshop-view-model` not found.

- [ ] **Step 3: Implement the helper**

Create `src/components/workshops/workshop-view-model.ts`:

```typescript
import type { Workshop } from '@providers/interfaces/workshop'
import type { WorkshopData } from './WorkshopExplorer'

/**
 * Build the UI view-model from a domain Workshop.
 * All derived fields (date string, endTime, etc.) are computed in this
 * single place — components consume WorkshopData directly.
 */
export function toWorkshopData(w: Workshop): WorkshopData {
  const start = new Date(w.startAt)
  const end = new Date(start.getTime() + w.durationMinutes * 60_000)
  // TODO(timezone): w.startAt is UTC ISO. `.split('T')[0]` returns the UTC
  // date string, but WorkshopCard/SearchView/CalendarView parse it as
  // local midnight. For a late-evening local time whose UTC equivalent
  // crosses midnight, the rendered date can be off by one day. Pre-existing
  // bug carried over from workshops.astro; resolve in the workshops-launch plan.
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    category: 'workshop',
    date: w.startAt.split('T')[0],
    startTime: w.startAt,
    endTime: end.toISOString(),
    duration: w.durationMinutes,
    price: w.priceCents,
    currency: w.priceCurrency,
    remainingSeats: w.availableCapacity,
    classScheduleId: w.scheduleId,
    classScheduleInstanceId: w.id,
    teamMemberId: w.teamMemberId,
    imageUrl: w.imageUrl,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/workshop-view-model.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/workshops/workshop-view-model.ts tests/components/workshop-view-model.test.ts
git commit -m "$(cat <<'EOF'
refactor(workshops): extract toWorkshopData view-model helper

Derives UI-shaped fields (date string, endTime, etc.) from the Workshop
domain type in a single place. Components stay unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Migrate `workshops.astro` to use `providers.workshop`

**Files:**
- Modify: `src/pages/workshops.astro`

**Dependencies:** Tasks 4, 5

- [ ] **Step 1: Replace the Square import and inline mapping**

Edit `src/pages/workshops.astro` lines 1–39. Replace the frontmatter with:

```astro
---
export const prerender = false

import Layout from '@layouts/Layout.astro'
import { providers } from '@config/providers'
import { toWorkshopData } from '@components/workshops/workshop-view-model'
import WorkshopExplorer from '@components/workshops/WorkshopExplorer'
import type { WorkshopData } from '@components/workshops/WorkshopExplorer'

let workshops: WorkshopData[] = []

try {
  const list = await providers.workshop.listWorkshops()
  workshops = list.map(toWorkshopData)
} catch {
  // Provider may be unavailable (e.g. sandbox)
}
---
```

Leave lines 41–53 (the `<Layout>` markup) unchanged.

- [ ] **Step 2: Manual verification — start the dev server and load the page**

Run: `npm run dev` (in background)
Then: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4321/workshops`
Expected: `200`.
Then check the dev server output file for `square-workshop` or `square-classes` log lines confirming the new provider is being hit.

After verification, stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/pages/workshops.astro
git commit -m "$(cat <<'EOF'
refactor(workshops): migrate workshops.astro to providers.workshop

Page no longer imports getClassInstances directly. Mapping to the UI
shape goes through the toWorkshopData helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Migrate `availability.json.ts`, update test mocks, delete `classes.ts`

**Files:**
- Modify: `src/pages/api/workshops/availability.json.ts`
- Modify: `tests/e2e/booking-flow.test.ts` (provider mock + fixture override)
- Delete: `src/providers/square/classes.ts` (zero callers after this task)

**Dependencies:** Task 4

**Why this task is large:** Migrating the endpoint without updating the e2e mock in the SAME commit leaves the test suite broken at HEAD (the mock has no `workshop` provider, so the migrated endpoint throws). And after this task, `classes.ts` has zero remaining callers — leaving it in the repo would contradict the plan's "delete dead code" goal. Bundling these into one commit avoids broken intermediate states.

**Response shape change — be explicit:** Today the endpoint returns the raw `ClassInstance[]` (with `price` in dollars). After this task it returns the raw `Workshop[]` (with `priceCents` in cents and renamed fields: `scheduleId` instead of `classScheduleId`, no `classScheduleInstanceId` since that *is* `id`). No frontend code currently calls `/api/workshops/availability.json` — only tests do (verified by `grep -rn 'workshops/availability' src/ tests/`). So we change the shape and update the tests; we do NOT add a translation layer to preserve the dollars contract.

- [ ] **Step 1: Read the current file**

Read `src/pages/api/workshops/availability.json.ts` end-to-end.

- [ ] **Step 2: Replace the Square import and the fetcher call**

Change the import at line 4 from:
```typescript
import { getClassInstances } from '@providers/square/classes'
```
to:
```typescript
import { providers } from '@config/providers'
```

Remove any `locationId` lookup (the provider owns its config now).

Replace `const classes = await getClassInstances(locationId)` with:
```typescript
const workshops = await providers.workshop.listWorkshops()
```

Replace every reference to `classes` (was `ClassInstance[]`) with `workshops` (is `Workshop[]`). Field mapping:
| Old (`ClassInstance`) | New (`Workshop`) |
|---|---|
| `c.id` | `w.id` |
| `c.classScheduleId` | `w.scheduleId` |
| `c.startAt` | `w.startAt` |
| `c.durationMinutes` | `w.durationMinutes` |
| `c.availableCapacity` | `w.availableCapacity` |
| `c.price` (dollars) | `w.priceCents` (cents) |

The endpoint's response body becomes `{ data: Workshop[] }` instead of `{ data: ClassInstance[] }`. This is intentional. Test updates are in Step 3.

- [ ] **Step 3: Update the e2e test mock**

Read `tests/e2e/booking-flow.test.ts`. In the `vi.mock('@config/providers', ...)` block (around lines 19–44), add the `workshop` and `giftcard` keys so the mock matches the full `Providers` interface:

```typescript
// Add these alongside the existing mock fields. mockListWorkshops is reused
// later by the "completes full wizard flow" test.
const mockListWorkshops = vi.fn(async () => [])
const mockGetWorkshop = vi.fn(async () => null)

// inside the providers mock object:
workshop: {
  listWorkshops: mockListWorkshops,
  getWorkshop: mockGetWorkshop,
},
giftcard: null,
```

In the "completes full wizard flow" test (the one that asserts `availData.data.toHaveLength(2)` — confirmed pre-existing failure per the plan review), add an override BEFORE the availability call so the new shape returns two `Workshop` items:

```typescript
mockListWorkshops.mockResolvedValueOnce([
  {
    id: 'inst-A', scheduleId: 'sched-A', name: 'Test WS 1',
    description: '', descriptionHtml: '', startAt: new Date(Date.now() + 86400000).toISOString(),
    durationMinutes: 60, priceCents: 5000, priceCurrency: 'USD',
    availableCapacity: 5, staffName: '', teamMemberId: '',
  },
  {
    id: 'inst-B', scheduleId: 'sched-B', name: 'Test WS 2',
    description: '', descriptionHtml: '', startAt: new Date(Date.now() + 172800000).toISOString(),
    durationMinutes: 60, priceCents: 5000, priceCurrency: 'USD',
    availableCapacity: 3, staffName: '', teamMemberId: '',
  },
])
```

If the test reads field names from the response (e.g. `data[0].price`), update those references to match the new shape (`priceCents`, `scheduleId`, etc.).

- [ ] **Step 4: Delete `classes.ts` (now orphaned)**

Confirm zero callers remain (workshops.astro and availability.json.ts are both migrated):
```bash
grep -rn "from '@providers/square/classes'" src/ tests/
grep -rn "ClassInstance" src/ tests/
```
Expected: zero matches for both.

Then delete:
```bash
rm src/providers/square/classes.ts
```

- [ ] **Step 5: Verify everything**

Run: `npx vitest run`
Expected: all suites green. The "completes full wizard flow" test should now PASS for the first time (it was failing pre-change).

Run: `npx astro check 2>&1 | tail -20`
Expected: no new errors.

Start dev server briefly and `curl -s -X POST http://localhost:4321/api/workshops/availability.json -H 'Content-Type: application/json' -d '{}' | head -c 500` — expect 200 (or 400 if request validation rejects empty body, fine either way; not 500). Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/workshops/availability.json.ts tests/e2e/booking-flow.test.ts
git rm src/providers/square/classes.ts
git commit -m "$(cat <<'EOF'
refactor(workshops): migrate availability.json + delete orphaned classes.ts

- availability.json now uses providers.workshop.listWorkshops()
- e2e mock includes workshop + giftcard entries (plus a fixture
  override for the previously-failing wizard flow test)
- classes.ts deleted — zero remaining callers after the migration
- Response shape changes from { data: ClassInstance[] (price in
  dollars) } to { data: Workshop[] (priceCents) }; no frontend
  callers exist, only tests, and those are updated in this commit

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Move the hard-coded class-booking app ID to a shared constant

**Files:**
- Modify: `src/config/site.config.ts`
- Modify: `src/components/workshops/WorkshopBookingModal.tsx`
- Modify: `src/components/reservations/steps/PaymentStep.tsx`

**Dependencies:** none (independent of provider work)

The hard-coded production class-booking app ID (`sq0idp-0WpGrONcXfCcfav3Lkd9Jg`) is required by Square's buyer-facing booking widget (see `square-class-bookings` memory) — it cannot be the merchant app ID. Move it to a single named export so it's reviewable instead of duplicated across components.

**Why a top-level export, not the `payment.config` object:** The `payment.config` object is set to `{}` in mock mode (see `siteConfig.providers.payment.config`). If we put `classBookingAppId` inside it, mock-mode renders pass `undefined` to `PaymentForm`, regressing the behavior we have today. A top-level `siteConfig.workshops.classBookingAppId` (or a separate named export) is set unconditionally and works in all modes.

**Note:** Two components currently hard-code this same string:
- `src/components/workshops/WorkshopBookingModal.tsx:461`
- `src/components/reservations/steps/PaymentStep.tsx:129`

Both must be updated together. If only one is patched, the duplication problem remains.

- [ ] **Step 1: Read both call sites and `site.config.ts` first**

Read `src/components/workshops/WorkshopBookingModal.tsx` (around line 461), `src/components/reservations/steps/PaymentStep.tsx` (around line 129), and `src/config/site.config.ts` end-to-end. Confirm both call sites use the literal `"sq0idp-0WpGrONcXfCcfav3Lkd9Jg"` with `environmentOverride="production"`.

- [ ] **Step 2: Add a named export in `site.config.ts`**

In `src/config/site.config.ts`, add a top-level named export (anywhere convenient, near the bottom is fine):

```typescript
/**
 * Square's published buyer-facing class-booking widget app ID. Required by
 * the buyer `class_bookings` API to accept Web Payments SDK tokens — the
 * merchant app ID is rejected (see square-class-bookings memory).
 * Set unconditionally so mock/dev mode still passes it to PaymentForm.
 */
export const CLASS_BOOKING_APP_ID = 'sq0idp-0WpGrONcXfCcfav3Lkd9Jg'
```

Do NOT add it to `SquareConfig` / `payment.config` (those are gated on `PROVIDER_MODE === 'square'`).

- [ ] **Step 3: Update `WorkshopBookingModal.tsx`**

At the top of the file, add:

```typescript
import { CLASS_BOOKING_APP_ID } from '@config/site.config'
```

Replace the hard-coded render at line 461:

```tsx
<PaymentForm ref={paymentFormRef} applicationIdOverride="sq0idp-0WpGrONcXfCcfav3Lkd9Jg" environmentOverride="production" />
```

with:

```tsx
<PaymentForm ref={paymentFormRef} applicationIdOverride={CLASS_BOOKING_APP_ID} environmentOverride="production" />
```

- [ ] **Step 4: Update `PaymentStep.tsx` (reservations flow — same string, same fix)**

Read `src/components/reservations/steps/PaymentStep.tsx` around line 129. Apply the same import and the same render change:

```typescript
import { CLASS_BOOKING_APP_ID } from '@config/site.config'
```

Then replace the literal `"sq0idp-0WpGrONcXfCcfav3Lkd9Jg"` at line ~129 with `{CLASS_BOOKING_APP_ID}` in the JSX.

- [ ] **Step 5: Verify no remaining hard-coded copies**

```bash
grep -rn "sq0idp-0WpGrONcXfCcfav3Lkd9Jg" src/
```
Expected: only the line in `src/config/site.config.ts` that defines the constant. Zero other matches.

- [ ] **Step 6: Manual verification**

Start dev server. Load `/workshops`, open a booking modal, advance to the payment step — Square form renders. Load `/book` (reservations), advance to the payment step — Square form renders. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/config/site.config.ts src/components/workshops/WorkshopBookingModal.tsx src/components/reservations/steps/PaymentStep.tsx
git commit -m "$(cat <<'EOF'
refactor(square): extract CLASS_BOOKING_APP_ID constant

The buyer-facing class-booking app ID was hard-coded in two
components (WorkshopBookingModal + reservations PaymentStep). Centralize
it as a named export so the constraint (see square-class-bookings memory)
is reviewable, and so both flows update in lockstep when the ID rotates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Delete dead `list.json` path and shadow type

**Files:**
- Delete: `src/pages/api/workshops/list.json.ts`
- Delete or modify: `tests/api/workshops.test.ts`
- Modify: `tests/e2e/booking-flow.test.ts` (remove `list.json` import only — `workshop` mock entry was added in Task 7)
- Modify: `src/lib/types.ts`

**Dependencies:** Tasks 4, 7

**Step ordering matters.** `tests/e2e/booking-flow.test.ts` has a top-level `await import('../../src/pages/api/workshops/list.json')` at module-init time (line 53). Deleting the source file BEFORE removing that import breaks the entire test suite at parse time. The steps below remove all references first, run the suite to confirm green, THEN delete the source file.

- [ ] **Step 1: Read `tests/api/workshops.test.ts` end-to-end**

It currently has tests for both `list.json` (GET) and `availability.json` (POST). The `list.json` tests will be deleted; the `availability.json` tests need updates since the endpoint's response shape changed in Task 7 (now returns `Workshop[]` with `priceCents`, not `ClassInstance[]` with `price`).

- [ ] **Step 2: Update `tests/api/workshops.test.ts` — remove `list.json` tests, update `availability.json` assertions**

Remove the import of `GET` from `@pages/api/workshops/list.json` and every `describe`/`it` block that calls `GET(ctx)`. Keep the `POST` (availability.json) tests but update any field-name assertions to match the new `Workshop` shape (e.g. `price` → `priceCents`, `classScheduleId` → `scheduleId`; check the actual file for what it asserts on).

If after the removal the file has no remaining `describe` blocks, delete the file entirely in Step 5.

- [ ] **Step 3: Remove the `list.json` reference in `tests/e2e/booking-flow.test.ts`**

Read the file. Remove the top-level `const workshopList = await import('../../src/pages/api/workshops/list.json')` at line 53 and any usage inside test bodies (line 91 per the grep). The e2e test should exercise availability and book, not list.

The `workshop` provider mock entry and the `mockListWorkshops.mockResolvedValueOnce([...])` override were ALREADY added in Task 7 — do not re-add them.

- [ ] **Step 4: Remove the shadow `WorkshopData` in `src/lib/types.ts`**

Read `src/lib/types.ts`. Delete the `WorkshopData` interface (lines 17–29). Confirm no callers exist anywhere — broaden the grep to catch relative imports too:

```bash
grep -rn "lib/types" src/ tests/ | grep -i WorkshopData
```
Expected: zero results. If there are hits, rewrite those imports to point at `@components/workshops/WorkshopExplorer`.

- [ ] **Step 5: Run the test suite — confirm green BEFORE deleting `list.json.ts`**

```bash
npx vitest run
```
Expected: PASS. If anything still references `list.json`, fix it now (the source file is still on disk, so this is the cheap moment to discover stragglers).

If `tests/api/workshops.test.ts` is now empty (no remaining `describe` blocks), delete it:
```bash
rm tests/api/workshops.test.ts
```

- [ ] **Step 6: NOW delete `list.json.ts`**

```bash
rm src/pages/api/workshops/list.json.ts
```

- [ ] **Step 7: Re-run the test suite to confirm**

```bash
npx vitest run
```
Expected: PASS — no broken imports, no orphaned tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(workshops): delete dead list.json path and shadow WorkshopData type

list.json had no callers in src/ — only tests referenced it. The
catalog-based path it queried was orphaned when classes.ts was added
for the buyer-facing API. Also remove the duplicate WorkshopData
interface in src/lib/types.ts; the authoritative one lives in
WorkshopExplorer.tsx.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Delete the empty `Workshop` catalog category in Square (one-shot)

**Files:**
- Create: `scripts/delete-empty-workshop-category.ts`

**Dependencies:** none (independent — can run anytime)

The research script discovered an empty `CATEGORY` named `"Workshop"` (`id: QXN2HDQQG2YBZBNLLKNFTZRC`) with no items in it. It is dead config in the Square account. Delete it via API.

**Safety requirements:**
- Script is **dry-run by default**. Pass `--confirm` to actually delete.
- Sanity-checks object type+name before doing anything.
- Logs `total items scanned` so a zero-iteration bug (wrong v44 unwrap shape) is visible — refuses to proceed if zero items were scanned (a real Square account always has at least one).
- Mirrors the v44 unwrap pattern (`response?.object ?? response`) used in `src/providers/square/catalog.ts`.
- Deletion is **one-way** — Square does not expose an undelete endpoint for catalog objects. Documented in the script's header comment.

- [ ] **Step 1: Create the script**

Create `scripts/delete-empty-workshop-category.ts`:

```typescript
import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

/**
 * One-shot script to delete the empty `Workshop` catalog CATEGORY left
 * over from the abandoned catalog-based workshops path.
 *
 * SAFETY:
 *   - Dry-run by default. Pass `--confirm` to actually delete.
 *   - Square catalog DELETE is permanent (no undelete endpoint).
 *   - Refuses to proceed if the object isn't the expected empty CATEGORY.
 *   - Refuses to proceed if the item-reference scan walked zero items
 *     (would indicate the v44 SDK iteration changed shape).
 */

const CATEGORY_ID = 'QXN2HDQQG2YBZBNLLKNFTZRC'
const CONFIRM = process.argv.includes('--confirm')

const token = process.env.SQUARE_ACCESS_TOKEN!
const env = process.env.SQUARE_ENVIRONMENT === 'production'
  ? SquareEnvironment.Production
  : SquareEnvironment.Sandbox

const client = new SquareClient({ token, environment: env })

async function main() {
  console.log(`Mode: ${CONFIRM ? 'DELETE (confirmed)' : 'DRY-RUN (pass --confirm to actually delete)'}`)
  console.log(`Square env: ${env}`)

  // 1. Sanity check the object.
  console.log(`\nFetching catalog object ${CATEGORY_ID}...`)
  const resp: any = await client.catalog.object.get({ objectId: CATEGORY_ID })
  const obj = (resp?.object ?? resp) as any
  console.log('Object:', JSON.stringify(obj, null, 2))
  if (obj?.type !== 'CATEGORY' || (obj?.categoryData?.name ?? '').toLowerCase() !== 'workshop') {
    console.error('\nObject is not the expected empty Workshop category. Aborting.')
    console.error('type:', obj?.type, 'name:', obj?.categoryData?.name)
    process.exit(1)
  }
  console.log('Confirmed: CATEGORY named Workshop.')

  // 2. Scan items for references.
  console.log('\nScanning items for references...')
  let totalItems = 0
  let referenceCount = 0
  for await (const o of await client.catalog.list({ types: 'ITEM' })) {
    totalItems++
    const item = o as any
    for (const cat of item.itemData?.categories ?? []) {
      if (cat.id === CATEGORY_ID) referenceCount++
    }
  }
  console.log(`Scanned ${totalItems} items; ${referenceCount} reference this category.`)
  if (totalItems === 0) {
    console.error('Scanned zero items — SDK iteration may have changed shape under v44. Aborting (no signal of safety).')
    process.exit(1)
  }
  if (referenceCount > 0) {
    console.error(`Refusing to delete: ${referenceCount} items still reference this category.`)
    process.exit(1)
  }
  console.log('No items reference this category. Safe to delete.')

  // 3. Delete (or dry-run).
  if (!CONFIRM) {
    console.log('\nDRY-RUN: would call client.catalog.object.delete with objectId =', CATEGORY_ID)
    console.log('Re-run with --confirm to actually delete.')
    return
  }
  console.log('\nDeleting (point of no return)...')
  await (client.catalog as any).object.delete({ objectId: CATEGORY_ID })
  console.log('Done.')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
```

- [ ] **Step 2: Run as dry-run first**

Run: `npx tsx scripts/delete-empty-workshop-category.ts`
Expected: prints the object JSON, scans items (non-zero count), prints "DRY-RUN: would call..." and exits.

If the SDK method `client.catalog.list({ types: 'ITEM' })` returns a different shape under v44 (e.g. you scanned zero items), fix the iteration pattern by reading `src/providers/square/catalog.ts` for the working v44 list pattern, then re-run.

- [ ] **Step 3: Run with `--confirm`**

Run: `npx tsx scripts/delete-empty-workshop-category.ts --confirm`
Expected: same sanity output, then "Deleting (point of no return)..." then "Done."

- [ ] **Step 4: Re-run the research script to confirm the category is gone**

Run: `npx tsx scripts/inspect-workshop-images.ts 2>&1 | grep -i "workshop"`
Expected: zero matches for the `Workshop` CATEGORY in the catalog listing.

- [ ] **Step 5: Commit**

```bash
git add scripts/delete-empty-workshop-category.ts
git commit -m "$(cat <<'EOF'
chore(workshops): add and run script to delete empty Workshop catalog category

Square account had a stale CATEGORY named Workshop (no items) left over
from the abandoned catalog-based workshops path. Script is dry-run by
default; --confirm triggers the destructive call. Verifies type, name,
zero references, and non-zero item-scan count before proceeding.
Square catalog delete is permanent — no rollback path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Final end-to-end verification

**Files:** none (verification only)

**Dependencies:** Tasks 1–10

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: PASS — all suites green.

- [ ] **Step 2: Astro type check**

Run: `npx astro check 2>&1 | tail -30`
Expected: no new errors compared to baseline (existing project warnings are fine).

- [ ] **Step 3: Production build**

Run: `npm run build 2>&1 | tail -15`
Expected: "Complete!" or success indicator, no module-resolution errors.

- [ ] **Step 4: Manual smoke test**

Start dev server, load `/workshops` in the browser, click a workshop, complete a booking step or two (use sandbox test card if env=sandbox: `4111 1111 1111 1111`). Confirm no regression — same behavior as before the refactor.

- [ ] **Step 5: Push dev**

```bash
git push origin dev
```

A Netlify preview will build (free). Confirm preview URL loads successfully.

---

## Self-Review

1. **Spec coverage:** All 6 stale items from the audit + the dead shadow type are addressed. Item 7 (modal state pattern) was verdicted "not stale" — no task.
2. **Placeholder scan:** No TBDs, no "implement appropriate X." Every code block is complete.
3. **Type consistency:** `Workshop` fields used in Tasks 2/3/5/6/7 match the Task 1 interface (`priceCents`, `scheduleId`, `availableCapacity`, optional `imageUrl`).
4. **Dependency ordering:** Tasks 2 and 3 both depend on Task 1; Task 4 on 2+3; Tasks 5–7 use the provider from Task 4; Task 9 depends on 4+7; Tasks 8 and 10 are independent and can run anytime; Task 11 is final.
5. **Command accuracy:** Vitest verified against `package.json` (`"vitest": "^4.0.18"`). Path aliases (`@providers/...`, `@components/...`, `@pages/...`) match existing test files. Test file paths follow the project convention (`tests/providers/mock/<name>.test.ts` and `tests/providers/square/<name>.test.ts`).

**Plan-review findings addressed (post-swarm revision):**

- P1 — Task 8 patches `PaymentStep.tsx` too (was missed).
- P2 — `CLASS_BOOKING_APP_ID` is a top-level named export, not inside `payment.config` (which is `{}` in mock mode and would have regressed).
- P3 — Task 7 explicitly deletes `classes.ts` after migration; not orphaned.
- P4 — Task 7 commit bundles the e2e mock update so no broken intermediate state.
- P5 — Task 9 reordered: all references removed first, then file deletion.
- P6 — Task 10 is dry-run by default with `--confirm` flag, item-count safety check, v44 unwrap pattern.
- P7 — Test paths updated to `tests/providers/mock/workshop.test.ts` and `tests/providers/square/workshop.test.ts`.
- P8 — Task 7 explicitly acknowledges the response shape change (`ClassInstance` → `Workshop`); test assertions updated.
- P9 — Task 7 adds `mockListWorkshops.mockResolvedValueOnce([...])` fixing the pre-existing wizard-flow test failure.
- N1 — `SquareWorkshopProvider` constructor takes full `SquareConfig` (consistency).
- N2 — `Workshop.imageUrl?: string` added now to ease the workshops-launch follow-up.
- N3 — `if (locationId)` guard moved into `SquareWorkshopProvider` (returns `[]` silently); page no longer needs the guard.
- N4 — Existing `'all providers'` test pattern extended; no separate describe block.
- N5 — `giftcard: null` added to the e2e mock alongside `workshop`.
- N6 — `TODO(timezone)` comment in `toWorkshopData` flags the pre-existing UTC-date bug for the workshops-launch plan to resolve.

**Note:** TDD steps simplified for purely structural tasks (Task 1 = no test, just compile-check; Task 6 = manual verification; Task 9 = remove refs + verify suite passes; Task 10 = one-shot script with dry-run). Tasks with real logic (2, 3, 4, 5) follow full red-green-refactor.
