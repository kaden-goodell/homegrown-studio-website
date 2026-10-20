# Task 11b-C review: Hours & Craft Café, Closed days, To decide, Block time, Bring in Square classes

Range 5700765..d499982 (7 commits), branch kaden/own-booking-system. Reviewer did not change any tracked file.

**Verdict: Needs fixes.** 4 Important, 14 Minor or quirks.

- `npx vitest run`: 296 files, 3830 passed, 0 failed (the 3 known clock failures did not show today).
- `npx tsc --noEmit`: 0 errors.

## Hands-on check
- **Seed** (local `.netlify/blobs-serve` only, written by a temporary untracked route, now deleted):
  - saved settings: Saturday and Sunday café, a "Holiday market" special day, a "deep clean" closure
  - a class below its minimum, with a plain refund flag on a 2-seat booking, a refund-failed flag, and a refund-unconfirmed flag plus its saved request
  - a past class with a door-unpaid seat and a counter-match check
  - a pick-a-day camp with a pos-needs-days seat
  - an unmatched counter sale
  - blocked time with a note
- **Run:** `ADMIN_PASSCODE=review-only-123 npx astro dev --port 4340`, with /admin in a same-origin iframe.
- **What reached the server:**
  - Every POST except login was answered inside the page, so nothing was written to Square, Gmail or texts. Settings answered with `square: failed`; to-decide marked the item done, like the real server.
  - GETs went through. So did the read-only import dry run (a Square read).
- **Widths walked:**
  - 390: Home, Hours, Inbox › To decide, every kind's sheet, Below-minimum › Text
  - 820: More, Closed days (add over a class, remove + Undo)
  - 1024: Block time, Bring in Square classes
- **Cleanup:** the seed route and blobs were removed, the server stopped, the tab closed. `git status` is clean apart from the stage-2 plan, which is not mine.
- **All 8 To decide kinds listed**, each with the right choices. The Home counter and the Inbox badge both read 8.

## Requirements
| # | Requirement | Status | Where |
|---|---|---|---|
| 1 | Settings store, CAS, history capped at 50, config fallback (same objects), 60 s cache, strict mode | Met | src/lib/studio-settings.ts:212-299 |
| 1 | Every consumer uses the merged settings | Met, one gap (I4) | see consumer sweep |
| 2 | GET/POST settings: owners only, validation, stale 409, booked list on new closures | Met | src/pages/api/admin/settings.json.ts:54-93; studio-settings.ts:115-168 |
| 3 | Café windows: exactly the script's calls, only when the item exists, sandbox skipped, failure keeps the save + Try again | Met | src/lib/cafe-windows.ts:62-144 |
| 3 / R38 | Script reads the saved settings; nightly roll-forward | **Missing (I1)** | scripts/set-cafe-windows.ts:39; no job in netlify/functions |
| 4 | Hours sheet (weekly rows, add a weekday, special days + Add, note) | Met | sheets/SettingsSheets.tsx:119-263 |
| 4 | Closed days (list, Remove with in-sheet confirm + Undo, add form with holiday look, booked list) | Met | SettingsSheets.tsx:269-389 |
| 5 | To decide: all 9 kinds, audited with who, "Done · what · who", counter + badge | Met | lib/classes/to-decide.ts; InboxData.tsx:129 |
| 5 | Counter sale → "Who are the seats for?" | **Broken (I2)** | ToDecideSheet.tsx:60, 218, 230 |
| 5 | Decided items leave every list | **Partly (I3)** | lib/warnings.ts:286, 314-319 |
| 5 | Refund kinds follow R29-R31 (reuses clearRefundRequest / decideRefundFlag / freeSeatOnly; no new refund path; Unconfirmed sends nothing to Square) | Met | to-decide.ts:419-449 |
| 5 | Reuses setPosDays / decideRefundFlag; door-unpaid; counter-match-check | Met | to-decide.ts:450-484 |
| 6 | Block time: Why segments + Note; BlockTimeForm and PrintDay on admin.css | Met | classes/BlockTimeForm.tsx; blocked-time.ts:37-48 |
| 7 | Bring in Square classes: dry run → Add N → results + toast | Met | sheets/ImportSquareSheet.tsx |
| RM1-3 | Run it again: next open day from today; duplicate replay; linkToLibrary expectedUpdatedAt | Met (tests) | NewClassSheet.tsx:128; admin-actions.ts |

