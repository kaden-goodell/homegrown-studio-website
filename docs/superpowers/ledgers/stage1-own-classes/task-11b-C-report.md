# Task 11b-C report: Hours & Craft Café, Closed days, To decide, Block time, Square import (direction D)

Worktree `/Users/catherine/source/homegrownStudio-booking`, branch `kaden/own-booking-system`, base 5700765. Not pushed.

## Status
Done. `npx tsc --noEmit`: 0 errors. `npx vitest run`: 296 files, 3830 passed, 0 failed.

## Commits
- `f3c40d6` feat(settings): saved café hours, special days and closed days in one store, used everywhere (server + consumers)
- `e3d7808` feat(admin): Hours & Craft Café and Closed days are editable; every admin screen uses the saved days (+ RM1)
- `e489ea5` feat(admin): To decide works: every kind has its choices, each recorded with who decided
- `88828f1` feat(admin): Block time Why (Closed · Private · Setup) + Note; BlockTimeForm and PrintDay on admin.css
- `73b0f2a` feat(admin): More › Bring in Square classes (dry run, then Add N)
- `dba84bd` fix(classes): RM2 duplicate replay; RM3 linkToLibrary passes expectedUpdatedAt
- `d499982` fix(admin): picked Inbox segment scrolls into view; "Café hours and special days"

## What was built

### 1. Studio settings store (`src/lib/studio-settings.ts`)
- kv `studio-settings`, key `settings`: `{ cafeWeekly[{weekday,opens,closes}], cafeSpecialDays[{date,opens,closes,name}], closures[{id,from,to,name,holiday?}], updatedAt, by, history }`.
  - Writes use compare-and-set.
  - `updatedAt` always moves forward.
  - History keeps the last 50 entries `{at, by, changed[] in plain words, before}`.
- **No document means the config.**
  - `getStudioDays()` returns `CONFIG_STUDIO_DAYS`, the same objects as `config/hours.ts` and `config/closures.ts`. Production behaves exactly as today until an owner saves.
  - Config closures get stable ids (`cfg-<from>`) when shown on /admin.
- **Loaders:** `getStudioDays/getClosures/getCafeHours({strict?, fresh?})`.
  - Answers are cached in-process for 60 s. A save replaces the cache at once on the instance that saved.
  - If the store can't be read: the last answer this server had, else the config (logged).
  - `strict` throws instead (room-clash checks never guess).
- **Validation:**
  - Times are HH:MM, and it must close after it opens.
  - Dates must be real YYYY-MM-DD. A closure's from ≤ to, at most a year; a blank To means one day.
  - Names are at most 60 characters. Blank names become "Special hours" / "a break".
  - Each weekday and each special date appears once.
  - Holiday is one of halloween / thanksgiving / christmas.
- **Pure rules now take the loaded list:**
  - `src/config/studio-days.ts` (`StudioDays`) is client-safe.
  - These take a `days` or list parameter, defaulting to config: `cafeHoursOn(ymd, cafe)`, `cafeRunsOn/cafeOn(ymd, days)`, `bookableOn/partyStartsForDate/partyStartsInRange(…, now, days)`, `blockedAndClosedBusy/busyBetween(…, days?)`. When not given, the last two load strict.
  - Sync config paths keep working unchanged.
- **Every consumer reads the saved days on the server:**
  - Party available-dates, availability and the book.json check. Book.json reads fresh, so a day closed a moment ago is never sold.
  - party-open-dates (notify-me emails) and party-availability.
  - Public `calendar.json`: closed rows, café filtered on closed days, party slots. It now also returns `closures`, which WhatsOnCalendar uses to shade and dress cells per month (config until the server answers).
  - studio-schedule `busyBetween`, which covers the admin calendar, the day sheet, staff calendar and class clash checks. A saved closure refuses a new class.
  - Warnings: party-on-closed-day.
  - Staff `week.json` (café hours per day), `events.json` (`cafeOpen`) and `open-studio.json` (`cafe`). ThisWeek, CheckInSheet and Today use these, with the config only until the server answers.
  - PartyModal's "N of M times still open" uses the server's `offered` count from available-dates and availability.
  - /craft-cafe and home are prerendered. They ship the config hours, then swap in `GET /api/cafe-hours.json` (weekly rows plus the special days in the next 60 days, on /craft-cafe) through `src/lib/cafe-hours-live.ts`.
  - SEO and STUDIO_HOURS stay config, as briefed. workshop-confirmation uses only `formatRange`.

