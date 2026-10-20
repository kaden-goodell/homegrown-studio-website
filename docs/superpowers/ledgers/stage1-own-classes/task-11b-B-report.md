# Task 11b-B report: Classes tab, class sheet, New class, library (direction D)

Worktree `/Users/catherine/source/homegrownStudio-admin`, branch `kaden/admin-d`, base cc81826. Not pushed.

## Status
Done. `npx tsc --noEmit`: 0 errors. `npx vitest run`: 282 files, 3607 passed, 0 failed. The 3 clock tests in events.test.ts pass at this hour.

## Commits
- `f5de5be` feat(classes): every new class lands in the library on its own; library versions say what changed and who (server)
- `9d5922a` feat(admin): one class sheet (Bookings · Details · Dates), single-screen New class, library tiles and sheets (client, plus the carried 11b-A polish)
- `16e4ff1` fix(admin): polish from the hands-on check

## What was built

### Server (`src/lib/classes/admin-actions.ts`, `library-store.ts`, `content-diff.ts`, routes)
- **Auto-add (R21).** A create with no `libraryId` saves library version 1 and links the class (`libraryId`, `libraryVersion`) in the same request.
  - The library is written before the class, after the clash check, so a refused class adds nothing.
  - The usual length and seats come from the first date.
  - If the library can't be written, the class is still added, unlinked, with the warning "Added. It didn't go into the library this time, so it won't show there."
- **Create from the library** with `alsoUpdateLibrary: true` ("This class and the library") saves a new version first, but only when the details differ (`contentChanges`, dates, seats and status left out). Without it the class keeps the latest version number.
- **Update** with `alsoUpdateLibrary` now skips the new version when the library already has the same details.
- **Library versions (I4).** Each version records `changed`, worked out on the server in the owner's words (Name, Photo, Price, Ages, Description, Teacher, Ways to book, Seat prices, Extras, Questions, Booking rules, How long it usually runs, Seats it usually has). This also happens on restore. The version's `by` comes from X-Admin-Who (built in 11b-A).
- **Additive fields on existing routes.** No contract was removed.
  - Library GET adds `runs`: per library class, `lastIso`, `nextIso` and the latest class's times. These feed "Last ran Oct 23", "6–8 PM usually" and the Schedule it start time.
  - Classes GET adds `totals` per class (bookings, seats, money taken less refunds) for Past.
  - Bookings GET adds `seatsTaken` per date, and `waiting` on each booking (a refund still waiting on Square, R29), so the shared RefundPanel shows "I checked Square".

### Client
- **Classes tab** (`ClassesTab.tsx`): + New class in the header, then Upcoming · Drafts · Past · Library.
  - **Upcoming:** grouped by day, "N of M booked" (plus "· 2 dates"), status tag. Cancelled classes sit in a folded "Cancelled (n)" group. "Still run from Square" stays at the end (R-A4).
  - **Drafts:** the note "Drafts are saved but not on the website yet.", then each draft with its day and price.
  - **Past:** newest first, "N bookings · N seats · $X", and the note "Tap a past class to see who came or refund someone."
  - **Library:** the note, then photo tiles reading "Last ran <date> · $price". A quiet Show archived link sits underneath.
