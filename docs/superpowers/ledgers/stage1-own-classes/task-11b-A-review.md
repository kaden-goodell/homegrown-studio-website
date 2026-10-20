# Task 11b-A review: /admin shell, direction D

Worktree `/Users/catherine/source/homegrownStudio-admin`, branch `kaden/admin-d`, 5248558..5039325 (4 commits). Read-only review. Nothing committed, pushed or changed.

**Verdict: Needs fixes.** The architecture is solid and most of the brief is met: hash routing, one sheet at a time, the leave prompt, focus return, inert background, independent loaders, 401 handling, server-validated X-Admin-Who, and owner-only routes. Three things break on a real device: toasts never appear on screen, the iPad Home overflows with a long class name, and on an iPad the side panel squeezes the week calendar so the item you tapped scrolls out of view.

Checks run:
- `npx vitest run tests/components/admin tests/api/admin`: 19 files, 160 tests, all pass. There are two act() warnings in CalendarView tests and jsdom's "scrollTo not implemented" noise.
- `npx tsc --noEmit`: 0 errors.
- Hands-on: `astro dev` on port 4331 with a throwaway passcode. Phone at 390×723 (and 375) inside a same-origin iframe, because Chrome's window can't go narrower than 614. iPad at 1024×768 and 820×1180, scaled.
  - Real data is thin: 5 Square classes, Craft Café, closed days, and empty inboxes. To see Party, Blocked, a draft class and the inbox sheets, I patched the iframe's `fetch` so those lists returned sample records and every write (status changes, block remove) was answered locally. Nothing reached Square, Gmail, texting or the stores.
  - The only console errors came from my first, wrongly shaped sample record (see Minor: no error boundary).
  - Tab closed and server stopped.

## Spec

