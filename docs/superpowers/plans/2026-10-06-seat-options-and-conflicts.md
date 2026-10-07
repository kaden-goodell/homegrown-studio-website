# Seat Options, Sign-up Cutoffs and Class/Party Conflict Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a class ask each seat a required question (Pumpkin Pails: pumpkin colour), close sign-ups a set number of hours before a class, keep parties and classes out of each other's room time, and put an unmissable "Needs attention" panel (plus a daily email) on the staff console.

**Architecture:** One pure overlap rule (`src/lib/conflicts.ts`) backs every room-time guard: party times on offer, the party pre-charge re-check, class creation (CLI and in-tab Square step) and the warnings scan. One pure rules module (`src/lib/seat-options.ts`) backs questions, picks and cutoffs for the modal, the booking server, the staff sheet and the CLI. Settings live in the existing `event-meta` overlay store; picks live in a new `seat-choices` store and travel to Square only as a booking note. Every guard refuses the NEW thing and reports; nothing touches an existing booking.

**Tech Stack:** Astro 5 SSR (Netlify adapter), React 19 islands, TypeScript strict, Netlify Blobs (`makeKvStore`), Square buyer Classes API + Bookings SDK v44, nodemailer (Gmail), vitest 4 + React Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-06-seat-options-and-conflicts-design.md`

## Global Constraints

- Tests: `npx vitest run <file>`. Type check: `npx tsc --noEmit`. Build: `npm run build`. Never run `npx astro check` (it hangs on an install prompt).
- Commits: stage by explicit path (`git add <path> <path>`), never `git add -A`/`.`. Every commit message ends with a blank line then `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never run `git stash`, `git checkout -- <file>`, `git reset`, or `git clean`. Work stays on branch `kaden/seat-options`; no pushes inside tasks.
- HARD RULE (Kaden, 2026-10-06): no code path may cancel, move, release or refund a customer's booking, or delete a class schedule with bookings. Guards refuse the NEW thing and report the conflict; nothing auto-fixes. (The existing "release held seats after a refused card" in `book.json` is the customer's own un-paid hold and stays as it is.)
- Copy voice: short, plain sentences; no exclamation stacking; never "party" in class copy. The one modal line is exactly `Picks are made ahead for you, so they can’t be changed after you book.` (curly apostrophe, matching every other customer string on the site).
- Time zone: every studio time is America/Chicago. Use `studioDate`, `studioDayUtcRange`, `formatTime`, `formatTimeSpan`, `formatDay`, `formatCalendarDay` (`@lib/studio-time`) and `localToUtcISO` (`@lib/party-slots`). Never slice a UTC ISO string to get a calendar day.
- Cleanup buffer is `partyConfig.cleanupBufferMinutes` (60). Never write a literal 60 in logic (tests may assert the resulting times).
- Default sign-up cutoff: 0 h for a plain class, 24 h once `options.length > 0`; a class's `signupCutoffHours` overrides both. Cutoff hours are whole numbers 0–336.
- Seat question limits: ≤ 3 questions per class, label ≤ 40 chars, 2–12 choices, each choice ≤ 30 chars, no duplicate choices (case-insensitive). After the first seat-choice record exists: no adding/removing questions, no removing/renaming choices; adding choices and renaming a question are allowed.
- Stores: new blob store `makeKvStore('seat-choices', 'seat-choices')`, key `seat-choices-workshop:<scheduleId>-<bookingId>`. Event-meta keys stay `event-meta-<kind>:<id>`. Dev keeps both on disk under `.data/`.
- Square gets picks only as the class booking's `customer_note`, formatted `Pumpkin color: Lavender ×2` (questions joined with ` · `). A 4xx refusal with a note is retried once without it.
- Daily warnings: Netlify scheduled function `netlify/functions/daily-warnings.ts`, `schedule: '0 12 * * *'` (7 AM CDT / 6 AM CST), emails `siteConfig.ownerEmails` only when the list is non-empty, subject `⚠ Studio schedule needs attention (n)`. Netlify functions cannot import `@lib/*`, so the function only knocks on a site job endpoint signed with `LOOKUP_SIGNING_SECRET` (the `signup-emails` pattern).
- Staff endpoints answer 401 to anyone without the staff cookie (`staffAuthorized`), and 503 (never an empty "all clear") when a source they need can't be read.

## Review Focus

- Event settings unreadable at checkout (Blobs outage): `book.json` must refuse with `unavailable` before holding seats, so a class with questions is never sold without picks. Test in Task 20.
- Seats lowered after picking, then raised: the request carries picks for seats 1..n only, and seats added back show their earlier picks. Test in Task 19.
- An old or shared `/workshops?w=<id>` link to a class whose sign-ups have closed: a notice, never a booking panel. Test in Task 18.
- The party panel takes its times from `/api/party/available-dates.json`, not `availability.json`: class-blocked times must vanish there too, or a customer picks a time the pre-charge re-check then refuses. Test in Task 3.
- Square or Blobs down while scanning for warnings: the endpoint answers 503 and the panel shows a red "Couldn’t check the schedule" box with Try again, never nothing (which reads as all clear). Tests in Tasks 8 and 9.

---

## File Structure

| File | New/Modified | Responsibility |
|---|---|---|
| `src/lib/conflicts.ts` | new | Pure interval math: the one party/class overlap rule, spans, refusal text |
| `src/lib/party-availability.ts` | mod | Party starts drop class-blocked times; `classSpansBetween`, `classSpansOrNone` |
| `src/pages/api/party/available-dates.json.ts` | mod | Same rule for the panel's own time list |
| `src/pages/api/calendar.json.ts` | mod | Same rule for advertised party slots |
| `src/lib/class-guard.ts` | new | `findPartyClashes(start, minutes)` (server: bookings + host names) |
| `src/pages/api/staff/conflicts.json.ts` | new | Staff-only "would this class overlap a party?" |
| `scripts/create-class.ts` | mod | Refuses a class over a booked party (no `--force`) |
| `scripts/square-tab-schedule.js` | new | Two-tab browser snippet: studio check, then Square POST/PUT |
| `src/providers/interfaces/workshop.ts`, `src/providers/square/workshop.ts` | mod | `totalCapacity`; `reserveSeats` `note` + retry without it |
| `src/lib/warnings.ts` | new | `listWarnings({from,to})`, `warningLine` |
| `src/pages/api/staff/warnings.json.ts` | new | Staff-only warnings for the next 60 days |
| `src/components/staff/WarningsPanel.tsx`, `Today.tsx` | new/mod | Red panel above the door search |
| `src/pages/api/jobs/daily-warnings.json.ts`, `netlify/functions/daily-warnings.ts` | new | Daily owner email when non-empty |
| `src/lib/seat-options.ts` | new | Pure: question/choice/cutoff/pick rules and wording |
| `src/lib/seat-choices.ts` | new | `seat-choices` store + roster roll-up |
| `src/lib/event-meta.ts`, `src/lib/events.ts` | mod | `options`, `signupCutoffHours`, edit lock, `mergeEventMeta` |
| `src/pages/api/staff/event-meta.json.ts` | mod | Accepts and validates the new fields |
| `src/components/staff/EventSettingsSheet.tsx` | mod | "Questions for each seat" + "Sign-ups close" |
| `src/lib/event-meta-cli.ts`, `scripts/set-event.ts`, `scripts/set-dropoff.ts` | new/new/mod | CLI for all event settings; old name kept as alias |
| `src/components/workshops/WorkshopExplorer.tsx`, `workshop-view-model.ts`, `src/pages/api/workshops.json.ts` | mod | `options`, `signupClosesAt`, `signupClosed` on the public list |
| `src/components/workshops/WorkshopCard.tsx` | mod | "Sign-ups closed" label |
| `src/components/workshops/WorkshopBookingModal.tsx` | mod | Per-seat selects, picks in the request |
| `src/pages/api/workshops/book.json.ts` | mod | Cutoff + picks checks before holding; note; store picks after charge |
| `src/lib/email.ts` | mod | "Your picks" block |
| `src/pages/api/staff/roster.json.ts`, `src/components/staff/Roster.tsx`, `HouseholdCard.tsx`, `src/pages/staff/print.astro` | mod | Totals strip, per-family picks, unmatched list, print column |

Task order follows the spec's build order: E (Tasks 1–3) → F (4–6) → G (7–10) → A (11–16) → B (17–19) → C (20–24) → D (25–27) → gate (28). `src/lib/conflicts.ts` is Task 1 because E consumes it first. The `seat-choices` store module lands in A (Task 12) because A's edit lock needs to know whether anyone has picked; C wires the write. The `picks-missing` warning (G) lands as Task 24, once questions and picks exist.

---

### Task 1: One overlap rule for parties and classes (`src/lib/conflicts.ts`)

**Files:**
- Create: `src/lib/conflicts.ts`
- Test: `tests/lib/conflicts.test.ts`

**Interfaces:**
- Consumes: `partyConfig.durationMinutes`, `partyConfig.cleanupBufferMinutes` (`@config/party.config`); `formatDay`, `formatTime` (`@lib/studio-time`).
- Produces:
  - `interface Interval { start: number; end: number }` (epoch ms, half-open)
  - `interface ClassSpan { id: string; name: string; startIso: string; endIso: string }` (`id` = class schedule id)
  - `interface PartySpan { id: string; startIso: string; endIso: string; hostName?: string }` (`id` = Square booking id)
  - `overlaps(a: Interval, b: Interval, bufferMinutes = 0): boolean`
  - `intervalOf(span: { startIso: string; endIso: string }): Interval`
  - `classSpanOf(w: { scheduleId: string; name: string; startAt: string; durationMinutes: number }): ClassSpan`
  - `partySpanOf(b: { id: string; slot: { startAt: string; duration?: number } }, hostName?: string): PartySpan`
  - `classBlocksParty(partyStartIso: string, classes: ClassSpan[]): ClassSpan | null`
  - `partyBlocksClass(classStartIso: string, classEndIso: string, parties: PartySpan[]): PartySpan[]`
  - `removeClassBlocked(starts: string[], classes: ClassSpan[]): string[]`
  - `classesOverlap(a: ClassSpan, b: ClassSpan): boolean`
  - `partyName(p: PartySpan): string` ("the Rivera party" / "a party")
  - `partyClashMessage(clashes: PartySpan[]): string`

