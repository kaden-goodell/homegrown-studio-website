# Stage 3 — Staff Availability and Assignments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crew mark when they can and can't work and say "I'd like to work this" on a class or party; owners see availability, asks and assignments on every class session and party in /admin and assign with a tap (only /admin assigns); unstaffed events are flagged in the daily warnings; everyone gets a read-only calendar link for their phone (owners see everything, crew see only their own assignments). Nothing here touches Square Payroll, timecards or Square Bookings.

**Architecture:** A new domain folder `src/lib/staffing/` (pure rules, three small CAS stores, a reader that joins the shared studio schedule with staffing records, a pure ICS writer). The staffing unit is an **event key**: `ses:<sessionId>` for one session of our classes, `party:<partyId>` for a party (stage 2 `pty_…` or a legacy Square booking id), `legacy:<scheduleId>` for a Square class still running out. Times are never copied into staffing records; they are read from the schedule every time, so a moved class or party takes its staff with it. Crew routes live under `src/pages/api/staff/`, owner routes under `src/pages/api/admin/`, the feed at `src/pages/api/calendar/feed/[token].ics.ts`. Screens: a new `/staff` tab "My shifts", and the `/admin` More › Staff sheet (replacing the stage-1 preview) plus a Staff row on the class and party sheets.

**Tech Stack:** Astro SSR + React islands, TypeScript, Netlify Blobs via `makeKvStore` (CAS `getWithMeta` + `setIfMatch`), Square Team API (read only: `teamMembers.search`, already used by `src/lib/staff-directory.ts`), email via `src/lib/email.ts` `sendEmail`, texts via `src/lib/quo.ts` `sendQuoText` (both rerouted to Kaden on a namespaced preview by `src/lib/preview-outbound.ts`), vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-18-own-booking-system-design.md` — "Stage 3: staff availability and assignments", "Where things live", "Rules carried over", "Decisions (18 Oct)" ("Assigning staff is /admin only… crew never assign"). Conventions: `docs/superpowers/plans/2026-10-18-stage1-own-classes.md`. Admin design: `.superpowers/sdd/2026-10-18-stage1-own-classes/admin-mockup-D.html` sheet `staff` ("Who can work" grid, "Assign on a class") and shell rules `task-11b-common.md`. Precedents: rulings R1–R39 in `.superpowers/sdd/2026-10-18-stage1-own-classes/progress.md`.

**Depends on:** stage 1 complete (11b-A/B/C admin shell and sheets, Task 14 events.ts on our classes, Task 15 daily email, Task 17 E2E harness on `scripts/sandbox-e2e.ts` + `scripts/lib/sandbox-e2e/*`), and stage 2 Tasks 3–4 (`partyBusy` reads the party book, so `party:pty_…` keys exist). Start Task 1 only when `progress.md` shows those complete.

## What the code does today (ground truth, read 19 Oct)

- **Who is staff:** `src/lib/staff-directory.ts listStaff()` reads ACTIVE Square Team Members (`{id, name, role: 'owner' | 'crew'}`, `isOwner` → owner), cached 10 min; on any Square failure it returns a fallback of `{id:'kaden'}`, `{id:'catherine'}`. Ids are Square team member ids. Email and phone are not read.
- **Crew sign-in:** shared `STAFF_PASSCODE`, then "Who's on the iPad?" picks a person; `staffAuthorized(request)` returns `{id, name, role}` from a 12 h HMAC cookie. Anyone with the passcode can pick any name (no per-person PIN).
- **Owner sign-in:** `/admin` has its own `ADMIN_PASSCODE` cookie; who is acting comes from the `X-Admin-Who` header limited to `OWNERS = ['Catherine', 'Kaden']` (`src/lib/admin-who.ts`) — a **name**, not a team member id.
- **/staff tabs** (`src/components/staff/nav.tsx`): This week, Today, Upcoming, Calendar (read-only, `StaffCalendar.tsx` over `/api/staff/calendar.json` = `busyBetween` minus drafts), Kits, Gift cards. `WarningsPanel` shows `/api/staff/warnings.json` to the crew.
- **/admin More** (`src/components/admin/More.tsx`) has a `staff` row "Coming in stage 3"; `router.ts` already accepts `#more-staff`.
- **Schedule:** `busyBetween()` returns `Busy` with `kind` `class` (id = class id, `sessionId` = session), `legacy-class`, `party`, `cafe`, `blocked`, `closed`.
- **ICS:** `src/lib/party-share.ts buildIcs()` writes single-party invites (UID from start time, no folding of long lines, no cancelled status) — not reusable for a live feed.
- **Warnings:** `src/lib/warnings.ts` codes + `listWarnings`; the daily email (`/api/jobs/daily-warnings.json`) and the /staff panel both read it; `UNDATED_CODES` hold undated items.

## Global Constraints

