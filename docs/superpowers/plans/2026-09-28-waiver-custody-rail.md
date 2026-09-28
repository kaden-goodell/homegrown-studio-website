# Waiver & Custody Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One iPad app for the counter that answers "is there an agreement, is it valid, any flags?" for any guest, runs every event on one rail with drop-off as an event property, records which staffer did every custody action, writes and enforces the drop-off addendum, supports multi-day attendance, emails signers a copy, reports incidents, and archives itself weekly.

**Architecture:** Astro SSR + React islands on Netlify; all state in Netlify Blobs via `src/lib/blob-store.ts` (`makeKvStore(storeName, fsDirName)` → `KvStore` with CAS `setIfMatch`; fs fallback under `.data/` in dev/tests). Signatures (`WaiverRecord`) become immutable evidence; a new `RsvpRecord` carries per-event intent. A new `event-meta` store overlays `dropOff`/`days` on parties (blob) and workshops (Square Classes). The staff console (`/staff`) becomes a "Today" app with a signed identity cookie.

**Tech Stack:** Astro 5, React 18, TypeScript, vitest (+ @testing-library), Netlify Blobs + Scheduled Functions, Square SDK v44, nodemailer/Gmail, Quo SMS (`sendQuoText`), `fflate` (new, zip), `qrcode` (new, QR SVG).

**Spec:** `docs/superpowers/specs/2026-09-28-waiver-custody-rail-design.md` · **Tickets:** Linear HOM-206 … HOM-220 (project "Waiver & Custody Rail") — every task below names its ticket; the ticket holds the exact UI copy and acceptance criteria and is authoritative for wording.

## Global Constraints

- All displayed times are America/Chicago via `src/lib/studio-time.ts` (`formatTime`, `formatWhen`, `studioDayUtcRange`). Never call `toLocaleString` without `timeZone`.
- Every store read-modify-write goes through a CAS loop like `mutateCheckin` (3 attempts, throw `Concurrent update` after). Never delete waiver, RSVP, checkin, or incident records.
- Agreement text (`legalSections`) and addendum text: any edit = version bump + archive file in the same commit; hashes in `docs/waiver-versions/hashes.json` must match or CI fails.
- Never pre-check a legal checkbox; never bundle the release checkbox with photo consent or the addendum.
- Copy: brand is **Hometown Studio** (one word "Hometown"). Entity: Goodell Holdings LLC.
- Late pickup: **$1 per minute after a 15-minute grace**. Drop-off cap **12 minors**, **≥2 adult staff**.
- SMS/email failures never block a custody action or a signature — log and surface `smsFailed`/`emailed:false`.
- Tests: vitest; API tests mock stores with `vi.mock('@lib/...')` as in `tests/api/waiver-sign.test.ts`; lib tests use the fs fallback (`tests/setup.ts` sets `BLOB_STORE_FS_DIR`). Run `npx vitest run <file>` per task; the full suite must stay green (`npm test`).
- Commit after every task with a conventional message; push `dev` after each phase.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/lib/staff-auth.ts` | signed identity cookie, `staffAuthorized(): StaffMember\|null` | 1 |
| `src/lib/staff-directory.ts` (new) | `listStaff()` from Square Team + fallback | 1 |
| `src/pages/api/staff/login.json.ts`, `pick.json.ts` (new) | two-step login | 1 |
| `src/lib/event-meta.ts` (new) | `EventMeta` store, CAS | 2 |
| `src/lib/events.ts` | `StudioEvent`, `getEvent`, `listEvents` | 2 |
| `src/pages/api/staff/event-meta.json.ts` (new) | drop-off/days toggle | 2 |
| `src/lib/rsvp-store.ts` (new) | `RsvpRecord` store | 3 |
| `src/lib/waiver-store.ts` | index entries `{waiverId,rsvpId}`, name index, `normalizeAuthorizedPickup` | 3, 4, 6 |
| `src/pages/api/waiver/sign.json.ts` | fresh vs returning; addendum; copy email; fail-closed | 3, 5, 6, 9 |
| `src/config/waiver-content.ts` | `dropOffAddendum`, `serializeAddendum`, `substantiveSince`, `counselNotes`, copy | 5, 6 |
| `docs/waiver-versions/hashes.json`, `addendum-a1.md` | archive + guard | 5 |
| `src/components/waiver/WaiverFlow.tsx` | form changes, addendum card, kiosk, OTP step | 5, 6, 8, 12 |
| `src/lib/checkin-store.ts` | `days`, `by`, attempts/lock, `releasedTo`, cap 2000 | 7 |
| `src/pages/api/staff/checkin.json.ts` | per-day actions, pickup rules, override, SMS | 7, 10 |
| `src/pages/api/staff/roster.json.ts`, `coverage.json.ts`, `events.json.ts` (new), `open-studio.json.ts` (new), `history.json.ts` (new), `incident.json.ts` (new) | staff APIs | 4, 7, 11, 13 |
| `src/components/staff/StaffConsole.tsx` → `Today.tsx`, `DoorSearch.tsx`, `EventList.tsx`, `Roster.tsx`, `HouseholdCard.tsx`, `PickupPanel.tsx`, `EventSettingsSheet.tsx`, `IncidentSheet.tsx`, `HistorySheet.tsx`, `StaffHeader.tsx` | console UI | 1, 2, 4, 7, 10, 11, 13 |
| `src/pages/staff/print.astro`, `incident-print.astro` (new) | print views | 7, 11 |
| `src/lib/incident-store.ts` (new) | incidents | 11 |
| `src/lib/email.ts` | `sendAgreementCopyEmail`, `sendIncidentEmail` | 9, 11 |
| `src/lib/otp-store.ts` (new), `src/pages/api/waiver/verify.json.ts` (new) | lookup OTP | 12 |
| `src/lib/archive-export.ts` (new), `netlify/functions/archive-records.ts` (new), `scripts/archive-records.ts` (new) | weekly archive | 13 |
| `scripts/gen-waiver-doc.ts` (new), `docs/WAIVER.md`, `docs/CREW-OPERATIONS.md`, `docs/door-card.md`, `docs/NEEDS-FROM-KADEN.md` | docs | 14 |

## Shared interfaces (all tasks use these exact names)

```ts
// src/lib/staff-auth.ts
export interface StaffMember { id: string; name: string; role: 'owner' | 'crew' }
export function staffAuthorized(request: Request): StaffMember | null
export function staffCookie(member: StaffMember): string
export type By = { id: string; name: string }