The rule (spec E and F reconciled): a party and a class clash when the party's own time overlaps `[class start − cleanup, class end]`. Spec E's literal wording also added cleanup after the party, which double-counts the hour and would kill the Saturday 4:30 PM party under every 7 PM class (the slot `partyDays.lastWrap` exists to protect). One hour between a party's end and a class's start; nothing required after a class (the spec's own example keeps the 3:30 PM Sunday party next to a 1–3 PM class).

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/conflicts.test.ts
import { describe, it, expect } from 'vitest'
import {
  overlaps,
  classSpanOf,
  partySpanOf,
  classBlocksParty,
  partyBlocksClass,
  removeClassBlocked,
  classesOverlap,
  partyName,
  partyClashMessage,
} from '@lib/conflicts'
import { localToUtcISO } from '@lib/party-slots'

// Sunday 18 Oct 2026, CDT (UTC-5).
const at = (hhmm: string, day = '2026-10-18') => localToUtcISO(day, hhmm)
const ms = (hhmm: string) => Date.parse(at(hhmm))
const PAILS = classSpanOf({ scheduleId: 'clssch_pails', name: 'Bedazzled Pumpkin Pails', startAt: at('13:00'), durationMinutes: 120 })

describe('overlaps', () => {
  it('is half-open: touching ends do not overlap', () => {
    expect(overlaps({ start: ms('10:00'), end: ms('11:00') }, { start: ms('11:00'), end: ms('12:00') })).toBe(false)
  })

  it('sees a plain overlap from either side', () => {
    const a = { start: ms('10:00'), end: ms('11:30') }
    const b = { start: ms('11:00'), end: ms('12:00') }
    expect(overlaps(a, b)).toBe(true)
    expect(overlaps(b, a)).toBe(true)
  })

  it('pulls b’s start earlier by the buffer, and only its start', () => {
    expect(overlaps({ start: ms('10:00'), end: ms('11:30') }, { start: ms('12:00'), end: ms('13:00') }, 60)).toBe(true)
    expect(overlaps({ start: ms('10:00'), end: ms('11:00') }, { start: ms('12:00'), end: ms('13:00') }, 60)).toBe(false)
    expect(overlaps({ start: ms('13:00'), end: ms('14:00') }, { start: ms('11:00'), end: ms('13:00') }, 60)).toBe(false)
  })
})

describe('classBlocksParty — Pumpkin Pails 1–3 PM on Sunday 18 Oct', () => {
  it('rules out the 1:00 PM party', () => {
    expect(classBlocksParty(at('13:00'), [PAILS])?.id).toBe('clssch_pails')
  })

  it('keeps the 3:30 PM party: nothing is needed after a class', () => {
    expect(classBlocksParty(at('15:30'), [PAILS])).toBeNull()
  })

  it('allows a party that ends exactly one cleanup before the class', () => {
    // 10:30 + 90 min = 12:00; the class needs the room from 12:00.
    expect(classBlocksParty(at('10:30'), [PAILS])).toBeNull()
  })

  it('refuses a party that ends one minute into the cleanup', () => {
    expect(classBlocksParty(at('10:31'), [PAILS])?.id).toBe('clssch_pails')
  })

  it('leaves the Saturday 4:30 PM party under a 7 PM class', () => {
    const evening = classSpanOf({ scheduleId: 's', name: 'Earrings', startAt: at('19:00', '2026-10-17'), durationMinutes: 120 })
    expect(classBlocksParty(at('16:30', '2026-10-17'), [evening])).toBeNull()
  })
})

describe('partyBlocksClass — the same rule from the class side', () => {
  const rivera = partySpanOf({ id: 'bk_1', slot: { startAt: at('13:00'), duration: 90 } }, 'Jamie Rivera')

  it('refuses a class starting inside the hour after a party', () => {
    expect(partyBlocksClass(at('15:00'), at('17:00'), [rivera]).map((p) => p.id)).toEqual(['bk_1'])
  })

  it('allows a class starting a full cleanup after the party ends', () => {
    expect(partyBlocksClass(at('15:30'), at('17:30'), [rivera])).toEqual([])
  })

  it('agrees with classBlocksParty for every half hour of the day', () => {
    for (let h = 8; h <= 19; h++) {
      for (const m of ['00', '30']) {
        const start = at(`${String(h).padStart(2, '0')}:${m}`)
        const asParty = partySpanOf({ id: 'x', slot: { startAt: start } })
        expect(classBlocksParty(start, [PAILS]) !== null).toBe(partyBlocksClass(PAILS.startIso, PAILS.endIso, [asParty]).length > 0)
      }
    }
  })
})

describe('spans', () => {
  it('a booking with no length counts as one standard party', () => {
    const p = partySpanOf({ id: 'bk_2', slot: { startAt: at('13:00') } })
    expect(p.endIso).toBe(at('14:30'))
    expect(p.hostName).toBeUndefined()
  })

  it('a class ends after its duration', () => {
    expect(PAILS).toEqual({ id: 'clssch_pails', name: 'Bedazzled Pumpkin Pails', startIso: at('13:00'), endIso: at('15:00') })
  })

  it('removeClassBlocked keeps only the Sunday 3:30 start next to Pails', () => {
    expect(removeClassBlocked([at('13:00'), at('15:30')], [PAILS])).toEqual([at('15:30')])
    expect(removeClassBlocked([at('13:00')], [])).toEqual([at('13:00')])
  })

  it('two classes at once overlap', () => {
    const needle = classSpanOf({ scheduleId: 'n', name: 'Needlepoint', startAt: at('18:00', '2026-10-23'), durationMinutes: 120 })
    const gcn = classSpanOf({ scheduleId: 'g', name: 'Girls Craft Night', startAt: at('19:00', '2026-10-23'), durationMinutes: 120 })
    const later = classSpanOf({ scheduleId: 'l', name: 'Later', startAt: at('20:00', '2026-10-23'), durationMinutes: 60 })
    expect(classesOverlap(needle, gcn)).toBe(true)
    expect(classesOverlap(needle, later)).toBe(false)
  })
})

describe('wording', () => {
  it('names a party by the host’s last name', () => {
    expect(partyName({ id: 'b', startIso: at('13:00'), endIso: at('14:30'), hostName: 'Jamie Rivera' })).toBe('the Rivera party')
    expect(partyName({ id: 'b', startIso: at('13:00'), endIso: at('14:30') })).toBe('a party')
  })

  it('prints time, host and booking id, then says what to do', () => {
    const msg = partyClashMessage([partySpanOf({ id: 'bk_1', slot: { startAt: at('13:00'), duration: 90 } }, 'Jamie Rivera')])
    expect(msg).toContain('Sun, Oct 18 · 1:00 PM party (Jamie Rivera), booking bk_1')
    expect(msg).toContain('Move the party in Square first (your call), then re-run.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/conflicts.test.ts`
Expected: FAIL with `Failed to resolve import "@lib/conflicts"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/conflicts.ts
/**
 * Room-time clashes between parties and classes. ONE rule, shared by every
 * guard: party times on offer, the party pre-charge re-check, class creation
 * (CLI and the in-tab Square step) and the warnings panel.
 *
 *   A party and a class clash when the party (its own length) overlaps the
 *   class window [class start − cleanup, class end].
 *
 * The cleanup is `partyConfig.cleanupBufferMinutes`: the room needs that long
 * after a party before a class starts. Nothing is needed after a class (the
 * Sunday 1–3 PM class leaves the 3:30 PM party in place).
 *
 * Pure: ISO strings in, answers out. No Square, no storage. Imported by
 * scripts/create-class.ts too (tsx resolves the @ aliases).
 */
import { partyConfig } from '@config/party.config'
import { formatDay, formatTime } from '@lib/studio-time'

const MINUTE_MS = 60_000

/** Epoch-ms interval, half-open [start, end): touching ends do not overlap. */
export interface Interval {
  start: number
  end: number
}

/** A class occurrence. `id` is the Square class schedule id. */
export interface ClassSpan {
  id: string
  name: string
  startIso: string
  endIso: string
}

/** A party booking. `id` is the Square booking id. */
export interface PartySpan {
  id: string
  startIso: string
  endIso: string
  hostName?: string
}

/**
 * Do `a` and `b` overlap once `b`'s start is pulled `bufferMinutes` earlier?
 * With the default 0 it is plain overlap, the same either way round.
 */
export function overlaps(a: Interval, b: Interval, bufferMinutes = 0): boolean {
  return a.start < b.end && b.start - bufferMinutes * MINUTE_MS < a.end
}

export function intervalOf(span: { startIso: string; endIso: string }): Interval {
  return { start: Date.parse(span.startIso), end: Date.parse(span.endIso) }
}

/** A class occurrence from the provider's Workshop shape. */
export function classSpanOf(w: { scheduleId: string; name: string; startAt: string; durationMinutes: number }): ClassSpan {
  const start = Date.parse(w.startAt)
  return {
    id: w.scheduleId,
    name: w.name,
    startIso: new Date(start).toISOString(),
    endIso: new Date(start + w.durationMinutes * MINUTE_MS).toISOString(),
  }
}

/** A party from a booking. A booking with no length counts as one standard party. */
export function partySpanOf(b: { id: string; slot: { startAt: string; duration?: number } }, hostName?: string): PartySpan {
  const start = Date.parse(b.slot.startAt)
  const minutes = b.slot.duration && b.slot.duration > 0 ? b.slot.duration : partyConfig.durationMinutes
  return {
    id: b.id,
    startIso: new Date(start).toISOString(),
    endIso: new Date(start + minutes * MINUTE_MS).toISOString(),
    ...(hostName ? { hostName } : {}),
  }
}

/** The class that rules out a party starting at `partyStartIso`, or null. */
export function classBlocksParty(partyStartIso: string, classes: ClassSpan[]): ClassSpan | null {
  const start = Date.parse(partyStartIso)
  const party: Interval = { start, end: start + partyConfig.durationMinutes * MINUTE_MS }
  return classes.find((c) => overlaps(party, intervalOf(c), partyConfig.cleanupBufferMinutes)) ?? null
}

/** Every party that rules out a class running [classStartIso, classEndIso). */
export function partyBlocksClass(classStartIso: string, classEndIso: string, parties: PartySpan[]): PartySpan[] {
  const cls: Interval = { start: Date.parse(classStartIso), end: Date.parse(classEndIso) }
  return parties.filter((p) => overlaps(intervalOf(p), cls, partyConfig.cleanupBufferMinutes))
}

/** Party starts with every class-blocked one taken out. */
export function removeClassBlocked(starts: string[], classes: ClassSpan[]): string[] {
  if (classes.length === 0) return starts
  return starts.filter((s) => !classBlocksParty(s, classes))
}

/** Two classes in the room at the same time. */
export function classesOverlap(a: ClassSpan, b: ClassSpan): boolean {
  return overlaps(intervalOf(a), intervalOf(b))
}

/** "the Rivera party" from host "Jamie Rivera"; "a party" when no name is known. */
export function partyName(p: PartySpan): string {
  const last = (p.hostName ?? '').trim().split(/\s+/).filter(Boolean).pop()
  return last ? `the ${last} party` : 'a party'
}

/** The refusal every class-creation path prints. There is no override. */
export function partyClashMessage(clashes: PartySpan[]): string {
  const lines = clashes.map(
    (p) => `  ${formatDay(p.startIso)} · ${formatTime(p.startIso)} party${p.hostName ? ` (${p.hostName})` : ''}, booking ${p.id}`,
  )
  return [
    `This class would overlap ${clashes.length === 1 ? 'a booked party' : `${clashes.length} booked parties`} (the room needs ${partyConfig.cleanupBufferMinutes} minutes after a party):`,
    ...lines,
    'Move the party in Square first (your call), then re-run.',
  ].join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/conflicts.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/conflicts.ts tests/lib/conflicts.test.ts
git commit -m "feat(conflicts): one party/class room-time rule with the cleanup hour

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Parties yield to classes in `openPartyStarts` (and the pre-charge re-check)

**Files:**
- Modify: `src/lib/party-availability.ts` (imports at top; `openPartyStarts` at lines 28–54)
- Test: `tests/lib/party-availability.test.ts`

**Interfaces:**
- Consumes: `classSpanOf`, `removeClassBlocked`, `ClassSpan` (Task 1).
- Produces:
  - `classSpansBetween(fromIso: string, toIso: string): Promise<ClassSpan[]>` — throws when classes can't be read.
  - `classSpansOrNone(fromIso: string, toIso: string): Promise<ClassSpan[]>` — logs and returns `[]` on failure (availability is never blocked by a class lookup).
  - `openPartyStarts(date, serviceVariationId?)` unchanged signature; now also drops class-blocked starts. `isStartOpen` inherits it (the book endpoint's pre-charge guard).

- [ ] **Step 1: Write the failing test**

In `tests/lib/party-availability.test.ts`, replace the `vi.mock('@config/providers', …)` block (lines 6–14) with:

```ts
const mockListBookings = vi.fn()
const mockListAllWorkshops = vi.fn()

vi.mock('@config/providers', () => ({
  providers: {
    booking: {
      listBookings: mockListBookings,
    },
    workshop: {
      listAllWorkshops: mockListAllWorkshops,
      listWorkshops: vi.fn(async () => []),
    },
  },
}))
```

In the existing `beforeEach`, add `mockListAllWorkshops.mockResolvedValue([])` after `mockListBookings.mockResolvedValue([])`. Then append:

```ts
// ── Parties yield to classes (spec E) ────────────────────────────────────────
function classAt(startAt: string, durationMinutes = 120) {
  return {
    id: 'inst-pails', scheduleId: 'clssch_pails', name: 'Bedazzled Pumpkin Pails', description: '', descriptionHtml: '',
    startAt, durationMinutes, priceCents: 2500, priceCurrency: 'USD', availableCapacity: 10, staffName: '', teamMemberId: '',
  }
}

describe('openPartyStarts — parties yield to classes', () => {
  // Thu 8 Oct 2026: Sunday 18 Oct is inside the booking window.
  const OCT_8 = new Date('2026-10-08T17:00:00.000Z')
  const SUN_1PM = '2026-10-18T18:00:00.000Z'
  const SUN_330PM = '2026-10-18T20:30:00.000Z'

  it('drops the 1:00 PM Sunday party when Pumpkin Pails runs 1–3 PM, and keeps 3:30', async () => {
    vi.setSystemTime(OCT_8)
    mockListAllWorkshops.mockResolvedValue([classAt(SUN_1PM)])
    const { openPartyStarts } = await import('@lib/party-availability')
    expect(await openPartyStarts('2026-10-18')).toEqual([SUN_330PM])
  })

  it('the pre-charge re-check refuses the class-blocked start', async () => {
    vi.setSystemTime(OCT_8)
    mockListAllWorkshops.mockResolvedValue([classAt(SUN_1PM)])
    const { isStartOpen } = await import('@lib/party-availability')
    expect(await isStartOpen(SUN_1PM)).toBe(false)
    expect(await isStartOpen(SUN_330PM)).toBe(true)
  })

  it('a class lookup that fails never blocks party availability', async () => {
    vi.setSystemTime(OCT_8)
    mockListAllWorkshops.mockRejectedValue(new Error('Square Classes API error: 503'))
    const { openPartyStarts } = await import('@lib/party-availability')
    expect(await openPartyStarts('2026-10-18')).toEqual([SUN_1PM, SUN_330PM])
    expect(mockListBookings).toHaveBeenCalledTimes(1)
  })

  it('a 7 PM Saturday class leaves every Saturday party in place', async () => {
    const { partyStartsForDate } = await import('@lib/party-slots')
    mockListAllWorkshops.mockResolvedValue([classAt('2027-08-08T00:00:00.000Z')]) // 7 PM CDT Sat 7 Aug 2027
    expect(await getOpen()).toEqual(partyStartsForDate(TEST_DATE))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/party-availability.test.ts`
Expected: FAIL — "drops the 1:00 PM Sunday party…" gets `['2026-10-18T18:00:00.000Z', '2026-10-18T20:30:00.000Z']`; the pre-charge test gets `true` for `SUN_1PM`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/party-availability.ts`, add to the imports:

```ts
import { createLogger } from '@lib/logger'
import { classSpanOf, removeClassBlocked, type ClassSpan } from '@lib/conflicts'

const logger = createLogger('party-availability')
```

Add above `openPartyStarts`:

```ts
/**
 * Classes on the calendar between two instants, in-progress and sold-out ones
 * included (`listAllWorkshops`). Never cached: the pre-charge re-check uses it
 * to decide a booking. Throws when classes can't be read.
 */
export async function classSpansBetween(fromIso: string, toIso: string): Promise<ClassSpan[]> {
  const w = providers.workshop
  const list = await (w.listAllWorkshops?.() ?? w.listWorkshops())
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  return list.map(classSpanOf).filter((c) => Date.parse(c.endIso) > from && Date.parse(c.startIso) < to)
}

/**
 * The same, but a failed lookup is logged and read as "no classes": party
 * availability is never blocked by it (spec E). The warnings panel catches
 * any overlap that slips through.
 */
export async function classSpansOrNone(fromIso: string, toIso: string): Promise<ClassSpan[]> {
  try {
    return await classSpansBetween(fromIso, toIso)
  } catch (err) {
    logger.error('Class lookup failed — party times not checked against classes', {
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}
```

Replace `openPartyStarts` (doc comment and body) with:

```ts
/**
 * Open start ISOs for a studio-local date: the schedule, minus past starts,
 * minus starts a class rules out (parties yield to classes, `@lib/conflicts`),
 * minus starts already booked.
 *
 * A failed class lookup is logged and ignored (never blocks booking). A failed
 * bookings lookup throws; callers decide (availability.json shows all
 * candidates; the book endpoint proceeds).
 */
export async function openPartyStarts(date: string, serviceVariationId?: string): Promise<string[]> {
  const now = Date.now()
  const candidates = partyStartsForDate(date).filter((iso) => new Date(iso).getTime() > now)
  if (candidates.length === 0) return candidates

  const { startIso, endIso } = studioDayUtcRange(date)
  const clear = removeClassBlocked(candidates, await classSpansOrNone(startIso, endIso))
  if (clear.length === 0 || !providers.booking.listBookings) return clear

  const bookings = await providers.booking.listBookings({
    startDate: startIso,
    endDate: endIso,
    locationId: siteConfig.providers.booking.config.locationId || '',
  })
  const bookedStarts = bookings
    .filter(
      (b) =>
        b.status !== 'cancelled' &&
        (!serviceVariationId || b.slot?.serviceVariationId === serviceVariationId)
    )
    .map((b) => b.slot.startAt)

  return removeBooked(clear, bookedStarts)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/party-availability.test.ts tests/api/party-book.test.ts`
Expected: PASS (the party book suite still passes: its providers mock has no `workshop`, so `classSpansOrNone` logs and returns `[]`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/party-availability.ts tests/lib/party-availability.test.ts
git commit -m "feat(party): party times yield to classes, incl. the pre-charge re-check

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The same rule for the panel's time list and the calendar

The party panel reads its times from `available-dates.json` ("the open times ride along with each date"), and the calendar advertises party slots from `calendar.json`. Neither goes through `openPartyStarts`, so without this task a customer could pick a class-blocked time that the pre-charge re-check then refuses.

**Files:**
- Modify: `src/pages/api/party/available-dates.json.ts:26-63`
- Modify: `src/pages/api/calendar.json.ts:122-133`
- Test: `tests/api/party-available-dates.test.ts`, `tests/api/calendar.test.ts`

**Interfaces:**
- Consumes: `classSpansOrNone` (Task 2), `removeClassBlocked`, `classSpanOf` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

In `tests/api/party-available-dates.test.ts`, replace the providers mock (lines 3–6) with:

```ts
const mockListBookings = vi.fn()
const mockListAllWorkshops = vi.fn()
vi.mock('@config/providers', () => ({
  providers: {
    booking: { listBookings: (...a: any[]) => mockListBookings(...a) },
    workshop: { listAllWorkshops: (...a: any[]) => mockListAllWorkshops(...a), listWorkshops: async () => [] },
  },
}))
```

In its `beforeEach` add `mockListAllWorkshops.mockReset().mockResolvedValue([])`, then append inside the `describe`:

```ts
  it('leaves out party times a class rules out, so the panel never offers them', async () => {
    mockListAllWorkshops.mockResolvedValue([
      { id: 'i', scheduleId: 'clssch_pails', name: 'Bedazzled Pumpkin Pails', startAt: '2026-10-18T18:00:00.000Z', durationMinutes: 120 },
    ])
    const { data } = await ask()
    expect(data.times['2026-10-18'].map((t: any) => t.startAt)).toEqual(['2026-10-18T20:30:00.000Z'])
  })

  it('offers every time when classes cannot be read', async () => {
    mockListAllWorkshops.mockRejectedValue(new Error('Square Classes API error: 503'))
    const { data } = await ask()
    expect(data.times['2026-10-18'].map((t: any) => t.startAt)).toEqual(['2026-10-18T18:00:00.000Z', '2026-10-18T20:30:00.000Z'])
  })
```

In `tests/api/calendar.test.ts`, append inside `describe('GET /api/calendar.json', …)`:

```ts
  it('does not advertise a party time a class rules out', async () => {
    mockListWorkshops.mockResolvedValue([workshop({ startAt: '2026-10-18T18:00:00.000Z', durationMinutes: 120, name: 'Bedazzled Pumpkin Pails' })])
    const october = (await getMonth('2026-10')).body.events.filter((e: any) => e.kind === 'party-available' && e.date === '2026-10-18')
    expect(october.map((e: any) => e.startTime)).toEqual(['15:30'])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/party-available-dates.test.ts tests/api/calendar.test.ts`
Expected: FAIL — available-dates returns both Sunday times; the calendar returns `['13:00', '15:30']`.

- [ ] **Step 3: Write minimal implementation**

`src/pages/api/party/available-dates.json.ts` — add imports:

```ts
import { classSpansOrNone } from '@lib/party-availability'
import { removeClassBlocked } from '@lib/conflicts'
```

Directly after `const starts = partyStartsInRange(now.toISOString(), windowEnd.toISOString())` add:

```ts
    // Parties yield to classes (spec E). The panel takes its times from here,
    // so the rule must hold here as well as in availability.json. A failed
    // class lookup offers every time (logged inside classSpansOrNone).
    const classes = starts.length > 0 ? await classSpansOrNone(now.toISOString(), windowEnd.toISOString()) : []
    const unblocked = removeClassBlocked(starts, classes)
```

and change the loop line `for (const startAt of removeBooked(starts, bookedStarts)) {` to:

```ts
    for (const startAt of removeBooked(unblocked, bookedStarts)) {
```

(`bookedDates` keeps using `starts`, so a date whose only times a class took shows as "Booked", not "not offered".)

`src/pages/api/calendar.json.ts` — add import:

```ts
import { classSpanOf, removeClassBlocked } from '@lib/conflicts'
```

and replace the `partyAvailable` expression with:

```ts
  // Parties yield to classes (spec E), then booked parties come off.
  const partyAvailable: PartyAvailabilitySlot[] = removeBooked(
    removeClassBlocked(offeredStarts, allWorkshops.map(classSpanOf)),
    partyBooked.map((b) => b.startAt)
  )
    .filter(inRangeIso)
    .map((startAt) => ({ startAt }))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/party-available-dates.test.ts tests/api/calendar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/party/available-dates.json.ts src/pages/api/calendar.json.ts tests/api/party-available-dates.test.ts tests/api/calendar.test.ts
git commit -m "feat(party): panel dates and calendar drop class-blocked party times

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Staff "would this class overlap a party?" endpoint

**Files:**
- Create: `src/lib/class-guard.ts`
- Create: `src/pages/api/staff/conflicts.json.ts`
- Test: `tests/api/staff-conflicts.test.ts`

**Interfaces:**
- Consumes: `partyBlocksClass`, `partySpanOf`, `partyClashMessage`, `PartySpan` (Task 1); `getPartyRecord` (`@lib/party-store`); `providers.booking.listBookings`.
- Produces:
  - `findPartyClashes(classStartIso: string, minutes: number): Promise<PartySpan[]>` — throws when bookings can't be read.
  - `GET /api/staff/conflicts.json?kind=workshop&start=<ISO>&minutes=<n>` → `200 { data: { ok: boolean; clashes: PartySpan[]; message: string } }`, `400 { error }`, `401`, `503 { error }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/staff-conflicts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 'k', name: 'Kaden', role: 'owner' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

const mockListBookings = vi.fn()
vi.mock('@config/providers', () => ({ providers: { booking: { listBookings: (...a: any[]) => mockListBookings(...a) } } }))
vi.mock('@config/site.config', () => ({ siteConfig: { providers: { booking: { config: { locationId: 'LOC' } } } } }))

const mockGetPartyRecord = vi.fn()
vi.mock('@lib/party-store', () => ({ getPartyRecord: (...a: any[]) => mockGetPartyRecord(...a) }))

import { GET } from '@pages/api/staff/conflicts.json'

const SUN_1PM = '2026-10-18T18:00:00.000Z'
const party = (id: string, startAt: string, status = 'confirmed') => ({ id, status, slot: { startAt, duration: 90 } })

function ctx(qs: string) {
  const url = new URL(`http://localhost/api/staff/conflicts.json?${qs}`)
  return { request: new Request(url), url } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  authed = { id: 'k', name: 'Kaden', role: 'owner' }
  mockListBookings.mockResolvedValue([])
  mockGetPartyRecord.mockImplementation(async (id: string) => (id === 'bk_1' ? { hostName: 'Jamie Rivera' } : null))
})

describe('GET /api/staff/conflicts.json', () => {
  it('rejects a caller without the staff cookie', async () => {
    authed = null
    expect((await GET(ctx(`kind=workshop&start=${SUN_1PM}&minutes=120`))).status).toBe(401)
    expect(mockListBookings).not.toHaveBeenCalled()
  })

  it.each([
    ['kind=party&start=2026-10-18T18:00:00.000Z&minutes=120'],
    ['kind=workshop&start=not-a-time&minutes=120'],
    ['kind=workshop&start=2026-10-18T18:00:00.000Z&minutes=0'],
    ['kind=workshop&start=2026-10-18T18:00:00.000Z&minutes=1.5'],
  ])('refuses %s', async (qs) => {
    expect((await GET(ctx(qs))).status).toBe(400)
  })

  it('reads that studio day’s bookings', async () => {
    await GET(ctx(`kind=workshop&start=${SUN_1PM}&minutes=120`))
    expect(mockListBookings).toHaveBeenCalledWith({ startDate: '2026-10-18T05:00:00.000Z', endDate: '2026-10-19T04:59:59.999Z', locationId: 'LOC' })
  })

  it('reports a clash with time, host and booking id, and what to do', async () => {
    mockListBookings.mockResolvedValue([party('bk_1', SUN_1PM)])
    const res = await GET(ctx(`kind=workshop&start=${SUN_1PM}&minutes=120`))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.ok).toBe(false)
    expect(data.clashes).toEqual([{ id: 'bk_1', startIso: SUN_1PM, endIso: '2026-10-18T19:30:00.000Z', hostName: 'Jamie Rivera' }])
    expect(data.message).toContain('1:00 PM party (Jamie Rivera), booking bk_1')
    expect(data.message).toContain('Move the party in Square first (your call), then re-run.')
  })

  it('is clear when the only party starts after the class ends', async () => {
    mockListBookings.mockResolvedValue([party('bk_2', '2026-10-18T20:30:00.000Z')])
    const { data } = await (await GET(ctx(`kind=workshop&start=${SUN_1PM}&minutes=120`))).json()
    expect(data.ok).toBe(true)
    expect(data.clashes).toEqual([])
  })

  it('ignores a cancelled party', async () => {
    mockListBookings.mockResolvedValue([party('bk_1', SUN_1PM, 'cancelled')])
    expect((await (await GET(ctx(`kind=workshop&start=${SUN_1PM}&minutes=120`))).json()).data.ok).toBe(true)
  })

  it('answers 503, never "clear", when bookings cannot be read', async () => {
    mockListBookings.mockRejectedValue(new Error('Square 500'))
    const res = await GET(ctx(`kind=workshop&start=${SUN_1PM}&minutes=120`))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/Don’t schedule/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/staff-conflicts.test.ts`
Expected: FAIL with `Failed to resolve import "@pages/api/staff/conflicts.json"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/class-guard.ts
/**
 * Server side of "no class over a booked party" (spec F). Read-only: it lists
 * bookings and reports; it never changes one.
 */
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { getPartyRecord } from '@lib/party-store'
import { studioDate, studioDayUtcRange } from '@lib/studio-time'
import { partyBlocksClass, partySpanOf, type PartySpan } from '@lib/conflicts'

/**
 * Non-cancelled parties a class running [classStartIso, +minutes) would
 * overlap, with host names when we hold the party's record. Throws when
 * bookings can't be read: callers refuse to schedule rather than guess.
 */
export async function findPartyClashes(classStartIso: string, minutes: number): Promise<PartySpan[]> {
  if (!providers.booking.listBookings) throw new Error('This booking provider cannot list bookings')
  const { startIso, endIso } = studioDayUtcRange(studioDate(classStartIso))
  const bookings = await providers.booking.listBookings({
    startDate: startIso,
    endDate: endIso,
    locationId: siteConfig.providers.booking.config.locationId || '',
  })
  const parties = await Promise.all(
    bookings
      .filter((b) => b.status !== 'cancelled')
      .map(async (b) => {
        const record = await getPartyRecord(b.id).catch(() => null)
        return partySpanOf(b, record?.hostName)
      }),
  )
  const classEndIso = new Date(Date.parse(classStartIso) + minutes * 60_000).toISOString()
  return partyBlocksClass(classStartIso, classEndIso, parties)
}
```

```ts
// src/pages/api/staff/conflicts.json.ts
import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { findPartyClashes } from '@lib/class-guard'
import { partyClashMessage } from '@lib/conflicts'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff:conflicts')
const MAX_MINUTES = 12 * 60

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Staff-only. `GET ?kind=workshop&start=<ISO>&minutes=<n>`: would a class at
 * that time overlap a booked party? The in-tab Square step
 * (scripts/square-tab-schedule.js) asks this before it creates or moves a
 * class, so the rule lives in one place. Read-only. A lookup failure is a
 * 503: the caller must not schedule on a guess.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) return json({ error: 'Unauthorized' }, 401)

  const kind = url.searchParams.get('kind')
  const start = url.searchParams.get('start') ?? ''
  const minutes = Number(url.searchParams.get('minutes'))
  if (kind !== 'workshop') return json({ error: 'Only kind=workshop is checked here.' }, 400)
  if (!start || Number.isNaN(Date.parse(start))) return json({ error: 'start must be an ISO time.' }, 400)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    return json({ error: `minutes must be a whole number from 1 to ${MAX_MINUTES}.` }, 400)
  }

  try {
    const clashes = await findPartyClashes(new Date(start).toISOString(), minutes)
    return json({
      data: {
        ok: clashes.length === 0,
        clashes,
        message: clashes.length === 0 ? 'No booked party in the way.' : partyClashMessage(clashes),
      },
    })
  } catch (err) {
    logger.error('Conflict check failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'Couldn’t read party bookings. Don’t schedule until this check passes.' }, 503)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/staff-conflicts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/class-guard.ts src/pages/api/staff/conflicts.json.ts tests/api/staff-conflicts.test.ts
git commit -m "feat(staff): conflicts endpoint — would this class overlap a booked party?

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `scripts/create-class.ts` refuses a class over a booked party

The script talks to Square through its own SDK client (not `providers`), so it lists that day's bookings with the same SDK call the provider uses and applies Task 1's pure rule. The decision logic is Task 1's, already tested; this task is wiring, verified by type check and a read-only dry run. There is no reschedule path in this script (moves happen in the Square tab, Task 6). No `--force`.

**Files:**
- Modify: `scripts/create-class.ts` (imports at lines 1–3; new function before `main`; call inside `main` before the `if (dryRun)` at line 250)

**Interfaces:**
- Consumes: `partyBlocksClass`, `partySpanOf`, `partyClashMessage` (Task 1); `studioDate`, `studioDayUtcRange` (`@lib/studio-time`).
- Produces: nothing exported.

- [ ] **Step 1: Write the change**

Add after `import { SquareClient, SquareEnvironment } from 'square'`:

```ts
import { partyBlocksClass, partySpanOf, partyClashMessage } from '../src/lib/conflicts'
import { studioDate, studioDayUtcRange } from '../src/lib/studio-time'
```

Add above `async function main() {`:

```ts
/**
 * HARD RULE (Kaden, 2026-10-06): a class is never created over a booked party.
 * Read-only: lists that studio day's bookings and exits 1 on any party that
 * overlaps [class start − cleanup, class end] (`@lib/conflicts`). It never
 * touches a booking, and there is no override.
 */
async function refuseIfPartyInTheWay(startIso: string, minutes: number): Promise<void> {
  const { startIso: from, endIso: to } = studioDayUtcRange(studioDate(startIso))
  const found: any[] = []
  // v44: bookings.list returns a paginator; iterate to collect.
  for await (const b of (await client.bookings.list({ locationId: locationId!, startAtMin: from, startAtMax: to })) as any) found.push(b)
  const live = found.filter((b) => !/^(CANCELLED|DECLINED)/.test(String(b.status ?? '')))
  const parties = await Promise.all(
    live.map(async (b) => {
      let hostName: string | undefined
      if (b.customerId) {
        try {
          const r: any = await client.customers.get({ customerId: b.customerId })
          const c = r?.customer ?? r
          hostName = [c?.givenName, c?.familyName].filter(Boolean).join(' ') || undefined
        } catch {
          // A name is a nicety; the refusal still prints the time and booking id.
        }
      }
      return partySpanOf({ id: b.id, slot: { startAt: b.startAt, duration: b.appointmentSegments?.[0]?.durationMinutes } }, hostName)
    }),
  )
  const endIso = new Date(Date.parse(startIso) + minutes * 60_000).toISOString()
  const clashes = partyBlocksClass(startIso, endIso, parties)
  if (clashes.length > 0) fail(partyClashMessage(clashes))
  console.log('  party check: no booked party in the way')
}
```

In `main`, directly after the three `console.log` lines that print the class (ending with the `duration:` line) and before `if (dryRun) {`, add:

```ts
  // Runs on --dry-run too: it only reads, so a dry run shows the refusal.
  await refuseIfPartyInTheWay(body.class_schedule.start_at, durationMinutes)
  if (rrule) console.log('  note: only the first date of a repeating series was checked for parties.')
```

Add to the header comment's flag list, after `--dry-run`:

```ts
 *
 * Party guard: before creating anything (and on --dry-run) the script reads
 * that day's bookings and refuses if a booked party overlaps the class or
 * the hour of cleanup before it. Move the party in Square first; there is
 * no --force.
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors in `scripts/create-class.ts`.

- [ ] **Step 3: Read-only dry run against Square**

Run: `npx tsx scripts/create-class.ts --name "Bedazzled Pumpkin Pails" --start "2026-10-18T13:00" --duration 120 --capacity 25 --dry-run`
Expected: either `party check: no booked party in the way` followed by `--dry-run, request body:`, or `✗ This class would overlap a booked party …` listing the party's time, host and booking id and ending `Move the party in Square first (your call), then re-run.` with exit code 1. Nothing is created in either case.

- [ ] **Step 4: Commit**

```bash
git add scripts/create-class.ts
git commit -m "feat(scripts): create-class refuses a class over a booked party

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: In-browser Square schedule step with the party check first (`scripts/square-tab-schedule.js`)

The staff cookie is `SameSite=Lax`, so a `fetch` from the `app.squareup.com` tab to the studio site never carries it (and the site sends no CORS headers). The snippet therefore runs in two tabs: `checkStudio` in a signed-in studio tab (same-origin) returns a clearance; `scheduleInSquare` in the signed-in Square tab refuses unless that clearance is ok, under 10 minutes old, and for the same start and length. The rule still lives only in `/api/staff/conflicts.json`.

**Files:**
- Create: `scripts/square-tab-schedule.js`
- Test: `tests/scripts/square-tab-schedule.test.ts`

**Interfaces:**
- Consumes: `GET /api/staff/conflicts.json` (Task 4).
- Produces (on `window.HometownSchedule`):
  - `checkStudio({ start: string; minutes: number; origin?: string }): Promise<{ ok: boolean; message: string; start: string; minutes: number; checkedAt: number }>`
  - `scheduleInSquare({ clearance, body: { class_schedule: object }, method?: 'POST' | 'PUT', scheduleId?: string }): Promise<{ done: boolean; message: string; status?: number; scheduleId?: string }>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/scripts/square-tab-schedule.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'scripts/square-tab-schedule.js'), 'utf8')
const START = '2026-10-18T18:00:00.000Z'

function load(fetchImpl: (...a: any[]) => any, cookie = '_js_csrf=tok123; other=1') {
  const root: any = { fetch: vi.fn(fetchImpl), location: { origin: 'https://ourhometownstudio.com' }, document: { cookie } }
  new Function('window', source)(root)
  return root
}
const answer = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) })
const body = (over: Record<string, unknown> = {}) => ({ class_schedule: { start_at: START, duration_minutes: 120, total_capacity: 25, ...over } })

afterEach(() => vi.useRealTimers())

describe('checkStudio (run in a signed-in studio tab)', () => {
  it('asks the studio’s conflicts endpoint, same-origin', async () => {
    const root = load(async () => answer(200, { data: { ok: true, message: 'No booked party in the way.' } }))
    const c = await root.HometownSchedule.checkStudio({ start: START, minutes: 120 })
    expect(root.fetch.mock.calls[0][0]).toBe(
      'https://ourhometownstudio.com/api/staff/conflicts.json?kind=workshop&start=2026-10-18T18%3A00%3A00.000Z&minutes=120',
    )
    expect(root.fetch.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' })
    expect(c).toMatchObject({ ok: true, start: START, minutes: 120 })
  })

  it('is not ok when the check itself fails', async () => {
    const root = load(async () => answer(503, { error: 'Couldn’t read party bookings. Don’t schedule until this check passes.' }))
    const c = await root.HometownSchedule.checkStudio({ start: START, minutes: 120 })
    expect(c.ok).toBe(false)
    expect(c.message).toMatch(/Don’t schedule/)
  })
})

describe('scheduleInSquare (run in the signed-in Square tab)', () => {
  const clear = () => ({ ok: true, message: 'No booked party in the way.', start: START, minutes: 120, checkedAt: Date.now() })

  it('refuses without a passing check, and says why', async () => {
    const root = load(async () => answer(200, {}))
    const r = await root.HometownSchedule.scheduleInSquare({ clearance: { ok: false, message: 'This class would overlap a booked party' }, body: body() })
    expect(r).toEqual({ done: false, message: 'This class would overlap a booked party' })
    expect(root.fetch).not.toHaveBeenCalled()
  })

  it('refuses a check older than 10 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-06T15:00:00Z') })
    const clearance = clear()
    vi.setSystemTime(new Date('2026-10-06T15:11:00Z'))
    const root = load(async () => answer(200, {}))
    expect((await root.HometownSchedule.scheduleInSquare({ clearance, body: body() })).done).toBe(false)
    expect(root.fetch).not.toHaveBeenCalled()
  })

  it('refuses when the class differs from what was checked', async () => {
    const root = load(async () => answer(200, {}))
    const r = await root.HometownSchedule.scheduleInSquare({ clearance: clear(), body: body({ duration_minutes: 180 }) })
    expect(r.done).toBe(false)
    expect(r.message).toMatch(/different start or length/)
  })

  it('creates the class with the tab’s CSRF token once cleared', async () => {
    const root = load(async () => answer(200, { class_schedule: { id: 'clssch_new' } }))
    const r = await root.HometownSchedule.scheduleInSquare({ clearance: clear(), body: body() })
    expect(r).toMatchObject({ done: true, scheduleId: 'clssch_new' })
    const [url, init] = root.fetch.mock.calls[0]
    expect(url).toBe('/appointments/api/class-schedules')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(init.headers['x-csrf-token']).toBe('tok123')
  })

  it('moves a class with PUT, dropping the empty resource_id Square 404s on', async () => {
    const root = load(async () => answer(200, { class_schedule: { id: 'clssch_1' } }))
    const r = await root.HometownSchedule.scheduleInSquare({ clearance: clear(), body: body({ resource_id: '' }), method: 'PUT', scheduleId: 'clssch_1' })
    expect(r.done).toBe(true)
    const [url, init] = root.fetch.mock.calls[0]
    expect(url).toBe('/appointments/api/class-schedules/clssch_1')
    expect(JSON.parse(init.body).class_schedule).not.toHaveProperty('resource_id')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scripts/square-tab-schedule.test.ts`
Expected: FAIL with `ENOENT: no such file or directory, open '…/scripts/square-tab-schedule.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/square-tab-schedule.js
/**
 * Create or move a Square class from the browser, with the party guard first.
 * HARD RULE: a class is never put over a booked party, and nothing here
 * touches a booking.
 *
 * Two tabs, because the studio's staff cookie is SameSite=Lax and never rides
 * on a request made from app.squareup.com:
 *
 *   1. In a tab on the studio site, signed in at /staff, paste this file, then
 *        const clearance = await HometownSchedule.checkStudio({ start: '2026-10-18T18:00:00.000Z', minutes: 120 })
 *      It asks /api/staff/conflicts.json (the one place the rule lives).
 *   2. In the signed-in app.squareup.com tab, paste this file, then
 *        await HometownSchedule.scheduleInSquare({ clearance, body })                                   // create
 *        await HometownSchedule.scheduleInSquare({ clearance, body, method: 'PUT', scheduleId: 'clssch_…' }) // move
 *      `body` is { class_schedule: { … } } as built in scripts/create-class.ts
 *      (for a move: GET /appointments/api/class-schedules/<id>, change start_at).
 *      It refuses unless the clearance is ok, under 10 minutes old, and for the
 *      same start_at and duration_minutes.
 *
 * Claude runs both through the Chrome javascript tool. Nothing runs on its own.
 */
;(function (root) {
  var MAX_AGE_MS = 10 * 60 * 1000
  var SCHEDULES = '/appointments/api/class-schedules'

  async function checkStudio(opts) {
    var origin = opts.origin || root.location.origin
    var url =
      origin +
      '/api/staff/conflicts.json?kind=workshop&start=' +
      encodeURIComponent(opts.start) +
      '&minutes=' +
      encodeURIComponent(String(opts.minutes))
    var base = { start: opts.start, minutes: opts.minutes, checkedAt: Date.now() }
    var res
    try {
      res = await root.fetch(url, { credentials: 'same-origin', cache: 'no-store' })
    } catch (err) {
      return Object.assign({ ok: false, message: 'Could not reach the studio site. Not scheduling.' }, base)
    }
    var json = await res.json().catch(function () {
      return null
    })
    if (!res.ok || !json || !json.data) {
      return Object.assign({ ok: false, message: (json && json.error) || 'The party check failed (' + res.status + '). Not scheduling.' }, base)
    }
    return Object.assign({ ok: json.data.ok === true, message: String(json.data.message || '') }, base)
  }

  function refuse(message) {
    return { done: false, message: message }
  }

  async function scheduleInSquare(opts) {
    var c = opts.clearance
    if (!c || c.ok !== true) return refuse((c && c.message) || 'Run checkStudio in the studio tab first.')
    if (Date.now() - c.checkedAt > MAX_AGE_MS) return refuse('That party check is more than 10 minutes old. Run it again.')
    var sendBody = JSON.parse(JSON.stringify(opts.body || {}))
    var cs = sendBody.class_schedule
    if (!cs || Date.parse(cs.start_at) !== Date.parse(c.start) || Number(cs.duration_minutes) !== Number(c.minutes)) {
      return refuse('The party check was for a different start or length. Run it again for this class.')
    }
    var method = opts.method === 'PUT' ? 'PUT' : 'POST'
    if (method === 'PUT' && !opts.scheduleId) return refuse('Moving a class needs its scheduleId (clssch_…).')
    // Square answers 404 NOT_FOUND class_schedule.resource_id when it is left empty.
    if (cs.resource_id === '') delete cs.resource_id
    var csrf = (/(?:^|; )_js_csrf=([^;]+)/.exec(root.document.cookie) || [])[1]
    if (!csrf) return refuse('No _js_csrf cookie: sign in to app.squareup.com in this tab first.')
    var url = method === 'PUT' ? SCHEDULES + '/' + encodeURIComponent(opts.scheduleId) : SCHEDULES
    var res = await root.fetch(url, {
      method: method,
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        'x-requested-with': 'XMLHttpRequest',
      },
      body: JSON.stringify(sendBody),
    })
    var text = await res.text()
    if (!res.ok) return { done: false, status: res.status, message: 'Square said ' + res.status + ': ' + text.slice(0, 300) }
    var id = ''
    try {
      id = (JSON.parse(text).class_schedule || {}).id || ''
    } catch (e) {}
    return { done: true, status: res.status, scheduleId: id || opts.scheduleId || '', message: method === 'PUT' ? 'Class moved.' : 'Class scheduled.' }
  }

  root.HometownSchedule = { checkStudio: checkStudio, scheduleInSquare: scheduleInSquare }
})(typeof window !== 'undefined' ? window : globalThis)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scripts/square-tab-schedule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/square-tab-schedule.js tests/scripts/square-tab-schedule.test.ts
git commit -m "feat(scripts): in-tab Square schedule step checks the studio for parties first

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The warnings scan (`src/lib/warnings.ts`) and class capacity from Square

Four of the five codes land here. `picks-missing` needs seat questions and picks, so it lands in Task 24.

**Files:**
- Modify: `src/providers/interfaces/workshop.ts` (`Workshop`, after `availableCapacity`)
- Modify: `src/providers/square/workshop.ts` (`fetchAll` mapping, the `availableCapacity: instance.available_capacity ?? 0,` line)
- Create: `src/lib/warnings.ts`
- Test: `tests/providers/square/workshop.test.ts`, `tests/lib/warnings.test.ts`

**Interfaces:**
- Consumes: `classSpanOf`, `classesOverlap`, `partyBlocksClass`, `partyName`, `partySpanOf`, `ClassSpan`, `PartySpan` (Task 1); `studioOpenOn` (`@config/closures`); `getPartyRecord` (`@lib/party-store`).
- Produces:
  - `Workshop.totalCapacity?: number` (Square instance `capacity`).
  - `type WarningCode = 'class-over-party' | 'class-over-class' | 'oversold' | 'party-on-closed-day' | 'picks-missing'`
  - `interface Warning { code: WarningCode; eventKind: 'workshop' | 'party'; eventId: string; when: string; title: string; detail: string; action: string }`
  - `WARNING_WINDOW_DAYS = 60`
  - `listWarnings({ from, to }: { from: string; to: string }): Promise<Warning[]>` (from/to = studio YYYY-MM-DD, inclusive; sorted by `when`; throws when classes or bookings can't be read)
  - `warningLine(w: Warning): string` → `"Sun Oct 18 · <detail> <action>"`

- [ ] **Step 1: Write the failing tests**

Append to `tests/providers/square/workshop.test.ts` (inside the top-level `describe('SquareWorkshopProvider', …)`):

```ts
  it('carries the class’s total capacity when Square gives it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...FIXTURE_RESPONSE,
      class_schedule_instances: [{ id: 'inst-1', class_schedule_id: 'sched-A', start_at: FUTURE_1, available_capacity: 5, capacity: 12 }],
    }), { status: 200 })))
    const [w] = await new SquareWorkshopProvider(config).listAllWorkshops()
    expect(w.totalCapacity).toBe(12)
    expect(w.availableCapacity).toBe(5)
  })

  it('leaves total capacity out when Square does not say', async () => {
    const [w] = await new SquareWorkshopProvider(config).listAllWorkshops()
    expect(w).not.toHaveProperty('totalCapacity')
  })
```

Create `tests/lib/warnings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockListAllWorkshops = vi.fn()
const mockListBookings = vi.fn()
vi.mock('@config/providers', () => ({
  providers: {
    workshop: { listAllWorkshops: (...a: any[]) => mockListAllWorkshops(...a), listWorkshops: async () => [] },
    booking: { listBookings: (...a: any[]) => mockListBookings(...a) },
  },
}))
vi.mock('@config/site.config', () => ({ siteConfig: { providers: { booking: { config: { locationId: 'LOC' } } } } }))

const HOSTS: Record<string, string> = { bk_rivera: 'Jamie Rivera', bk_lopez: 'Ana Lopez' }
vi.mock('@lib/party-store', () => ({ getPartyRecord: async (id: string) => (HOSTS[id] ? { hostName: HOSTS[id] } : null) }))

import { listWarnings, warningLine } from '@lib/warnings'

function cls(scheduleId: string, name: string, startAt: string, over: Record<string, unknown> = {}) {
  return {
    id: `inst-${scheduleId}`, scheduleId, name, description: '', descriptionHtml: '', startAt, durationMinutes: 120,
    priceCents: 2500, priceCurrency: 'USD', availableCapacity: 5, staffName: '', teamMemberId: '', ...over,
  }
}
const party = (id: string, startAt: string, status = 'confirmed') => ({ id, status, slot: { startAt, duration: 90 } })

const WINDOW = { from: '2026-10-15', to: '2026-10-25' }
const PAILS = cls('clssch_pails', 'Pumpkin Pails', '2026-10-18T18:00:00.000Z', { totalCapacity: 25, availableCapacity: 10 })

beforeEach(() => {
  vi.clearAllMocks()
  mockListAllWorkshops.mockResolvedValue([])
  mockListBookings.mockResolvedValue([])
})

describe('listWarnings', () => {
  it('is empty when nothing is wrong', async () => {
    mockListAllWorkshops.mockResolvedValue([PAILS])
    mockListBookings.mockResolvedValue([party('bk_rivera', '2026-10-18T20:30:00.000Z')]) // Sun 3:30 PM
    expect(await listWarnings(WINDOW)).toEqual([])
  })

  it('asks for bookings across the whole studio-local window', async () => {
    await listWarnings(WINDOW)
    expect(mockListBookings).toHaveBeenCalledWith({ startDate: '2026-10-15T05:00:00.000Z', endDate: '2026-10-26T04:59:59.999Z', locationId: 'LOC' })
  })

  it('class-over-party: a class in the room with a booked party, or in its cleanup hour', async () => {
    mockListAllWorkshops.mockResolvedValue([PAILS])
    mockListBookings.mockResolvedValue([party('bk_rivera', '2026-10-18T18:00:00.000Z')])
    const [w] = await listWarnings(WINDOW)
    expect(w).toEqual({
      code: 'class-over-party', eventKind: 'workshop', eventId: 'clssch_pails', when: '2026-10-18T18:00:00.000Z', title: 'Pumpkin Pails',
      detail: 'Pumpkin Pails 1–3 PM overlaps the Rivera party 1:00 PM.', action: 'Move one in Square.',
    })
    expect(warningLine(w)).toBe('Sun Oct 18 · Pumpkin Pails 1–3 PM overlaps the Rivera party 1:00 PM. Move one in Square.')
  })

  it('ignores a cancelled party', async () => {
    mockListAllWorkshops.mockResolvedValue([PAILS])
    mockListBookings.mockResolvedValue([party('bk_rivera', '2026-10-18T18:00:00.000Z', 'cancelled')])
    expect(await listWarnings(WINDOW)).toEqual([])
  })

  it('class-over-class: two classes at once', async () => {
    mockListAllWorkshops.mockResolvedValue([
      cls('clssch_gcn', 'Girls Craft Night', '2026-10-24T00:00:00.000Z'), // Fri 7–9 PM
      cls('clssch_needle', 'Needlepoint', '2026-10-23T23:00:00.000Z'), // Fri 6–8 PM
    ])
    const [w] = await listWarnings(WINDOW)
    expect(w).toMatchObject({ code: 'class-over-class', eventId: 'clssch_needle', detail: 'Needlepoint 6–8 PM overlaps Girls Craft Night 7–9 PM.' })
  })

  it('oversold: more seats sold than the class holds', async () => {
    mockListAllWorkshops.mockResolvedValue([{ ...PAILS, availableCapacity: -2 }])
    const [w] = await listWarnings(WINDOW)
    expect(w).toMatchObject({ code: 'oversold', eventId: 'clssch_pails', detail: 'Pumpkin Pails: 27 seats sold, 25 capacity.' })
  })

  it('party-on-closed-day: a party on a day the studio is shut', async () => {
    mockListBookings.mockResolvedValue([party('bk_lopez', '2026-10-19T15:00:00.000Z')]) // Mon 10 AM
    const [w] = await listWarnings(WINDOW)
    expect(w).toMatchObject({
      code: 'party-on-closed-day', eventKind: 'party', eventId: 'bk_lopez', title: 'The Lopez party',
      detail: 'The Lopez party 10:00 AM is booked on a closed day.',
    })
  })

  it('leaves out classes outside the window and sorts by date', async () => {
    mockListAllWorkshops.mockResolvedValue([
      { ...PAILS, availableCapacity: -1 },
      cls('clssch_late', 'Late', '2026-11-30T18:00:00.000Z', { totalCapacity: 10, availableCapacity: -5 }),
    ])
    mockListBookings.mockResolvedValue([party('bk_lopez', '2026-10-19T15:00:00.000Z')]) // Mon 19 Oct: closed
    const list = await listWarnings(WINDOW)
    expect(list.map((w) => w.code)).toEqual(['oversold', 'party-on-closed-day'])
  })

  it('throws when classes cannot be read, so no one mistakes it for all clear', async () => {
    mockListAllWorkshops.mockRejectedValue(new Error('Square Classes API error: 503'))
    await expect(listWarnings(WINDOW)).rejects.toThrow('503')
  })

  it('throws when bookings cannot be read', async () => {
    mockListBookings.mockRejectedValue(new Error('Square 500'))
    await expect(listWarnings(WINDOW)).rejects.toThrow('500')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/warnings.test.ts tests/providers/square/workshop.test.ts`
Expected: FAIL — `Failed to resolve import "@lib/warnings"`; the capacity test gets `undefined`.

- [ ] **Step 3: Write minimal implementation**

`src/providers/interfaces/workshop.ts`, after `availableCapacity: number`:

```ts
  /** Seats the class holds in all (Square's instance `capacity`). Absent when Square doesn't say. */
  totalCapacity?: number
```

`src/providers/square/workshop.ts`, in the `fetchAll` mapping, directly after `availableCapacity: instance.available_capacity ?? 0,`:

```ts
        ...(typeof instance.capacity === 'number' ? { totalCapacity: instance.capacity } : {}),
```

```ts
// src/lib/warnings.ts
/**
 * The staff console's "Needs attention" scan (spec G). Read-only: it reports
 * and says what a person does about it, in Square. Nothing here may cancel,
 * move or release a booking.
 *
 * Throws when classes or bookings can't be read: an empty list must only ever
 * mean "checked, and nothing is wrong".
 */
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { studioOpenOn } from '@config/closures'
import { getPartyRecord } from '@lib/party-store'
import { formatCalendarDay, formatTime, formatTimeSpan, studioDate, studioDayUtcRange } from '@lib/studio-time'
import { classSpanOf, classesOverlap, partyBlocksClass, partyName, partySpanOf, type ClassSpan, type PartySpan } from '@lib/conflicts'
import type { Workshop } from '@providers/interfaces/workshop'

export type WarningCode = 'class-over-party' | 'class-over-class' | 'oversold' | 'party-on-closed-day' | 'picks-missing'

export interface Warning {
  code: WarningCode
  eventKind: 'workshop' | 'party'
  /** Class schedule id or party booking id: what the panel opens. */
  eventId: string
  /** ISO start of the event the line is about. */
  when: string
  title: string
  /** "Pumpkin Pails 1–3 PM overlaps the Rivera party 1:00 PM." */
  detail: string
  /** What a person does about it: "Move one in Square." */
  action: string
}

/** Days ahead the panel and the daily email look. */
export const WARNING_WINDOW_DAYS = 60

/** "Sun Oct 18 · <detail> <action>" — the one line format, on the panel and in the email. */
export function warningLine(w: Warning): string {
  return `${formatCalendarDay(studioDate(w.when))} · ${w.detail} ${w.action}`
}

interface ScannedClass {
  span: ClassSpan
  workshop: Workshop
}

interface Scan {
  classes: ScannedClass[]
  parties: PartySpan[]
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

async function scan(from: string, to: string): Promise<Scan> {
  const startIso = studioDayUtcRange(from).startIso
  const endIso = studioDayUtcRange(to).endIso
  const lo = Date.parse(startIso)
  const hi = Date.parse(endIso)
  const w = providers.workshop
  const [workshops, bookings] = await Promise.all([
    w.listAllWorkshops?.() ?? w.listWorkshops(),
    providers.booking.listBookings
      ? providers.booking.listBookings({
          startDate: startIso,
          endDate: endIso,
          locationId: siteConfig.providers.booking.config.locationId || '',
        })
      : Promise.resolve([]),
  ])
  const classes = workshops
    .filter((x) => {
      const t = Date.parse(x.startAt)
      return t >= lo && t <= hi
    })
    .map((workshop) => ({ span: classSpanOf(workshop), workshop }))
    .sort((a, b) => a.span.startIso.localeCompare(b.span.startIso))
  const parties = await Promise.all(
    bookings
      .filter((b) => b.status !== 'cancelled')
      .map(async (b) => {
        const record = await getPartyRecord(b.id).catch(() => null)
        return partySpanOf(b, record?.hostName)
      }),
  )
  return { classes, parties }
}

function classOverParty(s: Scan): Warning[] {
  return s.classes.flatMap(({ span }) =>
    partyBlocksClass(span.startIso, span.endIso, s.parties).map((p): Warning => ({
      code: 'class-over-party',
      eventKind: 'workshop',
      eventId: span.id,
      when: span.startIso,
      title: span.name,
      detail: `${span.name} ${formatTimeSpan(span.startIso, span.endIso)} overlaps ${partyName(p)} ${formatTime(p.startIso)}.`,
      action: 'Move one in Square.',
    })),
  )
}

function classOverClass(s: Scan): Warning[] {
  const out: Warning[] = []
  for (let i = 0; i < s.classes.length; i++) {
    for (let j = i + 1; j < s.classes.length; j++) {
      const a = s.classes[i].span
      const b = s.classes[j].span
      if (!classesOverlap(a, b)) continue
      out.push({
        code: 'class-over-class',
        eventKind: 'workshop',
        eventId: a.id,
        when: a.startIso,
        title: a.name,
        detail: `${a.name} ${formatTimeSpan(a.startIso, a.endIso)} overlaps ${b.name} ${formatTimeSpan(b.startIso, b.endIso)}.`,
        action: 'Move one in Square.',
      })
    }
  }
  return out
}

function oversold(s: Scan): Warning[] {
  return s.classes.flatMap(({ span, workshop }): Warning[] => {
    const total = workshop.totalCapacity
    if (typeof total !== 'number') return []
    const sold = total - workshop.availableCapacity
    if (sold <= total) return []
    return [{
      code: 'oversold',
      eventKind: 'workshop',
      eventId: span.id,
      when: span.startIso,
      title: span.name,
      detail: `${span.name}: ${sold} seats sold, ${total} capacity.`,
      action: 'Sort it out in Square.',
    }]
  })
}

function partyOnClosedDay(s: Scan): Warning[] {
  return s.parties
    .filter((p) => !studioOpenOn(studioDate(p.startIso)))
    .map((p): Warning => ({
      code: 'party-on-closed-day',
      eventKind: 'party',
      eventId: p.id,
      when: p.startIso,
      title: capitalize(partyName(p)),
      detail: `${capitalize(partyName(p))} ${formatTime(p.startIso)} is booked on a closed day.`,
      action: 'Move it in Square or open the day.',
    }))
}

export async function listWarnings({ from, to }: { from: string; to: string }): Promise<Warning[]> {
  const s = await scan(from, to)
  return [...classOverParty(s), ...classOverClass(s), ...oversold(s), ...partyOnClosedDay(s)].sort((a, b) =>
    a.when.localeCompare(b.when),
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/warnings.test.ts tests/providers/square/workshop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/interfaces/workshop.ts src/providers/square/workshop.ts src/lib/warnings.ts tests/lib/warnings.test.ts tests/providers/square/workshop.test.ts
git commit -m "feat(warnings): scan for class/party overlaps, double classes, oversold, closed-day parties

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `GET /api/staff/warnings.json`

**Files:**
- Create: `src/pages/api/staff/warnings.json.ts`
- Test: `tests/api/staff-warnings.test.ts`

**Interfaces:**
- Consumes: `listWarnings`, `warningLine`, `WARNING_WINDOW_DAYS` (Task 7); `addDays` (`@lib/kit-dates`); `studioDate` (`@lib/studio-time`).
- Produces: `GET /api/staff/warnings.json` → `200 { data: { from: string; to: string; warnings: (Warning & { line: string })[] } }` | `401` | `503 { error }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/staff-warnings.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 'k', name: 'Kaden', role: 'owner' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

const mockListWarnings = vi.fn()
vi.mock('@lib/warnings', () => ({
  listWarnings: (...a: any[]) => mockListWarnings(...a),
  warningLine: (w: any) => `LINE ${w.detail}`,
  WARNING_WINDOW_DAYS: 60,
}))

import { GET } from '@pages/api/staff/warnings.json'

const ctx = () => ({ request: new Request('http://localhost/api/staff/warnings.json') }) as any
const W = { code: 'oversold', eventKind: 'workshop', eventId: 'clssch_pails', when: '2026-10-18T18:00:00.000Z', title: 'Pumpkin Pails', detail: 'Pumpkin Pails: 27 seats sold, 25 capacity.', action: 'Sort it out in Square.' }

beforeEach(() => {
  vi.clearAllMocks()
  authed = { id: 'k', name: 'Kaden', role: 'owner' }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T15:00:00.000Z')) // 10 AM CDT
  mockListWarnings.mockResolvedValue([])
})
afterEach(() => vi.useRealTimers())

describe('GET /api/staff/warnings.json', () => {
  it('rejects a caller without the staff cookie', async () => {
    authed = null
    expect((await GET(ctx())).status).toBe(401)
    expect(mockListWarnings).not.toHaveBeenCalled()
  })

  it('scans today and the next 59 studio days', async () => {
    const res = await GET(ctx())
    expect(res.status).toBe(200)
    expect(mockListWarnings).toHaveBeenCalledWith({ from: '2026-10-06', to: '2026-12-04' })
    expect((await res.json()).data).toEqual({ from: '2026-10-06', to: '2026-12-04', warnings: [] })
  })

  it('sends each warning with its ready-made line', async () => {
    mockListWarnings.mockResolvedValue([W])
    const { data } = await (await GET(ctx())).json()
    expect(data.warnings).toEqual([{ ...W, line: 'LINE Pumpkin Pails: 27 seats sold, 25 capacity.' }])
  })

  it('answers 503 when the scan cannot run, never an empty list', async () => {
    mockListWarnings.mockRejectedValue(new Error('Square 500'))
    const res = await GET(ctx())
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('Couldn’t check the schedule for conflicts. Refresh to try again.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/staff-warnings.test.ts`
Expected: FAIL with `Failed to resolve import "@pages/api/staff/warnings.json"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pages/api/staff/warnings.json.ts
import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { listWarnings, warningLine, WARNING_WINDOW_DAYS } from '@lib/warnings'
import { addDays } from '@lib/kit-dates'
import { studioDate } from '@lib/studio-time'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff:warnings')

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Staff-only: everything on the schedule that needs a person, today and the
 * next 59 days (spec G). Read-only. A scan that can't run is a 503 so the
 * panel says so instead of looking all clear.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!staffAuthorized(request)) return json({ error: 'Unauthorized' }, 401)
  const from = studioDate(new Date().toISOString())
  const to = addDays(from, WARNING_WINDOW_DAYS - 1)
  try {
    const warnings = await listWarnings({ from, to })
    return json({ data: { from, to, warnings: warnings.map((w) => ({ ...w, line: warningLine(w) })) } })
  } catch (err) {
    logger.error('Warnings scan failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'Couldn’t check the schedule for conflicts. Refresh to try again.' }, 503)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/staff-warnings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/staff/warnings.json.ts tests/api/staff-warnings.test.ts
git commit -m "feat(staff): warnings endpoint for the next 60 days

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `WarningsPanel` on the Today screen

**Files:**
- Create: `src/components/staff/WarningsPanel.tsx`
- Modify: `src/components/staff/Today.tsx` (imports; render above `<DoorSearch …/>` at line 127)
- Test: `tests/components/staff/WarningsPanel.test.tsx`

**Interfaces:**
- Consumes: `GET /api/staff/warnings.json` (Task 8); `btn` (`@components/staff/ui`); `EventKind` (`@lib/events`).
- Produces: `default function WarningsPanel({ onOpenEvent }: { onOpenEvent: (e: { kind: EventKind; id: string; title: string }) => void })`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/staff/WarningsPanel.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WarningsPanel from '@components/staff/WarningsPanel'

const LINE = 'Sun Oct 18 · Pumpkin Pails 1–3 PM overlaps the Rivera party 1:00 PM. Move one in Square.'
const warning = { code: 'class-over-party', eventKind: 'workshop', eventId: 'clssch_pails', title: 'Pumpkin Pails', when: '2026-10-18T18:00:00.000Z', detail: '', action: '', line: LINE }

function serve(...answers: Array<{ status: number; body: unknown }>) {
  const spy = vi.spyOn(globalThis, 'fetch')
  for (const a of answers) spy.mockResolvedValueOnce({ ok: a.status < 300, status: a.status, json: async () => a.body } as Response)
  return spy
}

afterEach(() => vi.restoreAllMocks())

describe('WarningsPanel', () => {
  it('shows nothing when the schedule is clear', async () => {
    const spy = serve({ status: 200, body: { data: { warnings: [] } } })
    const { container } = render(<WarningsPanel onOpenEvent={vi.fn()} />)
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/staff/warnings.json', { cache: 'no-store' }))
    expect(container).toBeEmptyDOMElement()
  })

  it('says how many things need attention and lists each line', async () => {
    serve({ status: 200, body: { data: { warnings: [warning, { ...warning, eventId: 'x', line: 'Second line.' }] } } })
    render(<WarningsPanel onOpenEvent={vi.fn()} />)
    expect(await screen.findByText('⚠ Needs attention (2)')).toBeInTheDocument()
    expect(screen.getByText(LINE)).toBeInTheDocument()
    expect(screen.getByText('Second line.')).toBeInTheDocument()
  })

  it('opens the event a line is about', async () => {
    serve({ status: 200, body: { data: { warnings: [warning] } } })
    const onOpenEvent = vi.fn()
    render(<WarningsPanel onOpenEvent={onOpenEvent} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
    expect(onOpenEvent).toHaveBeenCalledWith({ kind: 'workshop', id: 'clssch_pails', title: 'Pumpkin Pails' })
  })

  it('cannot be dismissed', async () => {
    serve({ status: 200, body: { data: { warnings: [warning] } } })
    render(<WarningsPanel onOpenEvent={vi.fn()} />)
    await screen.findByText('⚠ Needs attention (1)')
    expect(screen.queryByRole('button', { name: /dismiss|close|hide/i })).toBeNull()
  })

  it('says it could not check, in red, and tries again on request', async () => {
    serve({ status: 503, body: { error: 'x' } }, { status: 200, body: { data: { warnings: [warning] } } })
    render(<WarningsPanel onOpenEvent={vi.fn()} />)
    expect(await screen.findByText('⚠ Couldn’t check the schedule for conflicts.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('⚠ Needs attention (1)')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/staff/WarningsPanel.test.tsx`
Expected: FAIL with `Failed to resolve import "@components/staff/WarningsPanel"`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/staff/WarningsPanel.tsx
import { useEffect, useState, type CSSProperties } from 'react'
import { btn } from '@components/staff/ui'
import type { EventKind } from '@lib/events'

interface PanelWarning {
  code: string
  eventKind: 'workshop' | 'party'
  eventId: string
  title: string
  line: string
}

const box: CSSProperties = {
  border: '2px solid #b91c1c',
  background: 'rgba(185,28,28,0.07)',
  borderRadius: '0.8rem',
  padding: '0.8rem 1rem',
  marginBottom: '1rem',
}

/**
 * "Needs attention" (spec G): red, at the top of Today, fetched on every load.
 * Nothing is dismissible and nothing here fixes anything: each line says what
 * a person does, in Square. A scan that couldn't run says so, in red, rather
 * than showing nothing (which would read as all clear).
 */
export default function WarningsPanel({ onOpenEvent }: { onOpenEvent: (e: { kind: EventKind; id: string; title: string }) => void }) {
  const [warnings, setWarnings] = useState<PanelWarning[] | null>(null)
  const [failed, setFailed] = useState(false)

  async function load() {
    setFailed(false)
    try {
      const res = await fetch('/api/staff/warnings.json', { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.data) {
        setFailed(true)
        return
      }
      setWarnings(Array.isArray(json.data.warnings) ? json.data.warnings : [])
    } catch {
      setFailed(true)
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (failed) {
    return (
      <div role="alert" style={box}>
        <p style={{ margin: 0, fontWeight: 700, color: '#b91c1c' }}>⚠ Couldn’t check the schedule for conflicts.</p>
        <button type="button" onClick={load} style={{ ...btn(), marginTop: '0.5rem' }}>Try again</button>
      </div>
    )
  }
  if (!warnings || warnings.length === 0) return null

  return (
    <section role="alert" aria-label="Needs attention" style={box}>
      <p style={{ margin: '0 0 0.4rem', fontWeight: 700, color: '#b91c1c' }}>⚠ Needs attention ({warnings.length})</p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {warnings.map((w, i) => (
          <li
            key={`${w.code}:${w.eventId}:${i}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.35rem 0', borderTop: i === 0 ? 'none' : '1px solid rgba(185,28,28,0.15)' }}
          >
            <span style={{ flex: 1, fontSize: '0.875rem', color: 'var(--color-dark)' }}>{w.line}</span>
            <button
              type="button"
              onClick={() => onOpenEvent({ kind: w.eventKind, id: w.eventId, title: w.title })}
              style={{ ...btn(), padding: '0.3rem 0.6rem' }}
            >
              Open
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

`src/components/staff/Today.tsx` — add the import after the `EventList` import:

```tsx
import WarningsPanel from '@components/staff/WarningsPanel'
```

and directly above `<DoorSearch` in the main return:

```tsx
      <WarningsPanel onOpenEvent={(e) => onOpenRoster(e)} />

```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/staff/WarningsPanel.test.tsx tests/components/staff/StaffConsole-open.test.tsx`
Expected: PASS (StaffConsole's stub answers unknown URLs with `{ ok: true, data: { events: [] … } }`; with no `warnings` array the panel renders nothing).

- [ ] **Step 5: Commit**

```bash
git add src/components/staff/WarningsPanel.tsx src/components/staff/Today.tsx tests/components/staff/WarningsPanel.test.tsx
git commit -m "feat(staff): red Needs attention panel at the top of Today

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Daily warnings email (site job + Netlify scheduled function)

**Files:**
- Create: `src/pages/api/jobs/daily-warnings.json.ts`
- Create: `netlify/functions/daily-warnings.ts`
- Test: `tests/api/jobs-daily-warnings.test.ts`, `tests/netlify/daily-warnings.test.ts`

**Interfaces:**
- Consumes: `listWarnings`, `warningLine`, `WARNING_WINDOW_DAYS` (Task 7); `sendEmail` (`@lib/email`); `siteConfig.ownerEmails`; `SITE_URL` (`@config/site-url`).
- Produces:
  - `dailyWarningsJobKey(secret: string): string` (HMAC-SHA256 of `job:daily-warnings`, hex)
  - `POST /api/jobs/daily-warnings.json` (header `x-job-key`) → `200 { data: { count: number; sent: boolean } }` | `401` | `503`
  - `netlify/functions/daily-warnings.ts`: `run(site?: string, secret?: string, ask?: typeof fetch): Promise<{ count: number; sent: boolean; reason: string }>`, `config = { schedule: '0 12 * * *' }`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/api/jobs-daily-warnings.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockListWarnings = vi.fn()
vi.mock('@lib/warnings', () => ({
  listWarnings: (...a: any[]) => mockListWarnings(...a),
  warningLine: (w: any) => `Sun Oct 18 · ${w.detail} ${w.action}`,
  WARNING_WINDOW_DAYS: 60,
}))
const mockSendEmail = vi.fn()
vi.mock('@lib/email', () => ({ sendEmail: (...a: any[]) => mockSendEmail(...a) }))

import { POST, dailyWarningsJobKey } from '@pages/api/jobs/daily-warnings.json'

const SECRET = 'a-secret-only-the-site-holds'
const ctx = (key: string | null) =>
  ({ request: new Request('http://localhost/api/jobs/daily-warnings.json', { method: 'POST', headers: key ? { 'x-job-key': key } : {} }) }) as any
const W = { code: 'oversold', eventKind: 'workshop', eventId: 'clssch_pails', when: '2026-10-18T18:00:00.000Z', title: 'Pumpkin Pails', detail: 'Pumpkin Pails: 27 seats sold, 25 capacity.', action: 'Sort it out in Square.' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.LOOKUP_SIGNING_SECRET = SECRET
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'))
  mockListWarnings.mockResolvedValue([])
  mockSendEmail.mockResolvedValue({ sent: true })
})
afterEach(() => {
  delete process.env.LOOKUP_SIGNING_SECRET
  vi.useRealTimers()
})

describe('POST /api/jobs/daily-warnings.json', () => {
  it('refuses a caller without the job key', async () => {
    expect((await POST(ctx(null))).status).toBe(401)
    expect((await POST(ctx('wrong'))).status).toBe(401)
    expect(mockListWarnings).not.toHaveBeenCalled()
  })

  it('emails no one when nothing needs attention', async () => {
    const res = await POST(ctx(dailyWarningsJobKey(SECRET)))
    expect(mockListWarnings).toHaveBeenCalledWith({ from: '2026-10-06', to: '2026-12-04' })
    expect((await res.json()).data).toEqual({ count: 0, sent: false })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('emails both owners one line per warning', async () => {
    mockListWarnings.mockResolvedValue([W, { ...W, eventId: 'b' }])
    const res = await POST(ctx(dailyWarningsJobKey(SECRET)))
    expect((await res.json()).data).toEqual({ count: 2, sent: true })
    const mail = mockSendEmail.mock.calls[0][0]
    expect(mail.to).toBe('kaden@ourhometownstudio.com, catherine@ourhometownstudio.com')
    expect(mail.subject).toBe('⚠ Studio schedule needs attention (2)')
    expect(mail.text).toContain('Sun Oct 18 · Pumpkin Pails: 27 seats sold, 25 capacity. Sort it out in Square.')
    expect(mail.text).toContain('https://ourhometownstudio.com/staff')
    expect(mail.html).toContain('Pumpkin Pails: 27 seats sold, 25 capacity.')
  })

  it('answers 503 when the scan cannot run', async () => {
    mockListWarnings.mockRejectedValue(new Error('Square 500'))
    expect((await POST(ctx(dailyWarningsJobKey(SECRET)))).status).toBe(503)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
```

```ts
// tests/netlify/daily-warnings.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { run, config } from '../../netlify/functions/daily-warnings'

const SITE = 'https://ourhometownstudio.com'
const SECRET = 'a-secret-only-the-site-holds'
const answer = (data: Record<string, unknown>, ok = true, status = 200) => ({ ok, status, json: async () => ({ data }) }) as any

describe('daily-warnings function', () => {
  it('runs once a day at 12:00 UTC (7 AM CDT, 6 AM CST)', () => {
    expect(config.schedule).toBe('0 12 * * *')
  })

  it('knocks on the site job with the key made from the secret', async () => {
    const ask = vi.fn().mockResolvedValue(answer({ count: 0, sent: false }))
    const outcome = await run(SITE, SECRET, ask)
    const [url, init] = ask.mock.calls[0]
    expect(url).toBe('https://ourhometownstudio.com/api/jobs/daily-warnings.json')
    expect(init.method).toBe('POST')
    expect(init.headers['x-job-key']).toBe(createHmac('sha256', SECRET).update('job:daily-warnings').digest('hex'))
    expect(outcome).toEqual({ count: 0, sent: false, reason: 'nothing to report' })
  })

  it('makes the same key the site checks for', async () => {
    const { dailyWarningsJobKey } = await import('@pages/api/jobs/daily-warnings.json')
    const ask = vi.fn().mockResolvedValue(answer({ count: 0, sent: false }))
    await run(SITE, SECRET, ask)
    expect(ask.mock.calls[0][1].headers['x-job-key']).toBe(dailyWarningsJobKey(SECRET))
  })

  it('reports an email sent', async () => {
    expect(await run(SITE, SECRET, vi.fn().mockResolvedValue(answer({ count: 3, sent: true })))).toEqual({ count: 3, sent: true, reason: 'emailed' })
  })

  it('says why nothing happened', async () => {
    expect((await run(undefined, SECRET)).reason).toBe('not configured')
    expect((await run(SITE, SECRET, vi.fn().mockResolvedValue(answer({}, false, 503)))).reason).toBe('site answered 503')
    expect((await run(SITE, SECRET, vi.fn().mockRejectedValue(new Error('down')))).reason).toBe('site unreachable: down')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/jobs-daily-warnings.test.ts tests/netlify/daily-warnings.test.ts`
Expected: FAIL with unresolved imports for both new modules.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pages/api/jobs/daily-warnings.json.ts
import type { APIRoute } from 'astro'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { siteConfig } from '@config/site.config'
import { SITE_URL } from '@config/site-url'
import { createLogger } from '@lib/logger'
import { sendEmail } from '@lib/email'
import { addDays } from '@lib/kit-dates'
import { studioDate } from '@lib/studio-time'
import { listWarnings, warningLine, WARNING_WINDOW_DAYS } from '@lib/warnings'

export const prerender = false
const logger = createLogger('api:jobs:daily-warnings')

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

/** The key the scheduled function sends: made from a secret only the site holds. */
export function dailyWarningsJobKey(secret: string): string {
  return createHmac('sha256', secret).update('job:daily-warnings').digest('hex')
}

function allowed(request: Request): boolean {
  const secret = env('LOOKUP_SIGNING_SECRET')
  if (!secret) return false
  const given = Buffer.from(request.headers.get('x-job-key') ?? '')
  const wanted = Buffer.from(dailyWarningsJobKey(secret))
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Run each morning by netlify/functions/daily-warnings.ts: the same scan as
 * the staff panel, emailed to the owners only when something needs a person.
 * Read-only; it changes nothing anywhere.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!allowed(request)) return json({ error: 'Unauthorized' }, 401)

  const from = studioDate(new Date().toISOString())
  const to = addDays(from, WARNING_WINDOW_DAYS - 1)
  let warnings
  try {
    warnings = await listWarnings({ from, to })
  } catch (err) {
    logger.error('Daily warnings scan failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'Scan failed' }, 503)
  }
  if (warnings.length === 0) return json({ data: { count: 0, sent: false } }, 200)

  const lines = warnings.map(warningLine)
  const subject = `⚠ Studio schedule needs attention (${warnings.length})`
  const footer = 'Nothing has been changed. Each line needs a person, in Square.'
  const text = [...lines, '', `Open the staff console: ${SITE_URL}/staff`, '', footer].join('\n')
  const html = `<div style="max-width:560px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#b91c1c;">${esc(subject)}</p>
  <ul style="margin:0 0 12px;padding-left:18px;">${lines.map((l) => `<li style="margin:0 0 6px;font-size:14px;color:#3d3630;">${esc(l)}</li>`).join('')}</ul>
  <p style="margin:0 0 10px;"><a href="${esc(SITE_URL)}/staff" style="color:#7a4a2e;font-weight:600;">Open the staff console</a></p>
  <p style="margin:0;font-size:13px;color:#6f635b;">${esc(footer)}</p>
</div>`

  const { sent } = await sendEmail({ to: siteConfig.ownerEmails.join(', '), subject, html, text })
  return json({ data: { count: warnings.length, sent } }, 200)
}
```

```ts
// netlify/functions/daily-warnings.ts
import type { Config, Context } from '@netlify/functions'
import { createHmac } from 'node:crypto'

/**
 * Every morning at 12:00 UTC (7 AM CDT, 6 AM CST), ask the site to scan the
 * next 60 days and email the owners if anything needs attention. All the
 * deciding happens in src/pages/api/jobs/daily-warnings.json.ts; Netlify
 * functions can't import `@lib/*`, so this only knocks on its door.
 *
 * Netlify runs scheduled functions on the live site only, never on previews.
 */
export async function run(
  site: string | undefined,
  secret: string | undefined,
  ask: typeof fetch = fetch,
): Promise<{ count: number; sent: boolean; reason: string }> {
  if (!site || !secret) return { count: 0, sent: false, reason: 'not configured' }
  const key = createHmac('sha256', secret).update('job:daily-warnings').digest('hex')
  let res: Response
  try {
    res = await ask(`${site.replace(/\/$/, '')}/api/jobs/daily-warnings.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-job-key': key },
      body: '{}',
    })
  } catch (err) {
    return { count: 0, sent: false, reason: `site unreachable: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (!res.ok) return { count: 0, sent: false, reason: `site answered ${res.status}` }
  const data = ((await res.json()) as any)?.data ?? {}
  const count = Number(data.count) || 0
  const sent = data.sent === true
  return { count, sent, reason: count === 0 ? 'nothing to report' : sent ? 'emailed' : 'email not sent' }
}

export default async (_req: Request, context: Context) => {
  const outcome = await run(context?.site?.url ?? process.env.URL, process.env.LOOKUP_SIGNING_SECRET)
  console.log('daily-warnings', JSON.stringify(outcome))
}

export const config: Config = {
  schedule: '0 12 * * *',
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/jobs-daily-warnings.test.ts tests/netlify/daily-warnings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/jobs/daily-warnings.json.ts netlify/functions/daily-warnings.ts tests/api/jobs-daily-warnings.test.ts tests/netlify/daily-warnings.test.ts
git commit -m "feat(warnings): daily owner email when the schedule needs attention

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Seat question and cutoff rules (`src/lib/seat-options.ts`)

Pure and client-safe (no imports, no env) so the modal, the server, the staff sheet and the CLI share one set of rules. Later tasks append pick helpers to this file (Tasks 19, 20, 25).

**Files:**
- Create: `src/lib/seat-options.ts`
- Test: `tests/lib/seat-options.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface SeatOption { id: string; label: string; choices: string[] }`
  - `interface SeatPick { seat: number; optionId: string; choice: string }`
  - `interface CutoffSettings { options: SeatOption[]; signupCutoffHours: number | null }` (structurally `Pick<EventMeta, 'options' | 'signupCutoffHours'>`)
  - constants `MAX_OPTIONS = 3`, `MAX_LABEL_LENGTH = 40`, `MIN_CHOICES = 2`, `MAX_CHOICES = 12`, `MAX_CHOICE_LENGTH = 30`, `MAX_CUTOFF_HOURS = 336`, `DEFAULT_CUTOFF_HOURS_WITH_OPTIONS = 24`, `PICKS_FINAL_LINE`
  - `class SeatSettingsError extends Error { status: 400 | 409 }`
  - `optionIdFrom(label: string): string`
  - `validateOptions(raw: unknown): { ok: true; value: SeatOption[] } | { ok: false; error: string }`
  - `optionsChangeRefusal(prev: SeatOption[], next: SeatOption[], hasPicks: boolean): string | null`
  - `validateCutoffHours(raw: unknown): { ok: true; value: number | null } | { ok: false; error: string }`
  - `effectiveCutoffHours(s: CutoffSettings): number`
  - `signupClosesAt(startIso: string, s: CutoffSettings): string`
  - `isSignupClosed(startIso: string, s: CutoffSettings, now?: Date): boolean`
  - `cutoffClosedMessage(hours: number): string`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/seat-options.test.ts
import { describe, it, expect } from 'vitest'
import {
  validateOptions,
  optionsChangeRefusal,
  validateCutoffHours,
  effectiveCutoffHours,
  signupClosesAt,
  isSignupClosed,
  cutoffClosedMessage,
  optionIdFrom,
  PICKS_FINAL_LINE,
} from '@lib/seat-options'

const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }

describe('validateOptions', () => {
  it('accepts the Pumpkin Pails question, trimmed', () => {
    expect(validateOptions([{ label: ' Pumpkin color ', choices: [' Light Pink', 'Light Blue', 'Black', 'Lavender '] }])).toEqual({ ok: true, value: [PAILS] })
  })

  it('keeps an id it is given and makes one from the label otherwise', () => {
    expect(optionIdFrom('Pumpkin color')).toBe('pumpkin-color')
    expect(optionIdFrom('!!!')).toBe('option')
    const r = validateOptions([{ id: 'color', label: 'Pumpkin color', choices: ['A', 'B'] }])
    expect(r.ok && r.value[0].id).toBe('color')
  })

  it.each([
    ['not a list', { label: 'x' }, 'Questions must be a list.'],
    ['four questions', [1, 2, 3, 4].map((n) => ({ label: `Q${n}`, choices: ['A', 'B'] })), 'A class can ask up to 3 questions.'],
    ['an empty label', [{ label: '  ', choices: ['A', 'B'] }], 'Each question needs a name of 1 to 40 characters.'],
    ['a 41-character label', [{ label: 'x'.repeat(41), choices: ['A', 'B'] }], 'Each question needs a name of 1 to 40 characters.'],
    ['one choice', [{ label: 'Color', choices: ['A'] }], '“Color” needs 2 to 12 choices.'],
    ['thirteen choices', [{ label: 'Color', choices: Array.from({ length: 13 }, (_, i) => `C${i}`) }], '“Color” needs 2 to 12 choices.'],
    ['a 31-character choice', [{ label: 'Color', choices: ['A', 'x'.repeat(31)] }], 'Each choice needs 1 to 30 characters.'],
    ['a repeated choice, any case', [{ label: 'Color', choices: ['Black', 'black'] }], '“black” is listed twice under “Color”.'],
    ['two questions with one name', [{ label: 'Color', choices: ['A', 'B'] }, { label: 'color', choices: ['C', 'D'] }], 'Two questions are both called “color”.'],
  ])('refuses %s', (_name, raw, error) => {
    expect(validateOptions(raw)).toEqual({ ok: false, error })
  })
})

describe('optionsChangeRefusal', () => {
  it('allows anything before anyone has picked', () => {
    expect(optionsChangeRefusal([PAILS], [], false)).toBeNull()
  })

  it('after picks: adding a choice and renaming the question are fine', () => {
    expect(optionsChangeRefusal([PAILS], [{ ...PAILS, label: 'Pail color', choices: [...PAILS.choices, 'Orange'] }], true)).toBeNull()
  })

  it('after picks: removing or renaming a choice is refused', () => {
    const msg = 'People have already picked for this class, so existing choices can’t be removed or renamed. You can add new ones.'
    expect(optionsChangeRefusal([PAILS], [{ ...PAILS, choices: ['Light Pink', 'Light Blue', 'Black'] }], true)).toBe(msg)
    expect(optionsChangeRefusal([PAILS], [{ ...PAILS, choices: ['Light Pink', 'Light Blue', 'Black', 'Purple'] }], true)).toBe(msg)
  })

  it('after picks: adding or removing a question is refused', () => {
    const msg = 'People have already picked for this class, so questions can’t be added or removed.'
    expect(optionsChangeRefusal([PAILS], [], true)).toBe(msg)
    expect(optionsChangeRefusal([PAILS], [PAILS, { id: 'ribbon', label: 'Ribbon', choices: ['Red', 'Gold'] }], true)).toBe(msg)
  })
})

describe('cutoff', () => {
  it('accepts whole hours 0–336 and null (the default)', () => {
    expect(validateCutoffHours(null)).toEqual({ ok: true, value: null })
    expect(validateCutoffHours(0)).toEqual({ ok: true, value: 0 })
    expect(validateCutoffHours(336)).toEqual({ ok: true, value: 336 })
    for (const bad of [-1, 337, 2.5, '24', undefined]) {
      expect(validateCutoffHours(bad)).toEqual({ ok: false, error: 'Sign-ups close 0 to 336 hours before the class, in whole hours.' })
    }
  })

  it('defaults to 0 h for a plain class and 24 h once it asks questions; a set value wins', () => {
    expect(effectiveCutoffHours({ options: [], signupCutoffHours: null })).toBe(0)
    expect(effectiveCutoffHours({ options: [PAILS], signupCutoffHours: null })).toBe(24)
    expect(effectiveCutoffHours({ options: [PAILS], signupCutoffHours: 48 })).toBe(48)
    expect(effectiveCutoffHours({ options: [], signupCutoffHours: 6 })).toBe(6)
  })

  it('Pails (Sun 18 Oct, 1 PM) closes at 1 PM Saturday', () => {
    const start = '2026-10-18T18:00:00.000Z'
    expect(signupClosesAt(start, { options: [PAILS], signupCutoffHours: null })).toBe('2026-10-17T18:00:00.000Z')
    expect(isSignupClosed(start, { options: [PAILS], signupCutoffHours: null }, new Date('2026-10-17T17:59:59.000Z'))).toBe(false)
    expect(isSignupClosed(start, { options: [PAILS], signupCutoffHours: null }, new Date('2026-10-17T18:00:00.000Z'))).toBe(true)
  })

  it('a plain class stays open until it starts', () => {
    const start = '2026-10-17T00:00:00.000Z'
    expect(isSignupClosed(start, { options: [], signupCutoffHours: null }, new Date('2026-10-16T23:30:00.000Z'))).toBe(false)
    expect(isSignupClosed(start, { options: [], signupCutoffHours: null }, new Date(start))).toBe(true)
  })

  it('counts real hours across the clock change (24 h before 7 PM CST Sun 1 Nov is 8 PM CDT Sat 31 Oct)', () => {
    const start = '2026-11-02T01:00:00.000Z' // Sun 1 Nov, 7 PM CST
    expect(signupClosesAt(start, { options: [PAILS], signupCutoffHours: null })).toBe('2026-11-01T01:00:00.000Z')
  })

  it('says when sign-ups closed in plain words', () => {
    expect(cutoffClosedMessage(0)).toBe('Sign-ups for this class have closed.')
    expect(cutoffClosedMessage(1)).toBe('Sign-ups for this class closed 1 hour before it starts.')
    expect(cutoffClosedMessage(24)).toBe('Sign-ups for this class closed 24 hours before it starts.')
  })

  it('keeps the one modal line exactly', () => {
    expect(PICKS_FINAL_LINE).toBe('Picks are made ahead for you, so they can’t be changed after you book.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/seat-options.test.ts`
Expected: FAIL with `Failed to resolve import "@lib/seat-options"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/seat-options.ts
/**
 * Per-seat questions ("Pumpkin color") and sign-up cutoffs for a class
 * (spec A–C). Pure and client-safe — no imports, no env — so the booking
 * modal, the booking server, the staff sheet and the CLI share one set of
 * rules and one set of words.
 */

export interface SeatOption {
  /** Slug, e.g. "pumpkin-color". Stable once anyone has picked. */
  id: string
  label: string
  choices: string[]
}

export interface SeatPick {
  /** 1-based seat number within one booking. */
  seat: number
  optionId: string
  choice: string
}

/** What a cutoff is worked out from. `EventMeta` satisfies it. */
export interface CutoffSettings {
  options: SeatOption[]
  signupCutoffHours: number | null
}

export const MAX_OPTIONS = 3
export const MAX_LABEL_LENGTH = 40
export const MIN_CHOICES = 2
export const MAX_CHOICES = 12
export const MAX_CHOICE_LENGTH = 30
/** Two weeks: room for "a couple of days" and then some. */
export const MAX_CUTOFF_HOURS = 336
export const DEFAULT_CUTOFF_HOURS_WITH_OPTIONS = 24

/** The one line under the seat questions, in the modal and the email. */
export const PICKS_FINAL_LINE = 'Picks are made ahead for you, so they can’t be changed after you book.'

/** A settings change the rules refuse. `status` is the HTTP answer: 400 invalid, 409 locked by existing picks. */
export class SeatSettingsError extends Error {
  readonly status: 400 | 409
  constructor(message: string, status: 400 | 409 = 400) {
    super(message)
    this.name = 'SeatSettingsError'
    this.status = status
  }
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export function optionIdFrom(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return slug || 'option'
}

export function validateOptions(raw: unknown): Result<SeatOption[]> {
  if (!Array.isArray(raw)) return { ok: false, error: 'Questions must be a list.' }
  if (raw.length > MAX_OPTIONS) return { ok: false, error: `A class can ask up to ${MAX_OPTIONS} questions.` }
  const out: SeatOption[] = []
  for (const item of raw as any[]) {
    const label = typeof item?.label === 'string' ? item.label.trim() : ''
    if (!label || label.length > MAX_LABEL_LENGTH) {
      return { ok: false, error: `Each question needs a name of 1 to ${MAX_LABEL_LENGTH} characters.` }
    }
    const rawChoices: unknown[] = Array.isArray(item.choices) ? item.choices : []
    if (rawChoices.length < MIN_CHOICES || rawChoices.length > MAX_CHOICES) {
      return { ok: false, error: `“${label}” needs ${MIN_CHOICES} to ${MAX_CHOICES} choices.` }
    }
    const choices = rawChoices.map((c) => (typeof c === 'string' ? c.trim() : ''))
    const seen = new Set<string>()
    for (const c of choices) {
      if (!c || c.length > MAX_CHOICE_LENGTH) return { ok: false, error: `Each choice needs 1 to ${MAX_CHOICE_LENGTH} characters.` }
      if (seen.has(c.toLowerCase())) return { ok: false, error: `“${c}” is listed twice under “${label}”.` }
      seen.add(c.toLowerCase())
    }
    const id = typeof item.id === 'string' && /^[a-z0-9-]{1,32}$/.test(item.id) ? item.id : optionIdFrom(label)
    if (out.some((o) => o.id === id || o.label.toLowerCase() === label.toLowerCase())) {
      return { ok: false, error: `Two questions are both called “${label}”.` }
    }
    out.push({ id, label, choices })
  }
  return { ok: true, value: out }
}

/**
 * Once anyone has picked, stored picks must stay valid: the same questions,
 * and every existing choice still there. New choices and a renamed question
 * are fine. Returns the refusal, or null.
 */
export function optionsChangeRefusal(prev: SeatOption[], next: SeatOption[], hasPicks: boolean): string | null {
  if (!hasPicks) return null
  const sameQuestions = prev.length === next.length && prev.every((p) => next.some((n) => n.id === p.id))
  if (!sameQuestions) return 'People have already picked for this class, so questions can’t be added or removed.'
  for (const p of prev) {
    const n = next.find((x) => x.id === p.id)!
    if (!p.choices.every((c) => n.choices.includes(c))) {
      return 'People have already picked for this class, so existing choices can’t be removed or renamed. You can add new ones.'
    }
  }
  return null
}

export function validateCutoffHours(raw: unknown): Result<number | null> {
  if (raw === null) return { ok: true, value: null }
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= MAX_CUTOFF_HOURS) return { ok: true, value: raw }
  return { ok: false, error: `Sign-ups close 0 to ${MAX_CUTOFF_HOURS} hours before the class, in whole hours.` }
}

/** 0 h for a plain class, 24 h once it asks questions; a class's own setting wins. */
export function effectiveCutoffHours(s: CutoffSettings): number {
  return s.signupCutoffHours ?? (s.options.length > 0 ? DEFAULT_CUTOFF_HOURS_WITH_OPTIONS : 0)
}

/**
 * When sign-ups close: whole hours before the start, in real time. Across a
 * clock change the wall-clock time moves by the hour; 24 hours is 24 hours.
 */
export function signupClosesAt(startIso: string, s: CutoffSettings): string {
  return new Date(Date.parse(startIso) - effectiveCutoffHours(s) * 3_600_000).toISOString()
}

export function isSignupClosed(startIso: string, s: CutoffSettings, now: Date = new Date()): boolean {
  return now.getTime() >= Date.parse(signupClosesAt(startIso, s))
}

export function cutoffClosedMessage(hours: number): string {
  if (hours === 0) return 'Sign-ups for this class have closed.'
  return `Sign-ups for this class closed ${hours} hour${hours === 1 ? '' : 's'} before it starts.`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/seat-options.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seat-options.ts tests/lib/seat-options.test.ts
git commit -m "feat(seat-options): rules for per-seat questions and sign-up cutoffs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: The `seat-choices` store (`src/lib/seat-choices.ts`)

The module lands here (spec section C names it) because Task 13's edit lock asks "has anyone picked yet?". Task 22 writes to it; Task 25 adds the roster roll-up.

**Files:**
- Create: `src/lib/seat-choices.ts`
- Test: `tests/lib/seat-choices.test.ts`

**Interfaces:**
- Consumes: `makeKvStore` (`@lib/blob-store`); `SeatPick` (Task 11).
- Produces:
  - `interface SeatChoiceRecord { eventKind: 'workshop'; eventId: string; bookingId: string; orderId: string | null; customer: { givenName: string; familyName: string; email: string; phone: string }; seats: number; picks: SeatPick[]; at: string; attemptId: string }`
  - `seatChoiceKey(eventId: string, bookingId: string): string` → `seat-choices-workshop:<eventId>-<bookingId>`
  - `saveSeatChoices(record: SeatChoiceRecord): Promise<void>` (same booking id overwrites: idempotent)
  - `listSeatChoicesByEvent(kind: 'workshop', eventId: string): Promise<SeatChoiceRecord[]>` (oldest first)
  - `hasSeatChoices(kind: 'workshop', eventId: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/seat-choices.test.ts
import { describe, it, expect } from 'vitest'
import { saveSeatChoices, listSeatChoicesByEvent, hasSeatChoices, seatChoiceKey, type SeatChoiceRecord } from '@lib/seat-choices'

function record(eventId: string, bookingId: string, over: Partial<SeatChoiceRecord> = {}): SeatChoiceRecord {
  return {
    eventKind: 'workshop', eventId, bookingId, orderId: 'order-1',
    customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '' },
    seats: 2,
    picks: [{ seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' }, { seat: 2, optionId: 'pumpkin-color', choice: 'Black' }],
    at: '2026-10-06T15:00:00.000Z', attemptId: 'attempt-1', ...over,
  }
}

describe('seat-choices store', () => {
  it('keys a record by class schedule and booking', () => {
    expect(seatChoiceKey('clssch_pails', 'clsbk_1')).toBe('seat-choices-workshop:clssch_pails-clsbk_1')
  })

  it('lists one class’s records and nothing from another class', async () => {
    const a = `clssch_a${Date.now()}`
    const b = `clssch_b${Date.now()}`
    await saveSeatChoices(record(a, 'clsbk_1', { at: '2026-10-06T15:00:00.000Z' }))
    await saveSeatChoices(record(a, 'clsbk_2', { at: '2026-10-06T14:00:00.000Z' }))
    await saveSeatChoices(record(b, 'clsbk_3'))
    const list = await listSeatChoicesByEvent('workshop', a)
    expect(list.map((r) => r.bookingId)).toEqual(['clsbk_2', 'clsbk_1'])
    expect(list[0].picks[0]).toEqual({ seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' })
  })

  it('saving the same booking again replaces it', async () => {
    const id = `clssch_c${Date.now()}`
    await saveSeatChoices(record(id, 'clsbk_1'))
    await saveSeatChoices(record(id, 'clsbk_1', { seats: 1, picks: [{ seat: 1, optionId: 'pumpkin-color', choice: 'Black' }] }))
    const list = await listSeatChoicesByEvent('workshop', id)
    expect(list).toHaveLength(1)
    expect(list[0].seats).toBe(1)
  })

  it('knows whether anyone has picked for a class', async () => {
    const id = `clssch_d${Date.now()}`
    expect(await hasSeatChoices('workshop', id)).toBe(false)
    await saveSeatChoices(record(id, 'clsbk_1'))
    expect(await hasSeatChoices('workshop', id)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/seat-choices.test.ts`
Expected: FAIL with `Failed to resolve import "@lib/seat-choices"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/seat-choices.ts
/**
 * What each seat picked when it was booked (spec C): the structured record
 * behind the roster totals, the family's "Picks" line and the print sheet.
 * Square only ever gets a booking note.
 *
 * Written once, after the charge succeeds. Never edited afterwards: "you
 * pick what you get", and a swap is noted in the family's History by hand.
 *
 * Netlify Blobs in prod, `.data/seat-choices/` on disk in dev.
 */
import { createLogger } from '@lib/logger'
import { makeKvStore } from '@lib/blob-store'
import type { SeatPick } from '@lib/seat-options'

const logger = createLogger('seat-choices')
const kv = makeKvStore('seat-choices', 'seat-choices')

export interface SeatChoiceRecord {
  eventKind: 'workshop'
  /** Square class schedule id. */
  eventId: string
  bookingId: string
  orderId: string | null
  customer: { givenName: string; familyName: string; email: string; phone: string }
  seats: number
  picks: SeatPick[]
  at: string
  attemptId: string
}

const prefix = (eventId: string) => `seat-choices-workshop:${eventId}-`

export function seatChoiceKey(eventId: string, bookingId: string): string {
  return `${prefix(eventId)}${bookingId}`
}

/** Same booking id → same key, so a retried save replaces rather than doubles. */
export async function saveSeatChoices(record: SeatChoiceRecord): Promise<void> {
  await kv.set(seatChoiceKey(record.eventId, record.bookingId), JSON.stringify(record))
  logger.info('Seat choices saved', { eventId: record.eventId, bookingId: record.bookingId, seats: record.seats })
}

export async function listSeatChoicesByEvent(_kind: 'workshop', eventId: string): Promise<SeatChoiceRecord[]> {
  const keys = (await kv.list()).filter((k) => k.startsWith(prefix(eventId)))
  const records = await Promise.all(keys.map(async (k) => {
    const json = await kv.get(k)
    return json ? (JSON.parse(json) as SeatChoiceRecord) : null
  }))
  return records.filter((r): r is SeatChoiceRecord => r !== null).sort((a, b) => a.at.localeCompare(b.at))
}

export async function hasSeatChoices(_kind: 'workshop', eventId: string): Promise<boolean> {
  return (await kv.list()).some((k) => k.startsWith(prefix(eventId)))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/seat-choices.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seat-choices.ts tests/lib/seat-choices.test.ts
git commit -m "feat(seat-choices): store for what each seat picked

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Event settings gain questions and a cutoff (`event-meta`, `events`)

**Files:**
- Modify: `src/lib/event-meta.ts` (whole file; shown in full below)
- Modify: `src/lib/events.ts` (`StudioEvent` at lines 22–35; `partyEvent` lines 75–87; `workshopEvent` lines 89–100)
- Test: `tests/lib/event-meta.test.ts`, `tests/lib/events.test.ts`

**Interfaces:**
- Consumes: `validateOptions`, `optionsChangeRefusal`, `validateCutoffHours`, `SeatSettingsError`, `SeatOption` (Task 11); `hasSeatChoices` (Task 12).
- Produces:
  - `EventMeta` gains `options: SeatOption[]`, `signupCutoffHours: number | null`; `EventMetaHistoryEntry` gains optional `options?`, `signupCutoffHours?`; `EventMetaPatch` gains `options?: SeatOption[]`, `signupCutoffHours?: number | null`.
  - `emptyEventMeta(): EventMeta`
  - `normalizeEventMeta(raw: any): EventMeta`
  - `mergeEventMeta(current: EventMeta, patch: EventMetaPatch, by: By, now: string, hasPicks: boolean): EventMeta` (pure; throws `SeatSettingsError`)
  - `setEventMeta(kind, id, patch, by)` unchanged signature; throws `SeatSettingsError` (400 invalid, 409 locked).
  - `StudioEvent` gains optional `options?: SeatOption[]`, `signupCutoffHours?: number | null`, `capacity?: number` (always set for workshops and parties by `getEvent`/`listEvents`; optional so older fixtures still type-check).

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/event-meta.test.ts` (add the imports to the top import list):

```ts
import { emptyEventMeta, mergeEventMeta } from '@lib/event-meta'
import { saveSeatChoices } from '@lib/seat-choices'
import { SeatSettingsError } from '@lib/seat-options'
import { makeKvStore } from '@lib/blob-store'

const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }

describe('event-meta — seat questions and sign-up cutoff', () => {
  it('defaults to no questions and the default cutoff', async () => {
    const m = await setEventMeta('workshop', 'w_def_' + Date.now(), { dropOff: false }, by)
    expect(m.options).toEqual([])
    expect(m.signupCutoffHours).toBeNull()
  })

  it('reads an old record without the new fields as the defaults', async () => {
    const id = 'w_old_' + Date.now()
    await makeKvStore('event-meta', 'event-meta').set(
      `event-meta-workshop:${id}`,
      JSON.stringify({ dropOff: true, days: null, updatedAt: '2026-09-28T00:00:00.000Z', by, history: [] }),
    )
    expect(await getEventMeta('workshop', id)).toMatchObject({ dropOff: true, options: [], signupCutoffHours: null })
  })

  it('saves questions and a cutoff, and logs both', async () => {
    const id = 'w_set_' + Date.now()
    const m = await setEventMeta('workshop', id, { options: [PAILS], signupCutoffHours: 48 }, by)
    expect(m.options).toEqual([PAILS])
    expect(m.signupCutoffHours).toBe(48)
    expect(m.history.at(-1)).toMatchObject({ by, options: [PAILS], signupCutoffHours: 48 })
    const m2 = await setEventMeta('workshop', id, { signupCutoffHours: null }, by)
    expect(m2.signupCutoffHours).toBeNull()
    expect(m2.options).toEqual([PAILS])
  })

  it('refuses invalid questions with a plain message', async () => {
    const id = 'w_bad_' + Date.now()
    await expect(setEventMeta('workshop', id, { options: [{ ...PAILS, choices: ['Black'] }] }, by)).rejects.toMatchObject({
      name: 'SeatSettingsError', status: 400, message: '“Pumpkin color” needs 2 to 12 choices.',
    })
    expect(await getEventMeta('workshop', id)).toBeNull()
  })

  it('once someone has picked: adding a choice works, removing one or the question is refused', async () => {
    const id = 'w_lock_' + Date.now()
    await setEventMeta('workshop', id, { options: [PAILS] }, by)
    await saveSeatChoices({
      eventKind: 'workshop', eventId: id, bookingId: 'clsbk_1', orderId: null,
      customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '' },
      seats: 1, picks: [{ seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' }], at: '2026-10-06T15:00:00.000Z', attemptId: 'a',
    })
    const added = await setEventMeta('workshop', id, { options: [{ ...PAILS, choices: [...PAILS.choices, 'Orange'] }] }, by)
    expect(added.options[0].choices).toContain('Orange')
    await expect(setEventMeta('workshop', id, { options: [{ ...PAILS, choices: ['Light Pink', 'Light Blue', 'Black', 'Orange'] }] }, by)).rejects.toMatchObject({ status: 409 })
    await expect(setEventMeta('workshop', id, { options: [] }, by)).rejects.toMatchObject({ status: 409 })
    expect((await getEventMeta('workshop', id))!.options[0].choices).toContain('Lavender')
  })

  it('mergeEventMeta applies the same rules without storage', () => {
    const now = '2026-10-06T00:00:00.000Z'
    const next = mergeEventMeta(emptyEventMeta(), { signupCutoffHours: 24 }, by, now, false)
    expect(next).toMatchObject({ signupCutoffHours: 24, options: [], updatedAt: now, by })
    expect(() => mergeEventMeta(emptyEventMeta(), { signupCutoffHours: -1 }, by, now, false)).toThrow(SeatSettingsError)
  })
})
```

Append inside `describe('events', …)` in `tests/lib/events.test.ts`:

```ts
  it('carries a class’s seat questions, cutoff and capacity', async () => {
    const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Black', 'Lavender'] }
    const { getEventMeta } = await import('@lib/event-meta')
    vi.mocked(getEventMeta).mockResolvedValueOnce({ dropOff: false, days: null, options: [PAILS], signupCutoffHours: 48, updatedAt: '', by: { id: 'k', name: 'K' }, history: [] } as any)
    mockGetWorkshop.mockResolvedValueOnce({ ...WORKSHOPS[1], totalCapacity: 25 })
    expect(await getEvent('workshop', 'cs-pno')).toMatchObject({ options: [PAILS], signupCutoffHours: 48, capacity: 25 })
  })

  it('a party never asks seat questions', async () => {
    expect(await getEvent('party', 'p1')).toMatchObject({ options: [], signupCutoffHours: null })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/event-meta.test.ts tests/lib/events.test.ts`
Expected: FAIL — `emptyEventMeta`/`mergeEventMeta` are not exported; `m.options` is `undefined`; the events tests miss `options`/`capacity`.

- [ ] **Step 3: Write minimal implementation**

Replace `src/lib/event-meta.ts` with:

```ts
/**
 * Overlay store for event settings the source system doesn't own: drop-off
 * (studio-run camps/PNO vs. host-supervised parties/workshops), multi-day
 * spans (a camp sold as one Square Class covering several dates), and — for
 * classes — the per-seat questions and the sign-up cutoff (spec A).
 * `getEvent`/`listEvents` (`@lib/events`) merge this on top of the source.
 *
 * Netlify Blobs in prod, `.data/event-meta/` on disk in dev.
 */
import { createLogger } from '@lib/logger'
import { makeKvStore } from '@lib/blob-store'
import { hasSeatChoices } from '@lib/seat-choices'
import { optionsChangeRefusal, validateCutoffHours, validateOptions, SeatSettingsError, type SeatOption } from '@lib/seat-options'
import type { By } from '@lib/staff-auth'

const logger = createLogger('event-meta')
const kv = makeKvStore('event-meta', 'event-meta')

const HISTORY_CAP = 50

export interface EventMetaHistoryEntry {
  at: string // ISO
  by: By
  dropOff: boolean
  days: string[] | null
  /** Absent on entries written before seat questions existed. */
  options?: SeatOption[]
  signupCutoffHours?: number | null
}

export interface EventMeta {
  dropOff: boolean
  /** null = derive from the source event's startIso (single day). */
  days: string[] | null
  /** Per-seat questions; [] = none. */
  options: SeatOption[]
  /** null = the default (0 h, or 24 h once the class asks questions). */
  signupCutoffHours: number | null
  updatedAt: string // ISO
  by: By
  /** Append-only, capped at 50 (oldest dropped first). */
  history: EventMetaHistoryEntry[]
}

export interface EventMetaPatch {
  dropOff?: boolean
  days?: string[] | null
  options?: SeatOption[]
  signupCutoffHours?: number | null
}

function key(kind: string, id: string): string {
  return `event-meta-${kind}:${id}`
}

export function emptyEventMeta(): EventMeta {
  return {
    dropOff: false, days: null, options: [], signupCutoffHours: null,
    updatedAt: new Date(0).toISOString(), by: { id: '', name: '' }, history: [],
  }
}

export function normalizeEventMeta(raw: any): EventMeta {
  const options = validateOptions(raw?.options)
  return {
    dropOff: !!raw?.dropOff,
    days: Array.isArray(raw?.days) ? raw.days.map(String) : null,
    options: options.ok ? options.value : [],
    signupCutoffHours: typeof raw?.signupCutoffHours === 'number' ? raw.signupCutoffHours : null,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
    by: raw?.by && typeof raw.by === 'object'
      ? { id: String(raw.by.id ?? ''), name: String(raw.by.name ?? '') }
      : { id: '', name: '' },
    history: Array.isArray(raw?.history) ? raw.history : [],
  }
}

export async function getEventMeta(kind: string, id: string): Promise<EventMeta | null> {
  const json = await kv.get(key(kind, id))
  return json ? normalizeEventMeta(JSON.parse(json)) : null
}

/**
 * The next record for a patch. Pure, so the CLI (scripts/set-event.ts)
 * applies exactly the rules the staff sheet does. `hasPicks` = someone has
 * already picked for this class (locks removing questions and choices).
 * Throws SeatSettingsError.
 */
export function mergeEventMeta(current: EventMeta, patch: EventMetaPatch, by: By, now: string, hasPicks: boolean): EventMeta {
  let options = current.options
  if (patch.options !== undefined) {
    const checked = validateOptions(patch.options)
    if (!checked.ok) throw new SeatSettingsError(checked.error)
    const refusal = optionsChangeRefusal(current.options, checked.value, hasPicks)
    if (refusal) throw new SeatSettingsError(refusal, 409)
    options = checked.value
  }
  let signupCutoffHours = current.signupCutoffHours
  if (patch.signupCutoffHours !== undefined) {
    const checked = validateCutoffHours(patch.signupCutoffHours)
    if (!checked.ok) throw new SeatSettingsError(checked.error)
    signupCutoffHours = checked.value
  }
  const dropOff = patch.dropOff ?? current.dropOff
  const days = patch.days !== undefined ? patch.days : current.days
  return {
    dropOff,
    days,
    options,
    signupCutoffHours,
    updatedAt: now,
    by,
    history: [...current.history, { at: now, by, dropOff, days, options, signupCutoffHours }].slice(-HISTORY_CAP),
  }
}

/**
 * Apply a patch with optimistic concurrency (3 attempts, matching
 * `mutateCheckin`'s CAS loop) and append to history.
 */
export async function setEventMeta(kind: string, id: string, patch: EventMetaPatch, by: By): Promise<EventMeta> {
  const k = key(kind, id)
  // Only a change to the questions needs to know whether anyone has picked.
  const hasPicks = patch.options !== undefined && kind === 'workshop' ? await hasSeatChoices('workshop', id) : false
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await kv.getWithMeta(k)
    const current = value ? normalizeEventMeta(JSON.parse(value)) : emptyEventMeta()
    const next = mergeEventMeta(current, patch, by, new Date().toISOString(), hasPicks)
    if (await kv.setIfMatch(k, JSON.stringify(next), etag, value !== null)) {
      logger.info('Event meta set', {
        kind, id, dropOff: next.dropOff, days: next.days, options: next.options.length, signupCutoffHours: next.signupCutoffHours,
      })
      return next
    }
  }
  throw new Error('Concurrent update — please retry')
}
```

`src/lib/events.ts` — add the import:

```ts
import type { SeatOption } from '@lib/seat-options'
```

add to `StudioEvent` after `seats?: number`:

```ts
  /** Per-seat questions (classes only; [] when none). */
  options?: SeatOption[]
  /** The class's own sign-up cutoff in hours; null = the default. */
  signupCutoffHours?: number | null
  /** Seats the class holds in all, when Square says. */
  capacity?: number
```

in `partyEvent`, after `dropOff: …,` add:

```ts
    options: [],
    signupCutoffHours: null,
```

in `workshopEvent`, after `seats: w.availableCapacity,` add:

```ts
    options: meta?.options ?? [],
    signupCutoffHours: meta?.signupCutoffHours ?? null,
    ...(typeof w.totalCapacity === 'number' ? { capacity: w.totalCapacity } : {}),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/event-meta.test.ts tests/lib/events.test.ts tests/api/staff-events.test.ts tests/api/staff-roster.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-meta.ts src/lib/events.ts tests/lib/event-meta.test.ts tests/lib/events.test.ts
git commit -m "feat(event-meta): seat questions and sign-up cutoff, locked once anyone picks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: `/api/staff/event-meta.json` accepts questions and a cutoff

**Files:**
- Modify: `src/pages/api/staff/event-meta.json.ts` (imports; POST body handling lines 62–81)
- Test: `tests/api/event-meta.test.ts`

**Interfaces:**
- Consumes: `validateOptions`, `validateCutoffHours`, `SeatSettingsError` (Task 11); `setEventMeta` (Task 13).
- Produces: `POST { kind, id, dropOff?, days?, options?, signupCutoffHours? }` → `200 { data: StudioEvent }` | `400 { error }` (invalid, or questions/cutoff on a party) | `409 { error }` (locked by picks) | `401` | `404` | `503`.

- [ ] **Step 1: Write the failing test**

Append to `tests/api/event-meta.test.ts` (inside `describe('POST /api/staff/event-meta.json', …)`):

```ts
  const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }

  it('rejects questions from a caller without the staff cookie', async () => {
    authed = null
    expect((await POST(postCtx({ kind: 'workshop', id: 'cs1', options: [PAILS] }))).status).toBe(401)
    expect(mockSetEventMeta).not.toHaveBeenCalled()
  })

  it('saves checked, trimmed questions', async () => {
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', options: [{ label: ' Pumpkin color ', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }] }))
    expect(res.status).toBe(200)
    expect(mockSetEventMeta).toHaveBeenCalledWith('workshop', 'cs1', { options: [PAILS] }, { id: 'k', name: 'Kaden' })
  })

  it('refuses more than three questions, saying why', async () => {
    const options = [1, 2, 3, 4].map((n) => ({ label: `Q${n}`, choices: ['A', 'B'] }))
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', options }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('A class can ask up to 3 questions.')
    expect(mockSetEventMeta).not.toHaveBeenCalled()
  })

  it('refuses questions or a cutoff on a party', async () => {
    expect((await POST(postCtx({ kind: 'party', id: 'p1', options: [PAILS] }))).status).toBe(400)
    expect((await POST(postCtx({ kind: 'party', id: 'p1', signupCutoffHours: 24 }))).status).toBe(400)
    expect(mockSetEventMeta).not.toHaveBeenCalled()
  })

  it('saves a cutoff in whole hours, or null for the default', async () => {
    await POST(postCtx({ kind: 'workshop', id: 'cs1', signupCutoffHours: 48 }))
    await POST(postCtx({ kind: 'workshop', id: 'cs1', signupCutoffHours: null }))
    expect(mockSetEventMeta.mock.calls.map((c) => c[2])).toEqual([{ signupCutoffHours: 48 }, { signupCutoffHours: null }])
  })

  it('refuses a cutoff that is not whole hours 0–336', async () => {
    for (const signupCutoffHours of [2.5, -1, 337, '24']) {
      expect((await POST(postCtx({ kind: 'workshop', id: 'cs1', signupCutoffHours }))).status).toBe(400)
    }
    expect(mockSetEventMeta).not.toHaveBeenCalled()
  })

  it('passes on the lock refusal once someone has picked', async () => {
    const { SeatSettingsError } = await import('@lib/seat-options')
    const msg = 'People have already picked for this class, so existing choices can’t be removed or renamed. You can add new ones.'
    mockSetEventMeta.mockRejectedValue(new SeatSettingsError(msg, 409))
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', options: [PAILS] }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(msg)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/event-meta.test.ts`
Expected: FAIL — the new requests answer `400 Nothing to update.` (and the lock case answers 503).

- [ ] **Step 3: Write minimal implementation**

Add the import:

```ts
import { SeatSettingsError, validateCutoffHours, validateOptions } from '@lib/seat-options'
```

Replace the block from `const patch: EventMetaPatch = {}` to the end of the `try/catch` in `POST` with:

```ts
  const patch: EventMetaPatch = {}
  if (typeof body.dropOff === 'boolean') patch.dropOff = body.dropOff
  if ('value' in daysPatch) patch.days = daysPatch.value

  if ('options' in body) {
    if (kind !== 'workshop') return bad('Questions for each seat are for classes only.')
    const checked = validateOptions(body.options)
    if (!checked.ok) return bad(checked.error)
    patch.options = checked.value
  }
  if ('signupCutoffHours' in body) {
    if (kind !== 'workshop') return bad('Sign-up cutoffs are for classes only.')
    const checked = validateCutoffHours(body.signupCutoffHours)
    if (!checked.ok) return bad(checked.error)
    patch.signupCutoffHours = checked.value
  }

  if (patch.dropOff === undefined && patch.days === undefined && patch.options === undefined && patch.signupCutoffHours === undefined) {
    return bad('Nothing to update.')
  }

  try {
    // Confirm the event resolves BEFORE writing — a typo'd/stale id used to
    // leave an orphan meta overlay behind (written, then 404'd on the read
    // back) that nothing would ever surface or clean up.
    if (!(await getEvent(kind, id))) return bad("We couldn't find that event.", 404)
    await setEventMeta(kind, id, patch, byOf(staff))
    const event = await getEvent(kind, id)
    if (!event) return bad("We couldn't find that event.", 404)
    return new Response(JSON.stringify({ data: event }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    // The rules said no (invalid, or someone has already picked): say why.
    if (err instanceof SeatSettingsError) return bad(err.message, err.status)
    return bad("Couldn't reach storage — try again.", 503)
  }
```

Update the route's doc comment first line to: `Staff-only. \`POST { kind, id, dropOff?, days?, options?, signupCutoffHours? }\` patches the event-meta overlay (drop-off, multi-day, per-seat questions, sign-up cutoff) and returns the merged event.`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/event-meta.test.ts`
Expected: PASS (old and new tests).

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/staff/event-meta.json.ts tests/api/event-meta.test.ts
git commit -m "feat(staff): event settings API takes seat questions and a sign-up cutoff

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Gear sheet — "Questions for each seat" and "Sign-ups close"

**Files:**
- Modify: `src/components/staff/EventSettingsSheet.tsx` (imports; `patchEvent`/`save` patch type; two new blocks after the Days block, before the error line; two new components at the end of the file)
- Test: `tests/components/staff/EventSettingsSheet.test.tsx`

**Interfaces:**
- Consumes: `POST /api/staff/event-meta.json` (Task 14); `effectiveCutoffHours`, `MAX_OPTIONS`, `MAX_LABEL_LENGTH`, `MAX_CHOICE_LENGTH`, `MAX_CUTOFF_HOURS`, `SeatOption` (Task 11); `StudioEvent.options`, `StudioEvent.signupCutoffHours` (Task 13).
- Produces: nothing new for other tasks.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/staff/EventSettingsSheet.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EventSettingsSheet from '@components/staff/EventSettingsSheet'

const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }
const CLASS = { kind: 'workshop', id: 'clssch_pails', title: 'Pumpkin Pails', startIso: '2026-10-18T18:00:00.000Z', days: ['2026-10-18'], dropOff: false, options: [], signupCutoffHours: null } as any

function serve(event: any, postAnswer?: { status: number; body: unknown }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init?: any) => {
    if (init?.method === 'POST') {
      if (postAnswer) return { ok: postAnswer.status < 300, status: postAnswer.status, json: async () => postAnswer.body } as Response
      return { ok: true, status: 200, json: async () => ({ data: { ...event, ...JSON.parse(init.body) } }) } as Response
    }
    return { ok: true, status: 200, json: async () => ({ data: event }) } as Response
  })
}
const posted = (spy: ReturnType<typeof serve>) => spy.mock.calls.filter(([, init]: any) => init?.method === 'POST').map(([, init]: any) => JSON.parse(init.body))

afterEach(() => vi.restoreAllMocks())

function open(event: any = CLASS) {
  render(<EventSettingsSheet event={event} onSaved={vi.fn()} onClose={vi.fn()} />)
}

describe('EventSettingsSheet — seat questions', () => {
  it('a party has no seat questions and no cutoff', () => {
    serve({ ...CLASS, kind: 'party' })
    open({ ...CLASS, kind: 'party' })
    expect(screen.queryByText('Questions for each seat')).toBeNull()
    expect(screen.queryByText('Sign-ups close')).toBeNull()
  })

  it('builds a question, and saves it only after a confirm', async () => {
    const spy = serve(CLASS)
    open()
    fireEvent.click(screen.getByRole('button', { name: '+ Add a question' }))
    fireEvent.change(screen.getByLabelText('Question 1'), { target: { value: 'Pumpkin color' } })
    for (const c of ['Lavender', 'Black']) {
      fireEvent.change(screen.getByLabelText('New choice for question 1'), { target: { value: c } })
      fireEvent.click(screen.getByRole('button', { name: 'Add choice' }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save questions' }))
    expect(screen.getByText('Save these questions? Everyone booking this class will pick one answer per seat.')).toBeInTheDocument()
    expect(posted(spy)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }))
    await waitFor(() =>
      expect(posted(spy)).toEqual([{ kind: 'workshop', id: 'clssch_pails', options: [{ id: '', label: 'Pumpkin color', choices: ['Lavender', 'Black'] }] }]),
    )
  })

  it('shows the server’s refusal when picks lock a choice', async () => {
    const msg = 'People have already picked for this class, so existing choices can’t be removed or renamed. You can add new ones.'
    serve({ ...CLASS, options: [PAILS] }, { status: 409, body: { error: msg } })
    open({ ...CLASS, options: [PAILS] })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Black' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save questions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }))
    expect(await screen.findByText(msg)).toBeInTheDocument()
  })
})

describe('EventSettingsSheet — sign-ups close', () => {
  it('shows the default greyed: 0 hours for a plain class', () => {
    serve(CLASS)
    open()
    expect(screen.getByLabelText('Sign-ups close')).toHaveAttribute('placeholder', '0 (default)')
    expect(screen.getByText('Using the default: 0 hours.')).toBeInTheDocument()
  })

  it('shows the default greyed: 24 hours once the class asks questions', () => {
    serve({ ...CLASS, options: [PAILS] })
    open({ ...CLASS, options: [PAILS] })
    expect(screen.getByLabelText('Sign-ups close')).toHaveAttribute('placeholder', '24 (default)')
  })

  it('saves whole hours after a confirm', async () => {
    const spy = serve(CLASS)
    open()
    fireEvent.change(screen.getByLabelText('Sign-ups close'), { target: { value: '48' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Close sign-ups 48 hours before this class?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }))
    await waitFor(() => expect(posted(spy)).toEqual([{ kind: 'workshop', id: 'clssch_pails', signupCutoffHours: 48 }]))
  })

  it('will not offer to save part hours', () => {
    serve(CLASS)
    open()
    fireEvent.change(screen.getByLabelText('Sign-ups close'), { target: { value: '2.5' } })
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.getByText('Whole hours, 0 to 336.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/staff/EventSettingsSheet.test.tsx`
Expected: FAIL — no "+ Add a question" button, no "Sign-ups close" label.

- [ ] **Step 3: Write minimal implementation**

Add the import below `import type { StudioEvent } from '@lib/events'`:

```tsx
import {
  effectiveCutoffHours,
  MAX_CHOICE_LENGTH,
  MAX_CUTOFF_HOURS,
  MAX_LABEL_LENGTH,
  MAX_OPTIONS,
  type SeatOption,
} from '@lib/seat-options'

type EventPatch = { dropOff?: boolean; days?: string[] | null; options?: SeatOption[]; signupCutoffHours?: number | null }
```

Change the `patchEvent` signature's `patch` parameter type and the `save` function's parameter type from `{ dropOff?: boolean; days?: string[] | null }` to `EventPatch`.

Directly after the closing `</div>` of the `{/* Days */}` block and before `{error && …}`, add:

```tsx
        {event.kind === 'workshop' && (
          <SeatQuestions saved={event.options ?? []} busy={busy} onSave={(options) => save({ options })} />
        )}
        {event.kind === 'workshop' && (
          <SignupCutoff event={event} busy={busy} onSave={(hours) => save({ signupCutoffHours: hours })} />
        )}
```

Append at the end of the file:

```tsx
const sectionTitle: React.CSSProperties = { margin: '0 0 0.4rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-dark)' }
const hint: React.CSSProperties = { margin: '0.25rem 0 0', fontSize: '0.78125rem', color: 'var(--color-muted)' }
const textInput: React.CSSProperties = {
  padding: '0.4rem 0.6rem',
  borderRadius: '0.5rem',
  border: '1px solid rgba(var(--color-primary-rgb),0.3)',
  fontSize: '0.85rem',
}
const confirmBox: React.CSSProperties = {
  marginTop: '0.6rem',
  padding: '0.7rem 0.85rem',
  borderRadius: '0.7rem',
  background: 'rgba(217,119,6,0.08)',
  border: '1px solid rgba(217,119,6,0.28)',
}

const toDraft = (o: SeatOption): SeatOption => ({ id: o.id, label: o.label, choices: [...o.choices] })

/**
 * "Questions for each seat" (spec A): e.g. Pumpkin color → Light Pink /
 * Light Blue / Black / Lavender. Edits stay local until Save → confirm, like
 * Drop-off. The server owns the rules (limits; nothing removed once anyone
 * has picked) and its refusal shows in the sheet's error line.
 */
function SeatQuestions({ saved, busy, onSave }: { saved: SeatOption[]; busy: boolean; onSave: (options: SeatOption[]) => Promise<void> }) {
  const savedKey = JSON.stringify(saved)
  const [draft, setDraft] = useState<SeatOption[]>(() => saved.map(toDraft))
  const [newChoice, setNewChoice] = useState<Record<number, string>>({})
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    setDraft(saved.map(toDraft))
    setConfirming(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey])

  const dirty = JSON.stringify(draft) !== savedKey
  const update = (i: number, next: Partial<SeatOption>) => setDraft((d) => d.map((o, j) => (j === i ? { ...o, ...next } : o)))

  function addChoice(i: number) {
    const c = (newChoice[i] ?? '').trim()
    if (!c) return
    update(i, { choices: [...draft[i].choices, c] })
    setNewChoice((n) => ({ ...n, [i]: '' }))
  }

  async function confirmSave() {
    setConfirming(false)
    await onSave(draft.map((o) => ({ id: o.id, label: o.label.trim(), choices: o.choices })))
  }

  return (
    <div style={{ marginTop: '1.1rem' }}>
      <p style={sectionTitle}>Questions for each seat</p>
      <p style={{ ...hint, margin: '0 0 0.4rem' }}>Each seat picks one answer when booking. Picks can’t change after.</p>
      {draft.map((o, i) => (
        <div key={i} style={{ marginTop: '0.6rem', padding: '0.6rem', borderRadius: '0.6rem', border: '1px solid rgba(var(--color-primary-rgb),0.2)' }}>
          <input
            aria-label={`Question ${i + 1}`}
            value={o.label}
            maxLength={MAX_LABEL_LENGTH}
            placeholder="Pumpkin color"
            disabled={busy}
            onChange={(e) => update(i, { label: e.target.value })}
            style={{ ...textInput, width: '100%', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            {o.choices.map((c, k) => (
              <span key={k} style={chip}>
                {c}
                <button
                  type="button"
                  aria-label={`Remove ${c}`}
                  disabled={busy}
                  onClick={() => update(i, { choices: o.choices.filter((_, x) => x !== k) })}
                  style={{ border: 'none', background: 'none', color: 'var(--color-muted)', cursor: busy ? 'default' : 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: 0 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
            <input
              aria-label={`New choice for question ${i + 1}`}
              value={newChoice[i] ?? ''}
              maxLength={MAX_CHOICE_LENGTH}
              placeholder="Lavender"
              disabled={busy}
              onChange={(e) => setNewChoice((n) => ({ ...n, [i]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addChoice(i)
                }
              }}
              style={{ ...textInput, flex: 1 }}
            />
            <button type="button" onClick={() => addChoice(i)} disabled={busy} style={btn()}>Add choice</button>
          </div>
          <button
            type="button"
            onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
            disabled={busy}
            style={{ ...btn(), marginTop: '0.5rem', padding: '0.3rem 0.65rem', fontSize: '0.78125rem' }}
          >
            Remove question
          </button>
        </div>
      ))}
      {draft.length < MAX_OPTIONS && (
        <button
          type="button"
          onClick={() => setDraft((d) => [...d, { id: '', label: '', choices: [] }])}
          disabled={busy}
          style={{ ...btn(), marginTop: '0.6rem', padding: '0.3rem 0.65rem', fontSize: '0.78125rem' }}
        >
          + Add a question
        </button>
      )}
      {dirty && !confirming && (
        <div style={{ marginTop: '0.6rem' }}>
          <button type="button" onClick={() => setConfirming(true)} disabled={busy} style={btn(true)}>Save questions</button>
        </div>
      )}
      {confirming && (
        <div style={confirmBox}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-dark)', fontWeight: 600 }}>
            {draft.length === 0
              ? 'Remove the questions from this class?'
              : 'Save these questions? Everyone booking this class will pick one answer per seat.'}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <button type="button" onClick={() => setConfirming(false)} style={btn()}>Cancel</button>
            <button type="button" onClick={confirmSave} disabled={busy} style={btn(true)}>Yes, save</button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * "Sign-ups close" (spec A): whole hours before the class. Blank means the
 * default (0 h, or 24 h once the class asks questions), shown greyed.
 */
function SignupCutoff({ event, busy, onSave }: { event: StudioEvent; busy: boolean; onSave: (hours: number | null) => Promise<void> }) {
  const saved = event.signupCutoffHours ?? null
  const fallback = effectiveCutoffHours({ options: event.options ?? [], signupCutoffHours: null })
  const [value, setValue] = useState(saved === null ? '' : String(saved))
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    setValue(saved === null ? '' : String(saved))
    setConfirming(false)
  }, [saved])

  const parsed = value.trim() === '' ? null : Number(value)
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_CUTOFF_HOURS)
  const changed = parsed !== saved
  const inputId = `cutoff-${event.id}`

  return (
    <div style={{ marginTop: '1.1rem' }}>
      <label htmlFor={inputId} style={{ ...sectionTitle, display: 'block' }}>Sign-ups close</label>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_CUTOFF_HOURS}
          step={1}
          value={value}
          placeholder={`${fallback} (default)`}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          style={{ ...textInput, width: '7.5rem' }}
        />
        <span style={{ fontSize: '0.85rem', color: 'var(--color-dark)' }}>hours before it starts</span>
      </div>
      <p style={hint}>
        {!valid
          ? `Whole hours, 0 to ${MAX_CUTOFF_HOURS}.`
          : saved === null
            ? `Using the default: ${fallback} hours.`
            : `Default would be ${fallback} hours. Clear the box to use it.`}
      </p>
      {valid && changed && !confirming && (
        <div style={{ marginTop: '0.5rem' }}>
          <button type="button" onClick={() => setConfirming(true)} disabled={busy} style={btn(true)}>Save</button>
        </div>
      )}
      {confirming && (
        <div style={confirmBox}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-dark)', fontWeight: 600 }}>
            {parsed === null ? `Go back to the default (${fallback} hours)?` : `Close sign-ups ${parsed} hours before this class?`}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <button type="button" onClick={() => setConfirming(false)} style={btn()}>Cancel</button>
            <button
              type="button"
              onClick={async () => {
                setConfirming(false)
                await onSave(parsed)
              }}
              disabled={busy}
              style={btn(true)}
            >
              Yes, save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/staff/EventSettingsSheet.test.tsx tests/components/staff/Roster.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/staff/EventSettingsSheet.tsx tests/components/staff/EventSettingsSheet.test.tsx
git commit -m "feat(staff): gear sheet edits seat questions and the sign-up cutoff

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: CLI — `scripts/set-event.ts` (with `set-dropoff.ts` kept as an alias)

**Files:**
- Create: `src/lib/event-meta-cli.ts`
- Create: `scripts/set-event.ts`
- Modify: `scripts/set-dropoff.ts` (whole file becomes the alias)
- Test: `tests/lib/event-meta-cli.test.ts`

**Interfaces:**
- Consumes: `EventMetaPatch`, `mergeEventMeta`, `normalizeEventMeta`, `emptyEventMeta` (Task 13); `validateCutoffHours`, `effectiveCutoffHours` (Task 11).
- Produces:
  - `interface SetEventArgs { kind: 'workshop' | 'party'; id: string; show: boolean; patch: EventMetaPatch }`
  - `SET_EVENT_USAGE: string`
  - `parseSetEventArgs(argv: string[]): SetEventArgs | { error: string }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/event-meta-cli.test.ts
import { describe, it, expect } from 'vitest'
import { parseSetEventArgs, SET_EVENT_USAGE } from '@lib/event-meta-cli'

describe('parseSetEventArgs', () => {
  it('needs --workshop or --party with an id', () => {
    expect(parseSetEventArgs(['--on'])).toEqual({ error: SET_EVENT_USAGE })
  })

  it('keeps the old drop-off and days flags', () => {
    expect(parseSetEventArgs(['--workshop', 'clssch_1', '--on', '--days', '2026-10-19,2026-10-18'])).toEqual({
      kind: 'workshop', id: 'clssch_1', show: false, patch: { dropOff: true, days: ['2026-10-18', '2026-10-19'] },
    })
    expect(parseSetEventArgs(['--party', 'bk_1', '--off'])).toMatchObject({ kind: 'party', patch: { dropOff: false } })
  })

  it('--option replaces the class’s questions; it may repeat', () => {
    const r = parseSetEventArgs(['--workshop', 'clssch_pails', '--option', 'Pumpkin color=Light Pink|Light Blue|Black|Lavender', '--option', 'Ribbon=Red|Gold'])
    expect(r).toMatchObject({
      patch: {
        options: [
          { id: '', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] },
          { id: '', label: 'Ribbon', choices: ['Red', 'Gold'] },
        ],
      },
    })
  })

  it('--no-options clears them', () => {
    expect(parseSetEventArgs(['--workshop', 'clssch_pails', '--no-options'])).toMatchObject({ patch: { options: [] } })
  })

  it('--cutoff takes whole hours or "default"', () => {
    expect(parseSetEventArgs(['--workshop', 'c', '--cutoff', '48'])).toMatchObject({ patch: { signupCutoffHours: 48 } })
    expect(parseSetEventArgs(['--workshop', 'c', '--cutoff', 'default'])).toMatchObject({ patch: { signupCutoffHours: null } })
    expect(parseSetEventArgs(['--workshop', 'c', '--cutoff', '2.5'])).toEqual({ error: 'Sign-ups close 0 to 336 hours before the class, in whole hours.' })
  })

  it('refuses questions or a cutoff on a party', () => {
    expect(parseSetEventArgs(['--party', 'bk_1', '--option', 'A=B|C'])).toEqual({ error: 'Questions for each seat are for classes (--workshop) only.' })
    expect(parseSetEventArgs(['--party', 'bk_1', '--cutoff', '24'])).toEqual({ error: 'Sign-up cutoffs are for classes (--workshop) only.' })
  })

  it('refuses an --option without "Label=Choices"', () => {
    expect(parseSetEventArgs(['--workshop', 'c', '--option', 'Pumpkin color'])).toEqual({ error: '--option needs "Label=Choice|Choice", got "Pumpkin color".' })
  })

  it('--show only reads', () => {
    expect(parseSetEventArgs(['--workshop', 'c', '--show'])).toEqual({ kind: 'workshop', id: 'c', show: true, patch: {} })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/event-meta-cli.test.ts`
Expected: FAIL with `Failed to resolve import "@lib/event-meta-cli"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/event-meta-cli.ts
/**
 * Flag parsing for scripts/set-event.ts. Pure, so it is tested; the script
 * does the reading and writing. The rules themselves (limits, the lock once
 * anyone has picked) are applied by `mergeEventMeta`, same as the gear sheet.
 */
import type { EventMetaPatch } from '@lib/event-meta'
import { validateCutoffHours } from '@lib/seat-options'

export interface SetEventArgs {
  kind: 'workshop' | 'party'
  id: string
  show: boolean
  patch: EventMetaPatch
}

export const SET_EVENT_USAGE =
  'Usage: set-event.ts (--workshop <clssch_id> | --party <bookingId>) [--on | --off] [--days a,b] ' +
  '[--option "Label=Choice|Choice" …] [--no-options] [--cutoff <hours> | --cutoff default] [--show]'

export function parseSetEventArgs(argv: string[]): SetEventArgs | { error: string } {
  const flag = (n: string) => {
    const i = argv.indexOf(`--${n}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const has = (n: string) => argv.includes(`--${n}`)

  const kind = flag('workshop') ? 'workshop' : flag('party') ? 'party' : null
  const id = flag('workshop') ?? flag('party')
  if (!kind || !id) return { error: SET_EVENT_USAGE }

  const patch: EventMetaPatch = {}
  if (has('on')) patch.dropOff = true
  if (has('off')) patch.dropOff = false
  const daysArg = flag('days')
  if (daysArg !== undefined) {
    patch.days = daysArg ? daysArg.split(',').map((s) => s.trim()).filter(Boolean).sort() : null
  }

  const optionArgs = argv.flatMap((a, i) => (a === '--option' && argv[i + 1] !== undefined ? [argv[i + 1]] : []))
  if (optionArgs.length > 0 || has('no-options')) {
    if (kind !== 'workshop') return { error: 'Questions for each seat are for classes (--workshop) only.' }
    const options: NonNullable<EventMetaPatch['options']> = []
    for (const spec of optionArgs) {
      const eq = spec.indexOf('=')
      if (eq <= 0) return { error: `--option needs "Label=Choice|Choice", got "${spec}".` }
      options.push({ id: '', label: spec.slice(0, eq).trim(), choices: spec.slice(eq + 1).split('|').map((c) => c.trim()) })
    }
    patch.options = options
  }

  const cutoff = flag('cutoff')
  if (cutoff !== undefined) {
    if (kind !== 'workshop') return { error: 'Sign-up cutoffs are for classes (--workshop) only.' }
    const checked = validateCutoffHours(cutoff === 'default' ? null : Number(cutoff))
    if (!checked.ok) return { error: checked.error }
    patch.signupCutoffHours = checked.value
  }

  return { kind, id, show: has('show'), patch }
}
```

```ts
// scripts/set-event.ts
/**
 * Change an event's settings from the command line — the same `event-meta`
 * record the staff console's gear sheet writes, under the same rules
 * (`mergeEventMeta`): drop-off, multi-day span, per-seat questions and the
 * sign-up cutoff.
 *
 * Writes the PRODUCTION Netlify Blobs store through the authed `netlify` CLI
 * (site stores are site-wide, not per deploy). For local dev use the gear on
 * /staff instead (dev keeps event-meta on disk under .data/).
 *
 * Usage:
 *   npx tsx scripts/set-event.ts --workshop clssch_… --option "Pumpkin color=Light Pink|Light Blue|Black|Lavender"
 *   npx tsx scripts/set-event.ts --workshop clssch_… --cutoff 24          (or --cutoff default)
 *   npx tsx scripts/set-event.ts --workshop clssch_… --no-options
 *   npx tsx scripts/set-event.ts --workshop clssch_… --on | --off | --days 2026-10-18,2026-10-19
 *   npx tsx scripts/set-event.ts --workshop clssch_… --show
 *
 * `--option` may repeat; the list given REPLACES the class's questions. Once
 * anyone has picked, questions can't be added or removed and existing
 * choices can't be removed or renamed (adding choices is fine).
 *
 * Workshops are keyed by their Square class SCHEDULE id (clssch_…, from
 * scripts/list-classes.ts), parties by their booking id.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSetEventArgs } from '../src/lib/event-meta-cli'
import { emptyEventMeta, mergeEventMeta, normalizeEventMeta, type EventMeta } from '../src/lib/event-meta'
import { effectiveCutoffHours } from '../src/lib/seat-options'

const STORE = 'event-meta'
const CHOICES_STORE = 'seat-choices'
const BY = { id: 'kaden', name: 'Kaden (CLI)' }

const parsed = parseSetEventArgs(process.argv.slice(2))
if ('error' in parsed) {
  console.error(parsed.error)
  process.exit(1)
}
const { kind, id, show, patch } = parsed
const key = `event-meta-${kind}:${id}`

function netlify(args: string[]): string {
  return execFileSync('netlify', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function read(): EventMeta | null {
  try {
    const out = netlify(['blobs:get', STORE, key])
    const start = out.indexOf('{')
    return start >= 0 ? normalizeEventMeta(JSON.parse(out.slice(start))) : null
  } catch {
    return null // missing key
  }
}

/** Has anyone picked for this class? If we can't tell, assume yes (the stricter rule). */
function hasPicks(): boolean {
  if (kind !== 'workshop') return false
  try {
    return netlify(['blobs:list', CHOICES_STORE]).includes(`seat-choices-workshop:${id}-`)
  } catch {
    console.warn('  could not list seat-choices; treating this class as already picked for')
    return true
  }
}

function summary(m: EventMeta): string {
  const questions = m.options.map((o) => `${o.label}=${o.choices.join('|')}`).join('; ') || '(none)'
  const cutoff = `${effectiveCutoffHours(m)}h${m.signupCutoffHours === null ? ' (default)' : ''}`
  return `dropOff=${m.dropOff} days=${m.days ? m.days.join(',') : '(single day)'} questions=${questions} cutoff=${cutoff}`
}

const current = read() ?? emptyEventMeta()

if (show) {
  console.log(JSON.stringify(current, null, 2))
  console.log(summary(current))
  process.exit(0)
}
if (Object.keys(patch).length === 0) {
  console.error('Nothing to change. Add --on/--off, --days, --option, --no-options or --cutoff (or --show to read).')
  process.exit(1)
}

let next: EventMeta
try {
  next = mergeEventMeta(current, patch, BY, new Date().toISOString(), patch.options !== undefined && hasPicks())
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

const file = join(mkdtempSync(join(tmpdir(), 'event-meta-')), 'meta.json')
writeFileSync(file, JSON.stringify(next))
netlify(['blobs:set', STORE, key, '--input', file])

const after = read()
console.log(`${kind} ${id}: ${after ? summary(after) : '(could not read back)'}  (store ${STORE}, key ${key})`)
```

Replace `scripts/set-dropoff.ts` with:

```ts
/**
 * Old name, kept so existing notes and muscle memory still work: everything
 * (drop-off, days, seat questions, sign-up cutoff) lives in
 * scripts/set-event.ts now, which reads the same flags.
 *
 *   npx tsx scripts/set-dropoff.ts --workshop clssch_… --on
 */
import './set-event'
```

- [ ] **Step 4: Run test and type check**

Run: `npx vitest run tests/lib/event-meta-cli.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Read-only CLI smoke check**

Run: `npx tsx scripts/set-event.ts --workshop clssch_does_not_exist --show`
Expected: prints the empty record JSON and `dropOff=false days=(single day) questions=(none) cutoff=0h (default)`; writes nothing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/event-meta-cli.ts scripts/set-event.ts scripts/set-dropoff.ts tests/lib/event-meta-cli.test.ts
git commit -m "feat(scripts): set-event CLI for seat questions and cutoff; set-dropoff kept as alias

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Public workshop list carries questions and the cutoff

**Files:**
- Modify: `src/components/workshops/WorkshopExplorer.tsx` (`WorkshopData`, lines 10–29)
- Modify: `src/components/workshops/workshop-view-model.ts` (new `withSignupInfo` after `toWorkshopData`)
- Modify: `src/pages/api/workshops.json.ts` (whole handler)
- Test: `tests/components/workshop-view-model.test.ts`, `tests/api/workshops-list.test.ts`

**Interfaces:**
- Consumes: `isSignupClosed`, `signupClosesAt`, `CutoffSettings`, `SeatOption` (Task 11); `getEventMeta` (Task 13).
- Produces:
  - `WorkshopData` gains `options?: SeatOption[]`, `signupClosesAt?: string`, `signupClosed?: boolean` (optional: consumers that ignore them keep working).
  - `withSignupInfo(data: WorkshopData, settings: CutoffSettings, now?: Date): WorkshopData`
  - `GET /api/workshops.json` → each workshop has `options`, `signupClosesAt`, `signupClosed` (computed on the server).

- [ ] **Step 1: Write the failing tests**

Append to `tests/components/workshop-view-model.test.ts`:

```ts
import { withSignupInfo } from '@components/workshops/workshop-view-model'

describe('withSignupInfo', () => {
  const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Black', 'Lavender'] }
  const base = {
    id: 'inst-pails', name: 'Bedazzled Pumpkin Pails', description: '', category: 'workshop', date: '2026-10-18',
    startTime: '2026-10-18T18:00:00.000Z', endTime: '2026-10-18T20:00:00.000Z', duration: 120, price: 2500, currency: 'USD', remainingSeats: 10,
  }

  it('a class with questions closes 24 hours ahead by default', () => {
    const d = withSignupInfo(base, { options: [PAILS], signupCutoffHours: null }, new Date('2026-10-17T18:30:00.000Z'))
    expect(d).toMatchObject({ options: [PAILS], signupClosesAt: '2026-10-17T18:00:00.000Z', signupClosed: true })
  })

  it('a plain class is open until it starts', () => {
    const d = withSignupInfo(base, { options: [], signupCutoffHours: null }, new Date('2026-10-18T17:59:00.000Z'))
    expect(d).toMatchObject({ options: [], signupClosesAt: '2026-10-18T18:00:00.000Z', signupClosed: false })
  })
})
```

```ts
// tests/api/workshops-list.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockListWorkshops = vi.fn()
vi.mock('@config/providers', () => ({ providers: { workshop: { listWorkshops: (...a: any[]) => mockListWorkshops(...a) } } }))
const mockGetEventMeta = vi.fn()
vi.mock('@lib/event-meta', () => ({ getEventMeta: (...a: any[]) => mockGetEventMeta(...a) }))

import { GET } from '@pages/api/workshops.json'
import { forgetAll } from '@lib/short-memory'

const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }
const workshop = (scheduleId: string, startAt: string) => ({
  id: `inst-${scheduleId}`, scheduleId, name: scheduleId, description: '', descriptionHtml: '', startAt, durationMinutes: 120,
  priceCents: 2500, priceCurrency: 'USD', availableCapacity: 10, staffName: '', teamMemberId: '',
})

async function list() {
  const res = await GET({ request: new Request('http://localhost/api/workshops.json') } as any)
  return (await res.json()).workshops
}

beforeEach(() => {
  forgetAll()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-17T19:00:00.000Z')) // Sat 2 PM CDT
  mockListWorkshops.mockResolvedValue([workshop('clssch_pails', '2026-10-18T18:00:00.000Z'), workshop('clssch_kinu', '2026-10-24T00:00:00.000Z')])
  mockGetEventMeta.mockImplementation(async (_kind: string, id: string) =>
    id === 'clssch_pails' ? { options: [PAILS], signupCutoffHours: null } : null,
  )
})
afterEach(() => vi.useRealTimers())

describe('GET /api/workshops.json — questions and cutoff', () => {
  it('says, from the server’s clock, which classes have closed sign-ups', async () => {
    const [pails, kinu] = await list()
    expect(pails).toMatchObject({ options: [PAILS], signupClosesAt: '2026-10-17T18:00:00.000Z', signupClosed: true })
    expect(kinu).toMatchObject({ options: [], signupClosesAt: '2026-10-24T00:00:00.000Z', signupClosed: false })
  })

  it('reads settings by class schedule id', async () => {
    await list()
    expect(mockGetEventMeta).toHaveBeenCalledWith('workshop', 'clssch_pails')
  })

  it('still lists a class whose settings could not be read', async () => {
    mockGetEventMeta.mockRejectedValue(new Error('blobs down'))
    const [pails] = await list()
    expect(pails).toMatchObject({ name: 'clssch_pails', options: [] })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/workshop-view-model.test.ts tests/api/workshops-list.test.ts`
Expected: FAIL — `withSignupInfo` is not exported; the list has no `signupClosed`.

- [ ] **Step 3: Write minimal implementation**

`src/components/workshops/WorkshopExplorer.tsx` — add the import:

```ts
import type { SeatOption } from '@lib/seat-options'
```

and append to `WorkshopData` after `teamMemberId?: string`:

```ts
  /** Per-seat questions; empty or absent when the class asks none. */
  options?: SeatOption[]
  /** When sign-ups close (ISO). */
  signupClosesAt?: string
  /** Decided on the server, so a visitor's clock doesn't matter. */
  signupClosed?: boolean
```

`src/components/workshops/workshop-view-model.ts` — add the import:

```ts
import { isSignupClosed, signupClosesAt, type CutoffSettings } from '@lib/seat-options'
```

and append:

```ts
/** The class's seat questions and sign-up cutoff, worked out on the server. */
export function withSignupInfo(data: WorkshopData, settings: CutoffSettings, now: Date = new Date()): WorkshopData {
  return {
    ...data,
    options: settings.options,
    signupClosesAt: signupClosesAt(data.startTime, settings),
    signupClosed: isSignupClosed(data.startTime, settings, now),
  }
}
```

Replace `src/pages/api/workshops.json.ts` with:

```ts
import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { toWorkshopData, withSignupInfo } from '@components/workshops/workshop-view-model'
import type { WorkshopData } from '@components/workshops/WorkshopExplorer'
import { getEventMeta } from '@lib/event-meta'
import type { CutoffSettings } from '@lib/seat-options'
import { createLogger } from '@lib/logger'
import { remember } from '@lib/short-memory'
import { publicListHeaders } from '@lib/cache-headers'

export const prerender = false
const logger = createLogger('api:workshops')

/**
 * A class's questions and cutoff from event-meta — merged here, not in the
 * provider (spec B). Unreadable settings list the class as plain; the booking
 * server reads them again and refuses rather than sell seats without picks.
 */
async function settingsFor(scheduleId: string): Promise<CutoffSettings> {
  try {
    const meta = await getEventMeta('workshop', scheduleId)
    return { options: meta?.options ?? [], signupCutoffHours: meta?.signupCutoffHours ?? null }
  } catch (err) {
    logger.error('Event settings unreadable for the workshop list', {
      scheduleId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { options: [], signupCutoffHours: null }
  }
}

/**
 * Returns the upcoming workshops. Fetched client-side by WorkshopExplorer so the
 * /workshops page shell renders instantly instead of blocking on the (sometimes
 * slow) Square Classes API during navigation.
 */
export const GET: APIRoute = async ({ request }) => {
  let workshops: WorkshopData[] = []
  let failed = false
  try {
    const list = await remember('workshops:list', 30_000, () => providers.workshop.listWorkshops())
    const now = new Date()
    workshops = await Promise.all(
      list.map(async (w) => withSignupInfo(toWorkshopData(w), await settingsFor(w.scheduleId), now)),
    )
  } catch (err) {
    failed = true
    logger.error('workshops fetch failed', { error: err instanceof Error ? err.message : String(err) })
  }
  return new Response(JSON.stringify({ workshops, ...(failed ? { incomplete: true } : {}) }), {
    status: 200,
    // A failed lookup is never cached: it must not read as "no workshops".
    headers: publicListHeaders(request, { failed }),
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/workshop-view-model.test.ts tests/api/workshops-list.test.ts tests/components/home/UpcomingWorkshops.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workshops/WorkshopExplorer.tsx src/components/workshops/workshop-view-model.ts src/pages/api/workshops.json.ts tests/components/workshop-view-model.test.ts tests/api/workshops-list.test.ts
git commit -m "feat(workshops): public list carries seat questions and sign-up cutoff

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: "Sign-ups closed" on the card, and no booking panel from an old link

**Files:**
- Modify: `src/components/workshops/WorkshopCard.tsx` (lines 37–39 flags; lines 154–177 buttons)
- Modify: `src/components/workshops/WorkshopExplorer.tsx` (the `?w=` effect, after `if (!canBeBooked(target.price)) return`)
- Test: `tests/components/workshops/WorkshopCard.test.tsx`, `tests/components/workshops/WorkshopExplorer.test.tsx`

**Interfaces:**
- Consumes: `WorkshopData.signupClosed` (Task 17).
- Produces: nothing new.

A sold-out class past its cutoff keeps its "Sold out" chip but loses "Tell me if a seat opens": a seat that opens after the cutoff can't be booked.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('WorkshopCard', …)`:

```tsx
  it('after the cutoff, a quiet "Sign-ups closed" stands where the book button was', () => {
    const onBook = vi.fn()
    render(<WorkshopCard workshop={makeWorkshop({ signupClosed: true })} onBook={onBook} />)
    expect(screen.getByText('Sign-ups closed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'See details and book' })).toBeNull()
    expect(screen.queryByText('6 seats left')).toBeNull()
  })

  it('a sold-out class past its cutoff says both, and offers no waitlist', () => {
    render(<WorkshopCard workshop={makeWorkshop({ signupClosed: true, remainingSeats: 0 })} />)
    expect(screen.getByText('Sold out')).toBeInTheDocument()
    expect(screen.getByText('Sign-ups closed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tell me if a seat opens' })).toBeNull()
  })

  it('on the home page, a closed class has no link to book', () => {
    render(<WorkshopCard workshop={makeWorkshop({ signupClosed: true })} href="/workshops?w=ws-1" />)
    expect(screen.queryByRole('link', { name: 'See details and book' })).toBeNull()
    expect(screen.getByText('Sign-ups closed')).toBeInTheDocument()
  })
```

Append inside `describe('WorkshopExplorer — a link to one workshop (?w=<id>)', …)`:

```tsx
  it('sign-ups closed: no booking panel, a notice instead', () => {
    window.history.replaceState({}, '', '/workshops?w=2')
    render(<WorkshopExplorer workshops={[mockWorkshops[0], { ...mockWorkshops[1], signupClosed: true }]} />)
    expect(screen.queryByTestId('booking-modal')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Sign-ups for Pottery Basics have closed.')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/workshops/WorkshopCard.test.tsx tests/components/workshops/WorkshopExplorer.test.tsx`
Expected: FAIL — no "Sign-ups closed" text; the Explorer opens the modal.

- [ ] **Step 3: Write minimal implementation**

`src/components/workshops/WorkshopCard.tsx` — replace the three flag lines (`const comingSoon …`, `const soldOut …`, `const seats …`) with:

```tsx
  const comingSoon = !canBeBooked(workshop.price)
  const soldOut = !comingSoon && isSoldOut(workshop.remainingSeats)
  // Past the class's sign-up cutoff (decided on the server). A class not on sale yet has no cutoff to pass.
  const closed = !comingSoon && workshop.signupClosed === true
  const seats = comingSoon || soldOut || closed ? '' : seatsLeftLabel(workshop.remainingSeats)
```

Change `{soldOut && !asking && (` to `{soldOut && !closed && !asking && (` and `{soldOut && asking && (` to `{soldOut && !closed && asking && (`. Change the two book conditions to `{!comingSoon && !soldOut && !closed && href && (` and `{!comingSoon && !soldOut && !closed && !href && (`. Directly before the first of those two, add:

```tsx
          {closed && (
            <p
              style={{
                margin: 0,
                minHeight: '2.75rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.9375rem',
                fontWeight: 600,
                color: 'var(--color-muted)',
              }}
            >
              Sign-ups closed
            </p>
          )}
```

`src/components/workshops/WorkshopExplorer.tsx` — directly after `if (!canBeBooked(target.price)) return` in the `?w=` effect, add:

```tsx
    // Past its sign-up cutoff: say so, and no booking panel.
    if (target.signupClosed) {
      setNotice(`Sign-ups for ${target.name} have closed.`)
      return
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/workshops/WorkshopCard.test.tsx tests/components/workshops/WorkshopExplorer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workshops/WorkshopCard.tsx src/components/workshops/WorkshopExplorer.tsx tests/components/workshops/WorkshopCard.test.tsx tests/components/workshops/WorkshopExplorer.test.tsx
git commit -m "feat(workshops): Sign-ups closed on the card; old links open no booking panel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 19: One required pick per seat in the booking modal

The modal's rule is "say what's missing and go to it", never a greyed-out button (its existing test "never greys out Pay for missing details"). So Continue stays enabled; with a seat unanswered it stays on step 1, names the seat and focuses that select. Pay is unreachable until every seat has picked, which is what the spec asks of the Pay button.

**Files:**
- Modify: `src/lib/seat-options.ts` (append pick helpers)
- Modify: `src/components/workshops/WorkshopBookingModal.tsx`
- Test: `tests/lib/seat-options.test.ts`, `tests/components/workshops/WorkshopBookingModal.test.tsx`

**Interfaces:**
- Consumes: `SeatOption`, `SeatPick`, `PICKS_FINAL_LINE` (Task 11); `WorkshopData.options` (Task 17).
- Produces:
  - `selectionKey(seat: number, optionId: string): string` → `"1:pumpkin-color"`
  - `firstMissingPick(options: SeatOption[], seats: number, selections: Record<string, string>): { seat: number; option: SeatOption } | null`
  - `picksFromSelections(options: SeatOption[], seats: number, selections: Record<string, string>): SeatPick[]` (seats 1..n only, seat order then question order)
  - `picksNote(options: SeatOption[], picks: SeatPick[]): string` → `"Pumpkin color: Black ×1, Lavender ×1"`; questions joined with `" · "`; `""` when no picks
  - Request body adds `picks: SeatPick[]` only when the class has questions.

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/seat-options.test.ts` (add the names to its import list):

```ts
import { selectionKey, firstMissingPick, picksFromSelections, picksNote } from '@lib/seat-options'

describe('picks in a form', () => {
  const RIBBON = { id: 'ribbon', label: 'Ribbon', choices: ['Red', 'Gold'] }
  const sel = { [selectionKey(1, 'pumpkin-color')]: 'Lavender', [selectionKey(2, 'pumpkin-color')]: 'Black', [selectionKey(3, 'pumpkin-color')]: 'Black' }

  it('finds the first seat still to answer', () => {
    expect(firstMissingPick([PAILS], 2, sel)).toBeNull()
    expect(firstMissingPick([PAILS], 4, sel)).toEqual({ seat: 4, option: PAILS })
    expect(firstMissingPick([PAILS, RIBBON], 1, sel)).toEqual({ seat: 1, option: RIBBON })
  })

  it('sends picks for the seats booked only', () => {
    expect(picksFromSelections([PAILS], 2, sel)).toEqual([
      { seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' },
      { seat: 2, optionId: 'pumpkin-color', choice: 'Black' },
    ])
  })

  it('writes the Square note in the class’s choice order', () => {
    expect(picksNote([PAILS], picksFromSelections([PAILS], 3, sel))).toBe('Pumpkin color: Black ×2, Lavender ×1')
    expect(picksNote([PAILS], [])).toBe('')
    expect(
      picksNote([PAILS, RIBBON], [
        { seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' },
        { seat: 1, optionId: 'ribbon', choice: 'Gold' },
      ]),
    ).toBe('Pumpkin color: Lavender ×1 · Ribbon: Gold ×1')
  })
})
```

Append to `tests/components/workshops/WorkshopBookingModal.test.tsx`:

```tsx
describe('WorkshopBookingModal — a question for each seat', () => {
  const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }
  const pails = () => makeWorkshop({ name: 'Bedazzled Pumpkin Pails', price: 2500, options: [PAILS] })
  const pick = (seat: number, choice: string) =>
    fireEvent.change(screen.getByLabelText(`Seat ${seat} · Pumpkin color`), { target: { value: choice } })

  it('asks once per seat, and again for each seat added', () => {
    open(pails())
    expect(screen.getByLabelText('Seat 1 · Pumpkin color')).toBeInTheDocument()
    expect(screen.queryByLabelText('Seat 2 · Pumpkin color')).toBeNull()
    addSeats(1)
    expect(screen.getByLabelText('Seat 2 · Pumpkin color')).toBeInTheDocument()
  })

  it('offers only the class’s choices, and says picks are final', () => {
    open(pails())
    const options = within(screen.getByLabelText('Seat 1 · Pumpkin color')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Choose…', 'Light Pink', 'Light Blue', 'Black', 'Lavender'])
    expect(screen.getByText('Picks are made ahead for you, so they can’t be changed after you book.')).toBeInTheDocument()
  })

  it('will not go on until every seat has picked, and says which seat', () => {
    open(pails())
    addSeats(1)
    pick(1, 'Lavender')
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    expect(screen.getByText('Pick a pumpkin color for seat 2.')).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    expect(screen.getByLabelText('Seat 2 · Pumpkin color')).toHaveFocus()
  })

  it('keeps earlier picks through seat changes, and sends picks only for the seats booked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(booked())
    vi.stubGlobal('fetch', fetchMock)
    open(pails())
    addSeats(1)
    pick(1, 'Lavender')
    pick(2, 'Black')
    fireEvent.click(screen.getByRole('button', { name: 'Fewer seats' }))
    expect(screen.queryByLabelText('Seat 2 · Pumpkin color')).toBeNull()
    addSeats(1)
    expect(screen.getByLabelText('Seat 1 · Pumpkin color')).toHaveValue('Lavender')
    expect(screen.getByLabelText('Seat 2 · Pumpkin color')).toHaveValue('Black')
    fireEvent.click(screen.getByRole('button', { name: 'Fewer seats' }))
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await screen.findByTestId('payment-form')
    fillContact()
    await pay('$25')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).picks).toEqual([{ seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' }])
  })

  it('shows the picks beside the total on the payment step', async () => {
    open(pails())
    addSeats(1)
    pick(1, 'Lavender')
    pick(2, 'Lavender')
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await screen.findByTestId('payment-form')
    expect(screen.getByText('Pumpkin color: Lavender ×2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/seat-options.test.ts tests/components/workshops/WorkshopBookingModal.test.tsx`
Expected: FAIL — the helpers are not exported; the modal has no "Seat 1 · Pumpkin color" field.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/seat-options.ts`:

```ts
/** Key for one seat's answer to one question in a form's state. */
export function selectionKey(seat: number, optionId: string): string {
  return `${seat}:${optionId}`
}

/** The first seat and question still unanswered, or null when every seat has picked. */
export function firstMissingPick(
  options: SeatOption[],
  seats: number,
  selections: Record<string, string>,
): { seat: number; option: SeatOption } | null {
  for (let seat = 1; seat <= seats; seat++) {
    for (const option of options) {
      if (!selections[selectionKey(seat, option.id)]) return { seat, option }
    }
  }
  return null
}

/** Picks for seats 1..seats only: answers kept for seats taken away are not sent. */
export function picksFromSelections(options: SeatOption[], seats: number, selections: Record<string, string>): SeatPick[] {
  const out: SeatPick[] = []
  for (let seat = 1; seat <= seats; seat++) {
    for (const option of options) {
      const choice = selections[selectionKey(seat, option.id)]
      if (choice) out.push({ seat, optionId: option.id, choice })
    }
  }
  return out
}

/** "Pumpkin color: Black ×1, Lavender ×1" — the Square booking note. Choices in the class's order; questions joined with " · ". */
export function picksNote(options: SeatOption[], picks: SeatPick[]): string {
  return options
    .map((o) => {
      const counts = o.choices
        .map((c) => [c, picks.filter((p) => p.optionId === o.id && p.choice === c).length] as const)
        .filter(([, n]) => n > 0)
      return counts.length ? `${o.label}: ${counts.map(([c, n]) => `${c} ×${n}`).join(', ')}` : ''
    })
    .filter(Boolean)
    .join(' · ')
}
```

`src/components/workshops/WorkshopBookingModal.tsx`:

1. Add the import after the `@lib/workshop-rules` import:

```tsx
import { firstMissingPick, picksFromSelections, picksNote, selectionKey, PICKS_FINAL_LINE } from '@lib/seat-options'
```

2. After `const [seats, setSeats] = useState(1)` add:

```tsx
  // One answer per seat per question, keyed by selectionKey(seat, optionId).
  // Kept when the seat count drops, so a seat added back shows its pick.
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [pickProblem, setPickProblem] = useState<string | null>(null)
```

3. Directly before the `const attemptId = useRef(newAttemptId())` block, add:

```tsx
  const options = workshop.options ?? []
  const picks = picksFromSelections(options, seats, selections)
  const picksSignature = JSON.stringify(picks)
  const pickFieldId = (seat: number, optionId: string) => `${formId}-pick-${seat}-${optionId}`
```

and replace the attempt-ID block (comment, `useRef`, `useEffect`) with:

```tsx
  // One attempt ID per checkout. While we don't know how a try ended (dropped
  // connection, "we're not sure"), a retry sends the same ID, so the server
  // can never charge twice for it. Changing the seats or a pick, or a plain
  // "nothing was charged", starts a new one.
  const attemptId = useRef(newAttemptId())
  useEffect(() => {
    attemptId.current = newAttemptId()
  }, [seats, picksSignature])
```

4. Change `const started = seats !== 1 || contactStarted(contact)` to:

```tsx
  const started = seats !== 1 || contactStarted(contact) || Object.keys(selections).length > 0
```

5. Add after `function finish() { … }`:

```tsx
  /** Every seat answers every question before payment. Says which is missing and goes to it. */
  function picksComplete(): boolean {
    const missing = firstMissingPick(options, seats, selections)
    if (!missing) return true
    setPickProblem(`Pick a ${missing.option.label.toLowerCase()} for seat ${missing.seat}.`)
    document.getElementById(pickFieldId(missing.seat, missing.option.id))?.focus()
    return false
  }
```

6. In `handlePay`, directly after `if (processing || !paymentReady) return`, add:

```tsx
    if (!picksComplete()) {
      setStep('details')
      return
    }
```

7. In the request body, after `seats,` add:

```tsx
            ...(options.length > 0 ? { picks } : {}),
```

8. In `renderDetails`, directly after the `{seats >= maxSeats && ( … )}` paragraph and before the closing `</div>` of the seats block, add:

```tsx
          {options.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              {Array.from({ length: seats }, (_, i) => i + 1).map((seat) =>
                options.map((o) => {
                  const k = selectionKey(seat, o.id)
                  const fieldId = pickFieldId(seat, o.id)
                  return (
                    <div key={k} style={{ marginBottom: '0.625rem' }}>
                      <label
                        htmlFor={fieldId}
                        style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}
                      >
                        Seat {seat} · {o.label}
                      </label>
                      <select
                        id={fieldId}
                        required
                        value={selections[k] ?? ''}
                        onChange={(e) => {
                          const value = e.target.value
                          setSelections((s) => ({ ...s, [k]: value }))
                          setPickProblem(null)
                        }}
                        style={{
                          width: '100%',
                          minHeight: '2.75rem',
                          padding: '0.5rem 0.75rem',
                          borderRadius: '0.75rem',
                          border: '1.5px solid var(--color-field-border)',
                          background: 'var(--color-surface)',
                          fontSize: '1rem',
                          color: 'var(--color-dark)',
                        }}
                      >
                        <option value="" disabled>Choose…</option>
                        {o.choices.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  )
                }),
              )}
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--color-text)' }}>{PICKS_FINAL_LINE}</p>
              {pickProblem && (
                <p role="alert" className="field-error" style={{ marginTop: '0.375rem' }}>
                  {pickProblem}
                </p>
              )}
            </div>
          )}
```

9. In `renderPay`, inside the sand-coloured summary box, after its inner `<div>` (the line item and total), add:

```tsx
          {picks.length > 0 && (
            <p style={{ margin: '0.375rem 0 0', fontSize: '0.875rem', color: 'var(--color-text)' }}>{picksNote(options, picks)}</p>
          )}
```

10. In `renderConfirmation`, directly before `<ConfirmedBlock label="Before you come">`, add:

```tsx
          {picks.length > 0 && (
            <ConfirmedBlock label="Your picks">
              {picksNote(options, picks)}
              <p style={{ margin: '0.25rem 0 0' }}>{PICKS_FINAL_LINE}</p>
            </ConfirmedBlock>
          )}
```

11. In the details footer button, replace the `onClick` body with:

```tsx
        onClick={() => {
          if (!picksComplete()) return
          trackWizardStepCompleted('details')
          setStep('pay')
        }}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/seat-options.test.ts tests/components/workshops/WorkshopBookingModal.test.tsx`
Expected: PASS (including the existing "books the same seats…" test: a class with no questions still sends exactly the old keys).

- [ ] **Step 5: Commit**

```bash
git add src/lib/seat-options.ts src/components/workshops/WorkshopBookingModal.tsx tests/lib/seat-options.test.ts tests/components/workshops/WorkshopBookingModal.test.tsx
git commit -m "feat(workshops): one required pick per seat in the booking modal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 20: The booking server checks the cutoff and the picks before holding seats

**Files:**
- Modify: `src/lib/seat-options.ts` (append `validatePicks`, `seatPickLines`)
- Modify: `src/pages/api/workshops/book.json.ts` (imports; step 1 lookups at lines 75–79; new step 1b after the price check at line 95; the `reserveSeats` call at lines 108–113)
- Modify: `src/providers/interfaces/workshop.ts` (`reserveSeats` params gain optional `note`; Task 21 makes Square send it)
- Test: `tests/lib/seat-options.test.ts`, `tests/api/workshop-book.test.ts`

**Interfaces:**
- Consumes: `getEventMeta` (Task 13); `isSignupClosed`, `effectiveCutoffHours`, `cutoffClosedMessage`, `picksNote`, `selectionKey`, `firstMissingPick`, `picksFromSelections`, `CutoffSettings`, `SeatPick` (Tasks 11, 19).
- Produces:
  - `validatePicks(options: SeatOption[], seats: number, raw: unknown): { ok: true; value: SeatPick[] } | { ok: false; error: string }`
  - `seatPickLines(options: SeatOption[], picks: SeatPick[]): string[]` → `["Seat 1 · Pumpkin color: Lavender", …]`
  - `WorkshopProvider.reserveSeats` params gain `note?: string`; the route passes it when the booking has picks (Square sends it from Task 21).
  - Inside `POST`: `settings: CutoffSettings`, `picks: SeatPick[]`, `note: string` in scope for Tasks 22–23.

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/seat-options.test.ts` (add `validatePicks, seatPickLines` to the import list):

```ts
describe('validatePicks (the server’s check)', () => {
  const two = [
    { seat: 2, optionId: 'pumpkin-color', choice: 'Black' },
    { seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' },
  ]

  it('accepts one listed choice per seat, in seat order', () => {
    expect(validatePicks([PAILS], 2, two)).toEqual({
      ok: true,
      value: [{ seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' }, { seat: 2, optionId: 'pumpkin-color', choice: 'Black' }],
    })
  })

  it('a class with no questions takes no picks', () => {
    expect(validatePicks([], 2, undefined)).toEqual({ ok: true, value: [] })
    expect(validatePicks([], 2, [])).toEqual({ ok: true, value: [] })
    expect(validatePicks([], 2, two)).toEqual({ ok: false, error: 'This class has nothing to pick. Refresh and try again.' })
  })

  it.each([
    ['a seat with no pick', [two[1]], 'Pick a pumpkin color for seat 2.'],
    ['a seat beyond the booking', [...two, { seat: 3, optionId: 'pumpkin-color', choice: 'Black' }], 'The seat picks didn’t come through. Refresh and try again.'],
    ['an unknown question', [...two, { seat: 1, optionId: 'ribbon', choice: 'Red' }], 'This class’s questions have changed. Refresh and pick again.'],
    ['a choice not offered', [two[1], { seat: 2, optionId: 'pumpkin-color', choice: 'Orange' }], 'Seat 2: “Orange” isn’t one of the pumpkin color choices.'],
    ['two picks for one seat', [...two, { seat: 1, optionId: 'pumpkin-color', choice: 'Black' }], 'Seat 1 has two pumpkin color picks.'],
    ['something that is not a list', 'Lavender', 'The seat picks didn’t come through. Refresh and try again.'],
  ])('refuses %s', (_name, raw, error) => {
    expect(validatePicks([PAILS], 2, raw)).toEqual({ ok: false, error })
  })

  it('writes one line per seat for the email', () => {
    expect(seatPickLines([PAILS], [{ seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' }, { seat: 2, optionId: 'pumpkin-color', choice: 'Black' }])).toEqual([
      'Seat 1 · Pumpkin color: Lavender',
      'Seat 2 · Pumpkin color: Black',
    ])
  })
})
```

In `tests/api/workshop-book.test.ts`:

1. Change the first import line to `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'`.
2. After the `@lib/email` mock, add:

```ts
const mockGetEventMeta = vi.fn()
vi.mock('@lib/event-meta', () => ({ getEventMeta: (...a: any[]) => mockGetEventMeta(...a) }))

const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }
const TWO_PICKS = [
  { seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' },
  { seat: 2, optionId: 'pumpkin-color', choice: 'Black' },
]
```

3. At the top of the existing `beforeEach` body add:

```ts
  // Sat 10 Oct 2026: a week before the fixture's class. Only Date is faked.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-10T17:00:00.000Z'))
  mockGetEventMeta.mockResolvedValue(null)
```

and after the `beforeEach` add `afterEach(() => vi.useRealTimers())`.

4. Append inside `describe('POST /api/workshops/book.json', …)`:

```ts
  describe('sign-up cutoff and seat picks', () => {
    const withPails = () => mockGetEventMeta.mockResolvedValue({ options: [PAILS], signupCutoffHours: null })

    async function refusedBeforeHold(res: Response, status: number, code: string, detail: string) {
      expect(res.status).toBe(status)
      expect(await res.json()).toMatchObject({ code, detail })
      expect(mockReserve).not.toHaveBeenCalled()
      expect(mockPay).not.toHaveBeenCalled()
    }

    it('refuses after the class’s own cutoff, before holding anything', async () => {
      mockGetEventMeta.mockResolvedValue({ options: [], signupCutoffHours: 48 })
      vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z')) // 36 h before
      await refusedBeforeHold(await POST(ctx(body())), 409, 'not_open', 'Sign-ups for this class closed 48 hours before it starts.')
    })

    it('a class with questions closes 24 hours ahead by default', async () => {
      withPails()
      vi.setSystemTime(new Date('2026-10-16T01:00:00.000Z')) // 23 h before
      await refusedBeforeHold(await POST(ctx(body({ picks: TWO_PICKS }))), 409, 'not_open', 'Sign-ups for this class closed 24 hours before it starts.')
    })

    it('a plain class can still be booked half an hour before', async () => {
      vi.setSystemTime(new Date('2026-10-16T23:30:00.000Z'))
      expect((await POST(ctx(body()))).status).toBe(200)
    })

    it('refuses a seat with no pick, naming the seat', async () => {
      withPails()
      await refusedBeforeHold(await POST(ctx(body({ picks: [TWO_PICKS[0]] }))), 400, 'invalid', 'Pick a pumpkin color for seat 2.')
    })

    it('refuses a choice the class does not offer', async () => {
      withPails()
      const picks = [TWO_PICKS[0], { seat: 2, optionId: 'pumpkin-color', choice: 'Orange' }]
      await refusedBeforeHold(await POST(ctx(body({ picks }))), 400, 'invalid', 'Seat 2: “Orange” isn’t one of the pumpkin color choices.')
    })

    it('refuses picks for a class with no questions', async () => {
      await refusedBeforeHold(await POST(ctx(body({ picks: TWO_PICKS }))), 400, 'invalid', 'This class has nothing to pick. Refresh and try again.')
    })

    it('refuses when the class’s settings cannot be read: seats are never sold without their picks', async () => {
      mockGetEventMeta.mockRejectedValue(new Error('blobs down'))
      const res = await POST(ctx(body({ picks: TWO_PICKS })))
      expect(res.status).toBe(502)
      expect((await res.json()).code).toBe('unavailable')
      expect(mockReserve).not.toHaveBeenCalled()
    })

    it('holds the seats with the picks as Square’s booking note', async () => {
      withPails()
      expect((await POST(ctx(body({ picks: TWO_PICKS })))).status).toBe(200)
      expect(mockGetEventMeta).toHaveBeenCalledWith('workshop', 'clssch_kinusaiga')
      expect(mockReserve).toHaveBeenCalledWith({
        scheduleId: 'clssch_kinusaiga',
        startAt: START,
        seats: 2,
        customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com' },
        note: 'Pumpkin color: Black ×1, Lavender ×1',
      })
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/seat-options.test.ts tests/api/workshop-book.test.ts`
Expected: FAIL — `validatePicks` not exported; the cutoff and picks cases get 200 and `mockReserve` is called.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/seat-options.ts`:

```ts
const PICKS_GARBLED = 'The seat picks didn’t come through. Refresh and try again.'

/**
 * The booking server's check: one pick per seat per question, each a listed
 * choice. A class with no questions takes no picks. Answers with the FIRST
 * problem, in words the customer can act on.
 */
export function validatePicks(options: SeatOption[], seats: number, raw: unknown): Result<SeatPick[]> {
  const list = raw === undefined || raw === null ? [] : raw
  if (!Array.isArray(list)) return { ok: false, error: PICKS_GARBLED }
  if (options.length === 0) {
    return list.length === 0 ? { ok: true, value: [] } : { ok: false, error: 'This class has nothing to pick. Refresh and try again.' }
  }
  const chosen: Record<string, string> = {}
  for (const p of list as any[]) {
    const seat = p?.seat
    const optionId = p?.optionId
    const choice = p?.choice
    if (!Number.isInteger(seat) || seat < 1 || seat > seats || typeof optionId !== 'string' || typeof choice !== 'string') {
      return { ok: false, error: PICKS_GARBLED }
    }
    const option = options.find((o) => o.id === optionId)
    if (!option) return { ok: false, error: 'This class’s questions have changed. Refresh and pick again.' }
    if (!option.choices.includes(choice)) {
      return { ok: false, error: `Seat ${seat}: “${choice}” isn’t one of the ${option.label.toLowerCase()} choices.` }
    }
    const k = selectionKey(seat, optionId)
    if (k in chosen) return { ok: false, error: `Seat ${seat} has two ${option.label.toLowerCase()} picks.` }
    chosen[k] = choice
  }
  const missing = firstMissingPick(options, seats, chosen)
  if (missing) return { ok: false, error: `Pick a ${missing.option.label.toLowerCase()} for seat ${missing.seat}.` }
  return { ok: true, value: picksFromSelections(options, seats, chosen) }
}

/** "Seat 1 · Pumpkin color: Lavender" — one line per pick, for the email. */
export function seatPickLines(options: SeatOption[], picks: SeatPick[]): string[] {
  return picks.map((p) => `Seat ${p.seat} · ${options.find((o) => o.id === p.optionId)?.label ?? p.optionId}: ${p.choice}`)
}
```

`src/pages/api/workshops/book.json.ts`:

Add imports:

```ts
import { getEventMeta } from '@lib/event-meta'
import {
  cutoffClosedMessage,
  effectiveCutoffHours,
  isSignupClosed,
  picksNote,
  validatePicks,
  type CutoffSettings,
  type SeatPick,
} from '@lib/seat-options'
```

Replace the step 1 lookup with:

```ts
  // ── 1. The workshop, the customer and the class's settings, looked up together
  const [workshopLookup, customerLookup, metaLookup] = await Promise.allSettled([
    lookUp(typeof body.workshopId === 'string' ? body.workshopId : '', String(classScheduleId), String(startAt)),
    providers.customer.findOrCreate({ email, givenName, familyName, ...(phone ? { phone } : {}) }),
    getEventMeta('workshop', String(classScheduleId)),
  ])
```

Directly after the `if (!canBeBooked(workshop.priceCents)) { … }` block, add:

```ts
  // ── 1b. Sign-up cutoff and seat picks (spec C) ─────────────────────────────
  // Settings we can't read are a refusal: a class with questions must never be
  // sold without its picks. Nothing has been held or charged yet.
  if (metaLookup.status === 'rejected') {
    logger.error('Event settings unreadable before booking — refusing', {
      scheduleId: String(classScheduleId),
      error: String(metaLookup.reason),
    })
    return fail(502, 'unavailable')
  }
  const settings: CutoffSettings = {
    options: metaLookup.value?.options ?? [],
    signupCutoffHours: metaLookup.value?.signupCutoffHours ?? null,
  }
  if (isSignupClosed(workshop.startAt, settings)) {
    return fail(409, 'not_open', cutoffClosedMessage(effectiveCutoffHours(settings)))
  }
  const picksCheck = validatePicks(settings.options, seats, body.picks)
  if (!picksCheck.ok) return fail(400, 'invalid', picksCheck.error)
  const picks: SeatPick[] = picksCheck.value
  // Square keeps the picks only as a booking note ("Pumpkin color: Lavender ×2").
  const note = picksNote(settings.options, picks)
```

Change the `reserveSeats` call to:

```ts
    reservation = await providers.workshop.reserveSeats({
      scheduleId: String(classScheduleId),
      startAt: String(startAt),
      seats,
      customer: { givenName, familyName, email },
      ...(note ? { note } : {}),
    })
```

Add to the numbered list in the route's doc comment, after "1. look the workshop up…": `1b. refuse after the class's sign-up cutoff, and unless every seat has a valid pick (nothing held yet)`.

`src/providers/interfaces/workshop.ts` — in `reserveSeats` params, after `customer: …`:

```ts
    /**
     * Short text kept on the booking in Square (the seat picks). If Square
     * refuses the hold with it, the hold is asked for once more without it;
     * the picks are stored on our side either way.
     */
    note?: string
```

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run tests/lib/seat-options.test.ts tests/api/workshop-book.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors. (The Square provider ignores `note` until Task 21; the mock provider already accepts a wider object.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/seat-options.ts src/pages/api/workshops/book.json.ts src/providers/interfaces/workshop.ts tests/lib/seat-options.test.ts tests/api/workshop-book.test.ts
git commit -m "feat(workshops): refuse late sign-ups and bad picks before holding seats

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 21: `reserveSeats` carries the picks as a Square booking note (retried once without it)

**Files:**
- Modify: `src/providers/square/workshop.ts` (`reserveSeats`, lines 41–80)
- Test: `tests/providers/square/workshop-seats.test.ts`

**Interfaces:**
- Consumes: `SeatBookingError` (`src/lib/errors.ts`); the interface's `note?: string` (Task 20).
- Produces: `SquareWorkshopProvider.reserveSeats` sends `customer_note` when given a note, and on a 4xx refusal asks once more without it.

- [ ] **Step 1: Write the failing test**

Append inside `describe('reserveSeats', …)` in `tests/providers/square/workshop-seats.test.ts`:

```ts
    const held = () => answer(200, { class_booking: { id: 'clsbk_1', order_id: 'order-1', customer: { contact_token: 'contact-1' } } })
    const params = (note?: string) => ({ scheduleId: 'clssch_1', startAt: '2026-10-17T00:00:00.000Z', seats: 2, customer, ...(note ? { note } : {}) })

    it('sends the seat picks as the booking’s customer note', async () => {
      const fetchSpy = stubFetch(async () => held())
      await new SquareWorkshopProvider(config).reserveSeats(params('Pumpkin color: Lavender ×2'))
      expect(JSON.parse(fetchSpy.mock.calls[0][1].body).customer_note).toBe('Pumpkin color: Lavender ×2')
    })

    it('asks once more without the note when Square refuses, and keeps that hold', async () => {
      const fetchSpy = stubFetch(async (_url: string, init: any) =>
        JSON.parse(init.body).customer_note ? answer(400, '{"errors":[{"code":"BAD_REQUEST","field":"customer_note"}]}') : held(),
      )
      expect(await new SquareWorkshopProvider(config).reserveSeats(params('Pumpkin color: Lavender ×2'))).toEqual(reservation)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).not.toHaveProperty('customer_note')
    })

    it('reports the second refusal when the hold fails without the note too', async () => {
      const fetchSpy = stubFetch(async () => answer(400, 'Not enough seats available'))
      const err = await caught(new SquareWorkshopProvider(config).reserveSeats(params('x')))
      expect(err).toMatchObject({ phase: 'reserve', kind: 'refused', raw: 'Not enough seats available' })
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it('never asks again after no answer: the seats may already be held', async () => {
      const fetchSpy = stubFetch(async () => {
        throw new TypeError('fetch failed')
      })
      const err = await caught(new SquareWorkshopProvider(config).reserveSeats(params('x')))
      expect(err).toMatchObject({ kind: 'no_answer' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('without a note, a refusal is not retried', async () => {
      const fetchSpy = stubFetch(async () => answer(400, 'Not enough seats available'))
      await caught(new SquareWorkshopProvider(config).reserveSeats(params()))
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/providers/square/workshop-seats.test.ts`
Expected: FAIL — no `customer_note` in the body; the retry tests see one call.

- [ ] **Step 3: Write minimal implementation**

`src/providers/square/workshop.ts` — replace `async reserveSeats(…) { … }` with:

```ts
  async reserveSeats(params: {
    scheduleId: string
    startAt: string
    seats: number
    customer: { givenName: string; familyName: string; email: string }
    note?: string
  }): Promise<SeatReservation> {
    try {
      return await this.holdSeats(params, params.note)
    } catch (err) {
      // A refused hold holds nothing, so asking again is safe. If the note was
      // what Square refused, the picks are still stored on our side and in the
      // confirmation email. No answer is never retried: seats may be held.
      if (params.note && err instanceof SeatBookingError && err.kind === 'refused') {
        logger.warn('Seat hold refused with a booking note — asking once more without it', { status: err.status })
        return this.holdSeats(params, undefined)
      }
      throw err
    }
  }

  private async holdSeats(
    params: { scheduleId: string; startAt: string; seats: number; customer: { givenName: string; familyName: string; email: string } },
    note: string | undefined,
  ): Promise<SeatReservation> {
    let res: Response
    try {
      res = await fetch(this.classesUrl('/class_bookings'), {
        method: 'POST',
        headers: BUYER_HEADERS,
        body: JSON.stringify({
          class_schedule_id: params.scheduleId,
          start_at: params.startAt,
          customer: {
            given_name: params.customer.givenName,
            family_name: params.customer.familyName,
            email_address: params.customer.email,
          },
          quantity: params.seats,
          ...(note ? { customer_note: note } : {}),
        }),
      })
    } catch (err) {
      throw new SeatBookingError('square', 'reserve', 'no_answer', err instanceof Error ? err.message : String(err))
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      logger.error('Seat reservation refused', { status: res.status, error: text, withNote: !!note })
      throw new SeatBookingError('square', 'reserve', 'refused', text, res.status)
    }
    const booking = (await res.json()).class_booking
    logger.info('Seats reserved', { bookingId: booking.id, orderId: booking.order_id, withNote: !!note })
    return {
      bookingId: booking.id,
      // /complete expects this contact token as its customer_id, NOT the
      // Customers API id (see the square-class-bookings notes).
      contactToken: booking.customer?.contact_token ?? booking.contact_token ?? null,
      orderId: booking.order_id ?? null,
    }
  }
```

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run tests/providers/square/workshop-seats.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/providers/square/workshop.ts tests/providers/square/workshop-seats.test.ts
git commit -m "feat(square): seat picks ride on the class booking as customer_note, retried once without it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 22: Store the picks after the charge goes through

**Files:**
- Modify: `src/pages/api/workshops/book.json.ts` (after `// ── Paid and confirmed …` at line 165, before the email `try`)
- Test: `tests/api/workshop-book.test.ts`

**Interfaces:**
- Consumes: `saveSeatChoices`, `SeatChoiceRecord` (Task 12); `picks`, `note` (Task 20); `alertOwners`.
- Produces: one `seat-choices` record per paid booking with picks.

- [ ] **Step 1: Write the failing test**

In `tests/api/workshop-book.test.ts`, after the `@lib/event-meta` mock add:

```ts
const mockSaveSeatChoices = vi.fn()
vi.mock('@lib/seat-choices', () => ({ saveSeatChoices: (...a: any[]) => mockSaveSeatChoices(...a) }))
```

add `mockSaveSeatChoices.mockResolvedValue(undefined)` to `beforeEach`, and append inside the top-level `describe`:

```ts
  describe('the picks, once paid', () => {
    beforeEach(() => mockGetEventMeta.mockResolvedValue({ options: [PAILS], signupCutoffHours: null }))

    it('stores each seat’s pick after the charge has gone through', async () => {
      expect((await POST(ctx(body({ picks: TWO_PICKS })))).status).toBe(200)
      expect(mockSaveSeatChoices).toHaveBeenCalledWith({
        eventKind: 'workshop',
        eventId: 'clssch_kinusaiga',
        bookingId: 'clsbk_1',
        orderId: 'order-1',
        customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '(256) 555-0123' },
        seats: 2,
        picks: TWO_PICKS,
        at: '2026-10-10T17:00:00.000Z',
        attemptId: ATTEMPT,
      })
      expect(mockSaveSeatChoices.mock.invocationCallOrder[0]).toBeGreaterThan(mockPay.mock.invocationCallOrder[0])
    })

    it('stores nothing when the card is refused', async () => {
      mockPay.mockRejectedValue(new SeatBookingError('square', 'pay', 'refused', '{"errors":[{"code":"CARD_DECLINED"}]}', 400))
      await POST(ctx(body({ picks: TWO_PICKS })))
      expect(mockSaveSeatChoices).not.toHaveBeenCalled()
    })

    it('stores nothing for a class with no questions', async () => {
      mockGetEventMeta.mockResolvedValue(null)
      await POST(ctx(body()))
      expect(mockSaveSeatChoices).not.toHaveBeenCalled()
    })

    it('a failed save never fails a paid booking, and the owners are told', async () => {
      mockSaveSeatChoices.mockRejectedValue(new Error('blobs down'))
      const res = await POST(ctx(body({ picks: TWO_PICKS })))
      expect(res.status).toBe(200)
      expect(mockAlertOwners).toHaveBeenCalledWith(expect.stringContaining('Seat picks not saved: Ada Lovelace'))
      expect(mockAlertOwners.mock.calls[0][0]).toContain('Pumpkin color: Black ×1, Lavender ×1')
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/workshop-book.test.ts`
Expected: FAIL — `mockSaveSeatChoices` is never called.

- [ ] **Step 3: Write minimal implementation**

Add the import:

```ts
import { saveSeatChoices } from '@lib/seat-choices'
```

Directly after `// ── Paid and confirmed. Nothing below may turn this into a failure. ────────`, before `let emailSent = false`, add:

```ts
  // The structured picks behind the roster (spec C/D). Written only now, once
  // the money is taken. A failed write never fails the booking: the picks are
  // also in Square's booking note and in the customer's email, and a person
  // is told so they can be added by hand.
  if (picks.length > 0) {
    try {
      await saveSeatChoices({
        eventKind: 'workshop',
        eventId: workshop.scheduleId,
        bookingId: booked.bookingId,
        orderId: booked.orderId,
        customer: { givenName, familyName, email, phone },
        seats,
        picks,
        at: new Date().toISOString(),
        attemptId,
      })
    } catch (err) {
      logger.error('SEAT PICKS NOT SAVED (booking is paid)', {
        bookingId: booked.bookingId,
        error: err instanceof Error ? err.message : String(err),
      })
      await alertOwners(
        `Seat picks not saved: ${givenName} ${familyName}, ${workshop.name}, ${formatSlotLabel(workshop.startAt)}. ${note}. Booking ${booked.bookingId} is paid; the picks are in its Square note.`,
      ).catch(() => undefined)
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/workshop-book.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/workshops/book.json.ts tests/api/workshop-book.test.ts
git commit -m "feat(workshops): store each seat's pick once the charge goes through

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 23: "Your picks" in the confirmation email

**Files:**
- Modify: `src/lib/email.ts` (`sendWorkshopConfirmationEmail` input and body, lines 327–427)
- Modify: `src/pages/api/workshops/book.json.ts` (`sendConfirmation` call and function)
- Test: `tests/lib/email-workshop.test.ts`, `tests/api/workshop-book.test.ts`

**Interfaces:**
- Consumes: `seatPickLines`, `PICKS_FINAL_LINE`, `SeatOption`, `SeatPick` (Tasks 11, 20).
- Produces: `sendWorkshopConfirmationEmail` input gains `pickLines?: string[]`, `picksFinalLine?: string`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('sendWorkshopConfirmationEmail', …)` in `tests/lib/email-workshop.test.ts`:

```ts
  it('lists each seat’s pick and says picks are final', async () => {
    await sendWorkshopConfirmationEmail({
      ...input,
      pickLines: ['Seat 1 · Pumpkin color: Lavender', 'Seat 2 · Pumpkin color: Black'],
      picksFinalLine: 'Picks are made ahead for you, so they can’t be changed after you book.',
    })
    const mail = mockSendMail.mock.calls[0][0]
    expect(mail.text).toContain(
      'Your picks:\n  Seat 1 · Pumpkin color: Lavender\n  Seat 2 · Pumpkin color: Black\nPicks are made ahead for you, so they can’t be changed after you book.',
    )
    expect(mail.html).toContain('Your picks')
    expect(mail.html).toContain('Seat 2 · Pumpkin color: Black')
    expect(mail.html).toContain('can’t be changed after you book.')
  })

  it('says nothing about picks for a class with no questions', async () => {
    await sendWorkshopConfirmationEmail(input)
    const mail = mockSendMail.mock.calls[0][0]
    expect(mail.text).not.toContain('Your picks')
    expect(mail.html).not.toContain('Your picks')
  })
```

Append inside `describe('the picks, once paid', …)` in `tests/api/workshop-book.test.ts`:

```ts
    it('puts the picks in the confirmation email', async () => {
      await POST(ctx(body({ picks: TWO_PICKS })))
      const mail = mockSendEmail.mock.calls[0][0]
      expect(mail.pickLines).toEqual(['Seat 1 · Pumpkin color: Lavender', 'Seat 2 · Pumpkin color: Black'])
      expect(mail.picksFinalLine).toBe('Picks are made ahead for you, so they can’t be changed after you book.')
    })

    it('leaves picks out of the email for a class with no questions', async () => {
      mockGetEventMeta.mockResolvedValue(null)
      await POST(ctx(body()))
      expect(mockSendEmail.mock.calls[0][0]).not.toHaveProperty('pickLines')
    })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/email-workshop.test.ts tests/api/workshop-book.test.ts`
Expected: FAIL — no "Your picks" in the email; `mail.pickLines` undefined.

- [ ] **Step 3: Write minimal implementation**

`src/lib/email.ts` — in the `sendWorkshopConfirmationEmail` input type, after `bookingRef?: string`:

```ts
  /** "Seat 1 · Pumpkin color: Lavender", one per pick. Absent for a class with no questions. */
  pickLines?: string[]
  /** Shown under the picks: PICKS_FINAL_LINE. */
  picksFinalLine?: string
```

In the `text` array, directly after the `` `Seats: ${seatWord}, ${paid} paid`, `` line, add:

```ts
    ...(input.pickLines?.length
      ? [``, `Your picks:`, ...input.pickLines.map((l) => `  ${l}`), ...(input.picksFinalLine ? [input.picksFinalLine] : [])]
      : []),
```

In the `html` template, directly after the `<p style="${P}">${esc(seatWord)} &middot; <strong>${esc(paid)} paid</strong></p>` line, add:

```ts
  ${input.pickLines?.length
    ? `<p style="${LABEL}margin-top:10px;">Your picks</p>${input.pickLines.map((l) => `<p style="${P}margin:0 0 2px;">${esc(l)}</p>`).join('')}${input.picksFinalLine ? `<p style="${MUTED}margin-top:4px;">${esc(input.picksFinalLine)}</p>` : ''}`
    : ''}
```

`src/pages/api/workshops/book.json.ts` — extend the seat-options import with `seatPickLines, PICKS_FINAL_LINE, type SeatOption`. In the `sendConfirmation({ … })` call add `options: settings.options,` and `picks,`. In `sendConfirmation`'s input type add:

```ts
  options: SeatOption[]
  picks: SeatPick[]
```

and in its `sendWorkshopConfirmationEmail({ … })` call, after `bookingRef: input.bookingId,` add:

```ts
    ...(input.picks.length > 0
      ? { pickLines: seatPickLines(input.options, input.picks), picksFinalLine: PICKS_FINAL_LINE }
      : {}),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/email-workshop.test.ts tests/api/workshop-book.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email.ts src/pages/api/workshops/book.json.ts tests/lib/email-workshop.test.ts tests/api/workshop-book.test.ts
git commit -m "feat(email): Your picks block in the workshop confirmation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 24: Warning — seats sold with no pick on record (`picks-missing`)

Seats sold = Square capacity − seats left; seats with picks = the class's `seat-choices` records. A gap means someone booked outside our site (Square's own page or the dashboard).

**Files:**
- Modify: `src/lib/warnings.ts` (imports; new `picksMissing`; `listWarnings` return)
- Test: `tests/lib/warnings.test.ts`

**Interfaces:**
- Consumes: `getEventMeta` (Task 13); `listSeatChoicesByEvent` (Task 12); `Workshop.totalCapacity` (Task 7).
- Produces: `listWarnings` also returns `code: 'picks-missing'` warnings.

- [ ] **Step 1: Write the failing test**

In `tests/lib/warnings.test.ts`, after the `@lib/party-store` mock add:

```ts
const mockGetEventMeta = vi.fn()
vi.mock('@lib/event-meta', () => ({ getEventMeta: (...a: any[]) => mockGetEventMeta(...a) }))
const mockListSeatChoices = vi.fn()
vi.mock('@lib/seat-choices', () => ({ listSeatChoicesByEvent: (...a: any[]) => mockListSeatChoices(...a) }))
```

add to `beforeEach`: `mockGetEventMeta.mockResolvedValue(null)` and `mockListSeatChoices.mockResolvedValue([])`, and append:

```ts
describe('listWarnings — picks-missing', () => {
  const OPTION = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Black', 'Lavender'] }
  const seatsPicked = (...n: number[]) => n.map((seats) => ({ seats }))

  beforeEach(() => {
    mockListAllWorkshops.mockResolvedValue([PAILS]) // 25 seats, 10 left: 15 sold
    mockGetEventMeta.mockResolvedValue({ options: [OPTION], signupCutoffHours: null })
  })

  it('counts sold seats with no pick on record', async () => {
    mockListSeatChoices.mockResolvedValue(seatsPicked(4, 4, 5)) // 13 picked
    const [w] = await listWarnings(WINDOW)
    expect(mockListSeatChoices).toHaveBeenCalledWith('workshop', 'clssch_pails')
    expect(w).toEqual({
      code: 'picks-missing', eventKind: 'workshop', eventId: 'clssch_pails', when: '2026-10-18T18:00:00.000Z', title: 'Pumpkin Pails',
      detail: 'Pumpkin Pails: 2 seats have no pumpkin color.', action: 'Call the customer.',
    })
  })

  it('says "1 seat has" for one', async () => {
    mockListSeatChoices.mockResolvedValue(seatsPicked(14))
    expect((await listWarnings(WINDOW))[0].detail).toBe('Pumpkin Pails: 1 seat has no pumpkin color.')
  })

  it('is quiet when every sold seat has a pick', async () => {
    mockListSeatChoices.mockResolvedValue(seatsPicked(15))
    expect(await listWarnings(WINDOW)).toEqual([])
  })

  it('skips a class that asks no questions', async () => {
    mockGetEventMeta.mockResolvedValue(null)
    expect(await listWarnings(WINDOW)).toEqual([])
    expect(mockListSeatChoices).not.toHaveBeenCalled()
  })

  it('skips a class when Square gives no capacity', async () => {
    mockListAllWorkshops.mockResolvedValue([{ ...PAILS, totalCapacity: undefined }])
    expect(await listWarnings(WINDOW)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/warnings.test.ts`
Expected: FAIL — "counts sold seats…" gets `undefined`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/warnings.ts` — add imports:

```ts
import { getEventMeta } from '@lib/event-meta'
import { listSeatChoicesByEvent } from '@lib/seat-choices'
```

Add above `listWarnings`:

```ts
/** Seats Square says are sold, minus seats with a pick on record: someone booked outside our site. */
async function picksMissing(s: Scan): Promise<Warning[]> {
  const out: Warning[] = []
  for (const { span, workshop } of s.classes) {
    if (typeof workshop.totalCapacity !== 'number') continue
    const options = (await getEventMeta('workshop', span.id))?.options ?? []
    if (options.length === 0) continue
    const sold = workshop.totalCapacity - workshop.availableCapacity
    const picked = (await listSeatChoicesByEvent('workshop', span.id)).reduce((n, r) => n + r.seats, 0)
    const missing = sold - picked
    if (missing <= 0) continue
    out.push({
      code: 'picks-missing',
      eventKind: 'workshop',
      eventId: span.id,
      when: span.startIso,
      title: span.name,
      detail: `${span.name}: ${missing} seat${missing === 1 ? ' has' : 's have'} no ${options[0].label.toLowerCase()}.`,
      action: 'Call the customer.',
    })
  }
  return out
}
```

and change `listWarnings`' return to:

```ts
  return [...classOverParty(s), ...classOverClass(s), ...oversold(s), ...partyOnClosedDay(s), ...(await picksMissing(s))].sort((a, b) =>
    a.when.localeCompare(b.when),
  )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/warnings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/warnings.ts tests/lib/warnings.test.ts
git commit -m "feat(warnings): flag sold seats with no pick on record

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 25: Roster data — totals, picks by family, paid but not signed in

**Files:**
- Modify: `src/lib/seat-options.ts` (append `choiceTotals`, `totalsLine`, `picksShort`)
- Modify: `src/lib/seat-choices.ts` (append `RosterChoices`, `summarizeChoices`)
- Modify: `src/pages/api/staff/roster.json.ts` (import; compute `choices` before the response; add to `data`)
- Test: `tests/lib/seat-options.test.ts`, `tests/lib/seat-choices.test.ts`, `tests/api/staff-roster.test.ts`

**Interfaces:**
- Consumes: `listSeatChoicesByEvent`, `SeatChoiceRecord` (Task 12); `StudioEvent.options`, `.capacity`, `.seats` (Task 13).
- Produces:
  - `choiceTotals(options: SeatOption[], picks: SeatPick[]): Record<string, Record<string, number>>`
  - `totalsLine(option: SeatOption, totals: Record<string, number>): string` → `"Pumpkin color — Lavender 6 · Black 4 · Light Pink 3 · Light Blue 2"` (most picked first; ties in the class's order)
  - `picksShort(picks: SeatPick[]): string` → `"Lavender ×2"`
  - `interface RosterChoices { totals: Record<string, Record<string, number>>; byEmail: Record<string, SeatPick[]>; unmatched: { name: string; email: string; seats: number; picks: SeatPick[] }[]; seatsSold: number | null }`
  - `summarizeChoices(options: SeatOption[], records: SeatChoiceRecord[], signerEmails: string[], seatsSold: number | null): RosterChoices`
  - `GET /api/staff/roster.json` → `data.choices: RosterChoices | null` (null for parties and classes without questions)

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/seat-options.test.ts` (add the names to the import list):

```ts
import { choiceTotals, totalsLine, picksShort } from '@lib/seat-options'

describe('roster wording', () => {
  const p = (seat: number, choice: string) => ({ seat, optionId: 'pumpkin-color', choice })

  it('totals each choice', () => {
    expect(choiceTotals([PAILS], [p(1, 'Lavender'), p(2, 'Lavender'), p(1, 'Black')])).toEqual({ 'pumpkin-color': { Lavender: 2, Black: 1 } })
  })

  it('writes the strip most picked first, ties in the class’s order', () => {
    expect(totalsLine(PAILS, { Lavender: 6, Black: 4, 'Light Pink': 3, 'Light Blue': 2 })).toBe('Pumpkin color — Lavender 6 · Black 4 · Light Pink 3 · Light Blue 2')
    expect(totalsLine(PAILS, { Black: 1, 'Light Pink': 1 })).toBe('Pumpkin color — Light Pink 1 · Black 1')
    expect(totalsLine(PAILS, {})).toBe('Pumpkin color — no picks yet')
  })

  it('writes a family’s picks short', () => {
    expect(picksShort([p(1, 'Lavender'), p(2, 'Lavender'), p(3, 'Black')])).toBe('Lavender ×2, Black ×1')
  })
})
```

Append to `tests/lib/seat-choices.test.ts`:

```ts
import { summarizeChoices } from '@lib/seat-choices'

describe('summarizeChoices', () => {
  const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }
  const p = (seat: number, choice: string) => ({ seat, optionId: 'pumpkin-color', choice })

  it('totals, groups by email (any case) and lists paid families with no signed agreement', () => {
    const records = [
      record('clssch_pails', 'clsbk_1', { customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'Ada@Example.com', phone: '' }, seats: 2, picks: [p(1, 'Lavender'), p(2, 'Lavender')] }),
      record('clssch_pails', 'clsbk_2', { customer: { givenName: 'Bo', familyName: 'Test', email: 'bo@x.com', phone: '' }, seats: 1, picks: [p(1, 'Black')] }),
    ]
    expect(summarizeChoices([PAILS], records, ['ada@example.com '], 15)).toEqual({
      totals: { 'pumpkin-color': { Lavender: 2, Black: 1 } },
      byEmail: { 'ada@example.com': [p(1, 'Lavender'), p(2, 'Lavender')], 'bo@x.com': [p(1, 'Black')] },
      unmatched: [{ name: 'Bo Test', email: 'bo@x.com', seats: 1, picks: [p(1, 'Black')] }],
      seatsSold: 15,
    })
  })
})
```

In `tests/api/staff-roster.test.ts`, after the `@lib/checkin-store` mock add:

```ts
const mockListSeatChoices = vi.fn()
vi.mock('@lib/seat-choices', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, listSeatChoicesByEvent: (...a: any[]) => mockListSeatChoices(...a) }
})
```

add `mockListSeatChoices.mockReset().mockResolvedValue([])` to its `beforeEach`, and append:

```ts
describe('GET /api/staff/roster.json — seat picks (spec D)', () => {
  const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }
  const pailsEvent = {
    kind: 'workshop', id: 'clssch_pails', title: 'Pumpkin Pails', startIso: '2026-10-18T18:00:00.000Z', days: ['2026-10-18'],
    dropOff: false, options: [PAILS], signupCutoffHours: null, seats: 10, capacity: 25,
  }
  const p = (seat: number, choice: string) => ({ seat, optionId: 'pumpkin-color', choice })
  const rec = (email: string, givenName: string, picks: any[]) => ({
    eventKind: 'workshop', eventId: 'clssch_pails', bookingId: `bk_${givenName}`, orderId: null,
    customer: { givenName, familyName: 'Test', email, phone: '' }, seats: picks.length, picks, at: '2026-10-06T15:00:00.000Z', attemptId: 'a',
  })

  it('totals each choice, groups picks by family email, and lists who paid but has not signed', async () => {
    mockGetEvent.mockResolvedValue(pailsEvent)
    mockListWaiversByEvent.mockResolvedValue([makeWaiver({ adult: { firstName: 'Alice', lastName: 'Test', email: 'Alice@X.com', phone: '', dob: '1990-01-01', allergies: '' } })])
    mockListSeatChoices.mockResolvedValue([rec('alice@x.com', 'Alice', [p(1, 'Lavender'), p(2, 'Lavender')]), rec('bo@x.com', 'Bo', [p(1, 'Black')])])
    const { data } = await (await GET(ctx('?kind=workshop&id=clssch_pails'))).json()
    expect(mockListSeatChoices).toHaveBeenCalledWith('workshop', 'clssch_pails')
    expect(data.choices).toEqual({
      totals: { 'pumpkin-color': { Lavender: 2, Black: 1 } },
      byEmail: { 'alice@x.com': [p(1, 'Lavender'), p(2, 'Lavender')], 'bo@x.com': [p(1, 'Black')] },
      unmatched: [{ name: 'Bo Test', email: 'bo@x.com', seats: 1, picks: [p(1, 'Black')] }],
      seatsSold: 15,
    })
  })

  it('a party, or a class with no questions, has no picks block', async () => {
    const { data } = await (await GET(ctx('?kind=party&id=party-1'))).json()
    expect(data.choices).toBeNull()
    mockGetEvent.mockResolvedValue({ ...pailsEvent, options: [] })
    expect((await (await GET(ctx('?kind=workshop&id=clssch_pails'))).json()).data.choices).toBeNull()
    expect(mockListSeatChoices).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/seat-options.test.ts tests/lib/seat-choices.test.ts tests/api/staff-roster.test.ts`
Expected: FAIL — the new helpers are not exported; `data.choices` is undefined.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/seat-options.ts`:

```ts
/** Seats per choice, per question: { "pumpkin-color": { Lavender: 6, Black: 4 } }. */
export function choiceTotals(options: SeatOption[], picks: SeatPick[]): Record<string, Record<string, number>> {
  const totals: Record<string, Record<string, number>> = {}
  for (const o of options) totals[o.id] = {}
  for (const p of picks) {
    const t = totals[p.optionId]
    if (t) t[p.choice] = (t[p.choice] ?? 0) + 1
  }
  return totals
}

/** "Pumpkin color — Lavender 6 · Black 4 · Light Pink 3 · Light Blue 2": most picked first, ties in the class's order. */
export function totalsLine(option: SeatOption, totals: Record<string, number>): string {
  const parts = option.choices
    .map((c) => [c, totals[c] ?? 0] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
  return `${option.label} — ${parts.length ? parts.map(([c, n]) => `${c} ${n}`).join(' · ') : 'no picks yet'}`
}

/** "Lavender ×2, Black ×1": a family's picks on the roster card. */
export function picksShort(picks: SeatPick[]): string {
  const counts = new Map<string, number>()
  for (const p of picks) counts.set(p.choice, (counts.get(p.choice) ?? 0) + 1)
  return [...counts].map(([c, n]) => `${c} ×${n}`).join(', ')
}
```

Append to `src/lib/seat-choices.ts` (and extend its seat-options import to `import { choiceTotals, type SeatOption, type SeatPick } from '@lib/seat-options'`):

```ts
export interface RosterChoices {
  /** optionId → choice → seats. */
  totals: Record<string, Record<string, number>>
  /** Lower-cased booking email → that family's picks (all their bookings). */
  byEmail: Record<string, SeatPick[]>
  /** Paid bookings whose email matches no signed agreement for this class. */
  unmatched: { name: string; email: string; seats: number; picks: SeatPick[] }[]
  /** Seats Square says are sold (capacity − left), or null when unknown. */
  seatsSold: number | null
}

/** Roll a class's records up for the roster and the print sheet (spec D). */
export function summarizeChoices(
  options: SeatOption[],
  records: SeatChoiceRecord[],
  signerEmails: string[],
  seatsSold: number | null,
): RosterChoices {
  const signed = new Set(signerEmails.map((e) => e.trim().toLowerCase()))
  const byEmail: Record<string, SeatPick[]> = {}
  const unmatched: RosterChoices['unmatched'] = []
  for (const r of records) {
    const email = r.customer.email.trim().toLowerCase()
    byEmail[email] = [...(byEmail[email] ?? []), ...r.picks]
    if (!signed.has(email)) {
      unmatched.push({ name: `${r.customer.givenName} ${r.customer.familyName}`.trim(), email, seats: r.seats, picks: r.picks })
    }
  }
  return { totals: choiceTotals(options, records.flatMap((r) => r.picks)), byEmail, unmatched, seatsSold }
}
```

`src/pages/api/staff/roster.json.ts` — add the import:

```ts
import { listSeatChoicesByEvent, summarizeChoices } from '@lib/seat-choices'
```

directly before `return new Response(` in the success path, add:

```ts
    // Seat picks (spec D): only classes that ask questions have them.
    const options = kind === 'workshop' ? (event.options ?? []) : []
    const choices = options.length > 0
      ? summarizeChoices(
          options,
          await listSeatChoicesByEvent('workshop', id),
          waivers.map((w) => w.adult.email),
          typeof event.capacity === 'number' && typeof event.seats === 'number' ? event.capacity - event.seats : null,
        )
      : null
```

and add `choices,` to the `data` object after `households: responseHouseholds,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/seat-options.test.ts tests/lib/seat-choices.test.ts tests/api/staff-roster.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seat-options.ts src/lib/seat-choices.ts src/pages/api/staff/roster.json.ts tests/lib/seat-options.test.ts tests/lib/seat-choices.test.ts tests/api/staff-roster.test.ts
git commit -m "feat(staff): roster data carries seat-pick totals, family picks and unsigned payers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 26: Roster screen — totals strip, "Picks:" line, "Paid, not signed in yet"

**Files:**
- Modify: `src/components/staff/HouseholdCard.tsx` (props; one line under the phone link at line 238)
- Modify: `src/components/staff/Roster.tsx` (`RosterData`; strip after the header card; `picks` prop on each card; list after the cards)
- Test: `tests/components/staff/HouseholdCard.test.tsx`, `tests/components/staff/Roster.test.tsx`

**Interfaces:**
- Consumes: `RosterChoices` (type only, Task 25); `totalsLine`, `picksShort`, `SeatPick` (Task 25); `StudioEvent.options` (Task 13).
- Produces: `HouseholdCard` gains optional prop `picks?: SeatPick[]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/components/staff/HouseholdCard.test.tsx`:

```tsx
describe('HouseholdCard — seat picks', () => {
  it('shows the family’s picks under the phone', () => {
    render(
      <HouseholdCard
        h={household()} dropOff={false} kind="workshop" id="clssch_pails" day="2026-10-18" post={vi.fn(async () => ({})) as any}
        picks={[{ seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' }, { seat: 2, optionId: 'pumpkin-color', choice: 'Lavender' }]}
      />,
    )
    expect(screen.getByText('Picks: Lavender ×2')).toBeInTheDocument()
  })

  it('shows no picks line without picks', () => {
    renderCard(household(), false)
    expect(screen.queryByText(/^Picks:/)).toBeNull()
  })
})
```

Append to `tests/components/staff/Roster.test.tsx`:

```tsx
describe('Roster — seat picks (spec D)', () => {
  afterEach(() => { vi.restoreAllMocks() })

  const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }
  const PAILS_EVENT = { kind: 'workshop', id: 'cs-camp', title: 'Pumpkin Pails', startIso: '2026-10-18T18:00:00.000Z', days: ['2026-10-18'], dropOff: false, options: [PAILS] }
  const p = (seat: number, choice: string) => ({ seat, optionId: 'pumpkin-color', choice })

  function serveRoster(choices: unknown, event: any = PAILS_EVENT) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('/api/staff/incidents.json')) return { ok: true, json: async () => ({ data: { incidents: [] } }) } as Response
      return {
        ok: true,
        json: async () => ({
          data: { event, day: '2026-10-18', summary: { households: 1, people: 2, childrenHereNow: 0 }, capWarning: false, households: [household()], choices },
        }),
      } as Response
    })
  }

  it('shows the totals strip, the family’s picks, and who has paid but not signed in', async () => {
    serveRoster({
      totals: { 'pumpkin-color': { Lavender: 6, Black: 4, 'Light Pink': 3, 'Light Blue': 2 } },
      byEmail: { 'jamie@x.com': [p(1, 'Lavender'), p(2, 'Lavender')] },
      unmatched: [{ name: 'Bo Test', email: 'bo@x.com', seats: 1, picks: [p(1, 'Black')] }],
      seatsSold: 15,
    })
    renderRoster()
    expect(await screen.findByText('Pumpkin color — Lavender 6 · Black 4 · Light Pink 3 · Light Blue 2')).toBeInTheDocument()
    expect(screen.getByText('(15 seats sold)')).toBeInTheDocument()
    expect(screen.getByText('Picks: Lavender ×2')).toBeInTheDocument()
    expect(screen.getByText('Paid, not signed in yet')).toBeInTheDocument()
    expect(screen.getByText('Bo Test · 1 seat · Picks: Black ×1')).toBeInTheDocument()
  })

  it('counts picked seats when Square gave no capacity', async () => {
    serveRoster({ totals: { 'pumpkin-color': { Lavender: 2, Black: 1 } }, byEmail: {}, unmatched: [], seatsSold: null })
    renderRoster()
    expect(await screen.findByText('(3 seats picked)')).toBeInTheDocument()
    expect(screen.queryByText('Paid, not signed in yet')).toBeNull()
  })

  it('a class with no questions shows no picks at all', async () => {
    serveRoster(null, { ...PAILS_EVENT, options: [] })
    renderRoster()
    await screen.findAllByText('Jamie Rivera')
    expect(screen.queryByText(/^Pumpkin color —/)).toBeNull()
    expect(screen.queryByText(/^Picks:/)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/staff/HouseholdCard.test.tsx tests/components/staff/Roster.test.tsx`
Expected: FAIL — no "Picks:" line, no totals strip.

- [ ] **Step 3: Write minimal implementation**

`src/components/staff/HouseholdCard.tsx` — add imports:

```tsx
import { picksShort, type SeatPick } from '@lib/seat-options'
```

add `picks,` to the destructured props and `picks?: SeatPick[]` to the props type (after `post: …`), with the doc comment `/** This family's seat picks (classes with questions). Read-only: picks never change after booking. */`. Directly after the `📞 {h.phone}` `<a>` (inside the same `<div>`), add:

```tsx
          {picks && picks.length > 0 && (
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-dark)' }}>Picks: {picksShort(picks)}</p>
          )}
```

`src/components/staff/Roster.tsx` — add imports:

```tsx
import { picksShort, totalsLine } from '@lib/seat-options'
import type { RosterChoices } from '@lib/seat-choices'
```

add to `RosterData` after `households: Household[]`:

```tsx
  /** Seat picks (classes with questions only); null otherwise. Older servers omit it. */
  choices?: RosterChoices | null
```

after `const { event } = data` add:

```tsx
  const options = event.options ?? []
  const choices = options.length > 0 ? data.choices ?? null : null
```

directly after the header card's closing `</div>` (the one that ends after the Badge row), add:

```tsx
      {choices && (
        <div data-testid="picks-totals" style={{ ...card, background: 'rgba(255,255,255,0.85)' }}>
          {options.map((o) => {
            const totals = choices.totals[o.id] ?? {}
            const picked = Object.values(totals).reduce((n, x) => n + x, 0)
            return (
              <p key={o.id} style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-dark)' }}>
                <span>{totalsLine(o, totals)}</span>{' '}
                <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>
                  {choices.seatsSold !== null ? `(${choices.seatsSold} seats sold)` : `(${picked} seats picked)`}
                </span>
              </p>
            )
          })}
        </div>
      )}
```

change the `HouseholdCard` line to pass picks:

```tsx
        <HouseholdCard key={`${h.recordId}:${data.day}`} h={h} dropOff={event.dropOff} kind={kind} id={id} day={data.day} post={post} picks={choices?.byEmail[h.email.trim().toLowerCase()]} />
```

and directly after the `visibleHouseholds.map(…)` block, before the final `</div>`, add:

```tsx
      {choices && choices.unmatched.length > 0 && (
        <div style={{ ...card, background: 'rgba(255,255,255,0.7)' }}>
          <p style={{ margin: '0 0 0.4rem', fontWeight: 700, color: 'var(--color-dark)' }}>Paid, not signed in yet</p>
          {choices.unmatched.map((u, i) => (
            <p key={`${u.email}:${i}`} style={{ margin: '0.2rem 0 0', fontSize: '0.875rem', color: 'var(--color-dark)' }}>
              {`${u.name} · ${u.seats} seat${u.seats === 1 ? '' : 's'}${u.picks.length ? ` · Picks: ${picksShort(u.picks)}` : ''}`}
            </p>
          ))}
        </div>
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/staff/HouseholdCard.test.tsx tests/components/staff/Roster.test.tsx tests/components/staff/StaffConsole-open.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/staff/HouseholdCard.tsx src/components/staff/Roster.tsx tests/components/staff/HouseholdCard.test.tsx tests/components/staff/Roster.test.tsx
git commit -m "feat(staff): roster shows pick totals, each family's picks, and unsigned payers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 27: Print sheet — totals under the title, a Picks column

Astro pages have no unit tests in this repo; the logic is Task 25's tested helpers. This task is wiring, checked by the build and a look at the page.

**Files:**
- Modify: `src/pages/staff/print.astro`

**Interfaces:**
- Consumes: `listSeatChoicesByEvent`, `summarizeChoices` (Tasks 12, 25); `totalsLine`, `picksShort` (Task 25).
- Produces: nothing.

- [ ] **Step 1: Write the change**

In the frontmatter, add imports:

```ts
import { listSeatChoicesByEvent, summarizeChoices } from '@lib/seat-choices'
import { picksShort, totalsLine } from '@lib/seat-options'
```

after the `waivers.sort(…)` line add:

```ts
// Seat picks (spec D): only classes that ask questions have them.
const options = kind === 'workshop' && event ? (event.options ?? []) : []
const choices = event && options.length > 0
  ? summarizeChoices(
      options,
      await listSeatChoicesByEvent('workshop', id),
      waivers.map((w) => w.adult.email),
      typeof event.capacity === 'number' && typeof event.seats === 'number' ? event.capacity - event.seats : null,
    )
  : null
```

add `picks: string` to `PrintRow`; in the adult `rows.push({ … })` add `picks: choices ? picksShort(choices.byEmail[w.adult.email.trim().toLowerCase()] ?? []) : '',` and in the child `rows.push({ … })` add `picks: '',`.

In the header, directly after the `{event && ( <p class="meta"> … </p> )}` block, add:

```astro
        {choices && options.map((o) => (
          <p class="meta">
            <strong>{totalsLine(o, choices.totals[o.id] ?? {})}</strong>
            {choices.seatsSold !== null && <> ({choices.seatsSold} seats sold)</>}
          </p>
        ))}
```

In the table head, after `<th>Person</th>` add `{choices && <th>Picks</th>}`; in the row, after the Person `<td>` add `{choices && <td>{r.picks}</td>}`.

After the closing `)}` of the table conditional and before `<script>`, add:

```astro
    {choices && choices.unmatched.length > 0 && (
      <>
        <h2 style="font-size: 1rem; margin: 1rem 0 0.4rem;">Paid, not signed in yet</h2>
        <ul style="margin: 0; padding-left: 1.1rem; font-size: 0.8125rem;">
          {choices.unmatched.map((u) => (
            <li>{u.name} · {u.seats} seat{u.seats === 1 ? '' : 's'}{u.picks.length > 0 && <> · Picks: {picksShort(u.picks)}</>}</li>
          ))}
        </ul>
      </>
    )}
```

- [ ] **Step 2: Type check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build completes.

- [ ] **Step 3: Look at it on local dev**

Run `npm run dev`, sign in at http://localhost:4321/staff, set questions on a local class with the gear (Task 15), book two seats through /workshops (Task 19), then open `/staff/print?kind=workshop&id=<clssch_id>`.
Expected: the totals line under the title, a Picks column with "Lavender ×2" on the family's adult row, and (if the booking email has no signed agreement) the "Paid, not signed in yet" list.

- [ ] **Step 4: Commit**

```bash
git add src/pages/staff/print.astro
git commit -m "feat(staff): print sheet shows pick totals and a Picks column

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 28: Gate — full suite, types, build, browser walkthrough, memory note

**Files:**
- No code. Memory: `/Users/catherine/.claude/projects/-Users-catherine-source-homegrownStudio/memory/square-class-bookings.md` (append a short section).

- [ ] **Step 1: Full suite**

Run: `npx vitest run`
Expected: every test passes (the prior count plus this plan's additions). Fix any failure in the task that owns the file before going on.

- [ ] **Step 2: Types and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build completes.

- [ ] **Step 3: Browser walkthrough on local dev (`npm run dev`, http://localhost:4321)**

1. `/staff` → gear on a local class: add "Pumpkin color" with the four choices, save, confirm. The cutoff field shows "24 (default)".
2. `/workshops`: book two seats with Lavender and Black (sandbox card). Both selects are required; Continue names the missing seat.
3. `/staff` roster for that class: the strip reads "Pumpkin color — Black 1 · Lavender 1 (… seats sold)"; the family card reads "Picks: Black ×1, Lavender ×1" (or the booking shows under "Paid, not signed in yet" until the agreement is signed).
4. `/staff/print?kind=workshop&id=<clssch_id>`: totals line and Picks column.
5. With a local class on Sun 18 Oct 1–3 PM: `/book` for 18 Oct offers 3:30 PM only.
6. `npx tsx scripts/create-class.ts --name "<class>" --start "<a time over a seeded party>" --duration 120 --dry-run` refuses with the party's time, host and booking id.
7. Today screen shows "⚠ Needs attention (n)" listing the seeded overlap; there is no way to dismiss it.

- [ ] **Step 4: Record what Square did with the note**

After the first real or preview booking with picks, check the booking in the Square dashboard. Append to the `square-class-bookings` memory a dated section saying whether `customer_note` on `POST …/class_bookings` was kept (and where it shows), or refused (then the retry path ran and only our store has the picks). Two or three lines; no customer data.

- [ ] **Step 5: Hand off**

Report the test count, the build result, and the walkthrough outcome. Merging to `dev`, the preview check and the `dev → main` push stay Kaden's call (Pails on 18 Oct is the first real use; sign-ups must open after the push lands).

---

## Spec coverage

| Spec section | Tasks |
|---|---|
| A. Event settings (fields, validation, lock, `effectiveCutoffHours`, gear sheet, CLI) | 11, 12, 13, 14, 15, 16 |
| B. Public surface (`WorkshopData` fields, card label, modal selects, payload `picks`) | 17, 18, 19 |
| C. Booking server (cutoff 409, picks 400, `seat-choices` after charge, Square note + retry, email) | 20, 21, 22, 23 |
| D. Roster (`choices` response, totals strip, card line, unmatched list, print) | 25, 26, 27 |
| E. Parties yield to classes (availability, pre-charge re-check, graceful class lookup) | 1, 2, 3 |
| F. No class over a booked party (`conflicts.ts`, create-class refusal, in-tab step via `conflicts.json`) | 1, 4, 5, 6 |
| G. Warning panel + daily email (five codes, panel, `daily-warnings` function) | 7, 8, 9, 10, 24 |
| Testing / gate / memory note | every task; 28 |