- Branch `kaden/own-booking-system`. Never push `main` or `dev`. Prod push only on Kaden's go.
- **Only /admin assigns.** Every assign/unassign/needed-count write is behind `adminAuthorized`; no `/api/staff/*` route can change an assignment, and crew routes take the person from the cookie only (a `staffId` in the body is ignored).
- **Staff are never Square bookable resources.** No call to the Bookings API, team member booking profiles, `is_bookable`, or any Square write at all in this stage (memory: "new team members NEVER bookable"). The Team API is read only. The single exception is the sandbox seed (Task 10), which may create one sandbox team member and refuses unless `SQUARE_ENVIRONMENT=sandbox`.
- **Separate from payroll.** No hours, wages, timecards or shift totals. Assignments are who is on, not what is paid.
- Never cancel, move or refund anything from a staffing screen. A cancelled or moved event keeps its staffing record; owners are told, nothing is changed for them.
- Calendar feed tokens: 32 random bytes, base64url; only `sha256(token)` is stored; a wrong, revoked or departed-person token answers exactly like a missing one (404, same body, same timing path); the feed's scope comes from the stored record, never from the URL.
- Contact details of staff (email, phone from Square Team) are server-only: never in `/api/staff/login.json`, the picker, or any crew response about another person.
- Customer details in feeds: no customer email or phone, ever. Party host first name only on owners' feeds.
- Copy: staff-facing, house style (plain words, no jargon, "Craft Café", "party" never "birthday"); texts and emails to staff follow the customer rules (no colons, no timelines). Kaden reviews copy before prod.
- Test texts/emails go only to Kaden: preview reroute covers the routes; unit tests never send.
- Times stored UTC ISO; studio-local days via `src/lib/studio-time.ts`; ICS times written in UTC (`…Z`).
- New stores via `makeKvStore(name, dir)`; every multi-writer record `getWithMeta` + `setIfMatch` with 3 attempts; read failure on an owner screen shows its own error + Try again (11b rules), never an empty "nobody's available".
- Admin screens follow `task-11b-common.md` (one sheet at a time, phone bottom sheet / iPad side panel, toasts, hash routes, no `window.confirm`, ≥44 px targets, 16 px inputs).

## Review Focus

