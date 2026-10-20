# Task 11b-B review: Classes tab, class sheet, New class, library (direction D)

- **Range:** `cc81826..16e4ff1` on `kaden/admin-d`, in the worktree `/Users/catherine/source/homegrownStudio-admin`. Three commits: f5de5be, 9d5922a and 16e4ff1.
- **Checks:**
  - `npx vitest run`: 282 files, **3607 passed, 0 failed**.
  - `npx tsc --noEmit`: **clean**.
- **Hands-on setup:**
  - I ran `ADMIN_PASSCODE=review-only-123 npx astro dev --port 4337` with seeded blobs in `.netlify/blobs-serve/{entries,metadata}/0/`:
    - library entries: Punch Needle v1→v2 "Price", Mug, and an archived Macrame;
    - an open class with a card booking (2 seats), a comp, an unpaid counter seat and a refunded booking;
    - a draft with a 68-character name;
    - a past class with card and door-card bookings;
    - a cancelled class with card, POS and comp bookings;
    - a 2-date class spanning the DST change (Oct 28 and Nov 4);
    - a closed class.
  - The app ran in a same-origin iframe at 390×800, 820×800 and 1024×768.
  - A guard replaced the iframe's `fetch` and answered every POST locally: either a refusal (503) or a canned 409 stale, 409 peopleToTell, create success or refund success. The server log shows only `POST /api/admin/login.json`. Nothing reached Square, Gmail or texting.
- **Cleanup:**
  - The seeded files are deleted, the server is stopped and the tab is closed.
  - `git status` is clean.

## Verdict: **Needs fixes**: 3 Important · 16 UX quirks · 9 Minor

---

## Spec table