## Consumer sweep
I grepped config/closures, config/hours, CAFE_*, closureOn, studioOpenOn, cafeHoursOn, cafeRunsOn, partyStarts* and bookableOn across src, scripts and netlify.

**Every server path passes the loaded days:**
- party: available-dates, availability, book.json (fresh), party-open-dates (notify-me emails), party-availability
- calendar.json (closed rows, café hidden on closed days, party slots, plus `closures` for the client)
- studio-schedule busyBetween (admin calendar, day sheet, staff calendar, class clash checks)
- warnings: party on a closed day
- staff week.json, events.json, open-studio.json
- cafe-hours.json

**Client paths use the server's answer, with the config only until it arrives:**
- WhatsOnCalendar
- PartyModal (the `offered` count)
- staff ThisWeek, Today, CheckInSheet
- admin, through StudioProvider: Home, CalendarView, CalendarSheets, NewClassSheet, More

**Stay config on purpose:**
- SEO JSON-LD: SeoHead uses STUDIO_HOURS only (no café or closures), as briefed.
- workshop-confirmation: uses formatRange only.

**Prerendered pages:**
- `site.config.cafeHours` (the /craft-cafe and home hours blocks) ships the config at build time and is then swapped in by cafe-hours-live. That swap has the gap in I4.

**Not wired:**
- scripts/compare-party-availability.ts:33 (a dev script that reads config; harmless).
- scripts/set-cafe-windows.ts (I1).

## Important
**I1. R38 is not done, so Square's café windows will run out, and the script undoes the owners' saves.**
- `scripts/set-cafe-windows.ts:39` still writes `CONFIG_STUDIO_DAYS`. It only prints a warning (lines 32-33).
- No nightly job rolls the windows forward. Nothing in netlify/functions or api/jobs calls `rewriteCafeWindows`.
- Square holds about 11 windows. So about 11 weeks after the last save, Craft Café quietly disappears from the public calendar.
- Running the script once after an owner saves puts the config hours back in Square.
- **Fix:**
  - The script reads `getStudioDays({ strict: true })`, or the production store.
  - Add a nightly function, e.g. inside reconcile or daily-warnings. It calls `rewriteCafeWindows` with the merged settings, and writes only when `fitWindows(cafeWindows(...)).join(',')` differs from the item's current `programDates`. It runs only when the item exists, and logs or alerts on failure.

**I2. "Who are the seats for?" never appears after Match to a class.**
- After a successful match, `useDecide` calls `todo.retry()` (ToDecideSheet.tsx:40). The reloaded list returns the item as done.
- `ToDecideSheet` then switches to the Done view (line 60), which unmounts `CounterSale` and its `made` state (lines 185, 218, 230).
- Seen hands-on: the sheet went straight to "Done · …" with no naming step.
- The test misses it because its `decide` override for `match` doesn't mark the item done in the list (tests/components/admin/inbox/ToDecideSheet.test.tsx:56).
- **Fix:** keep the naming step mounted. For example, skip the list reload until naming finishes or is skipped, or render the naming step from a parent state keyed by item id. Then make the test's server mark the item done.

**I3. Counter sales decided in To decide keep showing as unresolved elsewhere.**
- Match and Not for a class only write `to-decide/done-<id>`. The `unmatched-pos` entry is never removed or marked.
- `ownClassWarnings` (src/lib/warnings.ts:286, 314-319) lists every `listUnmatchedPos()` entry with "Owners decide". So the /staff Warnings panel, and the daily warnings email the first time it sees the line, keep saying "A counter sale … didn't match a class" after Catherine has dealt with it.
- **Fix:** mark the unmatched entry resolved (like pos-needs-days `resolved`) and filter it in `listUnmatchedPos`. Or have the warnings skip ids decided in the to-decide store.
- "Keep it running" has the same problem for below-minimum: it stays in warnings until the class starts. Minor, but fix it the same way.

**I4. With no weekly café days, the public pages still show the old hours.**
- If an owner taps "No café on Saturdays" and saves (special days only), `/api/cafe-hours.json` returns `weekly: []`.
- `applyCafeHours` then returns early (src/lib/cafe-hours-live.ts:35), so /craft-cafe and home keep the build-time "Saturday 9 AM – 12:30 PM".
- Customers see hours that no longer exist.
- **Fix:** with an empty weekly list, replace the box with "Special days only, see below / the calendar". Do the same when the special list is empty, so stale config special days aren't left showing.

