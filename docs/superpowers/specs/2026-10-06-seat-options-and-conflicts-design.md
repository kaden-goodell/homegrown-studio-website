# Seat options, sign-up cutoffs, and class/party conflict guards

**Date:** 2026-10-06 · **Owner:** Kaden · **Status:** approved in chat (design), building on `dev`

## Why

Catherine's October classes need things we can't do today:

- **Bedazzled Pumpkin Pails** (Oct 18, 1–3 PM, $25) needs every seat to pick a pumpkin colour (Light Pink / Light Blue / Black / Lavender) because the pails are painted ahead. Square's class bookings have no per-seat options at all, so the choice must be recorded on our side and shown to staff.
- Classes with prep need a **sign-up cutoff** so five people can't book 30 minutes before.
- Parties and classes don't know about each other. Sunday party slots (1:00, 3:30) collide with Sunday classes; a class could be created on top of a booked party.
- Kaden wants an **unmissable warning panel** on the staff console when anything is overbooked or overlapping.

**Hard rule (Kaden, 2026-10-06):** nothing in this build ever cancels, moves, or releases a customer's booking. Every guard refuses the NEW thing and reports the conflict. Existing bookings are only ever touched by Kaden, by hand, in Square.

## Decisions (from chat)

| # | Decision |
|---|---|
| 1 | Options, cutoff, drop-off and days are all **event settings** in the existing `event-meta` overlay store, edited from the gear sheet on `/staff` and from the CLI. No deploy to add a question to a class. |
| 2 | One pick **per seat**, required. "You pick what you get": no changes after purchase. The desk can note a swap in the family's History; nothing in the data changes. |
| 3 | Sign-up cutoff: default **0 h** for a plain class; default **24 h** once a class has options; **editable per class** (Kaden: "in case we need a couple of days"). |
| 4 | Square gets the picks only as a booking **note** ("Pumpkin color: Lavender ×2"). The structured record lives in a new `seat-choices` store. |
| 5 | Parties **yield to classes**: a party slot is offered only if no class overlaps it, including the **60-minute cleanup before the class**. Checked in the availability endpoint and in the pre-charge guard. |
| 6 | **No class over a booked party**: the class-creation paths we control refuse when a party booking overlaps the class window (class start − 60 min through class end). No force flag. Square's own dashboard can't be hooked; the warning panel is the backstop. |
| 7 | **Warning panel** on `/staff` Today: red, top of page, every load; also a daily email when it is non-empty. |
| 8 | Price fix out of scope here but done 10/6: Kinusaiga $40 → $35. |

2026-10-07 (Kaden): one hour between ANY two events in either order; classes closer than that are warned, party times blocked.

## Scope

### A. Event settings (`src/lib/event-meta.ts`, `/api/staff/event-meta.json`, `EventSettingsSheet.tsx`, `scripts/set-dropoff.ts`)

`EventMeta` gains:

```ts
options: SeatOption[]            // [] = none
signupCutoffHours: number | null // null = default (0, or 24 when options.length > 0)

interface SeatOption {
  id: string          // slug, e.g. "color"; stable once bookings exist
  label: string       // "Pumpkin color"
  choices: string[]   // ["Light Pink", "Light Blue", "Black", "Lavender"]
}
```

- `setEventMeta` patch accepts `options` and `signupCutoffHours`; history entries record them. Validation: ≤ 3 options per event, label ≤ 40 chars, 2–12 choices, each ≤ 30 chars, no duplicate choices (case-insensitive). Options can be **edited only while the class has no seat-choice records**; after that, choices can be added but not removed or renamed (server refuses with a plain message), so stored picks stay valid.
- `effectiveCutoffHours(meta)` helper: `meta.signupCutoffHours ?? (meta.options.length ? 24 : 0)`.
- Gear sheet: a "Questions for each seat" block (label, choices as chips, add/remove) and a "Sign-ups close" field (hours before start; shows the default greyed when unset). Same confirm-and-log pattern as Drop-off.
- CLI: `scripts/set-dropoff.ts` renamed in spirit to `scripts/set-event.ts` (keep the old name as an alias): `--option "Pumpkin color=Light Pink|Light Blue|Black|Lavender"`, `--cutoff 24`, `--show`.