### 2. Admin API `GET/POST /api/admin/settings.json` (owners only)
- **GET** returns `{settings}`: the saved settings, or the config with `updatedAt: null`.
- **POST** takes `{cafeWeekly, cafeSpecialDays, closures, expectedUpdatedAt}`, the whole document.
  - Errors: 400 with `field` (e.g. `cafeSpecialDays.0`); 409 `{stale, current}`.
  - Audited as `studio-settings` with who and what changed.
  - The reply lists what's already booked on newly added or changed closures: our classes, Square classes and parties, by `busyBetween` over each range. It stays booked; `bookedUnknown` is set if that couldn't be read.
  - The reply also gives the Square result.
- **POST `{action:'square-retry'}`** rewrites the café windows from what's saved (audited).

### 3. Craft Café windows in Square (`src/lib/cafe-windows.ts`)
- The script's exact calls were extracted: `catalog.object.get({objectId, includeRelatedObjects:false})`, then `catalog.object.upsert` of the whole item with name "Craft Café", flow `display` and `programDates`. Same idempotency-key form, same 255-character fit.
- `scripts/set-cafe-windows.ts` calls the lib. A dry run was checked and prints the same windows.
- **Behaviour changes in the script:**
  - It starts from today, never before the café's first day, so past windows don't eat Square's limit.
  - It warns that it writes the config hours, not the owners' saved ones.
- **On save** (when something changed): the next 90 days are rewritten from the saved settings, but only when the café item exists.
  - Not found on the sandbox: `skipped`, "Square café hours not updated on the test site."
  - Not found on live, or Square refusing: `failed`. The settings stay saved and the sheet offers Try again.
  - After a success, the public calendar's 60 s café cache is cleared (`short-memory.forget`).

### 4. Screens
- **More › Hours & Craft Café:**
  - Weekly rows: a fieldset per weekday with Opens/Closes, "No café on Saturdays", and "Add another day" (a select of unused weekdays). "Save café hours" stays disabled until something changes.
  - Special days coming up, each with Remove + Undo toast.
  - "+ Add a special day" fieldset (Day, What is it?, Opens, Closes; Never mind / Add day). It warns when the day is a closed day.
  - The note "A special day replaces the usual hours for that day. Closed days beat both."
  - Studio hours are read only ("Ask Kaden to change them").
- **More › Closed days:**
  - The list of closures coming up, each with Remove. Remove asks in the sheet ("Open … again? [Keep it closed] [Open these days]"), then gives an Undo toast.
  - The add form: From, "To (blank for one day)", Why, and a "Holiday look on the calendar" select (None/Halloween/Thanksgiving/Christmas). [Add closed days] sits in the footer.
  - After adding: the toast "Closed Sat Oct 24. Heads up: 1 thing is booked then. Nothing was cancelled." with Undo, plus an in-sheet "Already booked on those days" list.
  - The mock-up's note is shown, plus "also closed every Monday to Wednesday".
- **Both sheets:**
  - Stale saves keep the typing and say "Someone else changed these settings. Check them and save again."
  - Square failure shows a panel with Try again; the test site says it was skipped.
- **StudioProvider (`shell/studio.tsx`):** Home's closed-today text, the calendar month and week, the Day, Café and Closed sheets, More's "N coming up", and New class's first open day all use the saved days.

### 5. To decide (`src/lib/classes/to-decide.ts`, `GET/POST /api/admin/to-decide.json`, `inbox/ToDecideSheet.tsx`)
- **Sources, each read on its own** (a failing one is named in `warning`):
  - `listUnmatchedPos`
  - `listRefundFlags`: plain / failed / unfinished / unconfirmed
  - `listPosNeedsDays`
  - Classes below their minimum: from 3 days before decide-by until the class starts, open/closed only
  - `listDoorUnpaid`
  - `listCounterMatchChecks`