## Deviations (from the report)
1. **recordPos instead of hold/confirm:** accepted.
   - It is the ledger's counter-sale writer: source `pos`, capacity ignored, idempotent by order + line uid.
   - A replay or double tap adds no seats and doesn't change `chargedCents` (seat-ledger.ts:482, 531).
   - `chargedCents` is set only on new lines, as prior + this line, so the refund cap can't exceed what Square took.
   - The amount is read from Square with a GET only.
2. **Naming after matching:** acceptable as designed, but broken in practice (I2).
3. **Two new setters, `markDoorPaid` and `moveCounterPayment`:** accepted.
   - Both run inside the ledger's CAS `mutate`.
   - markDoorPaid changes only seats that are still unpaid, records no money, and a repeat is a no-op.
   - moveCounterPayment:
     - refuses unless the target is an unpaid door seat with the same pass and ticket
     - moves the payment rather than copying it (the source's `square` is cleared), so nothing is paid twice
     - keeps the source seat confirmed but unpaid, so no seat is lost
     - is a no-op once checked, so a double tap is safe
   - Edge: when one sale covered 2 seats of a booking, only the flagged line moves. Consider moving the whole booking's lines from that order.
4. **"Texted" recorded on Open Messages:** accepted (matches the mock-up's Done).
5. **Below-minimum window (decide-by − 3 days until the class starts):** accepted.
6. **~11 windows:** this is a real gap → I1.
7. **Studio hours read-only, and the import row in its own list:** accepted.

**Concerns from the report:**
- 60 s cache lag on other instances: accepted. The party book check reads fresh, and the admin GET reads the store directly.
- To decide reads every source on each load: fine at this size.

## Minor and UX quirks
1. **Counter sale › Which seat?** defaults to the first pass ("Full series") even when the item says "Winter Camp - One day" (ToDecideSheet.tsx:208). That makes it easy to match the wrong pass. Pre-pick the pass whose label is in the item name, or start empty.
2. **One tap takes someone off a class**, with no confirm and no Undo:
   - "Free the seat" (door-unpaid)
   - "Free a seat" (plain refund on a 1-seat booking)
   - Add an in-sheet confirm like Closed days' "Open these days?".
3. **"Square didn't take the new café hours"** shows after adding or removing a closed day, even on days with no café (e.g. Sat Oct 24, before the café starts). It confuses on a Closed days action. Skip the Square write when the computed windows didn't change (this also covers R38's "rewrite only when they differ"), and word the failure "Craft Café's hours in Square didn't update".
4. **Clock words:** "needed by Thu Oct 22 12 AM" and "rung up Sun Oct 18 12 PM". Say "midnight" / "noon" (or "end of Wed Oct 21").
5. **Booked list isn't tappable:** "Already booked on those days" rows (class or party) can't be tapped to open the class or party the owner now has to deal with.
6. **Counter check button** reads "It was the person picked". Use the name: "It was Ben Carter".
7. **Two items, one situation:** Ben's door-unpaid item and Cara's counter check are the same story. If Ben is freed first, he disappears from Cara's "Or it was" choices. A cross-reference line on each would help.
8. **"Ask Kaden to change them"** is shown to Kaden too. Use "Studio hours are set in the site's settings" or hide it for Kaden.
9. **Closed days at 820:** the pinned "Add closed days" footer is visible while the form is below the fold. Tapping it first gives "Pick the first closed day". Consider "+ Add closed days" opening or scrolling to the form.
10. **Block time:** Day defaults to today even when today is a closed weekday (Mon–Wed). Default to the next open day.
11. **Toast too long:** "Closed Sat Oct 24. Heads up: 1 thing is booked then. Nothing was cancelled. Square didn't update." is long for a 4 s toast. The in-sheet panel already says it.
12. **Local dev footgun:** `.env` is production Square. A save on Hours or Closed days in local dev rewrites the LIVE café item from the local blob settings (settings-effects.ts:44-50). The script has the same risk, but now a single click does it. Consider skipping unless deployed (`onNetlify()`), or an explicit env opt-in.
13. **Inline styles remain** (`style={{ marginTop… }}`) in SettingsSheets.tsx and ToDecideSheet.tsx. The common rules say move them into admin.css.
14. **Grammar:** the below-minimum footer says "Text the 1 booked". Use "Text the 1 person booked" (the panel already says it right).

Also seen, not this task: at 820 the shell shows a left icon rail rather than the phone bottom tab bar the common rules give for widths under 900 (11b-A territory).