// src/lib/events.ts
export type EventKind = 'party' | 'workshop' | 'program'
export interface StudioEvent { kind: EventKind; id: string; title: string; startIso: string; days: string[]; dropOff: boolean; seats?: number }
export async function getEvent(kind: EventKind, id: string): Promise<StudioEvent | null>
export async function listEvents(range: { from: string; to: string }): Promise<StudioEvent[]>   // YYYY-MM-DD inclusive, studio TZ
export function eventKey(kind: EventKind, id: string): string   // `${kind}:${id}` — the checkin/rsvp "event id"; for parties this MUST stay the bare bookingId (legacy keys)

// src/lib/event-meta.ts
export interface EventMeta { dropOff: boolean; days: string[] | null; updatedAt: string; by: By; history: { at: string; by: By; dropOff: boolean; days: string[] | null }[] }
export async function getEventMeta(kind: EventKind, id: string): Promise<EventMeta | null>
export async function setEventMeta(kind: EventKind, id: string, patch: { dropOff?: boolean; days?: string[] | null }, by: By): Promise<EventMeta>

// src/lib/rsvp-store.ts
export interface RsvpRecord { id: string; waiverId: string; event: { kind: EventKind; id: string }; ref?: { bookingId?: string }; attending: string[] | null; responsibleAdult: string | null; addendumVersion: string | null; addendumSha256: string | null; at: string; firstAt: string; ip: string | null; userAgent: string | null; by?: By }
export async function upsertRsvp(r: Omit<RsvpRecord,'id'|'firstAt'> & { id?: string }): Promise<RsvpRecord>
export async function getRsvp(kind: EventKind, eventId: string, waiverId: string): Promise<RsvpRecord | null>
export async function listRsvpsByEvent(kind: EventKind, eventId: string): Promise<RsvpRecord[]>

// src/lib/checkin-store.ts (after Task 7)
export interface CheckinEvent { at: string; day?: string; action: 'checkin'|'undo-checkin'|'pickup'|'pickup-denied'|'undo-pickup'|'reissue-code'|'set-pickup'|'code-sent'|'pickup-override'|'locked'|'incident'|'open-studio'; personIds: string[]; by?: By; collectedBy?: string; idChecked?: boolean; reason?: string; note?: string; incidentId?: string }
export interface CheckinState { expected: string[] | null; days: Record<string, { presence: Record<string, PersonPresence> }>; pickupCodeHash: string | null; codeAttempts: number; lockedAt: string | null; confirmedPickup: { name: string; phone?: string }[]; notAuthorized: string; releasedTo: Record<string, { name: string; at: string; day: string }>; events: CheckinEvent[] }
export async function mutateCheckin(eventId: string, recordId: string, fn: (s: CheckinState) => void | Promise<void>): Promise<CheckinState>   // eventId = eventKey()

// src/lib/waiver-store.ts additions
export interface AuthorizedPickup { name: string; phone: string }
export function normalizeAuthorizedPickup(v: unknown): AuthorizedPickup[]
export interface EventIndexEntry { waiverId: string; rsvpId: string | null }
export async function lookupHouseholdsByName(lastName: string): Promise<HouseholdOnFile[]>

