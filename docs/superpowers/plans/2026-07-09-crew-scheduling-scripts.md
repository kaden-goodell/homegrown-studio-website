# Crew Scheduling & Store-Credit Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three API scripts from the staffing spec — add-team-member, post-open-shifts (weekly open slots moms claim in the Square Team app), and load-crew-credit (gift-card top-ups from timecards) — plus a runbook for Kaden.

**Architecture:** Pure logic (slot cutting, timezone conversion, hours/credit math) lives in `src/lib/crew/` with vitest coverage. Scripts in `scripts/team/` are thin CLIs following the existing `scripts/*.ts` pattern (dotenv + SquareClient, `npx tsx`). Idempotency: open shifts dedupe against Square itself (search-before-create); credit loads dedupe against a committed JSON ledger.

**Tech Stack:** TypeScript, square SDK v44 (`SquareClient`), tsx, vitest 4, dotenv. Production Square account (no sandbox for Labor/Team — this account's token is production; test data is created far in the future and cleaned up).

## Global Constraints

- Location ID: `LTHCH1W1J3Y4Q` (Homegrown Studio, Madison AL) — hardcode as `LOCATION_ID` in `scripts/team/square-helpers.ts`.
- Timezone: `America/Chicago`. All shift times are entered as Chicago local, stored as UTC RFC-3339.
- Business hours / slot template: Thu 4–9p (one slot), Fri 4–9p (one slot), Sat 9a–1p / 1–5p / 5–9p, Sun 2–5p / 5–8p.
- Job titles (exact): `Studio Assistant`, `Studio Crew`.
- SDK v44: money amounts are `bigint` cents (per memory `square-sdk-v44-shapes`); responses are unwrapped plain objects (`r.teamMember`, not `r.result.teamMember`).
- Scripts must NEVER touch Appointments bookability — creating team members via Team API leaves them non-bookable, which protects Kaden's phantom-availability booking model.
- Script style: match existing `scripts/add-party-craft.ts` — `import 'dotenv/config'`, `SquareClient` + `SquareEnvironment.Production`, `flag()` argv helper, usage message + `process.exit(1)` on bad input.
- Every script supports `--dry-run` where it mutates Square.
- Run tests with: `npx vitest run tests/lib/<file> --reporter=basic`.

---

### Task 1: Pure slot/timezone logic (`src/lib/crew/slots.ts`)

**Files:**
- Create: `src/lib/crew/slots.ts`
- Test: `tests/lib/crew-slots.test.ts`

**Interfaces:**
- Produces:
  - `SLOT_TEMPLATE: Record<number, Array<[number, number]>>` — day-of-week (0=Sun) → `[startHour, endHour]` pairs (24h floats, Chicago local)
  - `chicagoToUtc(date: string, hour: number): Date` — `'2026-07-25', 16` → UTC instant for 4pm Chicago that day
  - `cutSlots(weekStartMonday: string): Array<{ startAt: string; endAt: string; label: string }>` — RFC-3339 UTC strings for every template slot in the week beginning that Monday
  - `nextMonday(todayChicago: string): string` — `'2026-07-09'` → `'2026-07-13'`
  - `chicagoToday(): string` — today's date in Chicago as `YYYY-MM-DD`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/crew-slots.test.ts
import { describe, it, expect } from 'vitest'
import { chicagoToUtc, cutSlots, nextMonday, SLOT_TEMPLATE } from '../../src/lib/crew/slots'

describe('chicagoToUtc', () => {
  it('converts CDT (July, UTC-5)', () => {
    expect(chicagoToUtc('2026-07-25', 16).toISOString()).toBe('2026-07-25T21:00:00.000Z')
  })
  it('converts CST (December, UTC-6)', () => {
    expect(chicagoToUtc('2026-12-05', 16).toISOString()).toBe('2026-12-05T22:00:00.000Z')
  })
  it('handles half hours', () => {
    expect(chicagoToUtc('2026-07-25', 16.5).toISOString()).toBe('2026-07-25T21:30:00.000Z')
  })
})

describe('nextMonday', () => {
  it('from a Thursday', () => expect(nextMonday('2026-07-09')).toBe('2026-07-13'))
  it('from a Monday returns the following Monday', () => expect(nextMonday('2026-07-13')).toBe('2026-07-20'))
  it('from a Sunday', () => expect(nextMonday('2026-07-12')).toBe('2026-07-13'))
})

describe('cutSlots', () => {
  const slots = cutSlots('2026-07-20') // Mon; Thu=Jul 23, Fri=24, Sat=25, Sun=26
  it('produces 7 slots per week (1+1+3+2)', () => expect(slots).toHaveLength(7))
  it('Thu slot is 4–9p Chicago', () => {
    expect(slots[0]).toEqual({
      startAt: '2026-07-23T21:00:00.000Z',
      endAt: '2026-07-24T02:00:00.000Z',
      label: 'Thu 4:00p–9:00p',
    })
  })
  it('Sat has three slots starting 9a Chicago', () => {
    const sat = slots.filter((s) => s.label.startsWith('Sat'))
    expect(sat).toHaveLength(3)
    expect(sat[0].startAt).toBe('2026-07-25T14:00:00.000Z')
  })
  it('Sun last slot ends 8p Chicago', () => {
    expect(slots[slots.length - 1].endAt).toBe('2026-07-27T01:00:00.000Z')
  })
})

describe('SLOT_TEMPLATE', () => {
  it('covers only Thu–Sun', () => expect(Object.keys(SLOT_TEMPLATE).sort()).toEqual(['0', '4', '5', '6']))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/crew-slots.test.ts --reporter=basic`
Expected: FAIL — cannot resolve `src/lib/crew/slots`

- [ ] **Step 3: Implement**

```ts
// src/lib/crew/slots.ts
/**
 * Slot templates and timezone math for crew open shifts.
 * Hours are Chicago-local 24h floats; Square wants UTC RFC-3339.
 */

export const SLOT_TEMPLATE: Record<number, Array<[number, number]>> = {
  4: [[16, 21]], // Thu 4–9p
  5: [[16, 21]], // Fri 4–9p
  6: [[9, 13], [13, 17], [17, 21]], // Sat 9a–9p in three blocks
  0: [[14, 17], [17, 20]], // Sun 2–8p in two blocks
}

const TZ = 'America/Chicago'

function chicagoOffsetMinutes(utcInstant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  const p = Object.fromEntries(dtf.formatToParts(utcInstant).map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute)
  return (asUtc - utcInstant.getTime()) / 60000 // CDT: -300, CST: -360
}

export function chicagoToUtc(date: string, hour: number): Date {
  const [y, m, d] = date.split('-').map(Number)
  const naive = Date.UTC(y, m - 1, d, Math.floor(hour), Math.round((hour % 1) * 60))
  const offset = chicagoOffsetMinutes(new Date(naive))
  return new Date(naive - offset * 60000)
}

export function chicagoToday(): string {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
  return dtf.format(new Date()) // en-CA gives YYYY-MM-DD
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return t.toISOString().slice(0, 10)
}

function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function nextMonday(todayChicago: string): string {
  const dow = dayOfWeek(todayChicago)
  const delta = dow === 0 ? 1 : 8 - dow // always the NEXT Monday, never today
  return addDays(todayChicago, delta)
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtHour(h: number): string {
  const whole = Math.floor(h), min = Math.round((h % 1) * 60)
  const ampm = whole >= 12 ? 'p' : 'a'
  const h12 = whole % 12 === 0 ? 12 : whole % 12
  return `${h12}:${String(min).padStart(2, '0')}${ampm}`
}

export function cutSlots(weekStartMonday: string): Array<{ startAt: string; endAt: string; label: string }> {
  const out: Array<{ startAt: string; endAt: string; label: string }> = []
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStartMonday, i)
    const dow = dayOfWeek(date)
    for (const [startH, endH] of SLOT_TEMPLATE[dow] ?? []) {
      out.push({
        startAt: chicagoToUtc(date, startH).toISOString(),
        endAt: chicagoToUtc(date, endH).toISOString(),
        label: `${DAY_NAMES[dow]} ${fmtHour(startH)}–${fmtHour(endH)}`,
      })
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/crew-slots.test.ts --reporter=basic`
Expected: PASS (all 10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/crew/slots.ts tests/lib/crew-slots.test.ts
git commit -m "feat(crew): slot template + Chicago timezone math for open-shift posting"
```

---

### Task 2: Pure credit math (`src/lib/crew/credit.ts`)

**Files:**
- Create: `src/lib/crew/credit.ts`
- Test: `tests/lib/crew-credit.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `timecardHours(tc: { startAt: string; endAt?: string; breaks?: Array<{ startAt: string; endAt?: string }> }): number` — decimal hours worked, breaks subtracted; returns 0 for open (no `endAt`) timecards
  - `computeCreditCents(hours: number, rateDollarsPerHour: number): bigint` — rounded to the cent, as bigint for the SDK
  - `ledgerKey(teamMemberId: string, from: string, to: string): string` — `"TM123|2026-07-20|2026-08-02"`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/crew-credit.test.ts
import { describe, it, expect } from 'vitest'
import { timecardHours, computeCreditCents, ledgerKey } from '../../src/lib/crew/credit'

describe('timecardHours', () => {
  it('computes simple duration', () => {
    expect(timecardHours({ startAt: '2026-07-25T14:00:00Z', endAt: '2026-07-25T18:00:00Z' })).toBe(4)
  })
  it('subtracts breaks', () => {
    expect(timecardHours({
      startAt: '2026-07-25T14:00:00Z', endAt: '2026-07-25T18:00:00Z',
      breaks: [{ startAt: '2026-07-25T15:00:00Z', endAt: '2026-07-25T15:30:00Z' }],
    })).toBe(3.5)
  })
  it('returns 0 for an open timecard (still clocked in)', () => {
    expect(timecardHours({ startAt: '2026-07-25T14:00:00Z' })).toBe(0)
  })
  it('ignores an unfinished break', () => {
    expect(timecardHours({
      startAt: '2026-07-25T14:00:00Z', endAt: '2026-07-25T18:00:00Z',
      breaks: [{ startAt: '2026-07-25T15:00:00Z' }],
    })).toBe(4)
  })
})

describe('computeCreditCents', () => {
  it('whole hours at whole rate', () => expect(computeCreditCents(4, 15)).toBe(6000n))
  it('rounds to the cent', () => expect(computeCreditCents(3.33, 12.5)).toBe(4163n)) // 41.625 → 41.63
  it('zero hours → zero', () => expect(computeCreditCents(0, 15)).toBe(0n))
})

describe('ledgerKey', () => {
  it('joins with pipes', () => expect(ledgerKey('TMx', '2026-07-20', '2026-08-02')).toBe('TMx|2026-07-20|2026-08-02'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/crew-credit.test.ts --reporter=basic`
Expected: FAIL — cannot resolve `src/lib/crew/credit`

- [ ] **Step 3: Implement**

```ts
// src/lib/crew/credit.ts
/** Timecard → hours → gift-card credit math. Pure; no SDK imports. */

type BreakLike = { startAt: string; endAt?: string }
type TimecardLike = { startAt: string; endAt?: string; breaks?: BreakLike[] }

export function timecardHours(tc: TimecardLike): number {
  if (!tc.endAt) return 0
  let ms = Date.parse(tc.endAt) - Date.parse(tc.startAt)
  for (const b of tc.breaks ?? []) {
    if (b.endAt) ms -= Date.parse(b.endAt) - Date.parse(b.startAt)
  }
  return ms / 3_600_000
}

export function computeCreditCents(hours: number, rateDollarsPerHour: number): bigint {
  return BigInt(Math.round(hours * rateDollarsPerHour * 100))
}

export function ledgerKey(teamMemberId: string, from: string, to: string): string {
  return `${teamMemberId}|${from}|${to}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/crew-credit.test.ts --reporter=basic`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/crew/credit.ts tests/lib/crew-credit.test.ts
git commit -m "feat(crew): timecard-hours and credit-cents math"
```

---

### Task 3: Shared Square helpers (`scripts/team/square-helpers.ts`)

**Files:**
- Create: `scripts/team/square-helpers.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `client: SquareClient` (production, from `SQUARE_ACCESS_TOKEN`)
  - `LOCATION_ID = 'LTHCH1W1J3Y4Q'`
  - `JOB_TITLES = { assistant: 'Studio Assistant', crew: 'Studio Crew' } as const`
  - `getOrCreateJob(title: string): Promise<string>` — job id
  - `findCrewMembers(): Promise<Array<{ id: string; name: string; email?: string }>>` — ACTIVE team members whose wage setting has a `Studio Crew` job assignment
  - `flag(name: string): string | undefined` and `hasFlag(name: string): boolean` — argv helpers (same style as existing scripts)

No unit tests (thin SDK glue, exercised by the Task 6 live smoke). This task is code + typecheck + commit.

- [ ] **Step 1: Implement**

```ts
// scripts/team/square-helpers.ts
import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

export const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment: SquareEnvironment.Production,
})

export const LOCATION_ID = 'LTHCH1W1J3Y4Q'
export const JOB_TITLES = { assistant: 'Studio Assistant', crew: 'Studio Crew' } as const

const argv = process.argv.slice(2)
export const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
export const hasFlag = (n: string) => argv.includes(`--${n}`)

export async function getOrCreateJob(title: string): Promise<string> {
  let cursor: string | undefined
  do {
    const r: any = await client.team.listJobs({ cursor })
    const hit = (r.jobs ?? []).find((j: any) => j.title === title)
    if (hit) return hit.id
    cursor = r.cursor
  } while (cursor)
  const created: any = await client.team.createJob({
    idempotencyKey: `job-${title.toLowerCase().replace(/\s+/g, '-')}`,
    job: { title, isTipEligible: false },
  })
  console.log(`Created job "${title}" → ${created.job.id}`)
  return created.job.id
}

export async function findCrewMembers(): Promise<Array<{ id: string; name: string; email?: string }>> {
  const r: any = await client.teamMembers.search({
    query: { filter: { locationIds: [LOCATION_ID], status: 'ACTIVE' } },
    limit: 100,
  })
  const out: Array<{ id: string; name: string; email?: string }> = []
  for (const tm of r.teamMembers ?? []) {
    try {
      const ws: any = await client.teamMembers.wageSetting.get({ teamMemberId: tm.id })
      const jobs = ws.wageSetting?.jobAssignments ?? []
      if (jobs.some((j: any) => j.jobTitle === JOB_TITLES.crew)) {
        out.push({ id: tm.id, name: `${tm.givenName ?? ''} ${tm.familyName ?? ''}`.trim(), email: tm.emailAddress })
      }
    } catch { /* members with no wage setting are not crew */ }
  }
  return out
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p . 2>&1 | grep scripts/team || echo CLEAN`
Expected: `CLEAN` (or only pre-existing errors from other files; none from `scripts/team/`)

- [ ] **Step 3: Commit**

```bash
git add scripts/team/square-helpers.ts
git commit -m "feat(crew): shared Square client helpers — jobs, crew lookup, argv"
```

---

### Task 4: `scripts/team/add-team-member.ts`

**Files:**
- Create: `scripts/team/add-team-member.ts`

**Interfaces:**
- Consumes: `client, LOCATION_ID, JOB_TITLES, flag, hasFlag, getOrCreateJob` from `./square-helpers`
- Produces: CLI only. Usage:
  `npx tsx scripts/team/add-team-member.ts --given Jess --family Reeves --email jess@x.com --phone "+12565550100" --job crew --wage 7.25 [--dry-run]`
  (`--job` accepts `crew` or `assistant`; `--wage` is dollars/hour)

- [ ] **Step 1: Implement**

```ts
// scripts/team/add-team-member.ts
import { client, LOCATION_ID, JOB_TITLES, flag, hasFlag, getOrCreateJob } from './square-helpers'

/**
 * Create a payroll/clock-in team member. Deliberately does NOT touch
 * Square Appointments — new members stay non-bookable, which keeps
 * Kaden's availability-blocking model intact.
 *
 * Usage:
 *   npx tsx scripts/team/add-team-member.ts --given Jess --family Reeves \
 *     --email jess@example.com --phone "+12565550100" --job crew --wage 7.25
 */

const given = flag('given'), family = flag('family'), email = flag('email'), phone = flag('phone')
const jobKey = flag('job') as keyof typeof JOB_TITLES | undefined
const wage = flag('wage')

if (!given || !family || !email || !jobKey || !JOB_TITLES[jobKey] || wage == null) {
  console.error('Usage: add-team-member.ts --given <first> --family <last> --email <email> [--phone +1...] --job crew|assistant --wage <dollarsPerHour> [--dry-run]')
  process.exit(1)
}
const cents = Math.round(Number(wage) * 100)
if (!Number.isFinite(cents) || cents < 725) {
  console.error(`--wage "${wage}" is invalid or below federal minimum ($7.25)`)
  process.exit(1)
}
const jobTitle = JOB_TITLES[jobKey]

async function main() {
  if (hasFlag('dry-run')) {
    console.log(`DRY RUN — would create ${given} ${family} <${email}> as ${jobTitle} @ $${wage}/hr`)
    return
  }
  const created: any = await client.teamMembers.create({
    idempotencyKey: `tm-${email}`,
    teamMember: {
      givenName: given, familyName: family, emailAddress: email,
      ...(phone ? { phoneNumber: phone } : {}),
      status: 'ACTIVE',
      assignedLocations: { assignmentType: 'EXPLICIT_LOCATIONS', locationIds: [LOCATION_ID] },
    },
  })
  const tm = created.teamMember
  console.log(`Created team member ${tm.id} (${tm.givenName} ${tm.familyName})`)

  await getOrCreateJob(jobTitle) // ensure the job exists with this exact title
  const ws: any = await client.teamMembers.wageSetting.update({
    teamMemberId: tm.id,
    wageSetting: {
      teamMemberId: tm.id,
      jobAssignments: [{
        jobTitle,
        payType: 'HOURLY',
        hourlyRate: { amount: BigInt(cents), currency: 'USD' },
      }],
      isOvertimeExempt: false,
    },
  })
  console.log(`Wage set: ${jobTitle} @ $${(cents / 100).toFixed(2)}/hr (wage setting v${ws.wageSetting?.version})`)
  console.log('\nNEXT (dashboard, Kaden): Staff → Team → invite to the Square Team app; set a POS passcode.')
  console.log('Do NOT enable this person in Appointments — they must stay non-bookable.')
}

main().catch((e) => { console.error(e?.body ?? e); process.exit(1) })
```

- [ ] **Step 2: Dry-run to verify arg parsing**

Run: `npx tsx scripts/team/add-team-member.ts --given Test --family Person --email test@example.com --job crew --wage 7.25 --dry-run`
Expected: `DRY RUN — would create Test Person <test@example.com> as Studio Crew @ $7.25/hr`

Run: `npx tsx scripts/team/add-team-member.ts --given X --family Y --email z@z.z --job crew --wage 5`
Expected: exits 1 with the below-minimum error.

- [ ] **Step 3: Commit**

```bash
git add scripts/team/add-team-member.ts
git commit -m "feat(crew): add-team-member script — Team API + hourly wage, never bookable"
```

---

### Task 5: `scripts/team/post-open-shifts.ts`

**Files:**
- Create: `scripts/team/post-open-shifts.ts`

**Interfaces:**
- Consumes: `client, LOCATION_ID, JOB_TITLES, flag, hasFlag, getOrCreateJob` from `./square-helpers`; `cutSlots, nextMonday, chicagoToday` from `../../src/lib/crew/slots`
- Produces: CLI only. Usage:
  `npx tsx scripts/team/post-open-shifts.ts [--week 2026-07-20|next] [--copies 2] [--dry-run]`
  Default week = `next` (the Monday after today, Chicago time). Idempotent: slots that already have a scheduled shift with the same start+end are skipped.

- [ ] **Step 1: Implement**

```ts
// scripts/team/post-open-shifts.ts
import { client, LOCATION_ID, JOB_TITLES, flag, hasFlag, getOrCreateJob } from './square-helpers'
import { cutSlots, nextMonday, chicagoToday } from '../../src/lib/crew/slots'

/**
 * Publish the week's "Studio Crew" open shifts so moms can claim them in
 * the Square Team app (they tap Request; Kaden approves the push).
 * Run weekly: npx tsx scripts/team/post-open-shifts.ts
 */

const weekArg = flag('week') ?? 'next'
const week = weekArg === 'next' ? nextMonday(chicagoToday()) : weekArg
if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
  console.error(`--week must be YYYY-MM-DD (a Monday) or "next", got "${weekArg}"`)
  process.exit(1)
}
const copies = Number(flag('copies') ?? 1)

async function main() {
  const slots = cutSlots(week)
  console.log(`Week of ${week}: ${slots.length} template slots × ${copies} cop${copies === 1 ? 'y' : 'ies'}`)

  const existing: any = await client.labor.searchScheduledShifts({
    query: {
      filter: {
        locationIds: [LOCATION_ID],
        start: { startAt: slots[0].startAt, endAt: slots[slots.length - 1].endAt },
      },
    },
    limit: 200,
  })
  const taken = new Map<string, number>()
  for (const s of existing.scheduledShifts ?? []) {
    const d = s.draftShiftDetails ?? {}
    if (d.isDeleted) continue
    const k = `${d.startAt}|${d.endAt}`
    taken.set(k, (taken.get(k) ?? 0) + 1)
  }

  const jobId = await getOrCreateJob(JOB_TITLES.crew)
  const createdIds: string[] = []
  for (const slot of slots) {
    const have = taken.get(`${slot.startAt}|${slot.endAt}`) ?? 0
    const need = Math.max(0, copies - have)
    if (need === 0) { console.log(`  = ${slot.label} — already posted (${have})`); continue }
    for (let i = 0; i < need; i++) {
      if (hasFlag('dry-run')) { console.log(`  + ${slot.label} (DRY RUN)`); continue }
      const r: any = await client.labor.createScheduledShift({
        idempotencyKey: `open-${week}-${slot.startAt}-${i}`,
        scheduledShift: {
          draftShiftDetails: {
            locationId: LOCATION_ID,
            jobId,
            startAt: slot.startAt,
            endAt: slot.endAt,
            notes: 'Studio Crew open shift — claim in the Team app',
            // no teamMemberId → this is an OPEN shift
          },
        },
      })
      createdIds.push(r.scheduledShift.id)
      console.log(`  + ${slot.label} → ${r.scheduledShift.id}`)
    }
  }

  if (createdIds.length && !hasFlag('dry-run')) {
    const shifts: Record<string, { version?: number }> = {}
    for (const id of createdIds) shifts[id] = {}
    await client.labor.bulkPublishScheduledShifts({
      scheduledShifts: shifts,
      scheduledShiftNotificationAudience: 'AFFECTED',
    })
    console.log(`Published ${createdIds.length} open shifts. Moms can now claim them in the Team app.`)
  } else if (!createdIds.length) {
    console.log('Nothing new to publish.')
  }
}

main().catch((e) => { console.error(e?.body ?? e); process.exit(1) })
```

- [ ] **Step 2: Dry-run against a far-future week**

Run: `npx tsx scripts/team/post-open-shifts.ts --week 2026-09-07 --dry-run`
Expected: lists 7 `+` lines (Thu/Fri/3×Sat/2×Sun), `Nothing new to publish.` — and no writes. If `searchScheduledShifts` rejects the filter shape, fix field names against the error message (the API is new; the response error names the expected field).

- [ ] **Step 3: Commit**

```bash
git add scripts/team/post-open-shifts.ts
git commit -m "feat(crew): weekly open-shift posting script (idempotent, publish to Team app)"
```

---

### Task 6: Live smoke test — jobs, one open shift, cleanup

Production account; use week `2026-09-07` (far future) and delete afterward. Only Kaden + Catherine are active team members, so a stray publish is harmless — but clean up anyway.

**Files:** none created (terminal session only).

- [ ] **Step 1: Create both jobs for real**

Run: `node -e "..."` is not needed — run:
```bash
npx tsx -e "import('./scripts/team/square-helpers').then(async m => { console.log('crew job:', await m.getOrCreateJob(m.JOB_TITLES.crew)); console.log('assistant job:', await m.getOrCreateJob(m.JOB_TITLES.assistant)) })"
```
Expected: two job ids printed (created on first run, found on second). Run twice to confirm idempotency.

- [ ] **Step 2: Post one real week far in the future**

Run: `npx tsx scripts/team/post-open-shifts.ts --week 2026-09-07`
Expected: 7 shifts created + `Published 7 open shifts...`

Run again: `npx tsx scripts/team/post-open-shifts.ts --week 2026-09-07`
Expected: all 7 lines show `= ... already posted (1)`, `Nothing new to publish.` — idempotency proven against Square itself.

- [ ] **Step 3: Verify in dashboard (Kaden) and clean up**

Ask Kaden to glance at Dashboard → Staff → Shifts → Schedule, week of Sep 7 — seven open "Studio Crew" shifts should be visible. Then delete the test shifts:

```bash
npx tsx -e "
import('./scripts/team/square-helpers').then(async ({ client, LOCATION_ID }) => {
  const r = await client.labor.searchScheduledShifts({
    query: { filter: { locationIds: [LOCATION_ID], start: { startAt: '2026-09-07T00:00:00Z', endAt: '2026-09-14T00:00:00Z' } } }, limit: 200,
  })
  for (const s of r.scheduledShifts ?? []) {
    const d = s.draftShiftDetails
    await client.labor.updateScheduledShift({ id: s.id, scheduledShift: { draftShiftDetails: { ...d, isDeleted: true }, version: s.version } })
    await client.labor.publishScheduledShift({ id: s.id, idempotencyKey: 'del-' + s.id, version: s.version + 1 })
    console.log('deleted', s.id)
  }
})"
```
Expected: 7 `deleted` lines; the dashboard week is empty again. (If the update/publish shape errors, adjust per the error message — the delete semantics are draft-edit-then-publish.)

- [ ] **Step 4: Commit nothing — record results**

Append actual API-shape corrections (if any were needed) to `docs/superpowers/plans/2026-07-09-crew-scheduling-scripts.md` as a note under this task, and commit that:
```bash
git add docs/superpowers/plans/2026-07-09-crew-scheduling-scripts.md
git commit -m "docs(crew): record live smoke results for scheduled-shift API shapes"
```

**Live smoke results (2026-07-09):** two API-shape corrections were needed and are in the committed script: (1) `searchScheduledShifts` caps `limit` at 50 — paginate with `cursor`; (2) Square echoes shift timestamps in the location's local offset (`2026-09-10T16:00:00-05:00`), so slot dedupe keys must compare `Date.parse()` epochs, not ISO strings. Everything else (create → bulk publish with `scheduledShiftNotificationAudience: 'AFFECTED'`, delete via draft `isDeleted: true` + republish at the post-update version) worked exactly as planned. Jobs created: Studio Crew `NXiiWnzfkWztjQyaVwcgcWf4`, Studio Assistant `McrJcRogULT6L6Am9YuWuNDq`. Test week 2026-09-07 posted (7 shifts), re-run skipped all 7, then fully deleted (0 live remaining). `vitest --reporter=basic` no longer exists in vitest 4 — default reporter used.

---

### Task 7: `scripts/team/load-crew-credit.ts`

**Files:**
- Create: `scripts/team/load-crew-credit.ts`
- Create: `scripts/team/data/credit-ledger.json` (initial content: `{}`)

**Interfaces:**
- Consumes: `client, LOCATION_ID, flag, hasFlag, findCrewMembers` from `./square-helpers`; `timecardHours, computeCreditCents, ledgerKey` from `../../src/lib/crew/credit`
- Produces: CLI only. Usage:
  `npx tsx scripts/team/load-crew-credit.ts --from 2026-07-20 --to 2026-08-02 --rate 15 [--dry-run]`
  Ledger `scripts/team/data/credit-ledger.json` maps `ledgerKey` → `{ name, hours, cents, giftCardId, activityId, loadedAt }`; a key already present is skipped (idempotent re-runs). Ledger is committed to git after each run.

- [ ] **Step 1: Implement**

```ts
// scripts/team/load-crew-credit.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { client, LOCATION_ID, flag, hasFlag, findCrewMembers } from './square-helpers'
import { timecardHours, computeCreditCents, ledgerKey } from '../../src/lib/crew/credit'

/**
 * Pay-period store-credit top-up for the Studio Crew (moms).
 * Reads CLOSED timecards for the period, computes hours × rate, and loads
 * each mom's gift card with a promotional (no-payment) balance adjustment.
 * Idempotent via scripts/team/data/credit-ledger.json — commit it after runs.
 *
 * Usage: npx tsx scripts/team/load-crew-credit.ts --from 2026-07-20 --to 2026-08-02 --rate 15 [--dry-run]
 */

const from = flag('from'), to = flag('to'), rate = Number(flag('rate'))
if (!from || !to || !Number.isFinite(rate) || rate <= 0) {
  console.error('Usage: load-crew-credit.ts --from YYYY-MM-DD --to YYYY-MM-DD --rate <dollarsPerHour> [--dry-run]')
  process.exit(1)
}
const LEDGER_PATH = 'scripts/team/data/credit-ledger.json'
// Period bounds in Chicago local: from 00:00 CT through end-of-day on `to`.
const startAt = `${from}T00:00:00-05:00`
const endAt = `${to}T23:59:59-05:00`

async function giftCardFor(member: { id: string; name: string; email?: string }): Promise<any> {
  if (!member.email) throw new Error(`${member.name} has no email — cannot attach a gift card`)
  // 1. find-or-create the customer by email
  const found: any = await client.customers.search({
    query: { filter: { emailAddress: { exact: member.email } } }, limit: 1,
  })
  let customerId = found.customers?.[0]?.id
  if (!customerId) {
    const created: any = await client.customers.create({
      idempotencyKey: `crew-cust-${member.email}`,
      emailAddress: member.email,
      givenName: member.name.split(' ')[0],
      familyName: member.name.split(' ').slice(1).join(' ') || undefined,
      note: 'Studio Crew — store-credit compensation card holder',
    })
    customerId = created.customer.id
  }
  // 2. find-or-create the linked gift card
  const cards: any = await client.giftCards.list({ customerId })
  const existing = (cards.giftCards ?? [])[0]
  if (existing) return existing
  const gc: any = await client.giftCards.create({
    idempotencyKey: `crew-gc-${member.id}`,
    giftCard: { type: 'DIGITAL' },
  })
  await client.giftCards.linkCustomer({ giftCardId: gc.giftCard.id, customerId })
  return gc.giftCard
}

async function loadCredit(card: any, cents: bigint, key: string): Promise<string> {
  const base = { locationId: LOCATION_ID, giftCardId: card.id }
  const amountMoney = { amount: cents, currency: 'USD' as const }
  if (card.state === 'PENDING' || card.state === 'NOT_ACTIVE') {
    const r: any = await client.giftCards.activities.create({
      idempotencyKey: `act-${key}`,
      giftCardActivity: {
        type: 'ACTIVATE', ...base,
        activateActivityDetails: { amountMoney, buyerPaymentInstrumentIds: ['crew-credit'] },
      },
    })
    return r.giftCardActivity.id
  }
  const r: any = await client.giftCards.activities.create({
    idempotencyKey: `adj-${key}`,
    giftCardActivity: {
      type: 'ADJUST_INCREMENT', ...base,
      adjustIncrementActivityDetails: { amountMoney, reason: 'COMPLIMENTARY' },
    },
  })
  return r.giftCardActivity.id
}

async function main() {
  const ledger: Record<string, any> = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'))
  const crew = await findCrewMembers()
  if (!crew.length) { console.log('No Studio Crew members found.'); return }
  console.log(`Period ${from} → ${to} @ $${rate}/hr credit — ${crew.length} crew member(s)\n`)

  for (const member of crew) {
    const key = ledgerKey(member.id, from, to)
    if (ledger[key]) { console.log(`= ${member.name}: already loaded ${(ledger[key].cents / 100).toFixed(2)} on ${ledger[key].loadedAt}`); continue }

    const tcs: any = await client.labor.searchTimecards({
      query: { filter: { locationIds: [LOCATION_ID], teamMemberIds: [member.id], status: 'CLOSED', start: { startAt, endAt } } },
      limit: 200,
    })
    const hours = (tcs.timecards ?? []).reduce((sum: number, tc: any) => sum + timecardHours(tc), 0)
    const cents = computeCreditCents(hours, rate)
    if (cents === 0n) { console.log(`- ${member.name}: 0 hours, skipping`); continue }

    if (hasFlag('dry-run')) {
      console.log(`~ ${member.name}: ${hours.toFixed(2)} h → $${(Number(cents) / 100).toFixed(2)} (DRY RUN)`)
      continue
    }
    const card = await giftCardFor(member)
    const activityId = await loadCredit(card, cents, key)
    ledger[key] = { name: member.name, hours: Number(hours.toFixed(2)), cents: Number(cents), giftCardId: card.id, activityId, loadedAt: new Date().toISOString() }
    writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n')
    console.log(`+ ${member.name}: ${hours.toFixed(2)} h → $${(Number(cents) / 100).toFixed(2)} loaded (card ...${(card.gan ?? '').slice(-4)})`)
  }
  console.log('\nDone. Commit the ledger: git add scripts/team/data/credit-ledger.json && git commit -m "chore(crew): credit loads ' + from + '..' + to + '"')
}

main().catch((e) => { console.error(e?.body ?? e); process.exit(1) })
```

- [ ] **Step 2: Create the empty ledger and dry-run**

```bash
mkdir -p scripts/team/data && echo '{}' > scripts/team/data/credit-ledger.json
npx tsx scripts/team/load-crew-credit.ts --from 2026-07-01 --to 2026-07-08 --rate 15 --dry-run
```
Expected: `No Studio Crew members found.` (none exist yet) — proves the search path and arg parsing without writes.

- [ ] **Step 3: Commit**

```bash
git add scripts/team/load-crew-credit.ts scripts/team/data/credit-ledger.json
git commit -m "feat(crew): pay-period store-credit loader — timecards → gift-card top-ups"
```

---

### Task 8: Live gift-card round-trip test

Verifies the ACTIVATE/ADJUST_INCREMENT semantics with $1 against a real card linked to Kaden's own email, then reverses it.

**Files:** none (terminal only; ledger untouched — this test bypasses the script deliberately to isolate the gift-card calls).

- [ ] **Step 1: Create + load + verify + reverse**

```bash
npx tsx -e "
import('./scripts/team/square-helpers').then(async ({ client, LOCATION_ID }) => {
  const gc = await client.giftCards.create({ idempotencyKey: 'smoke-gc-1', giftCard: { type: 'DIGITAL' } })
  const card = gc.giftCard
  console.log('card', card.id, 'state', card.state)
  const act = await client.giftCards.activities.create({
    idempotencyKey: 'smoke-act-1',
    giftCardActivity: { type: 'ACTIVATE', locationId: LOCATION_ID, giftCardId: card.id,
      activateActivityDetails: { amountMoney: { amount: 100n, currency: 'USD' }, buyerPaymentInstrumentIds: ['crew-credit'] } },
  })
  console.log('activated, balance:', act.giftCardActivity.giftCardBalanceMoney)
  const dec = await client.giftCards.activities.create({
    idempotencyKey: 'smoke-act-2',
    giftCardActivity: { type: 'ADJUST_DECREMENT', locationId: LOCATION_ID, giftCardId: card.id,
      adjustDecrementActivityDetails: { amountMoney: { amount: 100n, currency: 'USD' }, reason: 'BALANCE_ACCIDENTALLY_INCREASED' } },
  })
  console.log('reversed, balance:', dec.giftCardActivity.giftCardBalanceMoney)
})"
```
Expected: `state PENDING` → `balance { amount: 100n }` → `balance { amount: 0n }`. If `ACTIVATE` rejects `buyerPaymentInstrumentIds: ['crew-credit']`, the error message names the accepted no-payment path — adjust `loadCredit()` in Task 7 accordingly and note the fix in this plan file.

**Live results (2026-07-09):** round-trip succeeded — `PENDING` card → ACTIVATE with `buyerPaymentInstrumentIds: ['crew-credit']` → $1.00 balance → ADJUST_DECREMENT → $0.00. One correction: `giftCards.create` requires top-level `locationId` (SDK client-side schema rejects without it); added to `giftCardFor()`. Test card `gftc:8dedbd36695743cebb503ecc2441fb7e` left at $0 balance, unlinked — harmless.

- [ ] **Step 2: Commit any corrections to load-crew-credit.ts**

```bash
git add scripts/team/load-crew-credit.ts docs/superpowers/plans/2026-07-09-crew-scheduling-scripts.md
git commit -m "fix(crew): gift-card activation shape per live API behavior"
```
(Skip if no corrections were needed.)

---

### Task 9: Runbook (`docs/CREW-OPERATIONS.md`)

**Files:**
- Create: `docs/CREW-OPERATIONS.md`

**Interfaces:** none — documentation for Kaden.

- [ ] **Step 1: Write the runbook**

Content must include, in this order (write real prose, not headings-only):

1. **One-time setup (Kaden, dashboard/state — in flight now):** AL withholding registration (myalabamataxes.alabama.gov), AL DOL unemployment account (labor.alabama.gov), subscribe Square Payroll (Dashboard → Staff → Payroll), enter both state account numbers + bank verification, add pay-as-you-go workers' comp in the payroll flow (required in AL at 5+ employees), verify Square Plus subscription is active (Settings → Pricing & subscriptions), pick pay frequency, assistant wage, and crew credit rate.
2. **Adding a person:** the `add-team-member.ts` command line for each job type, the reminder that Team-app invite + POS passcode are dashboard steps, and the hard rule: never enable anyone in Appointments (breaks the availability model).
3. **Weekly rhythm:** Monday — run `post-open-shifts.ts` (posts next week); as claims arrive — approve from the push notification; before the weekend — place Studio Assistants in Dashboard → Shifts → Schedule (drag-and-drop) and publish.
4. **Each pay period:** run Square Payroll (timecards import automatically; moms are in the run at $7.25/hr cash), then `load-crew-credit.ts --from <period start> --to <period end> --rate <credit rate>`, then commit the ledger. Note that gift-card credit is compensation — the CPA should confirm how its value is reported (imputed income).
5. **Costs:** $35/mo + $6/person paid (payroll), $0 scheduling (Square Plus), $0 credit loads.

- [ ] **Step 2: Commit**

```bash
git add docs/CREW-OPERATIONS.md
git commit -m "docs(crew): operations runbook — setup, weekly rhythm, pay-period credit loads"
```

---

## Self-Review Results

- **Spec coverage:** Phase 2 → Tasks 3–4; Phase 3 → Tasks 2, 7, 8; Phase 4 → Tasks 1, 5, 6; Phase 5 + Phase 1 checklist → Task 9. Phase 1 itself is Kaden-manual (not plannable code). ✓
- **Placeholder scan:** live-API-shape uncertainty in Tasks 5, 6, 8 is handled with explicit expected outputs and correction instructions, not "TBD". ✓
- **Type consistency:** `cutSlots` label/startAt/endAt used identically in Tasks 1 and 5; `ledgerKey`/`computeCreditCents` signatures match between Tasks 2 and 7; helper exports in Task 3 match all imports in Tasks 4, 5, 7. ✓
