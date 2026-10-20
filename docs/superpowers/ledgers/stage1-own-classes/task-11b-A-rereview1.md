# Task 11b-A re-review 1 (fix round 1)

Worktree `/Users/catherine/source/homegrownStudio-admin`, branch `kaden/admin-d`, 5039325..3ecfb1e. Read-only review: nothing committed, pushed or changed in tracked files.

**Verdict: Needs fixes.** Two Important findings are left. Most of the round is good: toasts show on a phone, iPad Home no longer overflows, and the week never scrolls sideways. The closed-day folding, the one time format, the "In Square" rows, the boundaries and the sheet footers all work in the browser. What's left:
- On an iPad, the toast lands on top of the side panel's Call button.
- The new scroll lock puts the page back with a smooth scroll, because the site's CSS sets `scroll-behavior: smooth` on html.

Counts: Important 2 (1 carried over, 1 new from the fix) · UX quirks 14 · Minor 4.

## Checks run
- `npx vitest run tests/components/admin tests/api/admin`: 20 files, 184 tests, all pass. The CalendarView act() warnings are gone. There is a new one in AdminShell.test.tsx:634 ("an open day with nothing on…", DaySheet update not wrapped in act).
- `npx tsc --noEmit`: 0 errors.
- Hands-on: `ADMIN_PASSCODE=review-only-123 npx astro dev --port 4332`.
  - Phone: 390×844 in a same-origin iframe. iPad: 820×1180 and 1024×768, scaled.
  - **Seeding:** `astro dev` emulates Netlify Blobs here ("Emulating features: … blobs"), so stores are not read from `.data/`. They live in `.netlify/blobs-serve/{entries,metadata}/0/site:<store>/<key>`. I seeded these there:
    - 2 private event requests: one with a long name and organisation, one Quoted
    - 1 message and 1 teacher application
    - a draft class with a 66-character name on Fri Oct 23, 6–8 PM
    - a blocked time on Thu Oct 22, 4–6 PM, added through the local admin route; it only reads Square
    - later, one malformed request, to trip the boundary
  - Writes made in the browser touched local emulated stores only: block remove, Undo, and inbox status changes. Nothing was sent to Square, Gmail or texting.
  - There are no real parties in the next 6 weeks, so the party sheet wasn't re-walked. It was untouched this round apart from the shared time formatter.
  - Cleanup:
    - `.netlify/blobs-serve` was empty before I started and is empty again (entries/ and metadata/ removed).
    - The temporary `.data/` folder I first wrote is deleted.
    - The server is stopped, the tab is closed, and `git status` is clean.
  - Console: the only errors were from the deliberately malformed record, caught by the boundary.

## Verdicts: Important findings from the first review

| # | Finding | Verdict | Evidence |
|---|---|---|---|
| I1 | Toasts off-screen | **Partly** | admin.css:73-88 (vars on :root), Toast.tsx:45. **Phone:** fixed. "Block removed. Undo" sits at y 705–764 above the tab bar (776). With a bottom sheet open, it moves to the top (y 24–83), clear of Call/Email; it overlaps the sheet's drag handle by about 16px, which is fine. Undo works and puts the status back. **iPad (820 and 1024):** with a side panel open, the toast still covers the panel's pinned footer. At 820 it spans x 88–536 and the panel starts at 451; at 1024 it spans x 236–684 and the panel starts at 584. Either way it sits right on the **Call** button for 4 s. See New Important N1. |
| I2 | iPad Home overflow | **Addressed** | admin.css:630, 668. At 1024 with the 66-character name, scrollWidth = clientWidth = 1024, and the columns are 404 + 324. At 820: 378 + 302, no overflow. |
| I3 | Week grid hid the tapped day | **Addressed** | CalendarView.tsx:30, 88-94, admin.css:726-732. At 820 with a panel open, the week turns into the day list and the tapped Square class is outlined and in view. No sideways scroll at any size. |

## Verdicts: UX quirks from the first review

