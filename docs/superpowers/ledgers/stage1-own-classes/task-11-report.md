# Task 11 report: admin screens

Status: DONE. One commit a5581fc `feat(admin): calendar, class editor, library, block time, print day` on kaden/own-booking-system (not pushed).

## What was built
- `AdminApp.tsx`: new tabs Calendar, Classes, Library, Block time (before Private events / Messages / Teachers). A "panel" (class editor, class bookings, print day) covers the tab content while open; Back returns. The default tab stays Private events, so the existing tests and the owner's current landing page don't change. Class tabs fetch only when opened.
- New owner-only routes:
  - `GET /api/admin/classes/calendar.json?from&to`: `busyBetween()` items, with our classes' `status` added. Range capped at 45 days. A source that can't be read gives a 503, never an empty calendar.
  - `GET /api/admin/classes/day.json?day=YYYY-MM-DD`: the print sheet. Our sessions that day with grouped bookings (refunded ones left out) plus waiver signers from `listWaiversByEvent('workshop', cls_id)`. Parties and legacy classes come with their signers. Café, blocked and closed show as plain lines. Read only.
- `classes/CalendarView.tsx`: week view by default (a list of days on a phone, seven columns at 900px and wider) and a month view (a 7-column grid of dots, tap a day to list it). Every kind has its colour (`KIND_STYLE`, with a legend) and drafts are marked. Tapping our class opens its bookings. Tapping blocked time asks twice before removing it. Anything else shows a read-only detail. Each day has a Print button.
- `classes/ClassEditor.tsx`: one form for four modes (new, from-library, edit, library). Basics and Sessions start open. Passes & prices, Ticket types, Questions, Add-ons and Rules start closed unless they already hold something beyond the defaults. A section also opens when an error lands in it.
  - The default class is one pass "Full class" (covers all), one ticket "Person" and one price. While the grid is 1×1, Basics shows a "Price per person ($)" field.
  - Price grid: rows are passes (name, what it covers, Remove), columns are ticket types, each cell is a dollar input, and an empty cell is not sold. Removing a pass or ticket type drops its cells.
  - The form checks itself before sending. Server `{error, field}` replies show inside the matching section.
  - Edit sends `expectedUpdatedAt` and refreshes it from every save reply. A 409 "Someone else changed…" shows that sentence with a Reload button (refetches through bookings.json and resets the form).
  - A 409 with `peopleToTell` lists name, email and phone, plus a "Move and I’ll tell them" button that resends with `confirmMove: true`.
  - Save warnings (POS, library) are shown.
  - Save options: "Just this date" / "Also update the library" when the class came from the library (edit uses `alsoUpdateLibrary`; from-library create does a follow-up library save). A new class gets "Add class" / "Add and keep in the library". Library mode gets "Save to library".
  - Photo: `classes/photo.ts` crops to 4:3 on a canvas, scales the longest side to 1600px or less, and tries JPEG at 0.85 → 0.45 until it is under 4 MB, then uploads to photo.json. The returned URL becomes `imageUrl`.
  - Live preview: the real `WorkshopTile` from a browser-built `WorkshopData` (`classes/preview.ts`).
- `ScheduleDialog.tsx`: one or more dates (end follows the usual length), seats, Open/Draft. Creates from the library (`libraryId`) or duplicates (`duplicate`, prefilled with the source sessions one week later). A clash shows the server sentence and keeps the form as typed.
- `LibraryList.tsx`: cards with price, length, seats, ages and version. Actions: Schedule, "Change details, then schedule", Edit, Versions (restore), Archive / Bring back, and Show archived.
- `ClassBookings.tsx`: the class's sessions with seats taken, and bookings read only (seats per ticket type, pass, contact links, per-seat picks, add-ons, paid / refunded, source, over-capacity warning).
  - Each booking has an empty `<div data-refund-slot={bookingId}/>` where Task 12 adds Refund. No refund calls exist.
  - Edit class, Run it again (duplicate), Cancel this class (asks first, sends `expectedUpdatedAt`, then lists who to contact; stale 409 shows Reload).