// src/config/waiver-content.ts additions
export const substantiveSince = 'v1'
export const dropOffAddendum: { version: 'a1'; title: string; sections: { heading: string; body: string[] }[] }
export function serializeAddendum(): string
export const counselNotes: string[]
```

---

## Phase A — foundations (Tasks 1–2, sequential)

### Task 1: Staff identity (HOM-206)

**Files:** Modify `src/lib/staff-auth.ts`; Create `src/lib/staff-directory.ts`, `src/pages/api/staff/pick.json.ts`, `public/robots.txt`, `src/components/staff/StaffHeader.tsx`, `src/components/staff/PickStaff.tsx`; Modify `src/pages/api/staff/login.json.ts`, `src/pages/api/staff/{checkin,kit-cancel,kit-return,kit-remind,party}.json.ts`, `src/lib/checkin-store.ts` (add `by?: By` to `CheckinEvent`), `src/lib/kit-store.ts` (`byStaff?` → `by?: By`), `src/components/staff/StaffConsole.tsx`, `src/pages/staff.astro`. Tests: `tests/lib/staff-auth.test.ts` (new), `tests/lib/staff-directory.test.ts` (new), update `tests/api/kit-staff.test.ts` mocks (`staffAuthorized` now returns an object).

**Interfaces:** Produces `StaffMember`, `By`, `staffAuthorized(): StaffMember|null`, `staffCookie(member)`, `listStaff()`.

- [ ] **Step 1: Failing tests for the signed cookie**

```ts
// tests/lib/staff-auth.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { staffCookie, staffAuthorized, checkPasscode } from '@lib/staff-auth'
const member = { id: 'kaden', name: 'Kaden', role: 'owner' as const }
const req = (cookie: string) => new Request('http://x/', { headers: { cookie } })
describe('staff-auth', () => {
  beforeEach(() => { process.env.STAFF_PASSCODE = 'secret-123' })
  it('round-trips a signed cookie', () => {
    const c = staffCookie(member).split(';')[0]
    expect(staffAuthorized(req(c))).toEqual(member)
  })
  it('rejects a tampered payload', () => {
    const c = staffCookie(member).split(';')[0]
    const [k, v] = c.split('='); const [payload, sig] = v.split('.')
    const bad = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), role: 'crew', name: 'Mallory' })).toString('base64url')
    expect(staffAuthorized(req(`${k}=${bad}.${sig}`))).toBeNull()
  })
  it('rejects a tampered signature', () => {
    const c = staffCookie(member).split(';')[0]
    expect(staffAuthorized(req(c.slice(0, -2) + 'zz'))).toBeNull()
  })
  it('rejects an expired cookie', () => {
    const c = staffCookie(member, Date.now() - 13 * 3600 * 1000).split(';')[0]
    expect(staffAuthorized(req(c))).toBeNull()
  })
  it('fails closed without a passcode', () => {
    const c = staffCookie(member).split(';')[0]
    process.env.STAFF_PASSCODE = ''
    expect(staffAuthorized(req(c))).toBeNull()
    expect(checkPasscode('anything')).toBe(false)
  })
  it('compares the passcode in constant time (no throw on length mismatch)', () => {
    expect(checkPasscode('x')).toBe(false); expect(checkPasscode('secret-123')).toBe(true)
  })
})
```

- [ ] **Step 2: Run** `npx vitest run tests/lib/staff-auth.test.ts` → FAIL (`staffCookie` takes no member).

- [ ] **Step 3: Implement `staff-auth.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'
const COOKIE = 'hg_staff'; const MAX_AGE = 12 * 60 * 60
export interface StaffMember { id: string; name: string; role: 'owner' | 'crew' }
export type By = { id: string; name: string }
function passcode(): string { const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}; return env.STAFF_PASSCODE || process.env.STAFF_PASSCODE || '' }
const key = () => passcode() + ':cookie'
const sign = (payload: string) => createHmac('sha256', key()).update(payload).digest('base64url')
const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }
export function passcodeConfigured(): boolean { return !!passcode() }
export function checkPasscode(input: string): boolean { const p = passcode(); return !!p && safeEq(input, p) }
export function staffCookie(member: StaffMember, iat = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...member, iat })).toString('base64url')
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`
}
export function clearStaffCookie(): string { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` }
export function staffAuthorized(request: Request): StaffMember | null {
  if (!passcodeConfigured()) return null
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|; )${COOKIE}=([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)`))
  if (!m) return null
  const [, payload, sig] = m
  if (!safeEq(sig, sign(payload))) return null
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (typeof p.iat !== 'number' || Date.now() - p.iat > MAX_AGE * 1000) return null
    if (!p.id || !p.name || (p.role !== 'owner' && p.role !== 'crew')) return null
    return { id: String(p.id), name: String(p.name), role: p.role }
  } catch { return null }
}
export const byOf = (m: StaffMember): By => ({ id: m.id, name: m.name })
```

Note: `Secure` breaks `http://localhost` in Safari but not Chrome; `netlify dev` serves http — add `; Secure` only when `import.meta.env.PROD`.

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: `staff-directory.ts` + test**

```ts
// tests/lib/staff-directory.test.ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('@lib/square-client', () => ({ getSquareClient: () => ({ teamMembers: { search: vi.fn().mockResolvedValue({ teamMembers: [
  { id: 'TM1', givenName: 'Kaden', familyName: 'Goodell', status: 'ACTIVE', isOwner: true },
  { id: 'TM2', givenName: 'Emma', familyName: 'R', status: 'ACTIVE', isOwner: false },
  { id: 'TM3', givenName: 'Gone', familyName: 'Person', status: 'INACTIVE' } ] }) } }) }))
import { listStaff, _resetStaffCache } from '@lib/staff-directory'
describe('listStaff', () => {
  it('maps active Square members; owners flagged', async () => {
    _resetStaffCache()
    expect(await listStaff()).toEqual([{ id: 'TM1', name: 'Kaden', role: 'owner' }, { id: 'TM2', name: 'Emma', role: 'crew' }])
  })
})
```

Locate the real Square client factory (`grep -rn "teamMembers\|new SquareClient\|createSquareClient" src/lib src/config`) and mock that module path instead of `@lib/square-client` if it differs. Implementation: search `{ query: { filter: { status: 'ACTIVE' } } }`, map `givenName` → `name` (append family initial if two members share a given name), `isOwner` → role, cache 10 min, fallback `[{id:'kaden',name:'Kaden',role:'owner'},{id:'catherine',name:'Catherine',role:'owner'}]` on error/empty with `logger.warn`.

- [ ] **Step 6: Endpoints.** `login.json.ts`: on valid passcode return `{ data: { staff: await listStaff() } }` (no cookie). `pick.json.ts`: `{ passcode, staffId }` → `checkPasscode` + find in `listStaff()` → `Set-Cookie: staffCookie(member)` → `{ data: { staff: member } }`. Keep the 5/5min limiter on both. Every other `/api/staff/*` endpoint: `const staff = staffAuthorized(request); if (!staff) 401` and pass `byOf(staff)` into event pushes (`state.events.push({ ..., by })`). Add `by?: By` to `CheckinEvent` and `KitEvent`.

- [ ] **Step 7: Console.** New `PickStaff.tsx` ("Who's on the iPad?" grid of buttons) and `StaffHeader.tsx` (`{title} · {staff.name} [Switch] [🚑 Incident (disabled until Task 11)] [Kits] [Log out]`). `StaffConsole.tsx` phases: `'checking'|'login'|'pick'|'today'|'roster'|'kits'` — for now `'today'` renders the old parties list (Task 4 replaces it). Keep the passcode in a `useRef` for Switch. Add `<meta name="robots" content="noindex,nofollow">` to `staff.astro`; create `public/robots.txt`:

```
User-agent: *
Disallow: /staff
Disallow: /api/
```

- [ ] **Step 8: Run** `npm test` → green (fix kit-staff mocks to return `{id:'t',name:'Test',role:'crew'}`). **Commit** `feat(staff): signed identity cookie, Square Team picker, by on every custody event (HOM-206)`.

### Task 2: Event model + event-meta (HOM-207)

**Files:** Create `src/lib/event-meta.ts`, `src/pages/api/staff/event-meta.json.ts`, `src/components/staff/EventSettingsSheet.tsx`; Modify `src/lib/events.ts`, `src/pages/api/staff/party.json.ts` (delete if only the toggle), `src/pages/api/waiver/sign.json.ts` (`validateParty` → `validateEvent(kind,id)` using `getEvent`), `src/pages/waiver.astro` (resolve `?workshop=`), `src/components/staff/StaffConsole.tsx` (gear → sheet). Tests: `tests/lib/event-meta.test.ts`, `tests/lib/events.test.ts` (new).

**Interfaces:** Produces `EventKind`, `StudioEvent{days}`, `getEvent`, `listEvents`, `eventKey`, `getEventMeta`, `setEventMeta`.

- [ ] **Step 1: Failing tests**

```ts
// tests/lib/event-meta.test.ts
import { describe, it, expect } from 'vitest'
import { getEventMeta, setEventMeta } from '@lib/event-meta'
const by = { id: 'k', name: 'Kaden' }
describe('event-meta', () => {
  it('returns null when unset, then the merged patch with history', async () => {
    const id = 'w_' + Date.now()
    expect(await getEventMeta('workshop', id)).toBeNull()
    const m = await setEventMeta('workshop', id, { dropOff: true }, by)
    expect(m.dropOff).toBe(true); expect(m.days).toBeNull(); expect(m.history).toHaveLength(1); expect(m.history[0].by).toEqual(by)
    const m2 = await setEventMeta('workshop', id, { days: ['2026-10-19', '2026-10-20'] }, by)
    expect(m2.dropOff).toBe(true); expect(m2.days).toEqual(['2026-10-19', '2026-10-20']); expect(m2.history).toHaveLength(2)
  })
  it('caps history at 50', async () => {
    const id = 'w_cap_' + Date.now()
    for (let i = 0; i < 55; i++) await setEventMeta('party', id, { dropOff: i % 2 === 0 }, by)
    expect((await getEventMeta('party', id))!.history).toHaveLength(50)
  })
})
```

```ts
// tests/lib/events.test.ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('@lib/party-store', () => ({ getPartyRecord: vi.fn(async (id: string) => id === 'p1' ? { bookingId: 'p1', title: 'Rivera Party', craftName: 'Slime', startIso: '2026-10-20T15:00:00.000Z', dropOff: true } : null), listParties: vi.fn(async () => [{ bookingId: 'p1', title: 'Rivera Party', craftName: 'Slime', startIso: '2026-10-20T15:00:00.000Z', dropOff: true }]) }))
vi.mock('@config/providers', () => ({ providers: { workshop: { listWorkshops: vi.fn(async () => [{ scheduleId: 'cs1', name: 'Macramé', startAt: '2026-10-21T04:30:00.000Z', seatsAvailable: 8 }]) } } }))
vi.mock('@lib/event-meta', () => ({ getEventMeta: vi.fn(async (kind: string, id: string) => id === 'cs1' ? { dropOff: true, days: ['2026-10-20', '2026-10-21', '2026-10-22'], updatedAt: '', by: { id: 'k', name: 'K' }, history: [] } : null) }))
import { getEvent, listEvents, eventKey } from '@lib/events'
describe('events', () => {
  it('party falls back to the record dropOff and derives days in studio TZ', async () => {
    const e = await getEvent('party', 'p1'); expect(e).toMatchObject({ kind: 'party', dropOff: true, days: ['2026-10-20'] })
  })
  it('workshop merges meta (dropOff, multi-day) and is listed on each of its days', async () => {
    const e = await getEvent('workshop', 'cs1'); expect(e).toMatchObject({ title: 'Macramé', dropOff: true, days: ['2026-10-20', '2026-10-21', '2026-10-22'] })
    expect((await listEvents({ from: '2026-10-22', to: '2026-10-22' })).map(x => x.id)).toEqual(['cs1'])
    expect((await listEvents({ from: '2026-10-20', to: '2026-10-20' })).map(x => x.id).sort()).toEqual(['cs1', 'p1'])
  })
  it('a 11:30pm UTC start is the previous studio day', async () => {
    // 2026-10-21T04:30Z = Oct 20 11:30pm CDT
    const e = await getEvent('workshop', 'cs1'); expect(e!.startIso).toBe('2026-10-21T04:30:00.000Z')
  })
  it('eventKey keeps party ids bare (legacy) and namespaces the rest', () => {
    expect(eventKey('party', 'p1')).toBe('p1'); expect(eventKey('workshop', 'cs1')).toBe('workshop:cs1')
  })
})
```

- [ ] **Step 2: Run** both → FAIL.
- [ ] **Step 3: Implement.** `event-meta.ts` with `makeKvStore('event-meta','event-meta')`, key `event-meta-{kind}:{id}`, CAS loop copied from `mutateCheckin` (getWithMeta → mutate → setIfMatch, 3 tries). `events.ts`: `studioDate(iso)` helper = `new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso))`; workshop list cached 60 s (`let cache:{at:number,list}`); `listEvents` = parties (`listParties()`) + workshops, merged with meta, filtered by `days.some(d => d>=from && d<=to)`, sorted by `startIso`. `eventKey('party',id)===id`. Keep `getEvent('program')` → null.
- [ ] **Step 4: Endpoint** `event-meta.json.ts`: staff-authed; validate `days` (`/^\d{4}-\d{2}-\d{2}$/`, ≤14, sorted+deduped, or `null`); `setEventMeta(kind,id,patch,byOf(staff))`; return `{ data: await getEvent(kind,id) }`. Delete `party.json.ts` if it only toggled drop-off (check `grep -rn "staff/party.json" src`).
- [ ] **Step 5: `sign.json.ts`** — replace `validateParty(partyId, now)` with `validateEvent(kind, id, now)`: `getEvent` → 404 `We couldn't find that event link.` / 410 `That event has already happened.` (any day < today-1) / **503 on throw** (fail closed, HOM-219 M10 done here) → returns `{ event }`. Callers pass `kind = partyId ? 'party' : 'workshop'`. `waiver.astro`: resolve `?workshop=` with the same 4 outcomes and pass `dropOff={event.dropOff}` + `eventTitle`.
- [ ] **Step 6: `EventSettingsSheet.tsx`** — props `{ event, onSaved }`; drop-off toggle with the confirm dialog copy from HOM-207 (use the existing in-app dialog pattern — no `window.confirm`); day chips with an `<input type="date">` "+ Add day"; "Last changed by {by.name}, {formatWhen(updatedAt)}". Wire a ⚙ button in the roster header.
- [ ] **Step 7: Run** `npm test` → green. **Commit** `feat(events): unified event model, event-meta overlay, drop-off/days settings sheet (HOM-207)`.

## Phase B — signatures, RSVPs, form (Tasks 3, 5, 6 sequential; Task 4 can run in parallel with 3)

### Task 3: RSVP records (HOM-210)

**Files:** Create `src/lib/rsvp-store.ts`; Modify `src/lib/waiver-store.ts` (`EventIndexEntry`, `upsertWaiverInEventIndex(kind,id,{waiverId,rsvpId})`, legacy read), `src/pages/api/waiver/sign.json.ts`, `src/pages/api/waiver/lookup.json.ts` (`mustResign`), `src/pages/api/staff/roster.json.ts`, `src/pages/api/party/roster.json.ts`, `src/components/waiver/WaiverFlow.tsx` (returning line + mustResign screen), `src/components/workshops/WorkshopBookingModal.tsx` (`?workshop=${classScheduleId}&booking=${bookingId}` — `classScheduleId` is already in modal state; confirm with `grep -n classScheduleId`), `src/config/waiver-content.ts` (`substantiveSince`), `docs/waiver-versions/README.md`. Tests: `tests/lib/rsvp-store.test.ts` (new), `tests/api/waiver-sign.test.ts` (modify), `tests/lib/waiver-store.test.ts` (modify).

- [ ] **Step 1: Failing tests**

```ts
// tests/lib/rsvp-store.test.ts
import { describe, it, expect } from 'vitest'
import { upsertRsvp, getRsvp, listRsvpsByEvent } from '@lib/rsvp-store'
const base = { waiverId: 'wvr_a', event: { kind: 'workshop' as const, id: 'cs_' + Date.now() }, attending: ['adult', 'child:0'], responsibleAdult: null, addendumVersion: null, addendumSha256: null, at: '2026-10-01T00:00:00.000Z', ip: null, userAgent: null }
describe('rsvp-store', () => {
  it('upserts one RSVP per household per event, keeping firstAt', async () => {
    const a = await upsertRsvp(base); expect(a.id).toMatch(/^rsv_/); expect(a.firstAt).toBe(base.at)
    const b = await upsertRsvp({ ...base, at: '2026-10-02T00:00:00.000Z', attending: ['adult'] })
    expect(b.firstAt).toBe(base.at); expect(b.attending).toEqual(['adult'])
    expect((await listRsvpsByEvent('workshop', base.event.id)).length).toBe(1)
    expect((await getRsvp('workshop', base.event.id, 'wvr_a'))!.id).toBe(b.id)
  })
})
```

In `tests/api/waiver-sign.test.ts` add: reuse path → `persistWaiver` **not** called and `upsertRsvp` called with `{ waiverId: 'wvr_src', attending, responsibleAdult }`; fresh party path → both called; `substantiveSince` newer than the source record's version → 409 `{ mustResign: true }`; workshop context → `event.kind==='workshop'`, `ref.bookingId` stored.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `rsvp-store.ts` (store `rsvps`, key `rsvp-{kind}:{eventId}-{waiverId}`, `listRsvpsByEvent` via the event index in `waiver-store` — the index entry now stores `rsvpId`; `firstAt` preserved on upsert). `waiver-store.ts`: index entries `{waiverId, rsvpId}`; `readIndexEntries()` accepts legacy string or `{recordId}` → `{waiverId, rsvpId:null}`; `listWaiversByEvent` unchanged in behavior. `sign.json.ts`: fresh in context → `persistWaiver` → `upsertRsvp` → index; fresh no-context → `persistWaiver` only; `handleReuse` → RSVP only + `recordExpected`; version compare `compareVersions('v2','v1')` (numeric after `v`) with `substantiveSince` → 409 `{ error: 'We've updated the agreement — please read and sign again.', mustResign: true }`. `lookup.json.ts` returns `mustResign:true, firstName` (no token) in that case. `WaiverFlow.tsx`: on `mustResign` show the notice + form prefilled name/email/phone only; returning screen adds *"Your agreement signed {date} still covers everyone here."*
- [ ] **Step 4: Rosters** join: for each index entry load waiver (+ rsvp if `rsvpId`), `attending = rsvp?.attending ?? legacyExpected`, `responsibleAdult = rsvp?.responsibleAdult ?? waiver.responsibleAdult`.
- [ ] **Step 5: `npm test`** green. **Commit** `feat(waiver): RSVP records replace cloned signatures; mustResign on substantive bumps; workshop signatures attach to the class (HOM-210)`.

### Task 4: Today screen + door check + kiosk (HOM-208, HOM-209)

**Files:** Create `src/components/staff/Today.tsx`, `DoorSearch.tsx`, `EventList.tsx`, `QrModal.tsx`, `src/pages/api/staff/events.json.ts`, `src/pages/api/staff/open-studio.json.ts`, `src/lib/open-studio-store.ts`, `src/lib/safe-return.ts`, `scripts/backfill-name-index.ts`; Modify `src/pages/api/staff/coverage.json.ts`, `src/lib/waiver-store.ts` (name index + `lookupHouseholdsByName`), `src/components/staff/StaffConsole.tsx`, `src/pages/waiver.astro`, `src/components/waiver/WaiverFlow.tsx` (kiosk). `npm i qrcode` (+ `@types/qrcode`). Tests: `tests/api/staff-coverage.test.ts`, `tests/api/staff-events.test.ts`, `tests/lib/safe-return.test.ts` (new), `tests/lib/waiver-store.test.ts` (name index).

- [ ] **Step 1: Failing tests** — `safe-return`: `safeReturnPath('/staff')==='/staff'`, `('//evil.com')==='/staff'`, `('https://evil')==='/staff'`, `(undefined)==='/staff'`. `waiver-store`: after `persistWaiver({adult:{lastName:'Rivera'}})`, `lookupHouseholdsByName('  rivera ')` returns it; `'RIVÉRA'` normalizes to the same key (strip diacritics via `normalize('NFD').replace(/\p{M}/gu,'')`). `staff-coverage`: `?q=2565550142` → phone path; `?q=a@b.co` → email; `?q=rivera` → array; response has `signedAt, agreementVersion, validUntil, covered, kids[{name,allergies}], adultAllergies, photoConsent`; unknown → `{ data: { households: [] } }`; unauthenticated → 401. `staff-events`: `?date=2026-10-20` returns `listEvents({from,to})` result with `rsvpCount` and `hereNow` per event (rsvpCount from `listRsvpsByEvent`, hereNow from checkin states for that day).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** stores/endpoints. `open-studio-store.ts`: key `open-studio-{YYYY-MM-DD}` → `Record<recordId,{personIds,at,by}>`; `open-studio.json.ts` POST `{recordId, personIds}` idempotent; GET `?date=` count. `coverage.json.ts` per HOM-208 §2 (return `openStudioToday`).
- [ ] **Step 4: UI.** `Today.tsx` = `DoorSearch` (debounce 250 ms; result states with the exact wording in HOM-208 §3; "Check in to Open Studio" with person toggles) + `EventList` (date stepper ‹ › ; rows per HOM-208 §6; tap → `onOpenRoster({kind,id})`) + "All upcoming parties" link. `QrModal.tsx` renders `await QRCode.toString(url,{type:'svg'})` inline. `StaffConsole` default phase `today`; roster phase takes `{kind,id}` (Task 7 completes the roster; until then pass `kind==='party'` through the old roster and show *"Workshop rosters land with the next update"* for others).
- [ ] **Step 5: Kiosk.** `waiver.astro`: `kiosk = url.searchParams.get('kiosk')==='1'`, `returnTo = safeReturnPath(url.searchParams.get('return'))`, `noindex` meta when kiosk. `WaiverFlow`: prop `kiosk`, start on form, top bar copy, done screen copy per HOM-209, 20 s timer → `history.replaceState(null,'',returnTo); location.replace(returnTo)`, `autoComplete="off"` on the `<form>`. Today's "Sign on this iPad" → `location.assign('/waiver?kiosk=1&return=/staff')`; Today re-runs the last query from `sessionStorage.hg_lastDoorQuery` on mount (try/catch).
- [ ] **Step 6: Backfill script** iterates `waivers` store, writes name-index entries (idempotent). Run it once against dev/prod after deploy (note in NEEDS-FROM-KADEN? No — Kaden gave autonomy; run it and record in the brief).
- [ ] **Step 7: `npm test`** green; **manual check in Chrome** at 768px and 390px (`npm run dev`, `/staff`). **Commit** `feat(staff): Today screen — door check, open-studio check-in, today's events, QR + kiosk mode (HOM-208, HOM-209)`.