| # | Verdict | Notes |
|---|---|---|
| 1 Time column wraps / two formats | Addressed | shell/time.ts; rows read "6–8 PM" on one line. One leftover: the inbox shows "Sat Nov 14 at 1:00 PM" (from `whenLabel`), see Q11. |
| 2 Blocked sheet "12 / PM" | Addressed | "Customers can't book anything 4–6 PM." |
| 3 iPad portrait stretched phone | Addressed (R-A1) | 72px icon rail at 820, Week/Month capped at 360px. |
| 4 Page scrolls behind sheet | **Partly** | AdminShell.tsx:314-325. The lock holds: body fixed at -262.5px, and scrollBy does nothing. The restore is the new N2. |
| 5 New class sheet overflow / sticky bar | Addressed | 0 inputs past their card at 390; Add class / Add and keep… sit in the pinned footer (133px). Style nit in Q12. |
| 6 "Not this time" clipped | **Partly** | Fixed on a phone (2×2). In an iPad side panel (≥768 viewport, about 369–440px panel) the 4 options go back to one row, and "Not this time" is clipped to "Not this ti…" at both 820 and 1024 (admin.css:1427-1430 keys off the viewport, not the panel). |
| 7 Inbox sheet hierarchy | **Partly** | The person is the title, the organisation is in the subtitle, Status sits under Next, and the group headings are serif with a rule. But the "Status" label is an `h3.adm-lbl` that takes the serif heading font (Playfair, uppercase), so it looks unlike every other label. It also sits 0px under the Next note (`style={{ marginTop: 0 }}`, InboxSheets.tsx:42). |
| 8 Labels crowding in sheets | Addressed | admin.css:1435-1441. |
| 9 Phone week opens on empty closed days | Addressed | "Closed Mon–Wed · Show" row; Home on Monday says "The studio is closed today." + Next up. Follow-ups in Q1–Q3. |
| 10 Month closed = busy | Addressed | Hatched cells with "Closed", no count. Noise follow-up in Q4. |
| 11 Key Blocked = Closed | Addressed | Dark solid grey vs hatch. |
| 12 iPad week headers / chips | Addressed | "Thu 22" on one line, 2-line clamp, title tooltip. Leftover in Q6. |
| 13 Classes tab empty vs Square | Addressed (R-A4) | "Still run from Square" with 5 read-only rows, which open the legacy sheet. Nit in Q9. |
| 14 Two Add buttons in Library | Addressed | `hideAdd`. |
| 15 Block time sheet heading / button | Addressed | ClassSheets.tsx `BlockSheet`, BlockTimeForm.tsx portal. |
| 16 Draft hatch | Addressed | Dashed bar on a plain row. |
| 17 Copy points | Addressed | "+ Book a party on this day". No "0 waiting" while loading. The Day sheet says "usually closed on Mondays". An empty passcode says "Type the passcode." with no request sent (checked in the browser). |

## Verdicts: Minor findings from the first review
- Error boundary: **Addressed**, but coarse. A malformed request replaced the whole Inbox tab with "Something went wrong showing this. [Try again]", while the tab bar and Home kept working. See Q10.
- `#more-sandbox` on live: **Addressed**. It shows "Only on the test site…" with nothing to press.
- Reports label: **Addressed** ("class sales, before refunds"; comps at $0).
- Import guard: **Addressed** (client-imports.test.ts covers `@pages` and non-client-safe `@config`).
- History entry on reload: **Addressed** (AdminShell.tsx:183-186).
- Quick-tap Undo: **Addressed** (InboxData.tsx `shown` map). In the browser: Quoted → Booked → Undo goes back to Quoted.
- Inbox status `by`, block Undo `confirm: true`: unchanged, accepted.
- act() warnings: **Partly**. The CalendarView ones are gone; a new one comes from AdminShell.test.tsx:634.

## Important (must fix)

**N1. iPad: the toast covers the side panel's Call button.**
- Cause: at ≥768 the toast region is `left: calc(var(--adm-side-w) + 1rem); right: 1rem; justify-content: flex-start` (admin.css:1314-1318). Nothing stops it before the panel.
- When it happens: on every inbox status change and every save with a panel open. The toast lies across Call for 4 s, and a tap there hits the toast's area, not Call (the region is `pointer-events: none`, but the toast itself isn't).
- Fix: `body:has(.adm-sheet-layer.is-panel) .adm-toasts { right: calc(var(--adm-panel-w) + 1rem) }`, so the toast stays under the page column. Optionally cap the toast at the column's width. A CSS test like the existing layout-css ones would hold it.

**N2. Closing a phone sheet scrolls the page back with an animation (new in this round).**
- Cause: global.css:106 sets `html { scroll-behavior: smooth }`. The restore is `window.scrollTo?.(0, y)` (AdminShell.tsx:323), which uses the root's smooth behaviour. The tab change at AdminShell.tsx:248 is called the same way.
- When body goes from `position: fixed` back to static, the document is at 0. The page shows its top, then glides down to where the owner was, every time a sheet closes after scrolling the week or Home.
- Not seen hands-on: the test window was hidden, so smooth scrolls didn't run at all there (the restore left scrollY at 0). Both cases are wrong.
- Fix: `window.scrollTo({ top: y, behavior: 'instant' })`, and the same at line 248. Assert in the scroll-lock test that `scrollTo` gets `behavior: 'instant'`.

## UX quirks (remaining)