| Item | Status | Where |
|---|---|---|
| Sign-in → 5-tab shell, default Home | Met | AdminShell.tsx:43-74, 158 |
| Sign-in busy state, show-passcode toggle, shared card | Met | AdminShell.tsx:86-129 |
| "Who's using this?" remembered, changeable in More, X-Admin-Who on every request | Met | AdminShell.tsx:47-58, shell/who.ts, classes/api.ts:32-41, More.tsx:55-60 |
| Server: adminActor validates against a fixed list; replaces ADMIN_BY in actions and routes | Met (not spoofable to arbitrary names) | lib/admin-who.ts:9-19, lib/admin-auth.ts:60-67; classes/library/blocked/refund/photo routes |
| Inbox badge = new requests + messages + teachers + to-decide | Met | InboxData.tsx:104-114, AdminShell.tsx:335-340 |
| Phone bottom tab bar ≥56px + safe area; ≥900px 220px sidebar; page uncapped to ~1200px | Met | admin.css:141-250, admin.astro |
| One sheet at a time; opening from a sheet replaces it | Met | AdminShell.tsx:211-228 |
| Phone bottom sheet (92dvh, handle, pinned head/foot); iPad side panel; forms as centred modal | Met | Sheet.tsx:61-88, admin.css:1040-1200, router.ts:117 |
| Escape/× close; focus to × on open, back to the opener on close | Met | AdminShell.tsx:281-302 |
| Background inert on phone | Met, but the page still **scrolls** behind the sheet (UX quirk 4) | AdminShell.tsx:324-344 |
| In-sheet leave prompt on ×, Escape, scrim, tab change, other sheet, Back; never window.confirm | Met (checked in the browser, Back included) | Sheet.tsx:41-54, AdminShell.tsx:192-195, 253-259 |
| Hash routing, plain tokens, refresh restores tab and sheet, Back closes the sheet and stays in /admin | Met | shell/router.ts, AdminShell.tsx:155-189, 248-278 |
| Toasts: one role=status region above the tab bar, 4s, Undo, "Didn't save. Try again." | **Partly**: works in code and jsdom, but renders **off-screen** in a browser (Important 1) | Toast.tsx, admin.css:1202-1253 |
| admin.css with site tokens, heading scale, ≥44px buttons, 16px inputs, focus ring, reduced motion | Met for new code (scan found no target <44px on any tab at 390px). The old class screens keep their inline styles (allowed deviation) | admin.css:53, 1026, 1270 |
| Each source loads on its own with its own error and Try again; 401 → sign-in | Met | shell/data.ts:14-32, InboxData.tsx:40-55, api.ts:45 |
| Empty states: a sentence plus the button that fixes it; skeleton loading | Partly: skeletons are good. Home "Nothing on today." and Classes "No classes coming up" have no button in the empty state | Home.tsx:47-49, ClassList |
| Home: greeting by Chicago time, date, Today rows (time · name · sub · colour · Draft/Cancelled), This week (only days with something), 4 counters, 4 buttons, iPad 2 columns, closure name | Met. The iPad 2-column grid overflows (Important 2) | Home.tsx, shell/items.tsx:45-66 |
| GET /api/admin/to-decide.json → {items:[]} | Met, owner-only | to-decide.json.ts |
| Calendar: Week (default) / Month, ‹ Today ›, phone day list with +, iPad 7 columns, month count and iPad chips, folded Key | Met. Paneled iPad layout is poor (Important 3) | CalendarView.tsx |
| Day sheet with the 4 add actions | Met | CalendarSheets.tsx:47-65 |
| Item sheets: our class → ClassBookings; Square class read-only; party Details/Guests/Payments + tel:/sms: with visible number; blocked + in-sheet confirm remove; café + Change café hours; closed + Edit closed days | Met (party and blocked checked with sample data) | ClassSheets.tsx:23-40, CalendarSheets.tsx:68-260 |
| Party data from the existing record + RSVP/waiver readers; no host token | Met | party.json.ts |
| Book a party stage-1 sheet, /book?date= in a new tab | Met | MoreSheets.tsx:224-235 |
| Inbox: 4 segments with counts; folded rows with badge and Next; item sheet with all answers and photos; 44px status Seg with each list's statuses; Call/Email with visible text | Met. "Not this time" is clipped at 390px (UX quirk 6) | Inbox.tsx, InboxSheets.tsx, describe.ts |
| Optimistic status, Undo, revert on failure, row stays under the filter until you leave | Met in logic (checked with the patched fetch). The toast carrying Undo isn't visible (Important 1) | InboxData.tsx:83-102, Inbox.tsx:56-93 |
| More: 6 rows with stage tags; Parties setup read-only from config + crafts API; Hours/Closed read-only; Staff/Promos "Coming soon" with no fake data; Reports | Met | More.tsx, MoreSheets.tsx |
| Reports: seats, sales, refunds (count + $), parties booked, says what it covers | Met. The label doesn't say sales are before refunds (Minor) | reports.json.ts:28-44, MoreSheets.tsx:133-168 |
| Set up sandbox only when the server reports sandbox (M1 / P0 #8) | Met in the list. The sheet still opens from `#more-sandbox`; the server refuses the POST (Minor) | More.tsx:20-26, seed-sandbox.json.ts GET |
| Old 7-tab layout removed; class screens still work inside sheets | Met | AdminApp.tsx deleted; ClassesTab.tsx, ClassSheets.tsx |
| Existing API contracts kept | Met (diff only adds a `by` argument and new optional fields) | admin-actions.ts, calendar.json.ts |
| Tests: old coverage ported, new behaviour covered, tsc clean | Met. Tests assert real outcomes (hash, focus, inert, X-Admin-Who, revert) | AdminShell.test.tsx (34), router/Toast/client-imports tests, admin-shell-routes.test.ts |

### Implementer deviations
1. Monday–Sunday weeks: acceptable. Side effect: on a phone the week opens with three empty closed days (Mon–Wed). That matches the mock-up, but see UX quirk 9.
2. Classes tab shows only Upcoming · Library, using the old screens: acceptable (11b-B).
3. Old New class / Block / bookings / Edit / Print inside sheets: acceptable as interim. The New class form overflows its card in the sheet (UX quirk 5).
4. Book a party explainer: acceptable (per brief).
5. Party sheet read-only, fee shown as paid: acceptable. Website-booked parties always paid the $300.
6. Guests listed one row per family: acceptable.
7. Blocked time has one reason shown as "Note": acceptable until 11b-C.
8. Setup pages read-only, no add-ons: acceptable.
9. Staff/Promos "Coming soon" note: acceptable.
10. Reports scope: acceptable; the label needs one tweak (Minor).
11. "New only" toggle and each list's own statuses: acceptable.
12. To decide read-only: acceptable.
13. Extra More rows (Using as, sandbox, Sign out): acceptable.
14. Calendar colours: acceptable, but Blocked and Closed share one grey in the Key (UX quirk 11).
15. "–" / "!" counters: acceptable.

## Important findings (must fix)

1. **Toasts render off-screen, so no Undo and no "Didn't save" message is ever seen.**
   - Cause: `.adm-toasts` uses `var(--adm-tab-h)` and `var(--adm-side-w)` (admin.css:1207, 1249). Those are defined only on `.adm` (admin.css:16-17). `ToastHost` renders its region outside the `.adm` div (AdminShell.tsx:67-71; Toast.tsx:45), so the `calc()` is invalid and `bottom` falls back to auto.
   - Measured in Chrome: after "Remove" on a block, the toast sat at y=1038, and after an inbox status change at y=735, both in a 723px-high viewport.
   - Effect: every save message, the Undo on block remove, block add and inbox status, and the failure message never show. jsdom can't catch this.
   - Fix: declare the two variables on `:root` (or on `.adm, .adm-toasts`), or render the toast region inside `.adm`. Then check that the toast clears the tab bar on a phone, sits beside the sidebar on an iPad, and doesn't cover the pinned sheet footer (Call/Email) while a bottom sheet is open. Raising it above the footer when a sheet is open is worth considering.

2. **iPad Home: the two-column grid overflows when a name is long.**
   - Cause: `.adm-cols { grid-template-columns: 1.25fr 1fr }` (admin.css:618). An `fr` track has an auto minimum, and the rows' no-wrap names set that minimum.
   - With a 55-character class name at 1024px, the columns came to 524 + 297 px in a 756px box. The page scrolled sideways (scrollWidth 1093) and clipped the "Teachers"/"To decide" counters and the Block time button.
   - Fix: `minmax(0, 1.25fr) minmax(0, 1fr)`. Check the same pattern on `.adm-need` (`repeat(4, 1fr)`) and `.adm-wgrid`.

3. **iPad with a side panel open: the week calendar loses the day you tapped.**
   - Cause: `.adm-shell.is-paneled .adm-wgrid { grid-template-columns: repeat(7, 8rem); overflow-x: auto }` (admin.css:690-693).
   - At 1024 × 768, sidebar (220) + panel (440) leaves about 364px. Only Mon–Wed show, which are always-empty closed days. The Friday chip that was tapped is pushed off to the right, inside a horizontal scroller.
   - Fix: while paneled, switch the week to the phone day-list layout (it reads well at 360px), or scroll the tapped day into view and start from Thursday. Month view while paneled needs the same check.

## UX quirks

1. **Time column breaks across two lines** (shell/items.tsx:86-94).
   - What's wrong: `time.split('–')` puts "6–" on one line and "8 PM" on the next. Times are also formatted two ways: "9:00 AM–12:30 PM" for Café, "9 AM–12 PM" for everything else.
   - Fix: one line, with a no-break space before AM/PM. If width is short, show the start bold and the end muted. Use one time format.
2. **Blocked sheet text wraps mid-time**: "9 AM–12 / PM" (CalendarSheets.tsx:125). Fix: a no-break space inside `formatTimeSpan` output.
3. **iPad portrait (820/834/768) gets the phone layout stretched to the full width.**
   - What's wrong: the Week/Month control is 800px wide, rows are 800px, and the bottom sheet is 820px wide.
   - Fix: cap `.adm-main` at about 640px, centred, below 900px, and the bottom sheet at about 600px, centred. It then reads like an iPad app, not a blown-up phone. The 1024 sidebar layout also stretches Week/Month to 1000px; a max-width of about 360px would suit it.
4. **Phone sheet: the page behind still scrolls.**
   - What's wrong: `inert` blocks taps, not scrolling. Wheel and touch over the scrim scroll the page underneath (checked), and on iOS the scroll chains into the page.
   - Fix: lock scroll while a modal sheet is open (`overflow: hidden` on html/body, or `overscroll-behavior: contain` plus a fixed body), and put the scroll position back on close.
5. **New class sheet (old ClassEditor) at 390px.**
   - What's wrong: the inputs run 22px past their card (input 35–378 inside a section 18–372 with 16px padding). The old sticky save bar ("Add class" / "Add and keep in the library") also covers fields mid-form instead of using the pinned sheet footer.
   - Fix: `.adm-sheet .class-editor .field-input { width: 100%; box-sizing: border-box }` (or `min-width: 0`). Either move the save bar into SheetFrame's footer or make it non-sticky in sheets, unless 11b-B ships together with this.
6. **Request status control clips "Not this time" to "Not this …" at 390px** (InboxSheets.tsx:46-51). Fix: let a 4-option Seg wrap to 2×2, or use the short label "Declined" / "Not now".
7. **Inbox item sheet has no visual hierarchy.**
   - What's wrong: group headings (THE EVENT, EXTRAS, MORE) use the same small caps as the field labels (WHAT, FOOD, BUDGET). "THE EVENT" sits right under the Next note with no gap. A long name plus organisation makes the header title 3 lines. The status control is at the very bottom of a 1,200px scroll.
   - Fix: give group headings a different style and more space above them. Put the org in the subtitle. Consider putting the status Seg just under the Next note, since it is the one control used on every visit.
8. **Section labels crowd the row above them in sheets.** For example "ONE-OFF DAYS" and "WHOLE-STUDIO PACKAGE" in Parties setup, and the label right under the note (MoreSheets.tsx:63-78). Fix: `.adm-sheet-body .adm-lbl { margin-top: 1.1rem }`, with no extra gap after a note.
9. **Phone week opens on three always-empty days.**
   - What's wrong: Mon, Tue and Wed each show "Nothing on this day + Add" before the first real day. The studio is closed Mon–Wed.
   - Fix: show weekly-closed days as one compact grey row, "Closed (Mon–Wed)", or fold them. Do the same on Home Today on a Monday: the mock-up says "Nothing on today. The studio is closed Mondays." and the build says only "Nothing on today."
10. **Month view on a phone: a closed day shows the same blue "1" as a day with a class or party.** For example Thanksgiving 26 and 27, and Halloween weekend (CalendarView.tsx:128). Fix: grey or hatch closed cells and leave the count off them, so a busy day is told apart from a shut day.
11. **Key: Blocked and Closed are the same grey** (admin.css kind tokens). Fix: hatch Closed, or use a darker grey.
12. **iPad week grid at 1024px with the sidebar.**
    - What's wrong: the day headers wrap to 3 lines ("Tue / Oct / 20") beside the + button, and chip names cut off after 3 lines.
    - Fix: put the weekday and date on one line ("Tue 20") with the + on its own row or as a smaller icon. Let chips show 2 lines with a title tooltip.
13. **Classes tab says "No classes coming up"** while Home and Calendar show 5 Square classes this month. Catherine will read this as broken. Fix: one line, "Classes still run from Square show on the Calendar.", or list them read-only under Upcoming (11b-B may cover this).
14. **Classes › Library shows two stacked brown primary buttons** ("+ New class" in the header and "Add a class to the library") plus an outline "Show archived". This is the P0 #4 removal, deferred to 11b-B. If 11b-A ships alone, hide the second button.
15. **Block time sheet.**
    - What's wrong: the sheet title "Block time" is repeated as a big h1 inside the body. The submit button sits in the body, not in the pinned footer.
    - Fix: hide the old heading (as was done for the other old screens) and move the button to the footer.
16. **Draft rows use a strong diagonal hatch behind the text** (admin.css:505), which hurts legibility on a phone. Fix: a light hatch on the colour bar only, or a dashed border; the Draft tag is already there.
17. **Small copy and consistency points.**
    - The Day sheet says "Book a party on this day" without the "+" that Home uses.
    - The Inbox header shows "0 waiting" while lists are still loading.
    - The Day sheet on a closed day still offers + New class, Book a party and Block time with no word that the day is closed.
    - The empty passcode can be submitted (it sends a request and says "That passcode isn't right."). Ask for it on the device instead.

## Minor

- **No error boundary.** One malformed stored record makes a list component throw. My first sample request lacked `event.date` and blanked the whole /admin to a white page. Wrap each tab panel and the sheet in a small boundary ("This part didn't load. [Try again]"), in the spirit of P0 #7.
- **`#more-sandbox` opens the Set up sandbox sheet on the live site by address.** The server refuses the POST with 409, so there's no risk, but the sheet should render "Only on the test site" unless GET says sandbox (MoreSheets.tsx:189).
- **Reports.** `classSalesCents` counts refunded seats, and comps count as seats sold (reports.json.ts:33-36). Label it "class sales (before refunds)" and say comps are included, or show net.
- **client-imports.test.ts guards only `@lib/...`.** `@pages/api/...` and `@config/...` value imports aren't guarded. Today they are type-only or client-safe; extend the regex so it stays that way.
- **Each refresh on a sheet address pushes another history entry** (AdminShell.tsx:180-189). It's harmless, but Back needs one extra press per refresh.
- **Inbox `setStatus` reads the old status from `ref.current`** (InboxData.tsx:84). Two quick taps before a render can record the wrong "was" for Undo. Read it inside the setter or keep a per-id pending map.
- **Inbox status changes still aren't recorded per owner.** The implementer noted this; their stores have no `by`. Fine for now.
- **Block remove's Undo re-adds with `confirm: true`.** It can land over something booked in the meantime; nothing is cancelled. This was noted and is acceptable.
- **CalendarView tests log two act() warnings.**
- **Performance is fine.** calendar.json for 6 weeks took about 550 ms locally (per-party record reads and per-class ledgers). Worth caching ledgers if months get busy.

Counts: Important 3 · UX quirks 17 · Minor 10.
