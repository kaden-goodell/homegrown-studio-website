# Waiver & Custody Rail — Design

**Date:** 2026-09-28 · **Branch:** `dev` · **Ships:** before the first drop-off event (week one after the Oct 16 opening)
**Source audit:** https://claude.ai/artifact/UpDnyctNm2NVjEabcaEJdW (findings referenced as C1…H6, M1…)

## Goal

One iPad app for the counter that answers three questions for any guest — *Is there an agreement? Is it valid? Any flags?* — and runs every event (party, workshop, kids' workshop, PNO, multi-day camp) on the same rail, with drop-off as a property of the event rather than a mode the crew picks. Every custody action carries the staffer's name. Signers get a copy. Records archive themselves weekly. Nothing is ever deleted.

Decisions already made (Kaden, 2026-09-28): drop-off events exist in week one; PNO/camps sell as **one Square Class covering all days**; **anyone on crew can flip drop-off** (confirmed + logged); crew names come from **Square Team Members**; **Quo SMS is live**; **Programs code stays** and moves onto this rail as a follow-up; late pickup **$1/min after 15 min**; archive destination = **email to kaden@ourhometownstudio.com** (Gmail already wired).

Not in scope: licensing/insurance (settled), Programs re-wire (follow-up), Square-side seat rosters (rosters come from signatures), drawn signatures, scroll gates.

## 1. Event model

```ts
type EventKind = 'party' | 'workshop' | 'program'
interface StudioEvent {
  kind: EventKind
  id: string          // party bookingId | Square classScheduleId | program session id
  title: string
  startIso: string
  days: string[]      // studio-TZ YYYY-MM-DD; length 1 unless multi-day
  dropOff: boolean
  seats?: number
}
```

- **Sources.** `party` → `party-store`. `workshop` → `providers.workshop.listWorkshops()` (already fetched for `/workshops`), id = `classScheduleId`. `program` → resolver added when Programs re-wires; the type exists now so nothing else changes then.
- **`event-meta` store** (`src/lib/event-meta.ts`, blob store `event-meta`, key `event-meta-{kind}:{id}`):
  `{ dropOff: boolean, days?: string[], updatedAt, by, history: [{at, by, dropOff, days}] }`. Overlays the source: `days` defaults to `[date(startIso)]`; `dropOff` defaults false. `party.dropOff` on the party record becomes a read-only fallback for old records; the meta store is the single writable source.
- **`getEvent(kind,id)` / `listEvents({from,to})`** in `src/lib/events.ts` merge source + meta. `listEvents` is what the Today screen reads.
- **Event settings sheet** on the roster: *Drop-off? [toggle] · Days: [date chips ± ]*. Any staffer may change it; the client asks "Switch this to a drop-off event? Pickup codes will be required." and the server logs `by` + before/after in `history`. `POST /api/staff/event-meta.json { kind, id, dropOff?, days? }`.

## 2. Signatures vs RSVPs (C2)

- `WaiverRecord` = **signatures only**. Written only when a person reads the text, ticks the box, types their name.
- New `RsvpRecord` (`src/lib/rsvp-store.ts`, store `rsvps`, key `rsvp-{kind}:{eventId}-{waiverId}`):
  `{ id, waiverId, event: {kind,id}, attending: string[] | null, responsibleAdult: string|null, addendumVersion: string|null, addendumSha256: string|null, at, ip, userAgent }`.
  One RSVP per household per event (upsert; re-RSVP replaces).
- **Fresh sign in an event context** writes the WaiverRecord, then the RsvpRecord. **Returning path** (`handleReuse`) writes only the RsvpRecord — no cloned signature, no synthesized `signature`. The returning screen adds one line: *"Your agreement signed {date} still covers everyone here."*
- **Forced re-sign.** `docs/waiver-versions/README.md` gains a `substantiveSince: 'vN'` marker. If the on-file `agreementVersion` is older than `substantiveSince`, the returning path shows *"We've updated the agreement — please read and sign again"* and routes to the full form (prefilled from the old record's non-sensitive fields). v1→v2 (rebrand) is not substantive.
- `event-index-{kind}:{id}` entries become `{ waiverId, rsvpId }`. Rosters join RSVP → waiver. Check-in state stays keyed by `waiverId` (household).
- Workshop modal passes `?workshop={classScheduleId}&booking={bookingId}`; the RSVP stores `booking` in a `ref` field. Existing party links (`?party=`) unchanged.

## 3. Drop-off addendum (C3) + form changes

- `waiverContent.dropOffAddendum = { version: 'a1', sections: [...] }` (text from audit Appendix A, late fee $1/min after a 15-minute grace, capacity/staffing numbers from `CREW-OPERATIONS.md`). `serializeAddendum()` → SHA-256, archived at `docs/waiver-versions/addendum-a1.md`. Bump rules identical to the main agreement.
- Shown as a **second, separate, unchecked checkbox** — *"I have read and agree to the Drop-off Program Addendum for the minors I am registering."* — only when `event.dropOff` is true, on both the fresh and returning paths. Server rejects an RSVP to a drop-off event without it. Recorded on the RsvpRecord.
- Form changes (`WaiverFlow.tsx`, `sign.json.ts`, `WaiverRecord`):
  - `authorizedPickup` → `authorizedPickup: { name: string; phone: string }[]` (0–3 rows; shown only when `dropOff`); legacy string records parse on read as today.
  - `notAuthorized: string` — *"Anyone who may NOT collect your child? (bring a copy of any court order)"* — drop-off only.
  - Allergies: a **"None"** tap that stores the literal `None`; on drop-off registrations an extra `medications` line — *"Medications or conditions we should know about (we don't administer medication)."*
  - Adult DOB becomes a masked text input (`MM/DD/YYYY`, `inputmode=numeric`); kids keep the date picker.
  - 18-year-old copy (M6): *"In Alabama you're a legal adult at 19. If you're 18, a parent or guardian signs for you — they can do it from their phone."* with the current page link.

## 4. Staff identity (C4)

- `src/lib/staff-directory.ts`: `listStaff()` → `[{ id, name, role: 'owner'|'crew' }]` from Square `teamMembers.search` (active, this location), cached 10 min in memory, with a static fallback of Kaden + Catherine so login never depends on Square being up. Owner = `is_owner` or configured ids.
- Login: passcode → **"Who's on the iPad?"** picker (big buttons). Cookie `hg_staff` becomes an HMAC-signed value `{ name, id, role, iat }` (server secret = `STAFF_PASSCODE` + salt), `Secure; HttpOnly; SameSite=Lax`, 12 h. `staffAuthorized(request)` returns the staffer or null. Constant-time passcode compare.
- Every write (`checkin`, `event-meta`, `incident`, kit actions) stamps `by: { id, name }`. Header shows the name; **Switch** = two taps (picker again, no passcode).
- `/staff` gets `<meta name="robots" content="noindex">` and `public/robots.txt` disallows it.

## 5. Today screen, Door, kiosk (C1, H1)

- `StaffConsole` phases: `login → pick-staff → today | roster | kits`. **Today** is the default.
- **Walk-in search** (top of Today): one input (phone / email / last name) → `GET /api/staff/coverage.json?q=` (extended: name search over the contact index, returns `signedAt, agreementVersion, validUntil, kids[], flags: {allergies[], noPhoto}`). Result states in words: **GOOD TO GO** / **EXPIRED — sign again** / **NOT ON FILE**. GOOD TO GO shows a *Check in to Open Studio* button → `POST /api/staff/open-studio.json` writes a day-keyed presence (headcount only). NOT ON FILE shows a QR (`/waiver`) and **Sign on this iPad** (opens `/waiver?kiosk=1` in the same tab; kiosk returns to `/staff` when done).
- **Today's events** list from `listEvents({from: today, to: today})`, sorted by start: kind icon, title, time, `DROP-OFF` chip, `Day n of m` for multi-day, counts (RSVP'd · here now). Tap → roster.
- **Kiosk mode** `/waiver?kiosk=1`: no returning-lookup prefill, success screen *"Done — hand the iPad back"*, auto-reset to the lookup step after 20 s, `noindex`.

## 6. Roster, pickup, multi-day (C5, M1, M7)

- `CheckinState` gains a day dimension:
  ```ts
  interface CheckinState {
    expected: string[] | null
    days: Record<string /*YYYY-MM-DD*/, { presence: Record<string, PersonPresence> }>
    pickupCodeHash: string | null   // one per household per EVENT
    codeAttempts: number            // wrong-code counter; reset on success/override
    lockedAt: string | null
    confirmedPickup: { name: string; phone?: string }[]
    notAuthorized: string
    events: CheckinEvent[]          // cap 2000
  }
  ```
  Legacy `presence` migrates on read into `days[eventStartDate]`. Roster shows the day selector only for multi-day events; the "current day" defaults to today (studio TZ) or the nearest event day.
- `CheckinEvent` gains `by`, `day`, and new actions `pickup-override`, `code-sent`, `locked`, `incident`, `settings`.
- **Check-in** (drop-off): first child check-in generates the code, hashes it, **sends it by SMS** to the signer (`sendQuoText`), shows it once. *Re-send code* button regenerates (new code, new hash, SMS to the signer; the old code is dead), logged as `reissue-code` with `by` — the plaintext is never stored, so "re-send" always means "re-issue."
- **Pickup panel** (drop-off, child selected): code input; **authorized chips** from `confirmedPickup` → tap fills *Collected by*; typing a name not on the list requires the checkbox **"Not on the list — I checked their photo ID"**; `notAuthorized` shown in red above the panel. Server: correct code → release, `pickedUpBy` stored **per person on the event**, SMS to signer *"{Kid} picked up by {name} at {time} — Hometown Studio"*. Wrong code → `codeAttempts++`, 5 → `lockedAt` set, panel says *Locked — use Override*. **Override** button → reason radio (*Called parent at {phone} and verified* / *Parent present* / *Other: __*) → `pickup-override` event with reason + `by`; clears the lock.
- **Card meta line:** *Signed Aug 3 · v2 · valid to Aug 2027* (M1). Drop-off roster: banner **DROP-OFF — pickup codes required**; header warning when kids checked in > 12.
- **Print roster** (M7): `/staff/print?kind=&id=&day=` — names, allergies/meds, emergency, authorized/not-authorized, blank in/out columns; `window.print()`.

## 7. Incident (H4)

- 🚑 **Incident** in the header on every console screen. Sheet fields: *who* (roster picker for the current event, or free text), *what happened*, *first aid given*, *witnesses*, *parent notified — at / by / how*; auto: staffer, event, day, timestamp.
- `POST /api/staff/incident.json` → store `incidents` key `incident-{id}`; also appended to the event's `CheckinEvent[]` as `{action:'incident', incidentId}`; **email** to Kaden + Catherine immediately (Gmail). Read-only list under the event ("Incidents (1)").

## 8. Copy email + archive (C6, H3)

- `sendAgreementCopyEmail(record, addendum?)` in `email.ts`, fired after `persistWaiver()` (non-fatal): who it covers, valid-through, version, full agreement text rendered from `serializeAgreement()`, plus the addendum text when it was accepted at that RSVP (also sent on a returning drop-off RSVP, since that's the first time they saw it). Party/kit confirmation emails gain one line: *Agreement on file for … (valid through …)*.
- `netlify/functions/archive-records.ts` — `schedule: '0 8 * * 0'` (Sun 3am CDT). Reads stores `waivers`, `rsvps`, `checkins`, `incidents`, `event-meta` via `@netlify/blobs`; writes `archive/{YYYY-MM-DD}.json` to an `archive` store; emails a zipped JSON to kaden@ourhometownstudio.com via the same nodemailer transport (`GMAIL_USER`/`GMAIL_APP_PASSWORD`). Also runnable by hand: `npx tsx scripts/archive-records.ts`. Subject line includes record counts so a silent failure is visible by its absence.
- **Retention rule** written into `docs/CREW-OPERATIONS.md` and `waiver-store.ts` header: signatures, RSVPs, custody logs and incidents are never deleted (minor claims toll to age 21).

## 9. Lookup hardening (H2) + small fixes

- `POST /api/waiver/lookup.json` returns `{ found, firstName, kidCount, validUntil }` — **no kids' names**. On the party-RSVP path only, after "found," send a 6-digit SMS code (`otp-{recordId}`, 10 min, 5 attempts) and require it before issuing the reuse token. The door check (staff, authenticated) is unaffected.
- `validateParty` fails closed (M10). Cookie/compare/noindex (M4, in §4). `docs/WAIVER.md` generated by `scripts/gen-waiver-doc.ts` from `serializeAgreement()` + `serializeAddendum()`; test asserts `sha256(serializeAgreement()) === CURRENT_AGREEMENT_SHA` and same for the addendum (constants live next to the archive) (H6). `NEEDS-FROM-KADEN.md` item 2 updated.

## Data flow (drop-off event, one household)

1. Parent books a seat (Square Class) → confirmation → `/waiver?workshop={classScheduleId}&booking=…` → reads text → signs (WaiverRecord) → addendum box (RSVP with `addendumVersion`) → copy emailed.
2. Day 1, 6:00pm: crew picks their name on the iPad → Today → taps the event (DROP-OFF chip) → family card → ticks kids → **Check in** → code generated, hashed, SMS'd, shown once → `checkin` event with `by`.
3. 8:50pm: Grandma arrives → crew taps Grandma's chip, types code → release → `pickup` event with `by`, `pickedUpBy` → parent gets SMS.
4. Day 2: same family card, day selector on "Tue" → check in again (same code, no new SMS unless *Re-send*).
5. Sunday 3am: archive emails itself.

## Error handling

- Storage 503s keep the existing "check wifi" copy; all writes remain CAS + retry. SMS failures never block a custody action (logged, badge *"SMS didn't send — tell the parent the code"*). Email failures are non-fatal and logged. Square Team unavailable → static owner fallback for the picker. Lock/override paths always leave a way forward (override never fails closed).

## Testing

Vitest, following existing patterns (`tests/api/*.test.ts` mock stores; `tests/lib/*` real logic):

- `checkin.json`: code required only when `dropOff && child`; denied logged; 5 attempts → locked; override clears lock + logs reason + `by`; code retired when last child out; re-issued on undo; per-day presence independent; legacy `presence` migration.
- `rsvp-store` + `sign.json`: fresh sign writes waiver + RSVP; reuse writes RSVP only, no WaiverRecord; forced re-sign when version < `substantiveSince`; drop-off RSVP without addendum → 400; addendum version/hash recorded.
- `event-meta`: overlay defaults; history + `by`; days default to start date.
- `staff-auth`: signed cookie round-trip, tamper, `by` stamped; fail-closed when passcode unset.
- `coverage.json`: GOOD TO GO / EXPIRED / NOT ON FILE; kids' names present for staff, absent from public lookup.
- `incident.json`: stored, appended to event log, email called.
- `archive`: exporter produces one JSON per store with counts; runs against the fs-fallback store in tests.
- Hash constants for agreement + addendum.

## Sequencing (3 working days, dev pushes as we go; prod when green)

1. **Day 1** — §4 staff identity, §1 event model/meta, §5 Today/Door/kiosk, §9 small fixes.
2. **Day 2** — §2 RSVP records + forced re-sign, §3 addendum + form changes, §8 copy email, §9 lookup OTP.
3. **Day 3** — §6 pickup completion + multi-day + print, §7 incident, §8 archive, remaining tests, docs regen, `CREW-OPERATIONS.md` §5 updated to match the software.

Follow-up (post-launch): Programs enrollment re-wired as `kind:'program'` events on this rail; `ChildIntakeStep` retired.