| # | Brief item | Status | Where |
|---|---|---|---|
| 1 | Classes tab: [+ New class] in the header; Upcoming · Drafts · Past · Library | Met | `ClassesTab.tsx:107-114` |
| 1a | Upcoming grouped by day, "N of M booked"; Cancelled in a folded group | Met | `ClassesTab.tsx:95-98,119-136` |
| 1b | Drafts with the note | Met | `:138-147`. The draft row repeats a "Draft" tag; see Q14. |
| 1c | Past newest first, "N bookings · N seats · $X", plus the note | Partly | `:149-155`. The $X counts unpaid counter seats (I3), and the note sits under the list. |
| 1d | Library photo tiles "Last ran · $price", the note; tap → library sheet | Met | `ClassesTab.tsx:187-224` |
| 1e | Library sheet: photo, price/seats/usual time, last ran; Schedule it / Edit details / Archive (in-sheet confirm + Undo) / Earlier versions + Restore | Met | `LibrarySheets.tsx:29-133`. Archive, Undo and versions were checked hands-on. |
| 2 | Class sheet header (name, "Day · time · $", tag) and tabs | Met | `ClassSheet.tsx:122-128,306` |
| 2a | Bookings: summary, rows (seats, package, paid/comp/counter, refunded tag), RefundPanel inline, Print list, Text everyone, per-date counts | Partly | `ClassSheet.tsx:308-375,449-491`. An unpaid counter seat reads "paid $X" (I3); RefundPanel text contradicts the row (Q1). |
| 2b | Details: photo picker, name, price, ages, description, More options fold (auto-opens), Preview | Met | `ClassDetails.tsx:43-139,316-331` |
| 2c | Save disabled until a change; first error focused + footer line | Met | `ClassSheet.tsx:136-161,270-282`. Focus is covered by tests; rAF doesn't run in a hidden tab, so it couldn't be seen hands-on. |
| 2d | Stale 409 keeps the typed form + the exact sentence | Met | `ClassSheet.tsx:164-172`. Checked hands-on: the typed name was kept and the note shown. Side effect in Q3. |
| 2e | "Only this class / This class and the library" only when content differs | Met | `ClassSheet.tsx:134,274-281`. Hands-on: price 40 gives two buttons; back to 35 gives Save; a name change gives two again. Unlinked classes never get the choice (I2). |
| 2f | Cancel at the bottom (red outline) → in-sheet confirm listing who's booked → who to contact; never refunds | Met | `ClassSheet.tsx:386-410,206-222,335-366` |
| 2g | Dates: shared DateRows ("Date N" · Day · Starts · Ends · Seats, end follows start), + Add another date, Open/Draft/Closed, Save dates | Met | `DateRows.tsx:73-116`, `ClassSheet.tsx:414-433` |
| 2h | Move-with-bookings confirm: the people + [Move and I'll tell them] [Don't move] (Don't move restores) | Met | `ClassSheet.tsx:285-297`. Hands-on: the list showed and Don't move put back 18:00–20:00 on Oct 24. |
| 3 | New class single screen: segment, photo, Name, dates, price, seats, More options, note, [Add class] + quiet [Save as draft]; iPad centred modal | Met | `NewClassSheet.tsx:169-225`. At 1024 it is a 680px centred card. |
| 3a | Date prefilled from a day | Met | `#new-2026-10-29` gives "On Thu Oct 29" and the Date 1 day 2026-10-29. |
| 3b | Clash shown inline next to Dates | Met | `NewClassSheet.tsx:154-158`. Hands-on: the message showed under the dates and the footer said "Fix the dates above." |
| 3c | After add: the class sheet on Bookings + toast "Added. It's on the calendar and in your library." | Met | `NewClassSheet.tsx:161-166`. Checked hands-on. |
| 3d | From the library with details changed → the two choices | Met | `NewClassSheet.tsx:127,173-181`. Hands-on: a time change kept Add class; a price change gave the two choices. |
| 4 | Server auto-add: library v1 + link in the same request; "This class and the library" saves a new version | Partly | `admin-actions.ts:251-298`. It is not idempotent, and a half-failure leaves orphans or duplicates (I1). The unlinked fallback never heals (I2). |
| 4a | Remove "Add and keep in the library", "Add a class to the library", "Change details, then schedule" | Met | Removed, with the components deleted. |
| 4b | Test: from scratch → library v1, `cls.libraryId` set | Met | `tests/api/admin-classes.test.ts` |
| 5 | Every class entry point opens this sheet | Met | `shell/items.tsx:72`, AdminShell test "every class entry point" |
| I3 | Cancel shows people (name, seats, phone) before the confirm; separate Refund everyone with its own confirm naming person + amount; per-booking results; never automatic | Met | `ClassSheet.tsx:225-243,249-262`. Hands-on: the confirm read "Cara Card · $41.42" and left out the POS booking. A failed result was followed by a retry that reused the same attempt token, sending kind=booking and freeSeat. |
| I4 | Versions: "what changed" server-side + who | Met | `library-store.ts:49-72`, `content-diff.ts`. Hands-on: "Mon Oct 5 · Catherine · Price". |
| I5 | Minimum to run "Needs [N] by [day] [time]" → decideByIso (Chicago) | Met | `ClassDetails.tsx:263-274`, `class-form.ts:192-195` |
| I6 | No waitlist field | Met | Absent |
| T14 | Shared RefundPanel; admin copy deleted; R29 waiting respected | Met | `ClassSheet.tsx:487`, the `classBookings` `waiting` field (`admin-actions.ts:565-574`), and `canRefund` excludes `waiting` |
| 11b-A carry | Call/Email height, month open vs today, inbox segments, holiday names, Try again, half-broken request, inbox counts, Day-sheet count/Print, chevron | Met | These are in the report and the tests. I didn't re-check them visually beyond the Home and Classes screens. |
| Security | Owner auth on every route; X-Admin-Who | Met | Every `api/admin/classes/*` route checks `adminAuthorized`; unauthenticated GET and POST return 401 (curl). The refund route goes through `api()` and so carries X-Admin-Who. The photo upload sends `adminHeaders()`, but a 401 there doesn't return to sign-in (M6). |

---

## Important

### I1. Create isn't idempotent: a lost reply or a half-failure leaves a second library entry (and a second class)
**Where:** `admin-actions.ts:270-293` and `NewClassSheet.tsx:146-160`.

**The problem:** The library is written first (`:274`), then `createClass`, then `syncPos`. `syncPos` calls Square's catalog, including the photo upload, so it can be slow on a cold start.

**Failure cases:**
- **The class write fails after the library write succeeds.** That leaves an orphan library entry. The owner sees "Didn't save. Try again.", taps Add again, and gets a second library entry for the same class. The library then shows it twice.
- **The reply is lost** (a function timeout or an iPhone network drop while Square syncs) after the class is saved. A retry makes a **second class**, with a second POS item and a second library entry.
  - The duplicate class was possible before this task.
  - The duplicate library entry is new.

**Why it matters:** The brief requires that a half-failure never leaves two library entries on retry, so this doesn't meet it.

**Fix (small):**
- New class mints one `attempt` key when the sheet opens and sends it with every Add.
- The server derives the class id and library id from that key, for example `cls_`/`lib_` plus a hash of the attempt.
- If the class already exists, the server returns it, as a replay.
- `saveLibraryVersion` must also skip creating a second entry when one with that id exists.
- This also makes the class-first order safe if preferred: write the class, then write the library, then link.

### I2. An unlinked class never reaches the library (no self-heal)
**Where:** `admin-actions.ts:281-284`, `ClassSheet.tsx:104-111,134` and `NewClassSheet.tsx:96-97`.

**The problem:** When the library write fails, the class is added unlinked and the toast says "It didn't go into the library this time, so it won't show there." After that, nothing ever links it:
- With no `libraryId`, `library` is null, so `differsFromLibrary` is false. The sheet only ever offers the plain Save, which never sends `alsoUpdateLibrary`.
- "Add a class to the library" has been removed, so the owner has no way to fix it.
- Classes made before R21 are also unlinked. Two of my seeded ones, Candle Pouring and Two-Week Pottery, never appear in the Library tab.

**Answer to the question asked: yes, it should self-heal.** The cheapest fix is on the server:
- In `updateScheduledClass`, when the saved class has no `libraryId`, save library v1 from its content (with `usualFrom` the first date) and link it. Do this on any successful save, without needing `alsoUpdateLibrary`. The warning path stays as it is.
- Optionally, also do it when "Run it again" or Schedule it creates from that class. This already happens today, by accident, because `libraryId` is null.
- Change the toast copy so it promises the fix: "Added. It'll go into the library the next time you save it."
- Add a test: the library write fails on create, the next plain Save links the class at v1.

### I3. Money is misstated: an unpaid counter seat reads "paid $X" and counts in "taken so far" and the Past totals
**Where:**
- `ClassSheet.tsx:458` (`paid = … b.paidHere || b.paidCents ? 'paid …'`)
- `ClassSheet.tsx:301` (`totalTaken`)
- `admin-actions.ts:199-203` (`totals.cents`)

**The problem:** `paidCents` falls back to the line's price when there is no `chargedCents`. So a door-counter seat that was never rung up (no `square.orderId`; see `door-unpaid.ts:30`) shows as "1 seat · paid $38.15 · at the counter".

**What I saw hands-on:**
- The shared RefundPanel directly under the row says "Nothing was paid for this seat. Free the seat instead."
- The summary "$114.45 taken so far" included that $38.15.

**Why it matters:** The owner uses Past "N bookings · N seats · $X" and "taken so far" to reconcile. Both overstate the money while a counter seat is unpaid. Task 14 deliberately flags unpaid door seats (`door-unpaid`), and this screen hides them.

**Fix:**
- Use `paidWay()` from `booking-words.ts`, which /staff already uses ("Not paid yet" / "Paid at the counter").
- Leave unpaid door-counter seats out of `totalTaken` and `totals.cents`. Either count only lines with an `orderId` or `paymentId` (comp is $0 anyway), or add a `takenCents` to the view.
- Add a test with an unpaid counter seat.

---

## UX quirks

1. **Counter row contradiction** (the same root as I3): the row says "paid $38.15 · at the counter" while the panel says "Nothing was paid…". Once a counter seat has been paid at the POS, /admin should pass `counterSalesAtRegister`, as /staff does, so the panel says to refund at the register rather than offering an online refund.
2. **"Nobody has been refunded."** stays in the cancelled panel (`ClassSheet.tsx:347`) after Refund everyone shows "Cara Card: Refunded $41.42". It also stays when someone was refunded on their own row earlier. Word it from the data, for example "N not refunded yet", or hide it once results exist.
3. **The stale 409 on Details also re-bases Dates** (`ClassSheet.tsx:169-170`). `baseRows` becomes the server's, while `rows` keeps what was on screen.
   - If the other owner moved a date, the Dates tab now holds the old dates as "unsaved changes".
   - Save dates lights up, and closing asks "Leave without saving?" for something she never touched.
   - Tapping Save dates would move the class back.
   - Fix: refill the rows untouched by her (when `rows` equals the old `baseRows`, set `rows` to the fresh rows), and the same for `status`.
4. **The cancelled contact list prints "paid $0" for a comp** (`ClassSheet.tsx:343`). Use "comp". Its phone numbers and emails are plain text there, while the rows below have tappable `tel:`/`mailto:` links.
5. **"Refund everyone?" with one person** reads oddly, and the confirm has no total. Show "Refund 1 person · $41.42" in the title, or a total line for several people.
6. **Text everyone opens its panel at the top of the scrolled body**, from a footer button. With a long list scrolled down, nothing visible happens. Scroll the panel into view, or show it in the footer.
7. **Print list leaves the class sheet.** It replaces the sheet with the print sheet, and Back or × lands on the tab, not the class. For a multi-date class it prints only the next date's day.
8. **Picking "From a past class" silently replaces whatever was typed**, including the name (`NewClassSheet.tsx:102-109`). Ask first, or keep a typed name.
9. **Run it again on a class whose details differ from the library** opens straight into "You changed the details. Keep the changes for:", though she changed nothing in this sheet. The copy is false there. Say "This class's details differ from the library's" in that case.
10. **The New class default date is a week from today**, which today is a Monday the studio is closed. Default to the next open day (Thu–Sun), or the day after the last class.
11. **After Move and I'll tell them**, the rows stay editable while the prompt shows. Editing a date then confirms a move the people list wasn't worked out for. Clear `toTell` when the rows change.
12. **Remove date N on a booked date** gives no warning until Save. The 409 list then appears, which is fine, but a quiet "N booked" hint on a booked date's fieldset would help.
13. **The multi-date summary repeats itself**: "1 of 6 seats booked, Wed Oct 28", then the per-date list with the same line. When there are several dates, drop the date-specific summary and show the total bookings.
14. **The Drafts segment shows a "Draft" tag on every row** (the segment already says so). The Past note sits under the list; the mock puts it on top, like Drafts.
15. **Library tiles without a photo are blank beige blocks.** Show the camera glyph PhotoPicker uses, or the initial. The library is in insertion order; most recent first would match "run it again".
16. **Library sheet:**
    - "$20 adult · $15 kid a seat" and "From $15 a seat" read wrong, because "a seat" is appended to a multi-price label (`LibrarySheets.tsx:106`).
    - "Earlier versions (2)" counts the current one.

---

## Minor

1. **The Classes segment isn't in the hash.** A refresh or Back returns to Upcoming, and a refreshed `#class-…` sheet opens over Home rather than Classes.
2. **`libraryRuns` (`admin-actions.ts:217-232`)** takes the usual start time from the latest class, drafts included. A draft at an odd time changes Schedule it's default for everyone.
3. **Archiving a library entry, then Run it again from one of its classes:** `useLibraryList()` excludes archived entries, so the class can't find its library. The create goes without a `libraryId` and silently makes a second, duplicate library entry. Pass `includeArchived`, or look it up by id.
4. **`updateScheduledClass` + SameAsLibrary:** when the content equals the library's latest, the class's `libraryVersion` isn't bumped to that latest version.
5. **Two-button footers don't show "Saving…" or "Adding…"** (only `disabled`). A slow Square sync gives no feedback.
6. **`uploadPhoto` (`photo.ts:55`)** uses a raw `fetch`, so a 401 doesn't return to sign-in. The text "Sign in first." shows as a photo error instead.
7. **The library Edit details save has no stale guard.** Two owners can overwrite each other's version silently; a new version is still added, so it can be restored. A failed save doesn't focus the field.
8. **Refund everyone keeps running if the sheet is closed mid-run.** The loop keeps posting with nobody watching the results. Ask before closing while `refundAll === 'running'`, or carry on and show a toast summary.
9. **The Dates tab on a past class is fully editable**, so a past class can be moved into the future. Consider making the dates read-only once every date has ended, keeping only Run it again.

---

## Deviations judged

| # | Deviation | Ruling |
|---|---|---|
| 1 | Ages is a text box | **Accept.** It keeps "8-12"-style values, and the hint shows how it renders. |
| 2 | DateRows in New class (Day·Seats / Starts·Ends) | **Accept.** One component everywhere was the brief's priority. |
| 3 | RefundPanel buttons under each row rather than one [Refund] at the right | **Accept.** Reuse beats a copy. Visually heavy but clear. |
| 4 | Text everyone = numbers + Copy + `sms:/open?addresses=` | **Accept.** Still needs a real-iPhone check; note it for Kaden's device test. |
| 5 | Preview as a toggle in the body | **Accept.** |
| 6 | Cancel → Bookings "who to contact"; Refund everyone only for bookings paid online here | **Accept.** It is correct per R29 and "never automatic". See Q2 and Q4 for the wording. |
| 7 | "Run it again on new dates" on Dates (uses create, not `duplicate`) | **Accept.** It gets auto-add and the library choice. See Q9. |
| 8 | Show archived, First runs / Not run yet, versions button in the body | **Accept.** |
| 9 | Status labels Open · Draft · Closed with a one-liner | **Accept.** |
| 10 | Past includes past drafts and cancelled classes | **Accept.** Sensible for refunds. |
| 11 | "Ages" split from "Booking rules" in what changed | **Accept.** |
| 12 | Inbox segments keep the full words and scroll | **Accept.** It was verified as non-clipping by the implementer's test. |

**Concerns:**
- **"Library down → class added unlinked":** not acceptable as the end state. It should self-heal on the next save (see I2).
- **"Orphan library entry if the class write fails":** combine it with idempotency (see I1).
- **"The choice appears only after the library loads; a plain Save if the load fails":** acceptable. It is the safe default.