- Every decision is recorded in kv `to-decide` (`done-<id>`) and in the audit log (`to-decide-<action>`, who), so the item reads "Done · what · who". Done items show for 14 days. The Home counter and Inbox badge count only open items.
- **Counter sale to match:**
  - The sheet shows when it was rung up, the amount (read from the Square order with a GET; "See Square" if it can't be read) and the item.
  - The class is guessed from the item name. Pickers: class, then "Which seat?" (pass × ticket, when there is more than one), then the date(s) for pick-a-day passes.
  - [Match to this class] → `recordPos` (source `pos`, capacity ignored, over capacity marked). Then "Who are the seats for?" (one optional name per seat → `setNames` per line, audited).
  - [Not for a class] dismisses it (audited).
- **Refund done in Square:** [Keep their seat] → `decideRefundFlag kept-seat`. [Free a seat] → asks "Which seat?" when several are held → `decideRefundFlag freed-seat` (`freeSeatOnly`, no money).
- **refund-failed:** "Square couldn't finish this refund. Check it in Square, then mark it handled." [Mark as handled].
- **refund-unfinished:** [Finish it] → `clearRefundRequest` went-through. This finishes the saved request and emails once.
- **refund-unconfirmed:** [It went through] / [It didn't go through] → `clearRefundRequest`.
- **Counter seat needs its day:** pick the day(s) → `setPosDays`.
- **Short of its minimum:**
  - The sheet shows "N of M needed to run", decide-by, a meter, and who's booked (from bookings.json).
  - [Keep it running] records the decision.
  - [Text the N booked] shows the numbers, Copy, and Open Messages (`sms:`). Tapping Open Messages records "Texted the people booked".
  - It also has "Open the class" and "Nothing cancels on its own."
- **Not paid at the counter:** [Mark paid at the counter] → new `markDoorPaid` (the line's `paidAtCounter`; it reads "Paid at the counter" everywhere and counts as taken). [Free the seat] → `freeSeatOnly`.
- **Check a counter sale (R34):** [Yes, it was <name>] → `markCounterMatchChecked`. Or pick one of the other unpaid door seats that day (same pass and ticket) → new `moveCounterPayment`. The sale moves to that person and counts as checked; the first person goes back to not paid.

### 6. Block time
- **Why** is a segmented control (Closed · Private · Setup), stored as the block's `reason`: "Closed" / "Private event" / "Setup". Older free-text reasons still show.
- **Note (only you see it)** is new: optional, up to 200 characters.
  - The admin calendar carries `note` on blocked items.
  - The Blocked sheet shows Why and Note, and its Undo keeps the note.
  - The staff calendar does not get the note.
- BlockTimeForm and PrintDay have no inline styles or `<style>` left. The print rules moved to admin.css, and `classes/ui.ts` was deleted.

### 7. Bring in Square classes (Task 17a UI)
- A More row in its own list, "Classes from Square", opens `#more-import`.
- The sheet runs a dry run first. It lists what will be added (photo or camera glyph, name, price · ages, issues), photos to add, and what's left out with the reason (e.g. "Already in the library.").
- [Add N to the library] adds them, toasts "Added N classes to your library.", and refreshes. Each added class opens its library sheet.

### 8. RM1–RM3
- **RM1:** Run it again moves the copied dates by whole weeks to the first matching weekday on or after the next open day from today (`nextOpenDay`, using the saved closures). Example: a Sat Oct 17 class run again on Mon Oct 19 → Sat Oct 24.
- **RM2:** `duplicateClass` turns a clash with its own reserved class into a replay. Tested: 3 parallel sends make 1 class.
- **RM3:** `linkToLibrary` updates with `expectedUpdatedAt`. On StaleClassError it re-reads, so a save in between wins and the link happens next time. Reads that find nothing mid-write are retried.

## Files
- **New:**
  - `src/config/studio-days.ts`
  - `src/lib/{studio-settings,settings-effects,cafe-windows,cafe-hours-live}.ts`
  - `src/lib/classes/to-decide.ts`
  - `src/pages/api/admin/settings.json.ts`, `src/pages/api/cafe-hours.json.ts`
  - `src/components/admin/shell/studio.tsx`
  - `src/components/admin/sheets/{SettingsSheets,ImportSquareSheet}.tsx`
  - `src/components/admin/inbox/ToDecideSheet.tsx`
- **Changed:**
  - Config: `config/{hours,closures}.ts`
  - Libs: `lib/{cafe-days,party-slots,party-availability,party-open-dates,warnings,short-memory,archive-stores}.ts`
  - Class libs: `lib/classes/{studio-schedule,seat-ledger,door-unpaid,booking-words,blocked-time,admin-actions,staff-view}.ts`
  - Routes: `api/{calendar,party/*,staff/{week,events,open-studio},admin/{to-decide,classes/calendar}}`
  - Pages: `pages/{craft-cafe,index}.astro`, `staff/print.astro`
  - Components: WhatsOnCalendar, PartyModal, staff `{Today,ThisWeek,CheckInSheet}`
  - Admin `{AdminShell,Home,More}`, `sheets/{MoreSheets,CalendarSheets,NewClassSheet,ClassSheet(export smsAll)}`, `inbox/{Inbox,InboxSheets}`, `classes/{BlockTimeForm,PrintDay,api,labels}`, `shell/{items,router}`
  - `styles/admin.css`
  - `scripts/set-cafe-windows.ts`
- **Deleted:** `src/components/admin/classes/ui.ts`.
- **Archive:** `studio-settings` and `to-decide` were added to `ARCHIVE_STORES`.

## Tests (new or extended)
- **`tests/lib/studio-settings.test.ts` (16):** config fallback (same objects), unreadable store → config / strict throws / last answer kept, create-only first save, stale 409 with current, CAS lost race retries then 503, updatedAt moves forward, history capped at 50, 60 s memory + fresh, every validation rule, describeChanges.
- **`tests/lib/cafe-windows.test.ts` (8):** config windows (grand opening, Christmas skipped), saved weekday/special/closure, 255-character fit, the exact upsert shape, 90-day rewrite, sandbox skipped with nothing written, live missing item failed, Square refusal → failed, never thrown.
- **`tests/api/admin-settings.test.ts` (9):** owners only, GET config, save with audit and who and Square rewrite, field errors, stale 409, a closure over a party and our class lists both and keeps them, Square failure keeps settings plus retry, sandbox skipped, no change → no Square call.
- **`tests/api/studio-settings-consumers.test.ts` (7):**
  - A saved closure hides party times (rules, available-dates incl. `offered`, availability) and refuses a new class.
  - It shows on the public calendar (closures payload, closed row, no party slot), the admin calendar and as the party-on-closed-day warning.
  - Removing a config closure reopens the day.
  - A special day changes /api/cafe-hours.json, the café span in busyBetween and the party times.
  - New weekly hours show on cafe-hours, staff week, events and open-studio.
  - With nothing saved, every answer is the config's.
- **Other server tests:**
  - `party-book.test.ts`: bookableOn gets the saved closures.
  - `WhatsOnCalendar`, `PartyModal`, `ThisWeek`: each uses the server's days.
  - `cafe-hours-live.test.ts`
- **`tests/lib/classes/to-decide.test.ts` (13):** every kind's actions on the real ledger and stores. Square is only read (GETs). Covered:
  - match over capacity, then names
  - dismiss (audited)
  - free with pick / keep
  - handled, finish, went-through / didn't
  - set-days with count rule
  - minimum window and keep running (nothing cancelled)
  - door paid ("Paid at the counter") / free
  - counter check confirm / move (payment moves, first goes back to unpaid)
  - refusals
- **`admin-shell-routes`:** to-decide 401, 404 and 400.
- **`booking-words`:** paidAtCounter.
- **`admin-classes-calendar`:** blocked Why and note, note length.
- **`admin-classes`:** RM2 parallel duplicate, RM3 save-in-between.
- **Client:**
  - `SettingsSheets.test.tsx` (14): hours view, save body with updatedAt, client checks, special add (closed warning) with Undo, remove with Undo, Square failed + Try again, sandbox skipped, stale keeps typing then uses their updatedAt, closed list, From/To checks, add with holiday + booked list + Undo, remove confirm + Undo, failed save keeps the form, load failure, StudioProvider.
  - `ToDecideSheet.test.tsx` (11): every kind's buttons and bodies, Done with who, error line.
  - `ImportSquareSheet.test.tsx` (3).
  - `BlockTimeForm` (+2): Why/Note, no inline styles.
  - `NewClassSheet` (+2, 1 updated): RM1 example, saved closures in the first open day.
  - `AdminShell` (+3): saved closure on Home and More count, To decide counter/badge/Done row/sheet, import row.
  - `client-imports` guard updated.

## Visual check
- **Setup:**
  - `.netlify/blobs-serve/{entries,metadata}/0/site:<store>/` was seeded with three classes (one below its minimum, one with a plain refund, a door-unpaid seat and a counter match, one pick-a-day camp with a needs-days seat), an unmatched counter sale, and saved settings (Sunday café, a Holiday market special day, "a deep clean" closure).
  - Ran `ADMIN_PASSCODE=<temp> npx astro dev --port 4351` and viewed /admin in a same-origin iframe.
  - The iframe's `fetch` answered every non-login POST locally: settings echoed with `square: failed`, to-decide with a stub. Nothing reached Square, Gmail or texts. Only GET reads went out.
- **Checked:**
  - 390: Home ("Closed for a deep clean" on Thu Oct 22 from saved settings; To decide 5), the Inbox › To decide list, the Counter sale sheet (guessed class, "See Square"), the Refund sheet with "Which seat?", and the Block time sheet (Why segments, Note). No horizontal scroll.
  - 820: Hours & Craft Café panel; Save → "Saved here. Square didn't take…" with Try again.
  - 1024: Closed days add → booked panel + toast with Undo.
  - /craft-cafe swapped in Sat + Sun hours and both special days.
- **Found and fixed:** the picked Inbox segment ("To decide") was off-screen on a phone, so it now scrolls into view; More's subtitle said "Saturday hours".
- **Cleanup:** the seed was deleted (blobs-serve empty as before), the server stopped, the tab closed, `git status` clean (the untracked stage-2 plan isn't mine).

## Deviations, and why
1. **POS match writes through `recordPos`, not hold/confirm.** `recordPos` is the ledger's existing counter-sale writer: source `pos`, capacity ignored, over-capacity marked, and idempotent by order + line. It also honours R32 (it pays an unpaid door seat on the sale's day instead of adding one). The amount, tax, payment ids and sale time are read from the Square order (a GET), which also fills the sheet's "Amount".
2. **"Who are the seats for?"** comes after matching: the seats are made first, then named (optional, per seat). There is no separate kind for named-less POS sales that matched on their own.
3. **Two new ledger setters**, beyond the reused Task 14 ones, because no existing setter does these:
   - `markDoorPaid`: mark paid at the counter.
   - `moveCounterPayment`: move the payment link to the right person.
4. **Text the N booked** records "Texted the people booked" when Open Messages is tapped. We can't know whether the text was sent; this matches the mock-up's "Done".
5. **Below-minimum** shows from 3 days before decide-by until the class starts, so it stays after decide-by passes while it's still undecided.
6. **Square café rewrite and Square's limit:** the save asks for 90 days, but Square's 255-character limit keeps about 11 windows (about 11 Saturdays). `coveredThrough` is returned; the UI doesn't show it yet.
7. **Studio hours** stay read-only in the Hours sheet ("Ask Kaden"), as briefed.
8. **The "Bring in Square classes" row** sits in its own small list under the six setup rows, so the mock-up's More list is unchanged.

## Concerns
- **The script vs. saved settings:** `scripts/set-cafe-windows.ts` still writes the config. Running it after owners save would put the config windows back. It now prints a warning. Consider retiring it, or having it read production settings.
- **Cache delay:** another server instance can use the old closed days for up to 60 s after a save. The party book check reads fresh, so a closed day can't be sold. Display paths may lag a minute.
- **The 255-character limit** means the public calendar shows about 11 café windows. Owners' saves roll them forward, but with no save for ~11 weeks the calendar's café entries run out, as with the script today.
- **To decide is not real-time:** it reads all sources on each load (ledgers per class). Fine at this size; it would need an index if classes grow a lot.
- **"Done" items** stay in the `to-decide` store for good (small records; listing shows 14 days).
- **Not tried against live Square:** the order read for amounts and the café rewrite, by rule. The rewrite uses the same calls the script has used live.
- **Not checked on real devices:** the iOS `sms:/open?addresses=` group link, and the real iPad.

---

# Fix round 1

Commits:
- `57a05ed`: R38, R39, I4
- `02a6574`: I2, I3, every quirk
- one last commit: /craft-cafe points to its own special-day list instead of repeating it

Checks:
- `npx tsc --noEmit`: 0 errors.
- `npx vitest run`: 299 files, **3853 passed, 0 failed**.

## Important
- **I1 / R38: the café windows now roll forward each night.**
  - A new `src/lib/cafe-roll.ts` reads the saved settings (strict, fresh) and runs `rewriteCafeWindows`.
  - `rewriteCafeWindows` now writes only when the windows it would write differ from the item's `programDates`. Otherwise it returns `unchanged`.
  - A failure emails the owners once (marker `cafe-windows-failing` in `class-alerts`). The next good night clears the marker, so a later failure emails again.
  - It is reached through `POST /api/jobs/cafe-windows.json`, which uses the HMAC job key like the other jobs (`job:cafe-windows`).
  - The scheduled function is `netlify/functions/cafe-windows.ts`, at `15 6 * * *` UTC. That is 1:15 AM CDT and 12:15 AM CST, so after midnight in Chicago all year.
  - `scripts/set-cafe-windows.ts` reads the production `studio-settings/settings` through the netlify CLI. It applies the same rule as the site (`studioDaysFromJson`: saved, or the config), so it no longer undoes a save on /admin.
- **R39: Square is written only from the live site.**
  - `cafeWritesAllowed(request)` is true only for deploy context `production` or `CAFE_WINDOWS_WRITE=1`.
  - Local dev, branch previews and the sandbox skip the write with "Square isn't updated from the test site." The Hours sheet then says "Café hours saved. Square isn't updated from the test site."
  - A save that changes no café window says nothing about Square and doesn't call it. This covers a closed day before the café starts, or on a Wednesday. The check compares the windows from before and after the save.
  - The failure wording is now "Craft Café's hours in Square didn't update."
- **I2: naming the seats after a match.**
  - After "Match to this class", the sheet stays on the item and shows "Who are the seats for?". The list reloads, and the item reads "Done · …", only after Add names or Skip.
  - The test's fake server now marks the item done, as the real one does. The test asserts the naming step, then Done.
- **I3: every decision clears its source.**
  - Matched and not-for-a-class counter sales set `resolved` on the `unmatched-pos` entry (new `resolveUnmatchedPos`), which `listUnmatchedPos` filters out.
  - Keep it running / Texted are read through `src/lib/classes/decided.ts`. The /staff warnings, and so the daily email, skip that class's below-minimum line, and `runMinimumToRunAlerts` sends no more texts or emails for it.
  - The other kinds were already resolved by their setters.
  - Covered by a new real-store test across `listWarnings`, the daily-warnings job's email, and the minimum alerts.
- **I4: no stale café hours on the public pages.**
  - With no weekly days, the hours box reads "Craft Café is by special day only".
  - On /craft-cafe, which lists the special days itself, it adds "See the special days below". On home it shows the days, or "See the calendar for the next café day" when there are none.
  - The build-time hours are never left showing.

## Quirks and minors
1. **Counter-sale seat guess.** The match starts on the seat the sold item maps to: its stored variation id (new on unmatched entries), else the way to book or ticket named in the item or variation name. With no clue there is no default: "Pick which seat", and Match says "Pick which seat it was."
2. **Freeing a seat asks first and can be undone.**
   - "Free the seat" and "Free a seat" ask in the sheet, naming the person: "Free Dora Door's seat? … No money moves." [Keep it] [Free it].
   - The toast offers Undo for 10 minutes. Undo uses the new `unfreeSeats` (removes only the no-money free-seat entry, back to confirmed), reopens the refund flag if there was one (`reopenRefundFlag`), puts the item back as waiting, and is audited.
3. **Square note only when a café day changed** (see R39), with the new wording.
4. **Midnight and noon by name.** /admin's `clock` / `clockRange` and To decide's heads say "midnight" and "noon", e.g. "9 AM–noon" and "needed by Thu Oct 22 midnight".
5. **Booked items open their sheets.** Rows under "Already booked on those days" are buttons that open the class, party or Square class.
6. **The counter-check button names the person.** It reads "Pick who it was" (disabled) until someone is picked, then "It was Dee Two".
7. **Door seat and counter check point to each other.**
   - The door-seat item carries "A counter sale that day was matched to Cara One. It may have been Dora Door: see 'Check a counter sale'."
   - The counter check says the picked person also shows under "Not paid at the counter" until it's sorted.
   - From the deviations note: a wrong match now moves every seat of that booking that the sale paid, in seat order.
8. **"Ask <the other owner> to change them"**, worked out from who is using /admin ("the other owner" if unknown).
9. **Add closed days with no From** scrolls to and focuses From, and shows the error there.
10. **Block time** starts on the next open day (saved closures included) when it wasn't opened from a day.
11. **Shorter toast:** "Closed Sat Oct 24. 1 booking stays booked." Square problems stay in the sheet's panel.
12. **Local-dev footgun:** fixed by R39.
13. **No inline styles left** in SettingsSheets, ToDecideSheet or ImportSquareSheet. They use `adm-gap-top`, `adm-gap-bottom`, `adm-dark`, `adm-lbl-first`, `adm-bookedlink`, and a `<progress class="adm-meter">`.
14. **Grammar:** "Text the 1 person booked" / "Text the N people booked".
- **Also:** a Done item for a class has "Open the class".

## New tests
- `tests/netlify/cafe-windows.test.ts`: schedule, job key, outcomes.
- `tests/api/jobs-cafe-windows.test.ts`:
  - writes when different, nothing when the same
  - a failure emails once, clears, then emails again
  - R39 for dev / branch / preview / unknown, and `CAFE_WINDOWS_WRITE=1`
  - the route needs the job key
- `admin-settings`: R39 skipped on save and retry with no Square call; a closed day with no café returns `square: null`; new wordings.
- `tests/lib/to-decide-clears.test.ts`: real stores. Not for a class and Keep it running leave the warnings and the daily email; Keep it running stops the minimum alerts.
- `to-decide`:
  - a resolved counter sale leaves `listUnmatchedPos`
  - `guessMatch`
  - Undo frees, then holds again, with the flag reopened (audited); "can't be undone"; too late after 10 minutes
  - a two-seat counter payment moves both seats
  - midnight wording
- `square-events`: the variation is stored.
- `cafe-hours-live`: empty weekly on /craft-cafe and on home.
- `ToDecideSheet`:
  - naming before Done (fake marks done)
  - free confirm with Keep it, then Undo
  - door free confirm and the related line
  - seat guess, and none
  - "It was Dee Two"
  - "Text the 2 people booked"
  - Done view's "Open the class"
- `SettingsSheets`: booked row opens the party, shorter toast, "Ask Catherine" for Kaden, From focus, noon wording.
- `BlockTimeForm`: starts on Thursday from a Monday.

## Visual re-check
- **Setup:** port 4351, temporary passcode, seed as before but with **no weekly café** (special days only).
  - The iframe answered every non-login POST locally: settings with `square: skipped`, and to-decide match with seats.
  - Nothing reached Square, Gmail or texts.
- **What was checked:**
  - /craft-cafe: "Craft Café is by special day only · See the special days below", plus both special days. The repeat seen at first was fixed in the last commit.
  - 390: Match to this class → "Who are the seats for?" with Seat 1 and Seat 2 (no jump to Done).
  - 390: Not paid at the counter showing the cross-reference, and the "Free Dora Door's seat?" confirm.
  - 820: Hours with "Special days only" and "Ask Kaden to change them" (as Catherine).
- **Cleanup:** the seed was removed (blobs-serve empty), the server stopped, the tab closed.

## Notes
- Undo of a freed seat restores it even if the session filled meanwhile (it was theirs a moment ago). It is limited to 10 minutes.
- The nightly job needs `LOOKUP_SIGNING_SECRET` (already set for the other jobs).
- The 820 icon rail the review mentions belongs to 11b-A (R-A1) and was left as is.

---

# Fix round 2

Commit: `59adc1c`. It addresses N1–N7 and R40 from `task-11b-C-rereview1.md`.

Checks:
- `npx tsc --noEmit`: 0 errors.
- `npx vitest run` ran **3 times in a row: 300 files, 3863 passed, 0 failed** each time.

## Changes
- **N1: Undo of "Free the seat" can no longer overbook or un-free the wrong seat.**
  - Refund entries now get an `id` (`rfe_…`) when written by `recordRefund`, which is how freeing a seat writes them.
  - The decision records exactly the new free-seat entries it wrote. It snapshots entry ids before freeing and diffs them after.
  - `unfreeSeats(cls, entries, now)` removes only those entries, inside the ledger's compare-and-set. It refuses in each of these cases, and nothing changes:
    - the entry is gone, or isn't a no-money free (it can't be undone from here)
    - a money refund came after it ("A refund was made on that seat since…")
    - any session not yet started would then be over capacity ("That seat was taken since. Add them over capacity from the class if you need to.")
  - A seat that someone else had already freed records no entries, so there's nothing to undo.
- **N2:** `moveCounterPayment` moves only seats of the wrong booking from that order with the same pass and ticket, still confirmed, with no refunds.
- **N3:** if the counter-sale sheet unmounts during the naming step (×, Back, another sheet), the list reloads once.
- **N4:** `tokenOf` now lives in `src/lib/classes/decided.ts`, and `minimumItemId` goes through it, so warnings, minimum alerts and To decide compare the same form.
- **R40 (N5):** "Texted the people booked" is saved as `note-<id>` (audited `to-decide-texted`).
  - The item keeps waiting and shows "Texted the people booked · Catherine, …".
  - The minimum-to-run alerts and the /staff warning continue. Only "Keep it running" decides it.
  - The toast says "Noted: you texted the people booked. It stays here until you decide."
  - A Done item also offers "Open the class".
- **N6:**
  - Alert checks use `findByRole`.
  - The SettingsSheets, ToDecideSheet and ImportSquareSheet tests set `asyncUtilTimeout: 5000`. They load, save, then reload, which can take more than 1 s under a full parallel run.
  - The Square-failure test checks the persistent panel, not the 4 s toast.
  - The pre-existing PrivateEventForm long-form test, which timed out once at 5 s under load, gets 20 s.
- **N7:**
  - In /admin, a range starting at noon or midnight is capitalised ("Noon–2 PM").
  - The public café hours use a new `formatCafeRange` / `formatCafeHours` in `config/hours.ts`, giving "9 AM – noon" and "Noon – 4 PM". This applies to `/api/cafe-hours.json` and the built `siteConfig.cafeHours`.
  - Other ranges (studio hours, workshop confirmations, SEO) are unchanged.

## Tests added
- `to-decide.test.ts`:
  - Undo refused after the seat was taken (ledger unchanged)
  - refused after a money refund
  - a seat freed by someone else is never un-freed
  - N2 moves only the same pass and ticket, held with no refunds
  - N4 hashed id in one form
  - R40 note keeps the item waiting, then Keep it running decides it
- `to-decide-clears.test.ts`: R40, so Texted leaves the /staff warning and the minimum alert in place.
- `ToDecideSheet.test.tsx`:
  - N3: closing the sheet during naming reloads the list
  - R40: toast, note line, item still waiting
- `time-words.test.ts`: /admin and public noon/midnight wording, other ranges unchanged.
- Updated: cafe-hours expectation "9 AM – noon".