- `BlockTimeForm.tsx`: day, From/To or All day, optional reason. A 409 with `clashes` shows the sentence and a "Block anyway" button (resends with `confirm: true`). Coming-up list, with Remove after a confirm.
- `ClassList.tsx` (Classes tab): upcoming classes with the next date, status and seats taken, plus New class. "Set up sandbox" posts seed-sandbox.json and shows both ids and the two env commands. On a 409 the button goes away and the sentence shows.
- `PrintDay.tsx`: has its own day picker and Print button (`window.print`). A print stylesheet prints only the sheet. Per class it shows seats X of Y, per-ticket totals, pick totals per question, add-on totals, and a roster table (name, seats, picks, phone, waiver signed / no waiver yet / unknown).
- Small helpers: `classes/api.ts` (fetch wrapper; network failure becomes a plain sentence), `dates.ts` (studio-day maths), `ui.ts`.

## Tests
- New: `tests/components/admin/classes/*.test.tsx` (Calendar 5, Editor 12, Schedule 3, Library 4, Bookings 4, BlockTime 5, ClassList 3, PrintDay 2), `tests/api/admin-classes-calendar.test.ts` (5), and 2 new AdminApp tab tests.
- Full suite: 264 files, 3244 tests passing. `npx tsc --noEmit -p .` = 0.

## Concerns / notes for review
1. Waiver status on Print day matches a booking's email to the signer emails indexed under `('workshop', cls_id)`. This assumes the waiver page indexes our classes under kind `workshop` with the cls_ id. confirmation.ts links `/waiver?workshop=<cls_id>`, but I did not confirm the waiver API indexes it that way. If it doesn't, every booking shows "No waiver yet".
2. Party rosters on Print day are only the waiver signers (name + kid count). Party guest detail lives behind staff auth, and per the ruling I added no further server work.
3. Default tab is still Private events. Making Calendar the landing tab is a one-line change if Kaden wants it.
4. In the editor, a session ending at or before its start is refused (no past-midnight sessions).
5. `LibraryList` calls `ownPriceLabel` with `ClassContent` through a cast. The function only reads pass ids, ticket labels and prices.
6. Not checked in a real browser at 400px. Layout uses wrapping flex/grid with `minmax`, the price grid scrolls inside its own box, and every button is the site `.btn` (48px) or has min-height 2.75rem.

## Fix round 1 (commit eb307ef)

Changes:
1. ClassEditor: "Most people per booking" and "How many they pick" are held as text in form state (`maxPerBooking`, `chooseCounts`). They can be cleared and retyped, and build() checks them ("The most people per booking is 1 to 40." / "<pass> needs to let people pick 1 to 60 sessions."). The other number boxes (usual length, usual seats, session seats, add-on most per seat, cutoff, minimum) were already text and are checked in build().
2. CalendarView: the detail has `key={id-startIso}`, so a half-confirmed Remove never carries to another block.
3. CalendarView: the detail renders straight after the tapped item, inside that day's list (week and month), and scrolls into view when it opens.
4. In the one-price layout, a price error shows under the Basics "Price per … ($)" box (new 'price' error key; the server's `field: 'prices'` maps there too). The Field error sits outside the <label>, so the box's name is unchanged.
5. "Just this date" and "Also update the library" are disabled for a cancelled class.
6. "Add and keep in the library" and from-library "Also update the library" now create the class, then send `update` with `alsoUpdateLibrary: true` and the created `updatedAt`. The server saves the library version and points the class at it (a new class gets a new library entry). The client's direct library save is gone. A failed link becomes a warning and the class is kept.
7. `reply()` in admin-actions.ts adds `stale: true` to the stale-class 409. ClassEditor and ClassBookings match on `extra.stale`, not the wording.
8. ScheduleDialog rows carry their own length (`minutes`). Copied sessions keep their length when the day or start moves, and a typed end resets the length.
9. day.json 401 test added.
10. (Added by coordinator) src/providers/square/workshop.ts: in the sandbox, listWorkshops/listAllWorkshops return [] and getWorkshop returns null without calling Square (the buyer classes API is production-only: 422 "No matching location found"). Production is unchanged and still fails closed. The existing provider test fixture now uses production.

Tests added: CalendarView (+2: confirm reset, placement), ClassEditor (+5: clear/retype numbers, price error on the price box, cancelled library class, library linking new, library linking from-library), ScheduleDialog (+1 copied length), day.json 401, admin-classes stale flag assertions, square workshop provider (+2 sandbox / production 422).

Commands and output:
- `npx tsc --noEmit -p .` → exit 0
- `npx vitest run tests/components/admin tests/api/admin-classes-calendar.test.ts tests/api/admin-classes.test.ts tests/providers/square/workshop.test.ts` → 12 files, 109 tests passed
- `npx vitest run` → 264 files, 3255 tests passed