### Task 5: Drop-off addendum (HOM-211)

**Files:** Modify `src/config/waiver-content.ts` (`dropOffAddendum`, `serializeAddendum`, `counselNotes`, form copy `addendumCheckboxLabel`), `src/components/waiver/WaiverFlow.tsx`, `src/pages/api/waiver/sign.json.ts`, `docs/waiver-versions/README.md`, `docs/CREW-OPERATIONS.md`; Create `docs/waiver-versions/addendum-a1.md`, `docs/waiver-versions/hashes.json`, `tests/config/waiver-hashes.test.ts`.

- [ ] **Step 1: Failing test**

```ts
// tests/config/waiver-hashes.test.ts
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { serializeAgreement, serializeAddendum, waiverContent, dropOffAddendum } from '@config/waiver-content'
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const hashes = JSON.parse(readFileSync('docs/waiver-versions/hashes.json', 'utf8'))
describe('agreement text is versioned', () => {
  it('current agreement hash matches the archive manifest', () => { expect(sha(serializeAgreement())).toBe(hashes.agreement[waiverContent.version]) })
  it('current addendum hash matches the archive manifest', () => { expect(sha(serializeAddendum())).toBe(hashes.addendum[dropOffAddendum.version]) })
  it('archive files exist for the current versions', () => {
    expect(() => readFileSync(`docs/waiver-versions/${waiverContent.version}.md`)).not.toThrow()
    expect(() => readFileSync(`docs/waiver-versions/addendum-${dropOffAddendum.version}.md`)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run** → FAIL. **Step 3:** add `dropOffAddendum` with the exact HOM-211 text (7 sections incl. preamble), `serializeAddendum()` mirroring `serializeAgreement()`, write `addendum-a1.md`, compute both hashes (`npx tsx -e`) into `hashes.json` `{ "agreement": { "v2": "…" }, "addendum": { "a1": "…" } }`. README: addendum bump rule.
- [ ] **Step 4: Form + server.** `WaiverFlow` prop `dropOff`: render the addendum card after the agreement card (same scroll box; heading `dropOffAddendum.title`; checkbox label from HOM-211 §3; state `agreeAddendum`), on both fresh and returning paths; add to `missing[]`. `sign.json.ts`: if `event.dropOff && minorsAttending && body.agreeAddendum !== true` → 400 copy from HOM-211 §4; write `addendumVersion`/`addendumSha256` on the RSVP. Tests in `waiver-sign.test.ts`: 4 cases from HOM-211.
- [ ] **Step 5: `npm test`** green; **Commit** `feat(waiver): Drop-off Program Addendum a1 — versioned, hashed, second checkbox on drop-off registrations (HOM-211)`.

### Task 6: Form changes (HOM-212)

**Files:** Modify `src/components/waiver/WaiverFlow.tsx`, `src/config/waiver-content.ts` (labels from HOM-212), `src/lib/waiver-store.ts` (`AuthorizedPickup`, `normalizeAuthorizedPickup`, record fields `notAuthorized`, `minors[].medications`), `src/pages/api/waiver/sign.json.ts`, `src/pages/api/staff/checkin.json.ts` (use `normalizeAuthorizedPickup`), `src/pages/api/staff/roster.json.ts` (expose pickup/notAuthorized/medications), `src/components/staff/StaffConsole.tsx` (card lines). Create `src/lib/dob-input.ts` (`maskDob(raw)`, `dobToIso('MM/DD/YYYY')`).

- [ ] **Step 1: Failing tests** — `normalizeAuthorizedPickup('Grandma Rivera, Uncle Joe and Aunt Sue')` → 3 entries with `phone:''`; array of `{name,phone}` passes through trimmed; `null`/`123` → `[]`. `dobToIso('01/15/2008')==='2008-01-15'`; `maskDob('0115')==='01/15'`; `dobToIso('13/40/2000')===null`. Sign endpoint: >3 rows → 400; row with 1-char name → 400; `notAuthorized` stored; `None` preserved; medications stored.
- [ ] **Step 2–4:** implement per HOM-212 (fields shown only when `dropOff`; "None" chip; underage inline note `form.underageNote` when `yearsBetween(dob) < 19`; masked adult DOB). Card: *name · phone* lines; `⛔ May NOT collect:` red block; medications beside allergies.
- [ ] **Step 5: `npm test`** green; **Commit** `feat(waiver): structured pickup + may-not-collect, allergies None, medications, masked DOB, 19+ note (HOM-212)`.

## Phase C — roster & pickup (Tasks 7, 10 sequential)

### Task 7: Multi-day roster + print (HOM-213)

**Files:** Modify `src/lib/checkin-store.ts`, `src/pages/api/staff/checkin.json.ts`, `src/pages/api/staff/roster.json.ts`, `src/components/staff/StaffConsole.tsx` → extract `Roster.tsx`, `HouseholdCard.tsx`; Create `src/pages/staff/print.astro`. Tests: `tests/lib/checkin-events.test.ts` (extend), `tests/api/staff-roster.test.ts` (new).

- [ ] **Step 1: Failing tests** (extend `checkin-events.test.ts`)

```ts
it('migrates legacy presence into days[firstDay] on read', () => {
  const s = normalize({ presence: { adult: { inAt: 'x', outAt: null } }, events: [] }, '2026-10-20')
  expect(s.days['2026-10-20'].presence.adult.inAt).toBe('x'); expect((s as any).presence).toBeUndefined()
})
it('keeps days independent', async () => {
  await mutateCheckin('workshop:cs1', 'wvr_1', s => { s.days['2026-10-20'] = { presence: { 'child:0': { inAt: 'a', outAt: null } } } })
  const s = await getCheckin('workshop:cs1', 'wvr_1'); expect(s.days['2026-10-21']).toBeUndefined()
})
it('childStillHere is per day', () => { /* build a state with child out on d1, in on d2; assert helper */ })
```

`normalize(raw, firstDay)` gets a second arg (callers pass `event.days[0]`). New helpers exported: `presenceOn(s, day)`, `childStillHere(s, day)`.

- [ ] **Step 2–3:** implement `days`, `day` on every action (default = today if in `event.days` else `event.days[0]`), code retirement only when `!childStillHere(s, day)` **and** it's the last event day (else keep the code for tomorrow), cap 2000. `roster.json.ts` accepts `kind,id,day` (+ `?party=` alias), returns `event`, per-household `signedAt, agreementVersion, validUntil, addendumVersion`, `capWarning: dropOff && childrenCheckedIn(day) > 12`.
- [ ] **Step 4: UI.** `Roster.tsx`: banner when `dropOff`; day segmented control when `days.length>1`; header `Day n of m`; ⚙ (Task 2 sheet), 🖨 → `/staff/print?kind&id&day`; cap badge. `HouseholdCard.tsx`: meta line *Signed {d} · {v} · valid to {d}* / red EXPIRED; *Addendum ✓* or *⚠ Addendum not signed* + **Send link** (POST `/api/staff/send-waiver-link.json {recordId, kind, id}` → Quo text with `/waiver?{kind}={id}`; add this tiny endpoint here).
- [ ] **Step 5: `print.astro`** — `staffAuthorized(Astro.request)` else 401; table per HOM-213 §4; `@media print { .no-print{display:none} }`.
- [ ] **Step 6: `npm test`** green; Chrome check; **Commit** `feat(roster): per-event rosters, multi-day attendance, drop-off banner, validity line, cap warning, print view (HOM-213)`.

### Task 10: Pickup completion (HOM-214)

**Files:** Modify `src/lib/checkin-store.ts` (`codeAttempts`, `lockedAt`, `releasedTo`, `confirmedPickup: AuthorizedPickup[]`, `notAuthorized`, new actions), `src/pages/api/staff/checkin.json.ts`, `src/lib/quo.ts` (`pickupCodeText`, `pickedUpText` builders); Create `src/components/staff/PickupPanel.tsx`, `tests/api/staff-checkin.test.ts`.

- [ ] **Step 1: Failing tests** (`tests/api/staff-checkin.test.ts`, mock `@lib/staff-auth` → member, `@lib/events` → drop-off workshop with days, `@lib/checkin-store` with an in-memory `mutateCheckin`, `@lib/waiver-store` → record with `authorizedPickup:[{name:'Grandma Rivera',phone:'2565550100'}]`, `notAuthorized:'Rick Smith'`, `adult.phone`, `@lib/quo` → `sendQuoText` spy):

```ts
const post = (body: any) => POST({ request: new Request('http://x', { method: 'POST', headers: { cookie: 'hg_staff=x.y' }, body: JSON.stringify(body) }) } as any)
it('checkin of a child on a drop-off event issues a code, texts it, logs code-sent with by', ...)      // sendQuoText called with adult phone; response.oneTimeCode 4 digits; events: checkin{by}, code-sent
it('pickup needs the code only for children on drop-off events', ...)                                  // adult without code → 200
it('wrong code increments attempts; 5th locks (423); locked ignores correct code', ...)
it('collectedBy must be a chip or the signer unless idChecked', ...)                                   // 'Stranger' + idChecked:false → 400 exact copy; idChecked:true → 200
it('may-not-collect name is refused on pickup and override', ...)                                      // 'rick smith' → 400, pickup-denied reason not-authorized
it('override releases without a code, clears the lock, logs reason + by', ...)
it('release texts the parent and records releasedTo per person and per day', ...)
it('SMS failure does not fail check-in; response.smsFailed=true', ...)
it('reissue-code requires a reason', ...)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** server rules exactly as HOM-214 §1–6 (`pickup` 423 on lock; `pickup-override` action; `set-pickup` structured). Message builders in `quo.ts`:

```ts
export const pickupCodeText = (title: string, code: string, kids: string[]) => `Hometown Studio pickup code for ${title}: ${code}. Whoever collects ${kids.join(' & ')} needs this code. Reply STOP to opt out.`
export const pickedUpText = (kids: string[], by: string, when: string) => `${kids.join(' & ')} picked up by ${by} at ${when} — Hometown Studio.`
```

- [ ] **Step 4: `PickupPanel.tsx`** per HOM-214 §7: chips, "Someone else…" + ID checkbox, code input with tries-left, **Check out (n)**, quiet **Override…** → sheet with the 3 radios + tap-to-call phone + red **Release without code**, locked state, **Re-send code** with reason prompt, per-row *✓ left {time} · {name}*. Non-drop-off unchanged.
- [ ] **Step 5: `npm test`** green; Chrome walk-through of the full drop-off flow on a local drop-off workshop; **Commit** `feat(pickup): SMS codes, authorized chips, ID checkbox, override with reason, lockout, pickup confirmation text (HOM-214)`.

## Phase D — emails, incident, lookup, archive (Tasks 9, 11, 12, 13 — 9 ∥ 11 ∥ 12, then 13)

### Task 9: Agreement copy email (HOM-216)

**Files:** Modify `src/lib/email.ts` (`sendAgreementCopyEmail`, `renderAgreementHtml/Text`), `src/pages/api/waiver/sign.json.ts`, `src/components/waiver/WaiverFlow.tsx` (confirmation copy), `src/pages/api/party/book.json.ts` + `src/pages/api/kits/order.json.ts` (one line). Tests: `tests/lib/email.test.ts` (new), `tests/api/waiver-sign.test.ts` (calls).