1. **Today gets folded away on a closed Monday.** The phone week opens on "Closed Mon–Wed · Show", so "Mon Oct 19 · Today" is hidden. Fix: never fold today; fold only the other days, e.g. "Closed Tue–Wed". CalendarView.tsx:95-110.
2. **The folded + (implementer's concern).** "Show" is a 13px primary-colour word at the right end of a hatched row. It's readable once you know it's there, but it doesn't look like a control, and an owner who wants to add something on a Tuesday has no + in sight. Suggestions, best first:
   - (a) Make the row read like a disclosure: "Closed Mon–Wed" on the left, "Show days ⌄" as a small ghost pill on the right, with `aria-expanded` set and the chevron turning.
   - (b) Add a small + at the right of the folded row that opens a day picker for the folded days.
   - (c) Leave it, since the Day sheet is still reachable from Month and Home. The pill in (a) is the cheap, clear win.
   - Also: `aria-expanded` is hard-coded `false`, and the button disappears once unfolded, so screen readers get no state change. Unfolded closed days don't say they are closed; add a muted "Usually closed" under the heading.
3. **"Show" sticks across weeks.** `unfold` isn't reset when you go to another week (CalendarView.tsx:70). After one Show, every later week shows Mon–Wed in full until you find "Fold the closed days" at the bottom. Fix: reset `unfold` on week change, or key it by week.
4. **Month view is noisy with "Closed".** Every Mon–Wed cell says "Closed" (15 labels in October), and Halloween's Fri–Sun closure looks the same as an ordinary Monday. Fix: hatch alone for the usual closed weekdays; keep the word "Closed" (or the closure's name) only for real closures.
5. **iPad month with a panel open: chips shrink to useless stubs** ("Pa…", "Ki…", "Au…"). The month grid is about 316px at 1024. The tapped day isn't marked either. Fix: use the measured width (as the week does) to show the count instead of chips below about 560px. Mark the open day `is-active`.
6. **Chip names break mid-word.** "Needlepoi / nt 101" at 820 and 1024 (Chrome; no hyphen inserted). At 820 each column is 96px, so most names show 1–2 words. Two options:
   - Raise `GRID_MIN_PX` to about 760 so iPad portrait (748px content) uses the day list, which reads much better there.
   - Or drop `overflow-wrap: break-word` and let the clamp ellipsis do the work.
7. **Week grid gives Mon–Wed full columns** even when they're shut and empty: 3/7 of the width for "Closed". Fix: narrower columns for shut days with nothing on (e.g. `minmax(0, 0.45fr)`), which gives Thu–Sun the room.
8. **iPad 768–1023 "Needs you" tiles are 68px wide.** "Messages" overflows its box by 6px and "To decide" wraps. Fix: 2×2 at this width (or below about 340px for the column).
9. **Classes › "Still run from Square".**
   - Each row says "Square class" and also carries the tag "In Square".
   - Two items on the same day each repeat the day heading ("Sun Oct 25" twice).
   - Fix: group by day as Home does, and drop one of the two labels.
10. **One bad record blanks the whole Inbox.** The boundary is per tab, so one malformed request hid every request, message and teacher, and the Inbox heading. "Try again" re-renders the same data and crashes again.
    - Fix: guard per row (a small boundary around each inbox row and answer group, or a try around `describeItem`) that shows "This one couldn't be shown".
    - Make the tab boundary's Try again also call `retry` on the sources.
11. **Time format leftovers.** Inbox rows and the "When" field show "Sat Nov 14 at 1:00 PM" (`whenLabel` in event-request-options), and the old ClassList card shows "Fri, Oct 23 · 6–8 PM" with a comma. Both differ from "1 PM" / "Fri Oct 23" everywhere else.
12. **Old class form footer.** The buttons sit left-aligned at their natural widths and stacked ("Add class" 116px over "Add and keep in the library" 228px), unlike every other sheet footer (full-width `.adm-two`). The portal also moves errors, notices and the "People to tell" list into the pinned footer (ClassEditor.tsx:611). A long list there would eat the screen. Keep the messages in the body and only the buttons in the footer.
13. **Contact footer: long emails break mid-word** ("review-test@example.invali / d" on iPad, "review- / test@…" on phone). Fix: one line with ellipsis (the `mailto:` still carries it all), or the label "Email" plus the address on its own line.
14. **Home "Next up" on a closed day picks blocked time** ("Next up: Thu Oct 22 · Blocked · Deep clean…"). Blocked time isn't something on. Fix: skip `blocked` (and probably `cafe`) when choosing Next up (Home.tsx:43-48).

## Minor
- The new act() warning in AdminShell.test.tsx:634 (await the Day sheet's calendar load).
- The Day sheet on a usual closed weekday still offers "+ Book a party on this day". Customers can't book parties on those days, and the /book link will show nothing for that date. Consider hiding it there, or saying "Parties can't be booked on Mondays".
- Home on a closed day still shows "Print today".
- The status `shown` map (InboxData.tsx) is never cleared when a source reloads. If another device changes a status and the list is refetched, Undo can return to a stale "was". Clear the map on a source refresh.

## Notes for the controller
- Implementer's concerns: (1) the inbox item sheet wasn't checked in a browser; it is now, see quirk 7 / N1 / Q13. (2) The hidden + on folded days is quirk 2 above, with a suggestion.
- To seed local data for a future hands-on, write to `.netlify/blobs-serve/entries/0/site:<store>/<key>`, with a copy of any existing `metadata/…` file (it is `{}`) at the same path under `metadata/`. Not `.data/`, because astro dev emulates Blobs.
