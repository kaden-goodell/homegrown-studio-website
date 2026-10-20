# Task 11b: Rebuild /admin to direction D (owner-approved 2026-10-19)

Owner: "D looks great. Go on it!!!!" Reference mock-up (open and copy its structure, wording and behaviour): /private/tmp/claude-501/-Users-catherine-source-homegrownStudio/2dcd1843-324d-4cfb-b5af-16c757c96ae5/scratchpad/admin-directions.html (direction D, both iPhone and iPad modes). UX review with the P0/P1/P2 list that still applies: ux-review.md in this folder.

## Shell
- /admin keeps its sign-in; after sign-in the app is a 5-tab shell: Home · Calendar · Classes · Inbox · More (Inbox shows a badge with the count of New items + To decide items).
- Phone (<900px): tabs as a bottom bar (≥54px, safe-area padding). iPad/desktop (≥900px): tabs as a left sidebar (200px) with the studio name on top.
- Sheets: phone = bottom sheet; iPad = right-side panel (~40% width) with the page still visible (wide content reflows), forms/new-item flows as a centered modal on iPad. Only ONE sheet at a time: opening something from inside a sheet replaces it. Back/close returns to the tab. Leaving a dirty form shows an in-page "Leave without saving?" (no native dialogs).
- URL hash reflects tab and open sheet (e.g. #calendar, #class-cls_x) so refresh/back keeps place.
- Reuse the booking modal chrome/tokens and the studio's global.css tokens; consistent buttons (≥44px), headings, spacing.

## Home
Greeting with Catherine/Kaden (use "Good morning" etc. without a name if unknown), date line; Today (rows by kind colour); This week (non-empty days); Needs you counters: Requests · Messages · Teachers · To decide (each opens Inbox on that segment); big buttons: + New class (primary), + Book a party, Block time; small Print today. iPad: two columns (Today+This week | Needs you+buttons).
- "+ Book a party" in stage 1: opens a sheet explaining parties are booked on /book today, with an "Open the party booking page" link and "Coming soon: book for someone on the phone" note (stage 2 fills it in). Party rows open a read-only party sheet (host, guests, craft, paid) from existing party data.

## Calendar
Week (default) and Month; ‹ › and Today; a + on every day opening a day sheet: New class on this day (date prefilled), Block time on this day, Print this day (Book a party on this day: same stage-1 sheet). Shows our classes (drafts marked), legacy Square classes, parties, Craft Café, blocked time, closed days ("Closed for Thanksgiving"). iPad: 7-column week grid + month grid with item chips. Tap anything → its sheet (class sheet / party sheet / blocked time sheet with Remove + in-page confirm / café read-only).

## Classes
Segments Upcoming · Drafts · Past · Library. Past keeps bookings + refunds available. Library tiles: Schedule it (opens New class prefilled), Edit, Archive (in-page confirm + Undo toast).
New class sheet: "Start fresh" / "From a past class" (library picker fills fields); fields photo, name, day, start/end (end follows start keeping length), price, seats, then "More options" disclosure for passes/ticket types/questions/add-ons/rules/sessions (reuse ClassEditor pieces). Saving ALWAYS adds/links a library entry automatically (server: create links/creates the library entry in the same request — implement in admin-actions create path; remove "Add and keep in the library").
Class sheet tabs: Bookings (summary seats/taken, list, RefundPanel per booking, Print list) · Details (edit fields; Save; "This class only" / "This class and the library" ONLY when content fields differ from the linked library version) · Dates (sessions; add date; status). Cancel class lives in Details with in-page confirm and the who-to-contact list.

## Inbox
Segments Requests · Messages · Teachers · To decide. Existing request/message/teacher cards restyled into list rows that open a sheet (answers, status segmented New/Replied/Done with Undo toast, call/email buttons as text + copy). To decide = unmatched POS sales (listUnmatchedPos), refund flags (listRefundFlags: "Free a seat" → refunds.freeSeatOnly, "Keep their seat" → resolveRefundFlag), pos-needs-days (pick days → add a setter that moves the counter seat to the chosen sessions), classes below minimum (from minimum-to-run if present; else omit until Task 15). If an inbox source fails to load, only that segment shows an error (never the whole admin).

## More
List: Parties setup (stage 2 — show current config read-only: days/times, $300, guests 10–30), Hours & Craft Café (NEW editable screen: weekly café hours + special days; persist in a new kv store 'studio-hours' read by cafeHoursOn/cafeRunsOn with config as fallback; also rewrite the Square café item windows via the existing set-cafe-windows logic extracted into a lib function), Closed days (NEW editable screen: list + add/remove closures with optional holiday dress; persist in kv 'closures' merged with config closures; every consumer of studioOpenOn/closures reads the merged list), Staff (Coming in stage 3 — preview), Promotions (Coming in stage 4 — preview), Reports (seats sold, revenue, refunds this month from the ledger), Set up sandbox (only when sandbox).

## Must keep
All existing admin API contracts (expectedUpdatedAt, stale:true, confirm/confirmMove flags, peopleToTell), RefundPanel, PrintDay, existing tests updated (not deleted) to the new structure, tsc 0, full suite green (events.test.ts clock failures excepted until Task 14).