- [ ] **Step 1: Failing tests** — `buildAgreementCopy({record, addendum?, event?})` returns `{subject, html, text}`; subject variants; html contains every `legalSections[].heading`, each minor's first name, `validUntil` formatted, record id; addendum block only when passed. Sign endpoint: called once on fresh; not on returning w/o addendum; with addendum on returning drop-off; thrown error → still 200.
- [ ] **Step 2–3:** implement (pure builder + thin sender via `sendEmail`). Fire after `persistWaiver` with `.catch(log)`.
- [ ] **Step 4:** confirmation copy; confirmation-email line via `lookupHouseholdEntry(email)`.
- [ ] **Step 5:** `npm test` green; send one real email on dev; **Commit** `feat(waiver): email the signer a copy of the agreement and addendum (HOM-216)`.

### Task 11: Incident report (HOM-215)

**Files:** Create `src/lib/incident-store.ts`, `src/pages/api/staff/incident.json.ts`, `src/pages/api/staff/incidents.json.ts`, `src/components/staff/IncidentSheet.tsx`, `src/pages/staff/incident-print.astro`; Modify `src/lib/email.ts` (`sendIncidentEmail`), `src/config/site.config.ts` (`ownerEmails: ['kaden@ourhometownstudio.com','catherine@ourhometownstudio.com']` — verify Catherine's address in Workspace; fall back to contact@ if unsure and note in the brief), `src/lib/checkin-store.ts` (`incident` action), `StaffHeader.tsx` (enable 🚑), `Roster.tsx` ("Incidents (n)"), `docs/CREW-OPERATIONS.md`. Tests: `tests/lib/incident-store.test.ts`, `tests/api/staff-incident.test.ts`.

- [ ] **Step 1: Failing tests** — store create/get/listByEvent/listSince; endpoint: `what` < 10 chars → 400; valid → record saved, `mutateCheckin` called with `{action:'incident', incidentId, by}` when `who[].waiverId`; `sendEmail` called with both owners; email throw → 200 `emailed:false`; 401 unauthenticated.
- [ ] **Step 2–4:** implement per HOM-215 (sheet fields, success copy, print note). Draft persists in component state; dismiss asks to confirm (in-app dialog).
- [ ] **Step 5:** `npm test` green; Chrome check; **Commit** `feat(staff): incident reports — sheet on every screen, stored, logged, emailed, printable parent note (HOM-215)`.

### Task 12: Lookup hardening (HOM-218)

**Files:** Create `src/lib/otp-store.ts`, `src/pages/api/waiver/verify.json.ts`, `tests/api/waiver-lookup.test.ts`; Modify `src/pages/api/waiver/lookup.json.ts`, `src/lib/reuse-token.ts` (throw in PROD without secret), `src/components/waiver/WaiverFlow.tsx` (code step), `src/config/waiver-content.ts` (copy), `.env.example`, `docs/NEEDS-FROM-KADEN.md`.

- [ ] **Step 1: Failing tests** — lookup response has no `kids`/`reuseToken`/`recordId`, has `kidCount`, `needsCode`, `phoneHint` (last 2 digits); `sendQuoText` called with the **on-file** phone even when looked up by email; OTP stored hashed with 10-min expiry; `verify` correct → full payload + token, OTP deleted; wrong ×5 → OTP deleted, 429; expired → 410; resend >3 → 429; Quo throw → `{found:true, smsFailed:true}`. `reuse-token`: `PROD` + no secret → throws.
- [ ] **Step 2–3:** implement (`otps` store key `otp-{recordId}`; `verify.json.ts`; client 6-box input, "Send again" 60 s cooldown). Kiosk untouched.
- [ ] **Step 4:** `npm test` green; **Commit** `feat(waiver): lookup returns no kids' names; SMS one-time code gates returning RSVPs (HOM-218)`.

### Task 13: Archive + history (HOM-217)

**Files:** Create `src/lib/archive-export.ts`, `netlify/functions/archive-records.ts`, `scripts/archive-records.ts`, `src/pages/api/staff/history.json.ts`, `src/components/staff/HistorySheet.tsx`, `tests/lib/archive-export.test.ts`, `tests/api/staff-history.test.ts`; Modify `src/config/policy-content.ts` (Records paragraph), `docs/CREW-OPERATIONS.md` §7, store header comments. `npm i fflate`.

- [ ] **Step 1: Failing tests** — `exportAll([{name:'a',store},{name:'b',store}])` counts every key; `custodyCsv` header + one row per event, quotes escaped, `by.name` column; `history.json` returns `events` for `{kind,id,recordId}`; 401.
- [ ] **Step 2–3:** implement. Scheduled function: `export const config: Config = { schedule: '0 8 * * 0' }`; uses `getStore({name, consistency:'strong'})` from `@netlify/blobs`; zips with `fflate.zipSync`; nodemailer transport duplicated inline (functions can't import `src/`); `ARCHIVE_DRY_RUN=1` writes to `/tmp`; failure → "Archive FAILED" email. `scripts/archive-records.ts --out`.
- [ ] **Step 4:** `HistorySheet` from the card ("History"). Policy paragraph. Cap already 2000 (Task 7).
- [ ] **Step 5:** `npm test` green; `netlify functions:invoke archive-records` with dry run; **Commit** `feat(records): weekly self-archive (email + archive store), custody history sheet, never-delete rule (HOM-217)`.

## Phase E — docs (Task 14) and follow-up (Task 15, post-launch)

### Task 14: Docs regen + guard + small fixes (HOM-219)

**Files:** Create `scripts/gen-waiver-doc.ts`, `docs/kit-rental-terms-DRAFT.md`, `docs/door-card.md`; Modify `docs/WAIVER.md` (generated), `docs/NEEDS-FROM-KADEN.md`, `docs/CREW-OPERATIONS.md` §5, `src/config/waiver-content.ts` (`counselNotes`), `package.json` (`gen:waiver`), `tests/config/waiver-hashes.test.ts` (doc-equals-generator assertion).

- [ ] **Step 1:** extend the hash test: `readFileSync('docs/WAIVER.md','utf8') === generateWaiverDoc()` (export the generator from `scripts/gen-waiver-doc.ts` as a pure function in `src/lib/waiver-doc.ts`).
- [ ] **Step 2–4:** generator; move §6a out; rewrite NEEDS item 2 and add env notes; rewrite CREW-OPERATIONS §5 to the shipped flow (≤1 page, crew voice; keep onboarding gate/two-adult/cap/mandated-reporter verbatim); door card from the audit Appendix B with shipped button names.
- [ ] **Step 5:** `npm test` green; **Commit** `docs: generated WAIVER.md + hash guard, crew ops §5 matches the software, door card, stale items fixed (HOM-219)`.

### Task 15: Programs re-wire (HOM-220) — post-launch, not in this run

Leave `program` resolver returning null with a comment pointing at HOM-220.

---

## Verification (end of run)

1. `npm test` — all green; `npm run build` — clean.
2. `netlify dev` + Chrome: (a) sign fresh at `/waiver` → email received; (b) `/staff` → passcode → picker → Today → search that phone → GOOD TO GO → Check in to Open Studio; (c) flip a local workshop to drop-off → `/waiver?workshop=…` shows addendum → sign → roster shows Addendum ✓ → check in child → SMS code (Quo) → pickup with chip + code → confirmation SMS → History shows every event with `by`; (d) wrong code ×5 → locked → Override → released; (e) 🚑 from Today and from roster → email; (f) `/staff/print`; (g) kiosk sign → auto-return; (h) 390 px width, no horizontal scroll anywhere.
3. Push `dev` (free preview), then `git push origin dev:main` per the project's deploy convention; run `scripts/backfill-name-index.ts` against prod once.
4. Move HOM-206…219 to Done with a one-line comment each; write the final brief (deviations, decisions made without Kaden).

## Self-review notes
- Spec coverage: §1→T2, §2→T3, §3→T5+T6, §4→T1, §5→T4, §6→T7+T10, §7→T11, §8→T9+T13, §9→T12+T14 (M10 in T2), sequencing kept. ✔
- Interface names consistent: `eventKey`, `By`, `AuthorizedPickup`, `mutateCheckin(eventId, recordId)`, `dropOffAddendum.version 'a1'`. ✔