### B. Public surface (`/api/workshops.json`, `workshop-view-model.ts`, `WorkshopCard.tsx`, `WorkshopBookingModal.tsx`)

- `listWorkshops()` output is merged with event-meta in the API route (not in the provider): `WorkshopData` gains `options`, `signupClosesAt` (ISO) and `signupClosed` (boolean, computed server-side so client clocks don't matter).
- Card: after the cutoff the Book button becomes a quiet "Sign-ups closed" label (same place, not a disabled button). Sold-out logic unchanged.
- Modal, Details step: under the seat count, one required `<select>` per seat per option, labelled "Seat 1 · Pumpkin color". Seat count change re-renders the selects, keeping earlier picks. The Pay button is disabled until every select has a value. One line of copy under the selects, reused from the party made-to-order wording and shortened:
  > Picks are made ahead for you, so they can't be changed after you book.
- Payload adds `picks: { seat: number; optionId: string; choice: string }[]`.

### C. Booking server (`/api/workshops/book.json.ts`, `seat-choices` store, Square note, email)

- Load event-meta for the schedule. If `signupClosed` → `409 not_open` with "Sign-ups for this class closed <n> hours before it starts." (nothing held or charged).
- If the event has options: every seat must have one pick per option, each a listed choice → else `400 invalid` naming the first problem. If it has none, `picks` must be empty.
- New store `seat-choices` (`makeKvStore('seat-choices','seat-choices')`), key `seat-choices-workshop:<scheduleId>-<bookingId>`:

```ts
{ eventKind: 'workshop', eventId, bookingId, orderId, customer: { givenName, familyName, email, phone }, seats, picks, at, attemptId }
```

  Written **after** the charge succeeds (the same place the confirmation email is sent); a failed write logs an owner alert but does not fail the booking (the money is taken; the picks also went to Square as a note and to the email).
- Square note: `reserveSeats` gains an optional `note`; the POST body sends `customer_note` when present. If Square rejects the field, retry once without it (the picks are still stored on our side). Verified behaviour goes into the `square-class-bookings` memory.
- Confirmation email: a "Your picks" block listing seat → choice, and the no-changes line.

### D. Roster (`/api/staff/roster.json`, `Roster.tsx`, `HouseholdCard.tsx`, `/staff/print`)

- Roster response gains `choices: { totals: Record<optionId, Record<choice, number>>, byEmail: Record<emailLower, Pick[]>, unmatched: { name, email, seats, picks }[] }`.
- `Roster.tsx`: when the event has options, a totals strip at the top: "Pumpkin color — Lavender 6 · Black 4 · Light Pink 3 · Light Blue 2 (15 seats sold)". Per-family card: a "Picks: Lavender ×2" line. A "Paid, not signed in yet" list under the roster for bookings with no matching waiver email, by customer name, with their picks.
- Print sheet: same totals line under the title; per-row picks in a new column.

### E. Parties yield to classes (`src/lib/party-availability.ts`, `party-slots.ts`)

- `openPartyStarts(date)` additionally fetches that day's classes (`providers.workshop.listAllWorkshops()`, which already includes in-progress and sold-out ones) and removes any candidate whose window `[start, start + duration + cleanup]` overlaps `[classStart − cleanup, classEnd]`. Both windows use `partyConfig.cleanupBufferMinutes` (60).
- The book endpoint's pre-charge re-verify uses the same function, so a stale panel can't book a removed slot.
- If the class lookup fails, availability is **not** blocked (same graceful rule the file already has for party bookings) but the failure is logged, and the warning panel (G) will catch any resulting overlap.

### F. No class over a booked party (`scripts/create-class.ts`, Chrome in-tab step, `src/lib/conflicts.ts`)

- New `src/lib/conflicts.ts` with pure functions over plain intervals: `partyBlocksClass(classStart, classEnd, parties)`, `classBlocksParty(...)`, `overlaps(a, b, bufferMinutes)`.
- `scripts/create-class.ts` (and the reschedule path) calls `providers.booking.listBookings` for the class day and refuses when a non-cancelled party overlaps `[classStart − 60 min, classEnd]`, printing the party's time, host name and booking id, and the sentence "Move the party in Square first (your call), then re-run." No `--force`.
- The in-browser schedule step (run from Kaden's signed-in Square tab) gets the same check before the POST/PUT, implemented as a small script that queries our own `/api/staff/conflicts.json?from=&to=` (below) — so the rule lives in one place.

### G. Warning panel + daily email (`/api/staff/warnings.json`, `WarningsPanel.tsx`, `netlify/functions/daily-warnings.ts`)

`GET /api/staff/warnings.json` (staff-authed) scans the next 60 days and returns a list of:

| Code | Condition | Line shown |
|---|---|---|
| `class-over-party` | a class window (−60 min) overlaps a non-cancelled party booking | "Sun Oct 18 · Pumpkin Pails 1:00–3:00 PM overlaps the Rivera party 1:00 PM. Move one in Square." |
| `class-over-class` | two classes overlap in time | "… Needlepoint 6–8 PM overlaps Girls Craft Night 3–5 PM" (only if they do) |
| `oversold` | seats sold > capacity (Square `total_capacity` vs bookings) | "… 27 seats sold, 25 capacity" |
| `party-on-closed-day` | a party booking on a day `studioOpenOn()` says is closed | "… party booked on a closed day" |
| `picks-missing` | class has options, a booking has no `seat-choices` record (booked outside our site) | "… 2 seats have no pumpkin colour — call the customer" |

- Today screen: `WarningsPanel` renders above the search box when the list is non-empty: red border, "⚠ Needs attention (3)", one line each, with the event link. Nothing is dismissible and nothing auto-fixes.
- `netlify/functions/daily-warnings.ts`, schedule `0 12 * * *` UTC (7 AM CT): runs the same scan and emails `ownerEmails` only when there is at least one warning. Subject "⚠ Studio schedule needs attention (n)".

### Out of scope

- Changing picks after purchase (desk notes it in History).
- Any Square-side structure beyond the booking note.
- Blocking Square's own dashboard from creating a conflicting class.
- Programs (`kind: 'program'`, still HOM-220).
- Party crafts and kits: untouched.

## Data and compatibility

- `event-meta` records without the new fields normalize to `options: []`, `signupCutoffHours: null`.
- `seat-choices` is new; no migration.
- Public API additions are additive; `WorkshopData` consumers that ignore the new fields keep working.
- Local dev keeps event-meta and seat-choices on disk under `.data/`.

## Testing

- Unit: event-meta validation (limits, edit-after-bookings rule), `effectiveCutoffHours`, `conflicts.ts` interval math incl. the 60-minute buffer on both sides, `openPartyStarts` removing slots around a class, cutoff computation across DST.
- API: book.json refuses late and invalid picks before holding seats; stores picks after charge; note retry path; roster totals/byEmail/unmatched; warnings endpoint for each code; event-meta patch validation and 401s.
- Components: modal selects (required, per seat, survive seat-count change), card "Sign-ups closed", roster totals strip and card line, warnings panel.
- Browser walkthrough on local dev: book two seats of Pails with picks → roster shows totals and the family's picks → print sheet; a party slot on Oct 18 is gone; create-class refuses over a seeded party; warnings panel lists a seeded overlap.
- Gate before merge: full vitest, tsc, build; preview check.

## Rollout

Build on a branch off `dev`, one writer at a time, review per stage, merge to `dev`, verify on the preview. Pails on Oct 18 is the first real use: the dev→main push must land before sign-ups open (Kaden's call; prod is also still pre-waiver-rail).
