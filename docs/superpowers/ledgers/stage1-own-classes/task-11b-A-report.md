# Task 11b-A report: admin shell, direction D

Worktree `/Users/catherine/source/homegrownStudio-admin`, branch `kaden/admin-d` (from 5248558). Not pushed.

## Status
Done. `npx tsc --noEmit`: 0 errors. `npx vitest run`: 3411 passed, 3 failed (the 3 known clock failures in `tests/lib/events.test.ts`, nothing else).

## Commits
- `24f79d9` feat(admin): record which owner made each change; sandbox check, to-decide, party, reports and calendar seats for the new admin
- `be2a70c` feat(admin): direction D shell: five tabs, one sheet at a time, Home, Calendar, Inbox and More
- `f99f5d0` fix(admin): keep server code out of the browser; small polish
- `5039325` fix(admin): site buttons keep their colours inside sheets; the old class form is one column in a sheet

## What was built

**Sign-in.** Passcode with a Show/Hide toggle, plus "Who's using this?" (Catherine | Kaden). Only one sign-in request goes out at a time: the button shows "Signing in…" and is disabled. The owner name is stored on the device (`localStorage['admin-who']`). If a device was signed in before this existed, it is asked once ("Continue"). The name can be changed under More › Using as …. Sign out is under More.

**Who recorded the change (audit I4).** `src/lib/admin-who.ts` holds the fixed owner list, `ownerOf()` and `ADMIN_WHO_HEADER`. `adminActor(request)` in `src/lib/admin-auth.ts` returns `{id:'owner-catherine', name:'Catherine'}` and so on. Anything off the list is recorded as the old `{id:'admin', name:'Owner'}`. Every function in `admin-actions.ts` now takes `by` as its last argument (default `ADMIN_BY`). That covers library save, restore and archive; class create, duplicate, update and cancel; POS sync; block and unblock; and the audit log. The classes, library, blocked, refund and photo routes pass `adminActor(request)`. On the client, `api()` sends `X-Admin-Who` on every request, and so does the photo upload.

**Shell (`AdminShell.tsx`).**
- Five tabs: a fixed bottom bar on phones (56px buttons, safe-area padding) and a 220px sidebar from 900px with "Hometown Studio" at the top.
- The Inbox tab shows a badge: new requests + messages + teachers + to-decide.
- `admin.astro` no longer limits the page to 768px. The content goes up to 1200px.
- Default tab is Home.

**Sheets.**
- One sheet at a time. Opening something from inside a sheet replaces it.
- Phone: bottom sheet, max 92dvh, with a grab handle, a pinned header (title, subtitle, ×), a scrolling body and a pinned footer. The page behind is `inert`.
- iPad: a 440px right-hand panel, with the page still usable and squeezed to fit. Class forms open as a centred 680px card instead.
- Escape, × and the scrim close the sheet. Focus moves to × when a sheet opens and back to the opener when it closes.
- Dirty forms show the in-sheet prompt "Leave without saving? [Keep editing] [Leave]" on ×, Escape, the scrim, a tab change, opening another sheet, or the back button. No `window.confirm` anywhere.

**Hash routing (`shell/router.ts`).**
- The address is `#home`, `#calendar`, `#classes`, `#inbox` or `#more`, or the token of the open sheet. Sheet tokens: `class-<id>`, `edit-<id>`, `new[-day]`, `block[-day]`, `book-party[-day]`, `print-<day>`, `day-<day>`, `legacy|blocked|party-<day>-<id>`, `cafe-<day>`, `closed-<day>`, `request|message|teacher|todo-<id>`, `libnew`, `libedit-<id>`, `libsched-<id>`, `more-<page>`.
- Tokens are plain only (`[A-Za-z0-9._-]`). Anything else is ignored.
- The tab under a sheet is kept in `history.state`. Opening a sheet uses `pushState`, replacing one uses `replaceState`, and Back or iOS swipe-back closes the sheet and stays in /admin.
- After a refresh on a sheet, the tab entry is put back underneath, so Back still works.
- An address that names only a sheet opens it over its natural tab (an inbox item over Inbox, and so on).

