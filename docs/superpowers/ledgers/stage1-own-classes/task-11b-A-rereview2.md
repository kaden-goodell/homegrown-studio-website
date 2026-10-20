# Task 11b-A re-review 2 (fix round 2)

Worktree `/Users/catherine/source/homegrownStudio-admin`, branch `kaden/admin-d`, 3ecfb1e..abfbb83. Read-only: nothing committed, pushed or changed in tracked files.

**Verdict: Approved.** Both Important findings are fixed and confirmed in the browser. No new Important problems. Every quirk from re-review 1 is addressed or accepted. A few small polish items are left for the owner's eye (listed below); none blocks.

Counts: Important 0 · new UX quirks 4 · Minor 5.

## Checks run
- `npx vitest run tests/components/admin tests/api/admin`: 21 files, 197 tests, all pass. 0 act() warnings. The stderr lines in admin-classes.test.ts are expected warn logs.
- `npx tsc --noEmit`: 0 errors.
- Hands-on: `ADMIN_PASSCODE=review-only-123 npx astro dev --port 4334`, same-origin iframe at 390×844, 820×1180 and 1024×768.
  - **Seeded** in `.netlify/blobs-serve/{entries,metadata}/0/site:<store>/<key>`:
    - 2 requests: one with a long name, long organisation and long email; one Quoted
    - 1 malformed request (no `about`/`event`)
    - 1 half-malformed request (row fields fine, no `where`), to reach the sheet boundary
    - 1 message and 1 teacher application
    - a draft class with a 68-character name, Fri Oct 23 6–8 PM
    - a blocked time, Thu Oct 22 4–6 PM
  - **Writes:** only status changes on the local emulated request, each put back to New. Nothing was sent to Square, Gmail or texting.
  - **Cleanup:**
    - `.netlify/blobs-serve` was empty before and is empty again.
    - The server is stopped, the tab is closed, and `git status` is clean.
  - **Console:** only the deliberate bad-record errors, each caught by a boundary.

## Important findings from re-review 1

| # | Verdict | Evidence |
|---|---|---|
| N1 toast over iPad panel | **Fixed** | admin.css:1485-1487. 820: toast x 88–435, panel starts at 451. 1024: toast x 236–568, panel starts at 584. Undo works in both. |
| N2 smooth glide on sheet close | **Fixed** | AdminShell.tsx:248, 323-324 use `behavior: 'instant'`. On Home at 390, scrolled to 157, then opened and closed a sheet. scrollY trace after close: 157 within one 25ms tick, flat after. The body was `fixed; top:-157px` while open. |

## Quirks and minors from re-review 1

| # | Verdict | Notes |
|---|---|---|
| Q1 today folded | Fixed | "Mon Oct 19 · Today" + "Usually closed", fold row "Closed Tue–Wed" (CalendarView.tsx:145-186). |
| Q2 fold control | Fixed | Pill "Show Tue–Wed ⌄" / "Hide Tue–Wed", aria-expanded toggles, unfolded days say "Usually closed". |
| Q3 Show sticks across weeks | Fixed | Next week opens folded ("Show Mon–Wed"). |
| Q4 month noise | Fixed | Quiet shaded Mon–Wed; Halloween cells in orange with the name. |
| Q5 month beside panel | Fixed | 1024 and 820: dots + count, open day `is-active`, no horizontal scroll. Follow-up in new Q2. |
| Q6 mid-word chip breaks | Fixed | Whole words, 2 lines, ellipsis ("Hand-Letterin…"). |
| Q7 shut columns | Fixed | Half width (65 vs 130px at 1024). Known leftover: headers "Mon…"/"Wed…" clip (controller's note). |
| Q8 Needs you tiles | Fixed | 820: 2×2, 147px tiles, nothing overflows. |
| Q9 Square classes grouping | Fixed (code + tests) | ClassesTab.tsx:49-56. |
| Q10 one bad record blanks Inbox | Fixed | The bad request shows "One item couldn't be shown." and the other rows still draw. Tab Try again reloads its sources (AdminShell.tsx:367, Boundary test). |
| Q11 time formats | Fixed | "Sat Nov 14 · 1 PM", "Sent Sat Oct 17". |
| Q12 old class form footer | Fixed (code) | ClassEditor.tsx:613-622. |
| Q13 long email in footer | **Partly** | No longer splits the button, but see new Q1. |
| Q14 Next up picks blocked | Fixed | Home on Monday: "Next up: Fri Oct 23 · Advanced Hand-Lettering…", skips Thursday's block. "Print today" hidden. |
| Status 2×2 in panel | Fixed | All 4 fit at 390/820/1024, none clipped. Status label is in the body font with room above it. |
| Day sheet on closed day | Fixed | "Parties can't be booked on Tuesdays." / "…on closed days." |
| `shown` map cleared on reload | Fixed | InboxData.tsx:69-72. |
| act() warning | Fixed | None in the run. |

## New UX quirks (polish; not blocking)

1. **The Call and Email buttons are different heights.** In the inbox sheet footer, the email address underneath wraps to 2–3 lines, and the grid stretches the Call button to match.
   - Measured: Call 57.6px vs Email 48px at 390, 77px vs 48px at 820, 58px vs 48px at 1024.
   - The address still breaks mid-word ("…example.invali / d") with an orphaned "-" line at 820.
   - Fix: `align-content: start` on `.adm-contactcol` (admin.css:1598). For the address, use one line with an ellipsis (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`), since the mailto carries the full address.
2. **Month: today and the open day look the same.** Both get a brown ring (`.is-today` border at admin.css:839, `.is-active` outline at admin.css:1538). With a day open at iPad size, two days are ringed and you can't tell which one is open. Fix: fill the active cell with the soft primary colour (or mark today with a filled date number) so the two differ.
3. **Inbox tabs clip beside the panel at 1024 landscape.** "Message…" and "To decid…" are cut off with a request open. 820 is fine. Inbox.tsx:38 Seg. Fix: let the Seg scroll or wrap, or drop the counts to badges when the column is under about 380px.
4. **Holiday name is cut to "Hallo…" / "Hall…"** in month cells on the phone and beside the panel; "Thanksgiving" will be worse. The colour already says it. Fix: show a short form ("Closed") or nothing below about 60px, and keep the full name in the aria-label and sheet.

## Minor
- Sheet boundary "Try again" re-renders the same bad data and fails again (AdminShell.tsx:379-383, no `onRetry`). With a half-broken request, the owner gets "Something went wrong" and can't see the person's phone or email. Consider SafeRow around each answer group in RequestAnswers so the header and contact footer still show.
- The Inbox counts include the unreadable record ("Requests 3", "5 waiting") while only 2 readable rows show.
- Day sheet subtitle on Halloween says "1 thing on" (counting the closure; CalendarSheets.tsx:56), while the month no longer counts closures.
- "Print this day" still shows on an empty closed day in the Day sheet.
- The fold pill's ⌄ / rotated chevron renders small and off the text baseline; a CSS chevron or SVG would sit better.