- **Class sheet** (`sheets/ClassSheet.tsx`). Every entry point uses it: Home, Calendar, the Day sheet and Classes rows (`class-<id>`); `edit-<id>` opens it on Details. The header is the name, then "Day · time · price" and a status tag (plus Past).
  - **Bookings:**
    - "N of M seats booked" and "$X taken so far", plus seats per date when there are several dates.
    - Each booking shows the name, seats (by kind), package, paid, comp or counter, a refunded tag, answers, extras, phone and email links, and the over-capacity warning.
    - Each booking has the shared `RefundPanel` inline. It goes through `api()`, so it carries X-Admin-Who and the 401 hook.
    - Footer: Print list (the class's day) and Text everyone. Text everyone shows the numbers as selectable text, Copy the numbers, and an Open Messages `sms:` link.
  - **Details:**
    - Preview button, the photo picker (thumbnail, Choose/Change/Remove, hidden input, 4:3 crop as before), Name, Price per seat, Ages, Description.
    - The More options fold: Teacher, Ways to book (one card per way, price boxes stacked), Seat prices, Extras, Questions, and Ages and booking rules with "Minimum to run: Needs [N] by [day] [time]" in studio time. It opens on its own when it has content or an error.
    - Save stays disabled until something changes. When the details differ from the linked library's latest version, Save becomes "Only this class" (primary) and "This class and the library".
    - A failed save scrolls to and focuses the first error, and the footer says "Fix the price under Details."
    - On a 409 stale, the typed form stays. The sheet says "Someone else changed this class. Your edits are kept; check them and save again. They changed: Price." The next save uses the new `updatedAt`.
    - At the bottom, a red-outline "Cancel this class" opens an in-sheet confirm. It lists everyone booked (name, seats, phone) before anything is sent: [Keep it] [Cancel class]. Cancelling then shows the Bookings tab with who to contact, and refunds nobody.
    - A cancelled class has its details locked, with a note on how to run it again.
  - **Refund everyone** (after a cancel only):
    - It has its own confirm naming each person and amount, and lists who isn't included (paid in Square, or not paid here).
    - Each booking gets a whole-booking refund with its seat freed, one request at a time, each with its own attempt token. Each person's result shows.
    - "Try the ones that didn't go through" reuses the same tokens. Nothing runs on its own.
  - **Dates:**
    - The shared `DateRows`. Each date is a fieldset "Date N" with Day, Starts, Ends and Seats; the end follows the start and keeps the length.
    - "+ Add another date"; an Open · Draft · Closed switch with a one-line explanation; Save dates, disabled until a change.
    - Moving a booked date puts the people in the footer with [Move and I'll tell them] and [Don't move]; Don't move puts the old dates back. After the move, a "Moved. Let these people know." list shows.
    - Clashes show under the dates.
    - A "Run it again on new dates" button.
  - The Details and Dates tabs keep their own unsaved changes while you switch tabs. Either counts for the leave prompt.
- **New class** (`sheets/NewClassSheet.tsx`, a centred card on iPad):
  - Start fresh / From a past class. Picking a library class fills in the name, price, usual time, seats, photo and every detail.
  - Then photo, Name, DateRows (the date is filled in when opened from a day), Price per seat and Ages, Description, More options, and the note "It goes into your library on its own, so you can run it again later."
  - Footer: [Add class] and a quiet [Save as draft]. If it started from the library and the details changed, Add class becomes "Only this class" / "This class and the library".
  - A clash shows next to the dates.
  - After adding: the new class's sheet opens on Bookings with the toast "Added. It's on the calendar and in your library." (or the server's warning instead).
  - The same sheet serves Schedule it (`libsched-<id>`) and Run it again (`again-<id>`, the class's details with its dates a week on).
- **Library sheets** (`sheets/LibrarySheets.tsx`):
  - **`lib-<id>`:** photo, "$35 a seat · 10 seats", "6–8 PM usually", "Last ran …".
    - Footer: [Schedule it], then [Edit details] [Archive]. Archive asks in the sheet, then closes with an Undo toast.
    - Earlier versions shows each version with its date, who made it, what changed, and Restore. An archived class offers Bring it back.
  - **`libedit-<id>`:** the same details form plus "How long it usually runs" and "Seats it usually has" (library only). Saves a new version.
- **Removed:**
  - "Add and keep in the library", "Add a class to the library" (`libnew`) and "Change details, then schedule".
  - Components: `ClassEditor`, `ClassBookings`, `ScheduleDialog` (its date rows are now `DateRows`), `ClassList`, `LibraryList`, and `/admin`'s copy of `RefundPanel` (`components/shared/RefundPanel.tsx` gained an optional `send`).
  - `quiet` from `ui.ts`.

### Carried from 11b-A re-review 2
- Call and Email are the same height (`align-content: start`). The address is one line with an ellipsis, and the full phone and email are selectable in a new "How to reach them" section.
- Month view: the open day is filled and today keeps its ring.
- Inbox segments: short labels with a count badge, on a row that scrolls with scroll-snap and never clips.
- Small month cells say "Closed"; the holiday name shows in wide chip cells, the aria-label and the sheet.
- A sheet's Try again reloads the data: the boundary has `onRetry` plus `resetKeys`, so a fixed record draws.
- Answer groups each have their own boundary, so a half-broken request still shows the name, phone and email.
- Inbox counts skip records that can't be shown.
- The Day sheet's count skips the closure, and an empty closed day has no Print.
- The fold pill uses a CSS chevron.

## Files
- **New:**
  - `src/lib/classes/content-diff.ts`
  - `src/components/admin/classes/{class-form.ts,ClassDetails.tsx,DateRows.tsx,labels.ts,library-data.ts}`
  - `src/components/admin/sheets/{ClassSheet,NewClassSheet,LibrarySheets}.tsx`
- **Changed:**
  - `src/lib/classes/{admin-actions,library-store,types}.ts`
  - `src/pages/api/admin/classes/{library,classes}.json.ts`
  - `src/components/admin/{AdminShell,ClassesTab}.tsx`
  - `sheets/{ClassSheets,CalendarSheets}.tsx`
  - `shell/{router.ts,Boundary.tsx}`
  - `inbox/{Inbox,InboxData,InboxSheets,answers}.tsx`
  - `classes/{CalendarView.tsx,ui.ts}`
  - `src/components/shared/RefundPanel.tsx`
  - `src/styles/admin.css`
- **Deleted:** the components listed under Removed above, and their tests (ported, see below).

## Tests
- **Server (`tests/api/admin-classes.test.ts`, +8, 1 rewritten):**
  - From scratch, the library has the class at version 1 (`changed: []`, made by the owner, usual length and seats from the first date) and the class's `libraryId` is set; the library list shows it.
  - A refused class (a clash) adds nothing to the library.
  - When the library is down, the class is added unlinked with a warning.
  - From the library: without the choice the library stays the same; with "This class and the library" a new version is saved, with `changed: ['Price','Description']`.
  - Versions record who and what changed, including on restore.
  - `runs`, `totals`, `seatsTaken` and `waiting` come back.
  - Rewritten: "alsoUpdateLibrary on a class with no library entry" now says the class is already at version 1 and the same details add no version.
- **`DateRows.test.tsx` (5):**
  - The fieldset with Day, Starts, Ends and Seats; the end follows the start.
  - A typed end resets the length.
  - Add and Remove a date.
  - Run it again (a week on, lengths kept).
  - `checkRows` errors and studio-time instants.
  - A clash shown under the dates.
- **`NewClassSheet.test.tsx` (16):**
  - Errors focus the first field and the footer says what; a clash shows inline; the create body.
  - Prefilled from a day.
  - After Add: the class sheet opens, the toast shows, and nothing is left marked unsaved; a warning toast replaces the usual one.
  - Draft.
  - Only one way to add.
  - Ways to book and Seat prices; removing them clears their prices.
  - Number boxes; Minimum to run; no waitlist field.
  - Where the price error shows.
  - The photo picker and Preview.
  - From a past class fills everything in.
  - The choice shows only when the details changed (time and seats don't count).
  - Schedule it opens with nothing unsaved.
  - Run it again with two dates.
- **`ClassSheet.test.tsx` (22):**
  - The header, summary and booking rows with the RefundPanel.
  - A refund carries X-Admin-Who.
  - A waiting refund shows the check.
  - Seats per date.
  - Print list and Text everyone.
  - The empty text.
  - Save disabled until a change; it sends `expectedUpdatedAt`, then the new one.
  - The choice only when content differs from the library, and a plain Save when the class is changed to match it.
  - A stale 409 keeps the form and says what they changed.
  - The first error is focused, with the footer line.
  - The POS warning.
  - More options opens on its own.
  - A cancelled class is locked.
  - Cancel lists who's booked before confirming, and makes no refund call.
  - A stale cancel.
  - Refund everyone: confirm, Never mind, each result, a retry with the same token, the comp row.
  - Dates: the switch and the save; the move confirm with Don't move, then Move and I'll tell them; a clash inline; Run it again; unsaved changes kept across tabs.
- **`LibrarySheets.test.tsx` (6):**
  - The sheet's contents, Schedule it and Edit details.
  - Archive with Keep it, then Archive with Undo.
  - Versions with who and what changed, and Restore.
  - Bring it back.
  - Edit details saves the usual fields and moves on without a leave prompt.
  - A usual length out of range is caught before sending.
- **`ClassesTab.test.tsx` (5):** Upcoming (grouping, booked counts, status tag, folded Cancelled, opening a class), Drafts, Past, Library tiles and archived, + New class. It also fails if the tab ever asks about the sandbox (ported from ClassList).
- **`AdminShell.test.tsx` (+7 new, 5 updated to the new screens):**
  - New: `#edit-` opens on Details; inbox counts skip an unreadable record; scrolling inbox segments; a half-broken request still shows how to reach them; a sheet's Try again reloads; the Day sheet's closure count and Print; every class entry point opens the one class sheet.
  - Updated: they now look for the class sheet's tabs instead of "Edit class", and check the New class footer (Add class + Save as draft).
- **Other tests:**
  - `RefundPanel.test.tsx` (shared): +1 for `send`.
  - `router.test.ts`: `again` and `lib` tokens; `libnew` is gone; the class sheet is a panel.
  - `layout-css.test.ts`: +3 (contact column and address, month active vs today, the chevron).
  - `CalendarView.test.tsx`: the Halloween phone cell now reads "Closed".
- **Ported tests:**
  - Every ClassEditor, ClassBookings, ScheduleDialog, LibraryList and ClassList case has a counterpart in the files above.
  - The deleted admin RefundPanel test was an exact subset of the shared one, which stays.

## Visual check
- **Setup:** `ADMIN_PASSCODE=<temp> npx astro dev --port 4341`.
  - Sample classes, ledgers and library entries were seeded in `.netlify/blobs-serve/{entries,metadata}/0/site:<store>/`: an open class with 3 bookings including a comp, a draft with a 68-character name, a past class, a cancelled class with a card and a POS booking, and a two-date class.
  - The app was viewed in a same-origin iframe at 390×844, 820×1100 and 1024×768.
  - The iframe's `fetch` refused every POST to classes, refund, blocked, photo and seed, so nothing could reach Square, email or texts. Refund everyone was pressed against that guard to see the failure line.
  - Only browsing and typing (never saved) were done.
- **Checked:**
  - Classes Upcoming.
  - The class sheet: Bookings, Details with the choice footer, More options, and the Cancel list before confirm.
  - Bookings on the cancelled class with the Refund everyone confirm and result.
  - Dates on the two-date class.
  - New class › From a past class.
  - Library tiles and the library panel with versions at 820.
  - New class as a centred card at 1024, and the class panel beside Home at 1024.
  - No horizontal scroll at any width.
- **Found and fixed** (`16e4ff1`):
  - "comp · comp" on a comp row.
  - The rules' two boxes misaligned because their labels wrap differently.
  - Refund everyone still showing beside its own results.
  - The Cancelled fold had no marker.
- **Cleanup:** the seeded `entries/` and `metadata/` were deleted (the folder was empty before and is empty again). The server is stopped and the tab is closed. `git status` is clean.

## Deviations from the mock-up and the brief, and why
1. **Ages is a text box, not the mock-up's select.** Stored ages are free text that `agesLabel` turns into "Ages 8+". A select would lose existing values like "8-12". The hint shows how it will read. Drop-off is a checkbox under Ages and booking rules.
2. **New class dates use DateRows** (Date 1: Day · Seats / Starts · Ends) rather than the mock-up's separate Day, Starts/Ends and Seats rows. The brief asks for one date component everywhere, and this also allows more than one date. Price per seat sits beside Ages.
3. **[Refund] on each booking is the shared RefundPanel's own buttons** (Refund, Free their seat, I checked Square), drawn under the row rather than as a single button at the row's right edge. The panel and its R22–R31 rules are reused, not copied.
4. **Text everyone** shows the numbers, Copy, and an Open Messages link (`sms:/open?addresses=…`, which is how iOS opens a group). It does not open a text on its own. That link format is iOS-specific and hasn't been tried on a real iPhone.
5. **Preview** is a toggle at the top of Details, New class and Edit details, not a button in the sheet header. The header already holds the title and ×.
6. **Cancel and Refund everyone.**
   - Cancelling switches the sheet to Bookings, which shows the "Who to contact" panel. That panel is worked out from the bookings, so it is still there after a reload.
   - Refund everyone includes only bookings paid online here, with money left and no refund waiting on Square. The rest are named in the confirm as not included.
7. **Run it again** (a "Run it again on new dates" button on Dates, opening New class) is not in the mock-up. The UX review's "Run it again → the new class's sheet opens" needed a home now that ScheduleDialog is gone. It uses the create path, not `duplicate`, so the library choice applies. The `duplicate` route is kept.
8. **Library extras:**
   - A quiet "Show archived" link, so the "Bring it back" coverage from the old library list is kept.
   - "First runs <date>" or "Not run yet" for a library class that hasn't run.
   - Earlier versions is a button in the sheet body, not in the footer, so the footer stays Schedule it, then Edit details | Archive, as in the mock-up.
9. **Status labels** are Open · Draft · Closed, with a one-line explanation under the switch ("On the website, with sign-ups closed.").
10. **Past** includes past drafts and past cancelled classes (with their tags), so a cancelled class that still needs refunds can be found. Upcoming folds only cancelled classes that are still ahead.
11. **"What changed" labels** split "Ages" from "Booking rules", because Ages now sits in the main details. The versions list shows "First version" for version 1.
12. **Inbox segments** keep the full words ("To decide") with a count badge and scroll sideways if needed, rather than shortened labels.

## Concerns
- **Copy and sign-in changes in the shared panel:** RefundPanel's copy is unchanged, and /staff still uses its own sender.
  - /admin's refunds now go through `api()`. They record the named owner (previously "Owner") and a 401 returns to sign-in.
- **The library choice only appears after the library loads.** The class sheet loads the linked library to compare. If that load fails, Details shows a plain Save (Only this class) rather than guessing.
- **Library failures on create:**
  - If the library can't be written for a new class, the class is added unlinked. It then won't appear in the library until a later "This class and the library" save on it.
  - If library creation succeeds but the class write then fails, an orphan library entry remains. The library is written first so that a clash can't leave one, and the class write is very unlikely to fail on its own.
- **Not checked on real devices:**
  - The iOS group-text link format.
  - The 820 iPad portrait layout, which was only checked in a browser frame.
- **Not changed:**
  - BlockTimeForm and PrintDay still use `ui.ts` inline styles (not in this task's scope).
  - The mock-up's Block time "Why" segments (11b-A deviation 7) are still not built.

---

# Fix round 1

Commits:
- `0f0d3b5` (server)
- `b267c20` (client: every review item)
- `717f45a` (camera glyph on library rows in New class)

These fix all 3 Important items, all 16 quirks and all 9 Minors from `task-11b-B-review.md`, following rulings R35 and R36.

Checks:
- `npx tsc --noEmit`: 0 errors.
- `npx vitest run`: 283 files, **3638 passed, 0 failed** (run three times).
- One admin-suite run failed once while the dev server was shutting down; it didn't recur in 9 reruns.

## Important

**I1 (R35): a retried Add never makes a second class, library entry or POS item.**
- **Client:** New class mints a `createKey` (UUID) when the sheet opens. It keeps it across retries and makes a new one after a success. Schedule it and Run it again use the same sheet, so they get the same behaviour. `duplicate` accepts `createKey` too.
- **Server reservation:** `reserveCreate()` stores `ck-<sha>` → `{ classId, libraryId }` in a new `class-create-keys` store, with compare-and-set, before anything is written.
- **Same ids on every try:** the class is created with the reserved id (`createClass({ id })`). The library entry uses `saveLibraryVersion({ createId })`, which returns an entry that already exists instead of adding a second.
- **A replay with the same key** finds the class and returns it (`replay: true`). It finishes a missing library link and a missing POS item, and makes nothing new. It skips the clash check, which would otherwise be against itself.
- A key that isn't a plain 8–80 character token is refused with 400 before any write.

**I2 (R36): an unlinked class goes into the library.**
- `linkToLibrary()` saves version 1 from the class's own details (usual length and seats from its first date) and links the class. The library id comes from the class id, so two calls at once make one entry.
- Any successful `update` of an unlinked class links it and returns `libraryAdded`. The toast says "Saved. It's in your library now."
- A new action, `{ action: 'link-library', id }`, is what the class sheet sends, once and quietly, when it opens an unlinked class. It shows no toast. If it fails, the sheet says "This class isn't in your library yet. It'll go in when you save it."
- The create-time warning now reads "Added. It'll go into the library the next time you open or save it."

**I3: money matches /staff.**
- Rows use `moneyWords()`, which is `paidWay()` plus the amount when money came in:
  - "Paid online · $76.30"
  - "Comped"
  - "Not paid yet"
  - "Counter sale · $32.70"
- `takenCents()` (in `booking-words.ts`) gives 0 for comps and for unpaid counter seats. "Taken so far", Past totals and the cancelled list all use it.
- The RefundPanel gets `counterSalesAtRegister`, as on /staff.

## Quirks
1. The counter row and the refund panel now agree (I3).
2. The cancelled panel says "Refunded N of M · $X." from the data, or "Nobody has been refunded yet." It lists every booking, including refunded ones.
3. A stale save on Details refills Dates from the fresh class when Dates weren't touched, and the reverse.
4. The cancelled contact list has tappable phone (`tel:`) and email (`mailto:`) links, with the text showing.
5. The Refund everyone confirm title is "Refund 2 people · $98.10 in all?", or "Refund 1 person · $41.42?".
6. Text everyone scrolls its panel into view.
7. **Print list:**
   - One date: it opens Print with "‹ Back to <class>", which reopens the class sheet.
   - Several dates: the footer asks "Print which date?" first.
8. Picking a past class after typing asks "Replace what you typed? [Keep mine] [Replace]" in the sheet. Picking one class and then another doesn't ask.
9. The library choice only shows when the details were changed in this sheet and differ from the library's. Run it again on a class that already differs from the library is a plain Add.
10. New class defaults to a week out, moved on to the next day the studio opens (`OPEN_WEEKDAYS`, closures). A tapped day still wins.
11. Editing a date clears the "People are booked" prompt.
12. A booked date says "N booked on this date. Moving it asks first; it can't be removed while people are booked."
13. With several dates, the first summary card is "N bookings on N dates" instead of repeating a per-date line.
14. Drafts rows have no "Draft" tag. Past's note sits on top, like Drafts.
15. Library tiles and the New class library rows show the camera glyph when there's no photo. The library is ordered most recently run (or coming up) first.
16. **Library sheet:**
    - Price: "$35 a seat", but "$20 adult · $15 kid" and "From $15" stay as they are.
    - "Earlier versions (N)" counts only earlier versions, and is hidden when there are none.

## Minor
1. The Classes segment is remembered in `sessionStorage`. A class sheet with no saved tab opens over Classes (`homeTabOf`).
2. Usual times:
   - A library class's usual time comes from a class on the website; a draft is used only when there's nothing else.
   - Drafts never count as "Last ran" or "First runs".
3. Run it again finds an archived library entry, because the list includes archived entries; the picker leaves them out.
4. A "This class and the library" save that matches the library points the class at the latest version.
5. Footer buttons say "Saving…", "Adding…" or "Moving…" on the one that is working.
6. A 401 on a photo upload goes back to sign-in (`sendPhoto` → `adminSignedOut`).
7. **Edit details on a library class sends `expectedVersion`:**
   - A save over a newer version is refused as stale (409), with "Someone else changed this library class. Your edits are kept; check them and save again."
   - The typing stays. Save waits for the fresh copy and then saves over it.
   - Server-side field errors focus the field.
8. Refund everyone ends with a toast ("Refunded all 3." / "Refunded 2 of 3. Open the class to try the rest.") that shows even if the sheet was closed while it ran.
9. A past class's dates are read only, with a note and Run it again.

## New tests
- **Server (+10):**
  - The same key twice gives one class, one library entry and one POS item.
  - A class write that fails after the library entry was made: the retry reuses that entry.
  - A replay finishes the library link and the POS item.
  - Duplicate with a key; a bad key gives 400.
  - Library down at create, then a plain Save links the class (`libraryAdded`).
  - `link-library` twice at once makes one entry; a third call is a no-op.
  - The version bump when the details already match.
  - Totals leave out an unpaid counter seat and a comp.
  - The usual time ignores a draft.
  - A stale library save is refused with nothing written.
- **ClassSheet (+10):**
  - I3 words and the total.
  - I2 heal on open, and the toast when it fails.
  - The libraryAdded toast.
  - Q2.
  - Q3.
  - Q6, Q7 and Q13.
  - Q11 and Q12.
  - M8.
  - M9.
  - M5.
- **NewClassSheet (+5):**
  - I1: the key is kept across a retry.
  - Q10: `defaultDay()`, including the Halloween weekend.
  - Q8.
  - Q9.
  - M3.
- **LibrarySheets (+2):** Q16, M7.
- **ClassesTab (+2):** Q14 with M1; Q15.
- **`photo.test.ts` (new):** crop, and M6.
- **router:** `homeTabOf` for a class.
- **Updated:**
  - Wording assertions now use paidWay and the new confirm title.
  - The harness fixture is linked to the library by default; tests that need an unlinked class say so.
  - `tests/setup.ts` clears `sessionStorage` after each test.

## Visual re-check
- **Setup:** `astro dev` on port 4341 with a throwaway passcode, and the same seeded classes plus an unpaid counter seat.
- **Guard:** an iframe `fetch` guard refused every POST that could reach Square, email or texts. It let through only the local, blob-only `link-library` call, which wrote two library entries and two audit rows to the local emulated store; these were deleted afterwards.
- **390:**
  - The counter row reads "1 seat · Not paid yet", and "taken so far" is $114.45 without it.
  - Opening the unlinked class added it to the library quietly, with no toast.
  - The cancelled panel has the links and "Nobody has been refunded yet."
- **820:** the class panel's "Print which date?" picker; the Cancelled fold chevron.
- **1024:** New class opens on Thu Oct 29 (the next open day a week out); "Replace what you typed?" appeared after typing and then picking.
- No horizontal scroll at any width.
- **Cleanup:**
  - `.netlify/blobs-serve` is empty again.
  - The server is stopped and the tab is closed.
  - `git status` is clean.

## Notes and concerns
- **Self-heal on open:** opening an unlinked cancelled class also adds it to the library. R36 says any unlinked class, so I kept it.
- **Cleanup of create keys:** the create-key records are never cleaned up. They are small, one per Add.
- **Stuck Save in Edit details:** if the refetch after a stale library save fails, Save stays disabled. The sheet shows the load error with Try again.

---

# Fix round 2

Commits: `0f66aab` (server) and `e35305d` (client). They fix N1–N6 and QN1–QN4 from `task-11b-B-rereview1.md` (ruling R37).

Checks:
- `npx tsc --noEmit`: 0 errors.
- `npx vitest run`: 283 files, **3650 passed, 0 failed**.

## Changes

**N1 (R37): nothing is added or moved into the past.**
- **Server:** a new or moved date that starts in the past is refused with 400 "Pick a date from today on." (`field: 'sessions'`). This applies to create, duplicate and update. A date left unchanged is never re-checked, so a class whose date has passed can still be saved.
- **Client (Run it again):** the copied dates move forward by whole weeks until the first one is on or after the next open studio day (`defaultDay()`), skipping closures. Weekday, times and the gaps between dates stay the same. For example, Kinusaiga (Sat Oct 10) now opens on Sat Nov 7, because Oct 31 is the Halloween closure.
- Schedule it already starts on `defaultDay()` or the tapped day. A refusal from the server shows under the dates.

**N2: replays say so.**
- When the reply is `replay` and the class that comes back differs from what was sent (status, dates, price or name), the toast is "This class was already added. Here it is." and the class opens.
- Every toast now follows the class's real status, so it never says "draft" for a class that is open.

**N3: a second guard on parallel creates.**
- `createClass` now writes create-only and throws `ClassExistsError` if the class is already there.
- `scheduleClass` and `duplicateClass` turn that error, or a clash with their own reserved class, into a replay.
- The local file store now honours create-only (`writeFile` with the `wx` flag). Before this, the reservation's compare-and-set was only proven by reading the code; now it holds in tests and local dev too.
- New test: 3 parallel sends of the same key give 1 class and 1 library entry.

**N4: Edit details keeps the typing when the reload fails.** If the reload after a stale save fails, the form stays on screen. The error shows above it with Try again. Save turns back on once the latest copy loads.

**N5: a stale save caused only by the library link.**
- **Server:** `linkToLibrary` reads the class again before writing. If it is already linked, it writes nothing, so the class keeps its `updatedAt`.
- **Client:** on a 409 stale, if no details, dates or status changed (only the background library link did), the save is sent again once, quietly, with the fresh `updatedAt`.

**N6: a counter sale paying two bookings is counted once.**
- Counter (`pos`) and pay-at-the-counter (`door-counter`) lines count their own price and tax, never the sale's `chargedCents`. This applies in `groupBookings` and in the cancel list.
- Test: one sale paying two bookings gives $32.70 for each booking and a total of $65.40.
- Refund caps (`refunds.ts`) are unchanged.

**QN1:** A booked date shows "Has bookings" in place of Remove.

**QN2:** Read-only (past) dates don't show the booked hint.

**QN3:** When a refund doesn't go through, the toast says "Refunded 0 of 1. Try the rest below." while the sheet is open. If the sheet was closed, it says "…Open the class to try the rest."

**QN4:** The library is ordered by last ran (newest first), then classes only coming up (soonest first), then "Not run yet" (latest edited first).

## Tests
- **Server (+4):** past dates on create, update and duplicate, with an unchanged past date still allowed; parallel same-key creates; a link-library that writes nothing when the class is already linked; a counter sale split across bookings.
- **Client (+8):**
  - `onOrAfter`, including skipping a closure;
  - "Has bookings" and no hint on read-only dates;
  - Run it again from a class three weeks old, plus the server's past-date refusal shown inline;
  - the replay toast;
  - the quiet re-save after a library link;
  - the QN3 toast;
  - Edit details after a failed reload;
  - library order.

## Visual re-check
- **Setup:** the same seed, `astro dev` on port 4341, the iframe guard as before.
- **Checked:**
  - At 390, Run it again for Kinusaiga fills in 2026-11-07, and the booked Date 1 shows "Has bookings" while the new Date 2 can be removed.
  - At 820, the library reads Kinusaiga (Last ran Oct 10) and then Rondelle (First runs Oct 22), with no horizontal scroll.
  - At 1024, the Run it again card looks right.
- **Cleanup:** the seed is deleted, the server is stopped, the tab is closed, and `git status` is clean.