**Toasts (`shell/Toast.tsx`).** One `role=status` region above the tab bar, 4 seconds, optional Undo. A failed save says "Didn't save. Try again."

**Loading, errors and sign-out.** Each data source loads on its own, with skeleton rows while it loads and its own error with Try again. A 401 from any request (through `api()`'s `onAdminSignedOut` hook) goes back to sign-in.

**Home.**
- "Good morning/afternoon/evening, <name>" by America/Chicago time, with a long date line.
- **Today:** rows of time · name · sub ("5 of 12 booked", "14 guests", "Walk-in · pay per craft", …), with a coloured bar for the kind and a Draft or Sign-ups closed tag. A closed day shows "Nothing on today. Closed for <name>."
- **This week:** the next 6 days, only the ones with something on.
- **Needs you:** 4 counters. They show "–" while loading and "!" if that list failed; tapping one opens Inbox on that segment.
- **Buttons:** + New class (primary), + Book a party, Block time, Print today.
- iPad: two columns (agenda | Needs you + buttons).

**Calendar (`classes/CalendarView.tsx`, rewritten).**
- Week (default) or Month, with ‹ › and a Today button that appears when the current week or month isn't showing.
- Phone week: a list of days, each with a + in its header. An empty day reads "Nothing on this day + Add". iPad week: 7 columns of chips.
- Month: a whole-week grid. Each cell shows a text count on phones and up to 3 chips plus "+N more" on iPad. The aria-label names everything on that day.
- The colour legend is folded behind "Key".
- Tapping a day or its + opens the **Day sheet**: that day's items + [+ New class on this day] [Book a party on this day] [Block time on this day] [Print this day].
- Tapping an item opens its own sheet:
  - **Our class:** the existing ClassBookings in a sheet. Edit replaces it with the existing ClassEditor.
  - **Square class:** "This class lives in Square. Change it there."
  - **Party:** read only, with Details · Guests · Payments tabs. The footer has Call and Text as `tel:`/`sms:` links with the number visible.
  - **Blocked:** reason/note + [Remove this block], confirmed inside the sheet. A toast offers Undo, which re-adds the block.
  - **Craft Café:** walk-in, pay per craft, + [Change café hours], which opens More › Hours.
  - **Closed day:** + [Edit closed days], which opens More › Closed days.
- The week runs Monday to Sunday (see deviations).

**Book a party (stage 1).** A sheet that says party booking currently happens on the party page, with [Open the party booking page] linking to `/book` (or `/book?date=YYYY-MM-DD` from a day) in a new tab.

**Inbox.**
- Segments: Requests n · Messages n · Teachers n · To decide n. Each source loads on its own.
- Rows fold to: name + status badge, kind · headline, and "Next: …" while the item still needs something.
- Tapping a row opens a sheet with every answer (request groups as on the form, message text, teacher answers and links), photos, a 44px segmented status control using each list's own statuses, and a footer with [Call] and [Email] links showing the number and address.
- Status changes apply immediately. An Undo toast posts the old status back. A failure reverts the status and shows "Didn't save. Try again."
- A "New only" filter keeps any row you changed in place until you leave the list.
- To decide reads `GET /api/admin/to-decide.json` (empty for now). Its empty state reads "Nothing to decide. Things that happen in Square without you land here."

**More.**
- Parties setup: read only. Weekday times are computed from `partyDays` (Thu/Fri 4 PM, Sat 1:30 PM, Sun 1 PM and 3:30 PM). Also shows upcoming one-off days, $300, length plus cleanup, 10–30 guests, booking notice and window, and the party crafts from `/api/party/service-info.json`. Note at the top: "Editing party times comes with party booking."
- Hours & Craft Café and Closed days: read only from `config/hours.ts` and `config/closures.ts`.
- Staff and Promotions: tagged "Coming in stage 3" / "Coming in stage 4", each with a one-line "Coming soon" note and no fake data.
- Reports: this month from our own records. Shows class seats sold, class sales (with tax and extras), refunds (count and $), and parties booked on the website this month, with a note saying exactly what is covered and what is in Square instead.
- Then Using as …, Set up sandbox (only when `GET seed-sandbox.json` returns `sandbox: true`, fixing M1 / P0 #8), and Sign out.

**Classes tab (interim until 11b-B).** Header with + New class, then Upcoming · Library segments showing the existing ClassList and LibraryList. Their own headers are hidden; LibraryList keeps its "Add a class to the library" button until 11b-B. Library Edit, "Change details, then schedule" and Add each open the existing editor in a sheet. Lists reload after any change.

**New server routes, all owner-only and read-only.**
- `GET /api/admin/to-decide.json` → `{data:{items:[]}}`
- `GET /api/admin/classes/seed-sandbox.json` → `{data:{sandbox}}`
- `GET /api/admin/party.json?id=` → `{party|null, guests|null}`. Never returns the host token.
- `GET /api/admin/reports.json` → this month's numbers. `monthReport()` is a pure function so it can be tested.
- `calendar.json` now also returns `booked`/`capacity` on our class sessions and `guests` on parties. Both are additive and optional.

All existing contracts are unchanged: expectedUpdatedAt/stale, confirm/confirmMove, peopleToTell, and the refund API.

## Files
New:
- `src/lib/admin-who.ts`, `src/styles/admin.css`
- `src/components/admin/{AdminShell,Home,More,ClassesTab}.tsx`
- `src/components/admin/shell/{router.ts,Sheet.tsx,Toast.tsx,items.tsx,data.ts,useWide.ts,who.ts}`
- `src/components/admin/inbox/{InboxData.tsx,Inbox.tsx,InboxSheets.tsx,answers.tsx,describe.ts}`
- `src/components/admin/sheets/{CalendarSheets,ClassSheets,MoreSheets}.tsx`
- `src/pages/api/admin/{to-decide,party,reports}.json.ts`

Changed:
- `src/lib/admin-auth.ts` (adminActor), `src/lib/classes/admin-actions.ts` (`by` argument)
- `src/pages/api/admin/classes/{classes,library,blocked,refund,photo,calendar,seed-sandbox}.json.ts`
- `src/pages/admin.astro`
- `src/components/admin/classes/`: `api.ts` (who header, 401 hook, DELETE), `photo.ts`, `dates.ts` (`weekStartMonday`), `CalendarView.tsx` (rewritten), `ClassBookings.tsx` (`hideHeader`, `onLoaded`), `ClassEditor.tsx` (`hideHeader`, `onDirtyChange`, `new` with `day`), `BlockTimeForm.tsx` (`initialDay`, `onDirtyChange`, `onBlocked`), `PrintDay.tsx` (`hideBack`), `ClassList.tsx` (`hideHeader`, sandbox panel removed), `LibraryList.tsx` (`hideHeader`)

Removed: `AdminApp.tsx`, `EventRequestCard.tsx`, `MessageCard.tsx`, `StatusPills.tsx`. Their content now lives in `inbox/answers.tsx`, `inbox/describe.ts` and the status Seg.

## Tests
- **`tests/components/admin/AdminShell.test.tsx`** replaces AdminApp.test.tsx (34 tests). Every old assertion is ported: request headline, answers, links, photo, statuses New/Quoted/Booked/Not this time, teachers with photos and Instagram, messages and Replied, the status filter, empty-list text, a failed list showing Try again, the class → Edit flow, and Calendar/Library/Block time opening. New coverage:
  - sign-in busy state, show passcode, who required, who asked once
  - 401 → sign-in
  - X-Admin-Who sent on GET and POST, and the new name after a change
  - 5 tabs with aria-current and the hash written
  - Inbox badge
  - restoring a tab and a sheet from the hash, and Back closing the sheet while staying in /admin
  - a sheet-only address opening over its tab
  - one-sheet replace with the hash following
  - Escape and × closing, focus returning to the opener, the page inert on phones
  - the leave prompt on ×, Escape, tab change and Back; a clean form closing without asking
  - Home greeting, rows, This week and counters; closed-day text; Print today
  - the day sheet's Book a party link with date
  - the party sheet tabs and Call/Text
  - blocked remove with confirm and Undo
  - inbox optimistic change with Undo, revert on failure, and New only keeping changed rows
  - inbox lists loading and failing independently while Calendar still works
  - the More list and its tags, Parties setup, Reports
  - sandbox hidden on live and shown on sandbox
  - sign out
- **`classes/CalendarView.test.tsx`** rewritten for the new behaviour (8 tests).
- **`classes/ClassList.test.tsx`:** the sandbox tests moved to the shell test, and a new test checks the list never offers or fetches sandbox.
- Added tests for the new props in ClassEditor, BlockTimeForm, ClassBookings and PrintDay.
- **`shell/router.test.ts`:** round-trips every token and rejects bad ones.
- **`shell/Toast.test.tsx`:** 4s timeout, replace, Undo.
- **`shell/client-imports.test.ts`:** fails if /admin's browser code imports anything but types from a server module.
- **Server:** `tests/api/admin-shell-routes.test.ts` (owners and adminActor, to-decide, reports, party). `admin-classes.test.ts` gains 3 X-Admin-Who tests (library version, block, class and audit record the owner; an unknown or missing name records Owner). `admin-classes-calendar.test.ts` adds seats and guests. `admin-classes-seed-sandbox.test.ts` adds the GET.

## Visual check
Ran `astro dev` on port 4329 with a throwaway `ADMIN_PASSCODE` for this session only; the local .env has none. Only signed in and browsed, against real Square reads. Nothing was submitted.

Checked: Home, Calendar week grid and side panel on desktop/iPad width; Home, Calendar, Inbox, More and a bottom sheet in 390px frames; the New class card.

This found and fixed three things jsdom couldn't:
1. The page failed to hydrate because the browser was importing server code through `@lib/artist-applications`. Fixed and now guarded by a test.
2. The admin button reset made `.btn-primary` text dark.
3. The old class form's two columns squeezed inside the iPad card.

The server is stopped.

## Deviations from the mock-up, and why
1. **Monday-to-Sunday weeks** (the old code started on Sunday; the mock-up started on "today"). The studio opens Thursday to Sunday, so Monday weeks keep a weekend together. The month grid is Monday-first, as in the mock-up.
2. **Classes tab** shows only Upcoming · Library and uses the existing screens, as the brief allows. Drafts and Past come with 11b-B.
3. **New class, Block time, class bookings, Edit and Print** are the existing components inside sheets, as the brief allows. That means the old copy is still there ("Session 1 day", "Add and keep in the library", the 7-section form, "Just this date"). 11b-B replaces them. In New class, the photo, name and date are not yet the mock-up's short form.
4. **Book a party** is the stage-1 explainer with a link instead of the mock-up's form, per the brief.
5. **The party sheet is read only.** No Move or Cancel (stage 1), no "Copy invite link" or "Send it again". Payments shows the $300 studio fee as paid when booked, with crafts rung up on the POS at the studio, because we don't store per-party payment amounts. Parties booked by hand in Square have no record here, and the sheet says so.
6. **Guests tab:** one row per family that said yes (name, kids, number coming, and a waiver tag: Waiver signed / Waiver expired / Needs the new waiver), not one row per child.
7. **Blocked time:** the mock-up's Why (Closed/Private/Setup) + Note is not built. The existing form has a single reason field, which the sheet shows as "Note".
8. **Parties setup, Hours and Closed days are read only** (per the brief; 11b-C makes them editable). Parties setup has no add-ons section because none exist in config. The mock-up's sample add-ons were fake.
9. **Staff and Promotions** show a one-line "Coming soon" note instead of the greyed preview, per the brief's "no fake data".
10. **Reports** show this month's class seats, class sales, refunds and parties booked from our records. There is no "where it came from" split or Craft Café total, because those numbers live in Square. The note says this.
11. **Inbox:**
    - Added a small "New only" toggle. The mock-up has no filter, but the brief's rule that a changed row stays put under a filter needed one, and it replaces the old All/New/… filter.
    - The status control uses each list's own statuses: requests New/Quoted/Booked/Not this time, messages New/Replied, teachers New/Talking/Booked/Not now.
    - The status control sits below the answers, as in the mock-up.
12. **To decide** is a list with a read-only sheet. Its items come in 11b-C.
13. **More** has an extra list: Using as …, Set up sandbox (sandbox only) and Sign out. None of these are in the mock-up, but the brief and audit asked for them.
14. **Calendar colours** use the site tokens: denim for our classes, teal for Square classes, pink for parties, green for Craft Café, grey for blocked and closed. The mock-up had no Square-class colour.
15. **Home** shows "–" while counters load and "!" when a list failed. The mock-up had no loading state.

## Concerns / follow-ups
- Removing a blocked time can be undone, and the undo re-adds it with `confirm: true`. If something got booked in between, the block goes back over it, which is the state it was in before. Nothing booked is changed.
- iPad behaviour (side panel, 7-column week) is chosen with `matchMedia('(min-width: 900px)')`. jsdom tests run in phone layout plus one stubbed wide test. iPad was checked in the browser at desktop width only, not on a real iPad.
- The tab inside a sheet is restored from `history.state`. A bookmarked sheet address with no state opens over its natural tab (`homeTabOf`).
- `ClassBookings`, `ClassEditor` and the library screens still use their own inline styles and `box` cards inside sheets. The admin.css migration for those belongs with 11b-B.
- The X-Admin-Who header is trusted for any holder of the admin cookie, by design: it is a shared passcode and the header only says which owner, from a fixed list. Inbox status changes still aren't recorded per owner, because their stores have no `by` field.
- I created and dropped one `git stash` entry of my own while checking the import guard. The other stash (`kaden/own-booking-system: task13 fix round 1 partial`) was not touched.

---

# Fix round 1

Commit `3ecfb1e` fixes all 3 Important findings, all 17 UX quirks and the Minors from `task-11b-A-review.md`, following rulings R-A1 to R-A7.

Checks:
- `npx tsc --noEmit`: 0 errors.
- `npx vitest run`: 3435 passed, 3 failed. The 3 failures are the known clock failures in `tests/lib/events.test.ts`.
- The CalendarView act() warnings are gone.

## Important
1. **Toasts landed off screen.**
   - Fix: `--adm-tab-h`, `--adm-side-w` and `--adm-panel-w` now live on `:root` (with media queries) instead of `.adm`. The toast region also carries `class="adm adm-toasts"`.
   - While a bottom sheet or centred card is open, the toast moves to the top (`body:has(...)`), so it never covers Call/Email or Save.
   - Checked in the browser at 390px: "Block removed. Undo" sits above the tab bar.
2. **iPad Home overflowed with a long class name.**
   - Fix: every shared grid track is now `minmax(0, …)`. That covers `.adm-cols`, `.adm-need`, `.adm-two`, the tab bar and the class form inside sheets.
   - Checked at 1024px with a 70-character class name: no horizontal scroll (scrollWidth equals clientWidth).
3. **iPad week calendar lost the tapped day behind a side panel** (R-A2).
   - The week grid is always `repeat(7, minmax(0, 1fr))`, and the paneled `repeat(7, 8rem)` with `overflow-x` is removed.
   - CalendarView measures its own width with a ResizeObserver. Below 640px on a wide screen, it shows the week as the day list.
   - The item whose sheet is open is marked `is-active` (outline, `aria-current`) and scrolled into view. The shell supplies the open sheet's token through `ShellContext`.
   - Checked at 820px with the party panel open: the day list shows, and the party row is highlighted.

Tests that would have caught these:
- `tests/components/admin/shell/layout-css.test.ts`:
  - The layout variables are on `:root`, not `.adm`.
  - Every `fr` track is wrapped in `minmax(0, …)` (or a fixed floor).
  - The week grid can't scroll sideways and has no paneled override.
  - 768/1024 breakpoints, `min(440px, 45vw)` panel, zero-specificity button reset.
- `Toast.test.tsx`: the region carries `.adm`.
- `CalendarView.test.tsx`: a narrow wide-screen container gives the day list with the active item highlighted; a 900px container gives the grid.

## Rulings
- **R-A1 tablets.**
  - Below 768px: phone layout.
  - 768–1023px: a 72px icon rail with labels under the icons.
  - 1024px and up: the full 220px sidebar.
  - Side panel width is `min(440px, 45vw)`. Bottom sheets appear only below 768px.
  - `useWide` now switches at 768px.
- **R-A2:** as in Important 3. Chips clamp to 2 lines with ellipsis and hyphenate long words, with the full name and time in `title`. Day headers read "Tue 20" on one line, with the 44px + full-width underneath.
- **R-A3 closed days.**
  - Phone/list week: closed weekdays with nothing on fold into one hatched row, "Closed Mon–Wed · Show", which unfolds them.
  - Home on a closed day shows "The studio is closed today." (plus "Closed for <name>." for a closure) and "Next up: <day> · <first item>".
  - Month: closed and holiday days show a muted "Closed" on hatching, with no count.
  - Key: Blocked is a darker solid grey; Closed is hatched.
  - The Day sheet on a usual closed weekday or a closure adds a note saying so.
- **R-A4:** Classes › Upcoming adds "Still run from Square". These are the next 6 weeks of legacy classes as read-only rows tagged "In Square", opening the legacy sheet. When none of our own classes are coming up, the empty text points to them.
- **R-A5:** one formatter, `shell/time.ts` (`timeSpan`, `clockRange`, `clock`). It writes "6–8 PM", "9 AM–12:30 PM" and "All day", with a no-break space before AM/PM. It is used in rows, chips, sheets, toasts, More, PrintDay and BlockTimeForm. The time column no longer wraps.
- **R-A6:** `shell/Boundary.tsx` adds one boundary per tab and one per sheet. Each shows "Something went wrong showing this. [Try again]" and logs to `console.error`. The sheet version keeps its × and frame.
- **R-A7:**
  - A bottom sheet or centred card locks the body (position fixed at the current offset, overflow hidden) and restores the scroll on close.
  - The old ClassEditor in a sheet portals its save bar into the sheet's pinned footer. Its buttons save on click, and there is no sticky bar mid-form.
  - The 22px overflow is fixed: the old form's grid tracks were sizing to the inputs' natural width, and are now `minmax(0, 1fr)` inside sheets. Checked: inputs end inside the card.
- **Inbox item sheet:**
  - Title is the person; the organisation or business goes in the subtitle.
  - The Status control sits right under the Next note.
  - Group headings are `h3.adm-group-h`.
  - The 4-option control wraps 2×2 on a phone (`is-wrap`), so "Not this time" fits.

## Other quirks
- Labels in sheets get 1.25rem above, with no extra gap after a note.
- Draft is a dashed colour bar on a plain row, with no hatch behind the text.
- The Block time sheet has no second heading, and its buttons are in the footer.
- Library: "Add a class to the library" is hidden in the shell (`hideAdd`), so + New class is the one way in.
- Empty states have their fixing button: Home "Nothing on today. + Add" opens the Day sheet; Classes "No classes coming up. + New class".
- The Day sheet says "+ Book a party on this day".
- Inbox shows no "0 waiting" while the lists load.
- An empty passcode says "Type the passcode." without sending anything.
- Week/Month is capped at 360px on tablets.

## Minor
- `#more-sandbox` on the live site shows "Only on the test site" with nothing to press.
- Reports says "class sales, before refunds" and that comps count as $0 seats.
- The import guard now also refuses value imports from `@pages/...` and from `@config/...` modules not on the client-safe list.
- A reload on a sheet no longer pushes another history entry.
- Two quick status taps: Undo returns to the one before. The status shown is kept in a per-item map, written synchronously.

## New tests
- **AdminShell (13):**
  - a tab crash and a sheet crash each show Try again while the rest works
  - scroll lock and restore
  - Home closed-day message and Next up
  - empty day + Add
  - Day sheet closed note and "+ Book a party…"
  - Classes "In Square" rows and the legacy sheet
  - one Add in the library
  - editor and block buttons in the footer, and a single heading
  - sandbox by address on live
  - no extra history entry on reload
  - quick-tap Undo
  - no waiting count while loading
- **CalendarView (5):** narrow list with highlight; grid with title and "Wed 12" header; folded closed days; month Closed; one-line times.
- **CSS tests (5)** and a **Toast region** test.
- **Fixed for test isolation:** one test now waits for its async `history.back()` before ending, so it no longer leaks into the next test.

## Visual re-check
Throwaway passcode on port 4329, browsing only. The page `fetch` was patched to add a long-named draft class, a party, blocked time and the party record; posts were answered locally. Server stopped and tab closed.
- **390px:** Home with a closed-day message, one-line times and a long name truncated. The toast is on screen. The New class sheet has its footer buttons and no overflow.
- **820px:** icon rail; the week grid with stacked headers; with the party panel open, the day list with the party highlighted.
- **1024px:** sidebar; the Home 2-column layout with no overflow; the week grid fits.
- **Not re-checked in the browser:** the inbox item sheet. Its inbox data loads once when the shell mounts, which my fetch patch couldn't reach, so its new layout is covered by tests only.

---

# Fix round 2

Commit `abfbb83` fixes both Important items, all 14 remaining quirks, the 4 Minors, and the act() warning from `task-11b-A-rereview1.md`, following the coordinator's rulings.

Checks:
- `npx tsc --noEmit`: 0 errors.
- `npx vitest run`: 3451 passed, 0 failed. The 3 clock-dependent `events.test.ts` tests happen to pass at this hour.
- No act() warnings in the admin tests.

## Important
- **N1, the toast covered the iPad panel.** Fix: `body:has(.adm-sheet-layer.is-panel) .adm-toasts { right: calc(var(--adm-panel-w) + 1rem) }`. Checked at 820px with a status change: the toast spans x 88–435, and the panel starts at about 452.
- **N2, the page scrolled back with an animation.** Both programmatic scrolls (restoring after a sheet closes, and the tab change) now call `scrollTo({ top, behavior: 'instant' })`. The scroll-lock test asserts every call passes `behavior: 'instant'`.

## Rulings and quirks
- **Folding.**
  - Today never folds; it shows "Usually closed" if it is a closed weekday.
  - The fold row is "Closed Tue–Wed" with a real pill button, "Show Tue–Wed ⌄" (or "Hide …"), that sets `aria-expanded`.
  - Unfolding lasts for that week only.
  - Unfolded days show a muted "Usually closed".
  - The old "Fold the closed days" button is gone.
- **Month.**
  - Usual closed weekdays are quiet shaded cells with no word (aria-label "…, usually closed").
  - Named closures show the holiday name ("Halloween", "Thanksgiving", "Christmas") in the site's holiday colours.
  - Closed items no longer count as "things on".
  - Beside a panel (cells under 560px wide): coloured dots and a count instead of name stubs, and the open day is marked `is-active`.
- **Week grid.**
  - `GRID_MIN_PX` is 720, not 760. At a true 1024 landscape the content box is 756px, so 760 would have taken the grid away from iPad landscape too. iPad portrait (708px) still gets the day list, with or without a panel.
  - Chips: whole words, `hyphens: auto`, two lines then an ellipsis. `overflow-wrap: normal` stops mid-word breaks.
  - Shut empty days take half a column (`minmax(0, 0.5fr)`, set inline) and say "Usually closed".
- **Needs you:** 2×2 at 768–1023px and beside a panel. At 820px each tile is 147px and no label overflows.
- **Classes:** Square classes are grouped with one heading per day, and each row has a single "In Square" tag (the "Square class" sub-line is dropped there).
- **Boundaries.**
  - A tab's Try again calls `onRetry`, which reloads the calendar views and all four inbox lists before redrawing.
  - `SafeRow` wraps every agenda row (`ItemRow`) and inbox row, so a bad record shows "One item couldn't be shown." and the rest of the list stays.
  - Inbox lists that load again clear the remembered statuses Undo uses.
- **One date and time format.** `shell/time.ts` adds `dayAndSpan`, `dayAndClock` and `dayAndStart`.
  - Inbox headlines, "When" and "Sent" now read "Sat Nov 14 · 1 PM".
  - ClassList and ClassBookings read "Fri Oct 23 · 6–8 PM".
  - The "Sent" date in subtitles reads "Sat Oct 17".
- **Old class form in a sheet.** Errors, notices and "People to tell" render in the body. Only the buttons go to the footer, as a full-width stack (`.adm-savebtns`).
- **Contact buttons.** Call, Email and Text show only their label. The number or address sits underneath as selectable text (`user-select: all`), wrapping anywhere only inside the address.
- **Home on a closed day.**
  - "Next up" takes only classes, Square classes, parties and Craft Café, never blocked time.
  - "Print today" is hidden when nothing is on.
- **Day sheet on a closed weekday or closure:** "Parties can't be booked on Tuesdays." (or "…on closed days.") replaces "+ Book a party on this day".
- **Inbox sheet.**
  - The status control wraps 2×2 in any sheet or panel; it goes to one row only on the page (`.adm-main`).
  - "Status" is an `h3.adm-lbl` in the body font.
  - It has 1rem of room under the Next note. Root cause: the `.adm p { margin: 0 }` reset outranked `.adm-note` and `.adm-lbl` margins; it is now `:where(.adm) :where(p)`.
- **act() warning:** that test now waits for the Day sheet's load.

## New tests
- **layout-css.test.ts (+4):** toast vs panel; the zero-specificity `p` reset; Needs you 2×2 plus whole-word chips; the 4-way status control on one row only in `.adm-main`.
- **Boundary.test.tsx (2):** Try again calls `onRetry` and redraws; a bad row is skipped while its neighbour still draws.
- **CalendarView (+4, others updated):** folding with a Show/Hide pill and `aria-expanded`, reset on the next week; today never folds; month quiet closed weekdays and Halloween; month dots and count with the open day marked; half-width shut columns.
- **AdminShell (+4, others updated):** Next up skips blocked time; Square classes one heading per day with one label; class-form footer holds only buttons; the Status label style and placement. The scroll lock asserts instant scrolls. The bad-record test now expects a per-row note.

## Visual re-check (390 / 820 / 1024)
- **Setup:** `astro dev` on port 4329 with a throwaway passcode. Data seeded in `.netlify/blobs-serve/{entries,metadata}/0/site:<store>/<key>`:
  - 2 requests (one with a long name, a long organisation and a long email; one Quoted)
  - 1 message and 1 teacher application
  - a draft class with a 66-character name
  - a blocked time
- **390px:** Home on a closed Monday ("Next up" skips the block); the inbox sheet with a 2×2 status control (no clipping), the address under Email wrapping only inside itself, and section spacing.
- **820px:** icon rail; Needs you 2×2; inbox sheet in the panel with the status control wrapping and every label fitting; after a status change the toast sits left of the panel.
- **1024px:** the month with the day panel (open day marked, dots and counts, shaded closed weekdays, Halloween in colour, no horizontal scroll); the week grid with half-width closed days and whole-word chips.
- **Cleanup:**
  - Writes went only to the local emulated store, and the one status change was undone.
  - The seeded entries/ and metadata/ are deleted, leaving `.netlify/blobs-serve` empty as before.
  - The server is stopped and my tab is closed. An existing tab on port 4333 belonged to another session and was left alone.