1. **Calendar feed token** (wrong, revoked, rotated, a departed person's, a crew token with `?all=1` or `?staff=<other id>` appended) → 404 indistinguishable from missing for the first four; a crew feed only ever contains that person's assignments whatever the query string (Task 7 tests "token refusals" and "scope from the record").
2. **Crew forging an identity or an assignment** (POST to `/api/staff/shifts.json` with another `staffId`, an `assign` action, an owner-only field; a cookie for a person no longer on the team) → the body's person is ignored, assign is refused 403 with no write, a departed person's writes are refused (Task 5 tests "cookie is the person", "crew can't assign").
3. **An event that moves or is cancelled after staff are on it** (class session moved to another day, party moved across months, class cancelled) → assignment follows the event key, the feed shows the new time with the same UID and a bumped SEQUENCE, a cancelled one shows `STATUS:CANCELLED`, and the daily warnings tell owners "Jessica is on a cancelled class" / "Jessica said she can't work then" (Task 4 "moved keeps staff", Task 8 "assigned-cant").
4. **Availability across the clock change and day edges** (a "can't" 5–9 PM on Sun Nov 1; an all-day mark; a range ending at midnight; a weekly "usually can" overridden by a date "can't") → the per-event verdict uses real instants in Chicago time (Task 2 test "across the clock change").
5. **Two owners assigning at once / Square team list down** → CAS keeps both writes (no lost assignment), a stale sheet is told to reload; when Square is unreachable the last-known team list is used for names and feed checks, and nothing is written under the fallback ids `kaden`/`catherine` (Task 3 "concurrent assign", Task 1 "fallback never keys data").

---

### Task 1: Staff people — contact details, last-known team, owner mapping

**Files:**
- Modify: `src/lib/staff-directory.ts` (keep `listStaff()` exactly as it answers today; add the functions below)
- Test: `tests/lib/staff-directory.test.ts` (extend)

**Interfaces:**

```ts
export interface StaffPerson extends StaffMember { email: string | null; phone: string | null; active: boolean }
/** Server only. Active team with contact details. `source: 'square'` when Square answered; 'last-known' when Square failed and a saved copy exists; throws when neither. */
export async function teamWithContacts(): Promise<{ people: StaffPerson[]; source: 'square' | 'last-known' }>
/** True only for an id on the current (or last-known) ACTIVE team. Fallback ids 'kaden'/'catherine' are never "real". */
export async function isActiveStaffId(id: string): Promise<boolean>
/** The team member an /admin owner name ('Catherine' | 'Kaden') is, by given name among owners; null when not found or ambiguous. */
export async function staffIdForOwner(owner: Owner): Promise<string | null>
export const FALLBACK_IDS: ReadonlySet<string> // 'kaden', 'catherine'
```

Last-known copy: kv `staff-team` key `team` (written whenever Square answers and the list differs; `{ at, people }`), so feeds and names survive a Square outage. `teamMembers.search` already returns `emailAddress` / `phoneNumber`; no new Square call.

- [ ] **Step 1: Failing tests:** contact fields mapped from the Square shape; inactive members excluded; Square failure with a saved copy → `source: 'last-known'`; with none → throws (callers show an error); **"fallback never keys data"**: `isActiveStaffId('kaden')` is false even while `listStaff()` is answering with the fallback; `staffIdForOwner('Catherine')` finds the owner whose given name is Catherine, null when two owners share it; `listStaff()` output unchanged (no email/phone in it).
- [ ] **Step 2: Run** `npx vitest run tests/lib/staff-directory.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(staffing): team contact details, last-known team and owner mapping (read only)`.

### Task 2: Staffing types and pure rules

**Files:**
- Create: `src/lib/staffing/types.ts`, `src/lib/staffing/rules.ts` (pure, browser-safe)
- Test: `tests/lib/staffing/rules.test.ts`

**Interfaces:**

```ts
// types.ts
import type { By } from '@lib/staff-auth'
export type EventKey = `ses:${string}` | `party:${string}` | `legacy:${string}`
export interface TimeRange { from: string; to: string }          // 'HH:MM' studio-local; to '24:00' allowed
export interface DayMark { kind: 'can' | 'cant'; range: TimeRange | null; note: string } // range null = all day
export interface Availability {
  staffId: string
  name: string                      // as last seen, for owner screens
  weekly: Record<string, DayMark | null> // '0'..'6' (Sun..Sat) usual pattern; null = not said
  dates: Record<string, DayMark[]>  // 'YYYY-MM-DD' → marks that replace the weekly mark for that day (≤ 4 per day)
  updatedAt: string | null
  history: { at: string; by: By; change: string }[] // capped 50
}
export interface Assignment { staffId: string; name: string; by: By; at: string; notified: { email: boolean; text: boolean } | null }
export interface Ask { staffId: string; name: string; at: string; note: string }
export interface StaffingEntry {
  key: EventKey
  needed: number | null             // null = the default for its kind (OWNER-3)
  assigned: Assignment[]
  asks: Ask[]                       // "I'd like to work this"
  seen: { startIso: string; endIso: string; title: string } | null // last time an owner/feed saw it, to spot a move
  sequence: number                  // ICS SEQUENCE, bumped when seen times change
  updatedAt: string | null
  history: { at: string; by: By; change: string }[] // capped 100
}
export interface StaffableEvent {
  key: EventKey; kind: 'class' | 'party' | 'legacy-class'
  title: string; startIso: string; endIso: string
  status: 'on' | 'cancelled' | 'gone' // gone = the event no longer exists anywhere
  openHref: string                   // /admin hash to open it
  detail: { seats?: string; guests?: number; hostFirst?: string | null }
}
```

```ts
// rules.ts
export function eventKeyOf(b: { kind: string; id: string; sessionId?: string }): EventKey | null // class → ses:, party → party:, legacy-class → legacy:, others null
export function verdict(a: Availability | null, ev: { startIso: string; endIso: string }): 'can' | 'cant' | 'partly' | 'unknown'
export function neededFor(e: StaffingEntry | null, kind: StaffableEvent['kind']): number
export function staffedState(e: StaffingEntry | null, kind: StaffableEvent['kind']): 'staffed' | 'short' | 'none' // none = 0 assigned, short = 0 < assigned < needed
export function validateAvailability(raw: unknown, now: Date): Result<Pick<Availability, 'weekly' | 'dates'>> // HH:MM; from < to; ≤ 4 marks a day; no overlapping marks on a day; dates within today−1 .. today+365; note ≤ 120 chars; dates in the past dropped
export function movedSince(e: StaffingEntry, ev: StaffableEvent): boolean
```

`verdict`: the day's marks are the date marks when present, else the weekly mark; an event touching two days (a party past midnight is not possible today, but a range ending `24:00` is) checks both. `cant` overlapping any minute of the event → `cant`; `can` covering the whole event → `can`; `can` covering part → `partly`; nothing said → `unknown`.

- [ ] **Step 1: Failing tests:** each verdict; date marks replace the weekly mark (weekly "can Sat", date "can't Sat Oct 31 9–12" → a 10 AM class `cant`, a 2 PM class `unknown`… because the date marks replace the whole day); **"across the clock change"**: "can't 17:00–21:00" on Sun Nov 1 refuses a 6 PM class whose `startIso` is `2026-11-02T00:00:00Z`, and allows one at 4 PM; all-day mark; `24:00` end; validation refuses each bad case with an owner-readable sentence ("Pick an end time after the start."); `eventKeyOf` for every Busy kind; `staffedState` with needed 1 and 2.
- [ ] **Step 2–4:** run (FAIL), implement, `npx vitest run tests/lib/staffing` — PASS.
- [ ] **Step 5: Commit** `feat(staffing): availability, asks and assignment rules`.

### Task 3: Staffing stores (availability, entries, feeds)

**Files:**
- Create: `src/lib/staffing/availability-store.ts` (kv `staff-availability`, key `person-{staffId}`)
- Create: `src/lib/staffing/staffing-store.ts` (kv `staffing`, key `evt-{eventKey}` with `:` encoded as `_`)
- Create: `src/lib/staffing/feed-store.ts` (kv `calendar-feeds`, keys `tok-{sha256hex}` → record, `who-{staffId|owner:Name}` → current hash)
- Test: `tests/lib/staffing/stores.test.ts`

**Interfaces:**

```ts
// availability-store.ts
export async function getAvailability(staffId: string): Promise<Availability | null>
export async function getAvailabilityMany(ids: string[]): Promise<Map<string, Availability>>
export async function saveAvailability(staffId: string, name: string, next: Pick<Availability, 'weekly' | 'dates'>, by: By, expectedUpdatedAt: string | null): Promise<Availability> // CAS; stale → StaleError
// staffing-store.ts
export async function getEntries(keys: EventKey[]): Promise<Map<EventKey, StaffingEntry>> // parallel, bounded 8
export async function listAllEntryKeys(): Promise<EventKey[]>
export async function updateEntry(key: EventKey, fn: (e: StaffingEntry) => StaffingEntry, change: string, by: By, expectedUpdatedAt?: string | null): Promise<StaffingEntry> // CAS ×3; creates when missing
// feed-store.ts
export interface FeedRecord { hash: string; scope: 'mine' | 'all'; staffId: string | null; owner: Owner | null; createdAt: string; by: By; lastUsedAt: string | null }
export async function makeFeed(who: { staffId: string } | { owner: Owner }, by: By): Promise<{ token: string; record: FeedRecord }> // revokes the previous one for that person
export async function findFeed(token: string): Promise<FeedRecord | null> // hashes, then one get; never compares raw tokens
export async function revokeFeed(who: { staffId: string } | { owner: Owner }, by: By): Promise<void>
export async function touchFeed(hash: string, now: Date): Promise<void> // lastUsedAt at most once an hour; failures ignored
```

- [ ] **Step 1: Failing tests** (fs-backed kv as in `tests/lib/event-meta.test.ts`): save/get availability; stale `expectedUpdatedAt` refused; history capped; **"concurrent assign"**: two `updateEntry` calls adding different people with a wrapped `setIfMatch` that loses once → both people present; same person assigned twice → once; makeFeed stores only the hash (raw token absent from every stored value); a second makeFeed revokes the first (old token → null); revoke; `findFeed` with garbage/short/long input → null without throwing.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(staffing): availability, staffing and calendar-feed stores`.

### Task 4: Staffable events — the schedule joined with staffing

**Files:**
- Create: `src/lib/staffing/events.ts`
- Test: `tests/lib/staffing/events.test.ts`

**Interfaces:**

```ts
export interface StaffingRow {
  event: StaffableEvent
  entry: StaffingEntry | null
  state: 'staffed' | 'short' | 'none'
  needed: number
  people: { staffId: string; name: string; verdict: 'can' | 'cant' | 'partly' | 'unknown'; asked: boolean; assigned: boolean }[]
}
export async function staffableBetween(fromIso: string, toIso: string): Promise<StaffableEvent[]>
export async function staffingRows(fromIso: string, toIso: string, opts?: { onlyStaffId?: string }): Promise<StaffingRow[]>
export async function orphanEntries(now: Date): Promise<{ key: EventKey; entry: StaffingEntry; status: 'cancelled' | 'gone' }[]> // entries with people on them whose event is cancelled or gone, last 30 days → future
```

Sources: `busyBetween` (class sessions of open/closed classes — drafts excluded; parties; legacy classes) plus `listClasses` for cancelled classes (status `cancelled`) and the stage-2 party records for cancelled parties, so a cancelled event with staff still shows. Titles: class name; party "Party · 14 guests" (host first name only in `detail.hostFirst`, used by owner views). `onlyStaffId` filters to events where that person is assigned or asked (crew screens and crew feeds never receive other people's availability).

- [ ] **Step 1: Failing tests:** a 3-session class gives 3 events with `ses:` keys; a draft gives none; a cancelled class with an assignment gives a `cancelled` row; **"moved keeps staff"**: moving a session keeps its key and its assignment and `movedSince` turns true; a party moved Oct→Nov keeps `party:` key; a deleted record with people → `gone` in `orphanEntries`; `people` lists every active team member with verdict/asked/assigned and never a fallback id; `onlyStaffId` rows carry only that person in `people`; a store read failure throws (no empty list).
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(staffing): staffable events from the shared schedule with who can, who asked, who is on`.

### Task 5: Crew API — my availability, my asks, my schedule

**Files:**
- Create: `src/pages/api/staff/shifts.json.ts`
- Test: `tests/api/staff-shifts.test.ts`

**Contract:**
- `GET ?from&to` (≤ 10 weeks) → `{ me: { id, name }, availability, mine: StaffingRow[] (assigned to me), open: StaffableEvent[] (on, not mine, with an "asked" flag for me), feed: { has: boolean } }`. `open` carries no other person's names or availability.
- `POST { action: 'availability', weekly, dates, expectedUpdatedAt }` → saves for the cookie's person.
- `POST { action: 'ask' | 'unask', key, note? }` → adds/removes this person's ask (refused on cancelled/gone/past events: "That one has already happened.").
- Any other action (`assign`, `unassign`, `needed`) → 403 "Only an owner can put people on a class or party. Ask in /admin." and nothing is written.
- Identity: `staffAuthorized(request)` only; 401 without; 403 "You're not on the team list any more. Ask an owner." when `!isActiveStaffId(me.id)` (also stops writes under fallback ids). Rate limit 30/min per person. Every write → `recordAudit` (`staff.availability`, `staff.ask`, `staff.unask`).

- [ ] **Step 1: Failing tests:** **"cookie is the person"**: body `staffId` of someone else ignored, the cookie's record changes; **"crew can't assign"**: `assign` → 403, store unchanged; an owner-role /staff cookie can't assign either (assigning is /admin only); fallback id → 403; stale availability → 409 "Someone changed your times on another device. Here they are."; ask on a past event refused; GET never includes another person's availability or asks.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(staff): my availability, I'd like to work this, and my schedule API`.

### Task 6: Owner API — staffing board, assign, needed, notify

**Files:**
- Create: `src/pages/api/admin/staffing.json.ts`
- Create: `src/lib/staffing/notify.ts` (assignment email + text to the staff person)
- Modify: `src/lib/email.ts` (`sendShiftEmail`)
- Test: `tests/api/admin-staffing.test.ts`, `tests/lib/staffing/notify.test.ts`

**Contract:**
- `GET ?from&to` (≤ 10 weeks) → `{ rows: StaffingRow[], team: { id, name, role }[], teamSource }`.
- `GET ?key=<eventKey>` → one row (the class/party sheet's Staff section).
- `POST { action: 'assign' | 'unassign', key, staffId, tell: boolean, expectedUpdatedAt }` → `updateEntry`; refuses unknown/inactive staff ("Jessica isn't on the team list."), cancelled/gone/past events; assigning someone whose verdict is `cant` is allowed but the reply carries `warning: "Jessica said she can't work then."` (owners decide). `tell` (OWNER-2 default on) → `notify.ts` sends email + text: "Hometown Studio here. You're on Needlepoint 101, Sun Oct 25, 1 PM to 3 PM. See your shifts at {origin}/staff" / "…You're off Needlepoint 101, Sun Oct 25. Thanks!" Notification failure never undoes the assignment; reply `warning: "Saved. The text to Jessica didn't go through."`.
- `POST { action: 'needed', key, needed: 0..6 | null }` (0 = no one needed, e.g. Kaden runs it alone and doesn't want the flag).
- Every route `adminAuthorized` + `adminActor(request)` (11b-A) as `by`; audit `staffing.assign`, `staffing.unassign`, `staffing.needed`.

- [ ] **Step 1: Failing tests:** 401 without the admin cookie; a /staff cookie (any role) is not enough; assign + unassign + needed; stale → 409 "Someone else just changed who's on this. Here's the latest."; `cant` warning; notify sends one email + one text with the copy above and no colon in it; preview reroute (no real number in tests); notify failure keeps the assignment and returns the warning; `tell: false` sends nothing.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(admin): staffing board API — assign, needed counts, tell the person`.

### Task 7: Calendar links for phones (read-only ICS feeds)

**Files:**
- Create: `src/lib/staffing/ics-feed.ts` (pure)
- Create: `src/pages/api/calendar/feed/[token].ics.ts`
- Create: `src/pages/api/staff/feed.json.ts` (POST make/rotate my link, DELETE revoke; scope `mine`)
- Create: `src/pages/api/admin/feed.json.ts` (POST make/rotate the acting owner's link, DELETE revoke; scope `all`)
- Test: `tests/lib/staffing/ics-feed.test.ts`, `tests/api/calendar-feed.test.ts`

**Interfaces:**

```ts
export interface FeedEvent { uid: string; sequence: number; startIso: string; endIso: string; summary: string; description: string; status: 'CONFIRMED' | 'CANCELLED'; url: string | null }
export function buildFeed(events: FeedEvent[], opts: { name: string; now: Date }): string
```

Feed rules: CRLF line endings, lines folded at 75 octets (UTF-8 safe), TEXT escaping of `\ ; , newline`, `X-WR-CALNAME` ("Hometown Studio" / "Hometown Studio · my shifts"), `REFRESH-INTERVAL;VALUE=DURATION:PT1H` + `X-PUBLISHED-TTL:PT1H`, `DTSTAMP` = now, times UTC `…Z`, `UID` = `<eventKey>@ourhometownstudio.com` (stable across moves), `SEQUENCE` from the entry, `LOCATION` = studio address from `siteConfig`. Window: 30 days back to 120 days ahead. Cancelled events with staff stay 30 days as `STATUS:CANCELLED`.

- **Crew feed (`mine`):** only events the person is assigned to; summary "Needlepoint 101" / "Party · 14 guests"; description "With Catherine." (OWNER-5) plus "Doors 30 minutes early" for parties; no customer names.
- **Owner feed (`all`):** every class session and party (and blocked time and closed days as all-day/timed "Closed"/"Blocked"), summary prefixed "⚠ " when short of staff; description "On: Kaden, Jessica · 8 of 12 seats" / "Party · Stefanie · 14 guests" (host first name only, OWNER-4); events the owner is assigned to start "You're on · ".
- **Route:** no cookie; rate limit 60/min per IP; the token must match `^[A-Za-z0-9_-]{43}$` before hashing; unknown → 404 `Not found`; a crew record whose `staffId` is no longer active (`isActiveStaffId`, last-known team when Square is down) → the same 404; scope read from the record only, query string ignored; `Content-Type: text/calendar; charset=utf-8`, `Cache-Control: private, max-age=300`; schedule read failure → 503 (calendar apps keep the last copy). `touchFeed` after a 200.
- **Make/rotate:** returns `{ https, webcal }` URLs once; the page shows them with Copy and "Add to iPhone calendar" (webcal link); "Make a new link" rotates (old one stops). Audit `feed.make`, `feed.revoke`.

- [ ] **Step 1: Failing tests:** ics-feed: folding at 75 octets with an emoji on the boundary; escaping; CRLF; UID stable when start changes and SEQUENCE bumps; CANCELLED status; parses with a small round-trip parser in the test. Route: **"token refusals"** (garbage, wrong, revoked after rotate, departed person) all give the identical 404 body; **"scope from the record"**: crew token + `?all=1&staff=<other>` still only their events; owner token lists everything incl. unstaffed marker; no customer email/phone anywhere in either body (regex check); 503 on schedule failure; rate limit.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(staffing): read-only calendar links for phones — owners see everything, crew their own shifts`.

### Task 8: Warnings and the daily email

**Files:**
- Modify: `src/lib/warnings.ts` (codes `unstaffed`, `assigned-cant`, `assigned-cancelled`; `OWNER_ONLY_CODES`)
- Modify: `src/pages/api/staff/warnings.json.ts` (crew panel hides `OWNER_ONLY_CODES`), `src/pages/api/jobs/daily-warnings.json.ts` (includes them), `src/components/admin/Home.tsx` "Needs you" (count of unstaffed in the next 14 days, opens More › Staff)
- Test: extend `tests/lib/warnings*.test.ts`, `tests/api/jobs-daily-warnings*.test.ts`, `tests/api/staff-warnings*.test.ts`

Lines (owner-facing, one-line format of `warningLine`):
- `unstaffed` (events within OWNER-6's horizon, default 14 days, `needed > assigned`): "Sat Oct 24 · Potholder Looms 10 AM has no one on yet. Assign someone in /admin › More › Staff." / "…has 1 of 2 on."
- `assigned-cant`: "Sun Oct 25 · Jessica is on Needlepoint 101 but said she can't work then. Check with her."
- `assigned-cancelled` (undated item, `itemId` = event key): "Jessica is still on Potholder Looms, which was cancelled. Tell her, then take her off."

- [ ] **Step 1: Failing tests:** each code fires and does not fire at the edges (needed 0 → never; 14-day horizon boundary in Chicago days); crew warnings response excludes them; daily email includes them and the first-seen logic (Task 15 of stage 1) treats `assigned-cancelled` as undated; a staffing store failure adds one "Couldn't check staffing" line instead of silently skipping.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(warnings): unstaffed, can't-work and cancelled-shift lines for owners`.

### Task 9: /staff — My shifts

**Files:**
- Modify: `src/components/staff/nav.tsx` (tab `shifts` "My shifts", after Calendar), `src/components/staff/StaffConsole.tsx` (phase)
- Create: `src/components/staff/MyShifts.tsx`, `src/components/staff/AvailabilityEditor.tsx`, `src/components/staff/CalendarLinkSheet.tsx`
- Modify: `src/components/staff/StaffCalendar.tsx` (each class/party gets "I'd like to work this" / "You asked" / "You're on")
- Test: `tests/components/staff/MyShifts.test.tsx`, `AvailabilityEditor.test.tsx`, extend `StaffCalendar` tests

Screen: **My schedule** first ("You're on" list, next 8 weeks, each with time, "With Catherine", tap opens the roster as today). **When I can work**: a week strip of the studio's open days (Thu–Sun today; read from studio days) with Can / Can't / — per day and an optional "Only from … to …"; below, "Different on a date" (date + Can/Can't + times + note) list with remove. **Ask to work**: upcoming classes and parties not yours, each with "I'd like to work this" (toggle, optional note). **Calendar on my phone**: "Get my calendar link" → sheet with Copy, "Add to iPhone calendar" (webcal), a one-line how-to for Google ("In Google Calendar, Other calendars, From URL"), and "Make a new link" (the old one stops working). Header shows whose shifts these are ("Jessica's shifts") because the iPad is shared.

- [ ] **Step 1: Failing tests:** renders only my assignments; saving availability sends the cookie's data with `expectedUpdatedAt` and shows "Saved."; stale reply shows the server's times and says so; ask toggles; calendar link sheet shows both links and rotate confirm in-sheet (no `window.confirm`); 400 px phone layout; buttons ≥ 44 px; no tab-level crash when the API fails (error + Try again).
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(staff): My shifts — schedule, when I can work, ask to work, calendar link`.

### Task 10: /admin — More › Staff, Staff on class and party sheets

**Files:**
- Create: `src/components/admin/sheets/StaffSheet.tsx` (replaces the `staff` preview in `MoreSheets.tsx`), `src/components/admin/staffing/StaffRow.tsx` (shared Staff section), `src/components/admin/staffing/api.ts`
- Modify: `src/components/admin/More.tsx` (row subtitle "Who's on, who can work, calendar links"), `ClassSheet.tsx` and the party sheet (stage 2 `PartySheet.tsx`) add the Staff section, `CalendarView.tsx` items show a small "No one on" chip when `state !== 'staffed'` and `needed > 0`, `Home.tsx` Needs you tile
- Test: `tests/components/admin/staffing/*.test.tsx`

**More › Staff** (mock-up `staff`): segmented This week / Next week / Pick a week; "Needs someone" list first (short/none events, each tappable to assign); "Who can work" grid (people × open days, Yes/No/Part/—, from verdicts against each day's events); "Everything this week" list with assigned names; footer "Calendar link for my phone" (owner's `all` feed, same sheet as /staff) and per-person "Stop their calendar link" (revoke, in-sheet confirm). **Staff section** on a class session / party: Needed (stepper 0–6, "Usual" reset), then each team member as a row: name, verdict tag (Can / Can't / Part / Not said), "Asked" star with their note, and an Assign/Take off button; "Tell them by text and email" tick (on by default) above the buttons; stale and `cant` warnings as toasts. Legacy Square classes are staffable (their sheet is read-only for everything else).

- [ ] **Step 1: Failing tests:** grid renders verdicts; Needs someone lists short/none only; assign from the section posts `tell` and shows the toast; `cant` warning toast; stale reload message; needed stepper; owner calendar link; revoke someone's link asks in-sheet first; phone 400 px and iPad 1024 px; one sheet at a time (opening a class from More › Staff replaces the sheet).
- [ ] **Step 2–4:** run, implement, `npx vitest run tests/components/admin` — PASS.
- [ ] **Step 5: Commit** `feat(admin): More › Staff and a Staff section on every class session and party`.

### Task 11: Archive, sandbox seed, E2E scenarios, phone checklist

**Files:**
- Modify: `src/lib/archive-stores.ts` (`staff-availability`, `staffing`, `staff-team`; **not** `calendar-feeds` — hashes only, but no need to keep them)
- Modify: `src/pages/api/admin/classes/seed-sandbox.json.ts` (R12 route): sandbox only, ensure one ACTIVE team member "E2E Crew" exists (Team API `CreateTeamMember`, given name `E2E`, family `Crew`, no booking profile, no wage), print nothing secret. Refuses unless `SQUARE_ENVIRONMENT=sandbox` (existing guard + a test).
- Modify: `scripts/lib/sandbox-e2e/scenarios.ts`, `scripts/sandbox-e2e.ts` (crew client signs in as "E2E Crew"; owner client as today)
- Create: `docs/superpowers/plans/stage3-phone-checklist.md`
- Test: `tests/lib/archive-stores.test.ts`, `tests/api/admin-seed-sandbox.test.ts`, `tests/scripts/sandbox-e2e*.test.ts` (dry-run lists the new scenarios)

**E2E scenarios** (append after the last stage-1/2 id; numbers below are relative, S3-1 = next free id):
- S3-1 Crew sets "can Sat 9–5", "can't" one date; GET shows it; another person's GET doesn't.
- S3-2 Crew asks to work an E2E class; owner board shows the ask; crew POST `assign` → 403 and board unchanged.
- S3-3 Owner assigns E2E Crew (tell off) → crew My shifts lists it; crew feed contains exactly that event (UID `ses:…`); owner feed contains it plus the rest of the week.
- S3-4 Owner moves the E2E class session by an hour → crew feed shows the new time, same UID, SEQUENCE + 1.
- S3-5 Unassign → daily warnings (`GET /api/admin/warnings` or the jobs dry-run) list "has no one on yet" for that class; crew warnings don't.
- S3-6 Cancel the class with E2E Crew on it → `assigned-cancelled` line; crew feed shows `STATUS:CANCELLED`.
- S3-7 Rotate the crew link → old token 404, new 200; revoke from /admin → 404; garbage token 404 with the identical body.
- S3-8 Two owner assigns in parallel (different people) → both on.
Cleanup: unassign, revoke E2E feeds, remove E2E Crew's availability (the team member stays in the sandbox).

- [ ] **Step 1:** failing unit tests for archive list, seed guard, dry-run listing; implement; pass.
- [ ] **Step 2:** push the branch (preview only); Kaden runs the one-liner `--only <S3 ids>`; every scenario PASS; failures become failing unit tests in the owning task.
- [ ] **Step 3:** write the phone checklist (below).
- [ ] **Step 4: Commit** `test(e2e): staffing scenarios; archive staffing stores; sandbox crew member`.

**Real-money checklist:** none — this stage moves no money and makes no Square write on the live site. Instead, `stage3-phone-checklist.md` for Kaden on prod after the go:
1. On your iPhone, /staff › My shifts › Get my calendar link › Add to iPhone calendar: it subscribes; your assigned shifts appear.
2. In /admin, assign yourself to something tomorrow: within an hour the iPhone calendar shows it (pull to refresh in Calendar › Calendars).
3. Move that class 30 minutes in /admin: the phone shows the new time, not two events.
4. Add the same link in Google Calendar (From URL): it appears (Google can take up to a day to refresh; that's Google, not us).
5. Catherine: /admin › More › Staff › Calendar link for my phone: everything shows, unstaffed ones marked ⚠.
6. Make a new link, then check the old subscription stops updating (it shows nothing new; delete it).
7. Assign a crew member with "Tell them" on: they get one text and one email, no colons, right time.
8. Check Square: no team member became bookable, no new Square anything.

---

## Rulings (implementer may proceed on these)

- **S3-R1 Staffing unit:** one class session (`ses:`), one party (`party:`), one legacy Square class (`legacy:`). A 4-day camp has 4 separate staffing entries; "assign to every day" is a convenience button in the Staff section that writes each.
- **S3-R2 Craft Café windows are not staffable in this stage** (spec names classes and parties). Room is left: `EventKey` can gain `cafe:` later.
- **S3-R3 Shared iPad identity:** no per-person PIN; the "Who's on the iPad?" pick is the identity, as it already is for custody and refunds. My shifts shows the name large so nobody edits someone else's by mistake.
- **S3-R4 Owner identity on /admin** is the `X-Admin-Who` name; it maps to a team member id only for "You're on" in the owner feed (`staffIdForOwner`); assignments always store team member ids.
- **S3-R5 Feed tokens are shown when made and never again;** "Make a new link" is the recovery.
- **S3-R6 A person leaving the team** (inactive in Square): their feed 404s, their availability stays (archive) but is hidden, their future assignments raise `unstaffed` because they no longer count.

## OWNER decisions (recommended default in bold; build the default unless Kaden says otherwise)

- **OWNER-1 How crew say when they can work:** **a usual week (Can / Can't / not said per open day, optional times) plus "different on a date" exceptions.** Alternative: date-by-date only.
- **OWNER-2 Tell staff when assigned or taken off:** **yes, a text and an email, with a "Tell them" tick on by default in /admin.**
- **OWNER-3 People needed per event by default:** **1 for a class session, 1 for a party; owners change it per event (0 = nobody needed, no warning).**
- **OWNER-4 What owners' phone calendars show for a party:** **"Party · host first name · guest count"; never phone numbers or emails.**
- **OWNER-5 Crew see who else is on with them:** **yes ("With Catherine").**
- **OWNER-6 How far ahead the daily email flags unstaffed events:** **14 days** (the /admin board shows everything).

## Surprises found in the current code

- `listStaff()` falls back to ids `kaden`/`catherine` on any Square error; anything keyed by staff id must refuse those ids or a Square blip would split a person's data in two.
- /admin knows owners by name only (`X-Admin-Who`); /staff knows them by Square team id. The two meet only through given-name matching.
- `buildIcs` in `party-share.ts` derives the UID from the start time, so a moved event would duplicate in a subscribed calendar; the feed needs its own writer with stable UIDs.
- `/api/staff/warnings.json` shows every warning to the crew; owner-only lines need an explicit filter.
