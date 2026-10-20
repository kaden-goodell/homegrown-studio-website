# Task 9 report: public list and booking panel for our own classes

Status: DONE. Commit 8b55603 `feat(classes): public list and booking panel for our own classes` on kaden/own-booking-system (not pushed).

## What was built
- `src/lib/classes/public-class.ts` (new, browser-safe): `OwnClassData` / `PublicSession` / `PublicPass` types; `passState` (a pass is full when any session it needs has no seats; a choose-N pass needs N open sessions with room), `withSeatsSold`, `classAvailability` (sold out only when every sellable pass is full; otherwise nothing open → sign-ups closed), `lowestPrice`, `ownPriceLabel` ("$15" / "$20 adult · $15 kid" / "From $15"), `sessionsLine` ("4 sessions · starts Sat Oct 24"), `asScheduledClass` (feeds `quote()` in the browser).
- `src/lib/classes/public-view.ts` (new, server only): `listedPublicly` (open/closed, not linkOnly), `viewableByLink` (open/closed incl. linkOnly), `toPublicClass(cls, ledger, now)` → WorkshopData with `own`. Session `left` = capacity − `seatsTaken` from the ledger; session `closed` = `cutoffRefusal` (started or past cutoff). Only sellable passes (≥1 price cell) are sent; non-choose passes carry `sessionIds` from `sessionsForPass`. `taxPercent` = CLASS_TAX_PERCENT or 0 when not taxable. A `closed` class → `signupClosed: true, remainingSeats: null` (shows "Sign-ups closed" + RequestSpot, never "Sold out").
- `/api/workshops.json`: reads our classes (sessions in the next 400 days) in parallel with Square; merged and sorted by first session start. Our read failing (or one class's ledger failing → that class left out) marks the list `incomplete` so it is never cached; Square classes still list.
- `WorkshopData.own?: OwnClassData`. Explorer opens `ClassBookingPanel` when `own` is set (legacy modal untouched for Square classes), decrements seats locally after a booking, analytics item `{item_id: classId, item_category: 'class'}`.
- `priceLabel` / `workshopStatus` meta / `rowWhen` read `own` (ages + drop-off from class rules).
- `ClassBookingPanel`: steps Details (description, pass picker when >1 visible pass, day picker for choose-N, per-ticket counters min 0, cap = min(maxPerBooking, seats left on every needed session)) → For each person (only when questions/add-ons) → Your details and payment → booked. Summary lists seat/add-on lines and Tax, no total line; total only on "Pay $X" (client `quote()`). PaymentForm with NO applicationIdOverride/environmentOverride, gift cards allowed, wallet for any seat count, `tokenize()` once. Body `{classId, passId, sessionIds, tickets, seats, attemptId, paymentToken, customer, attribution, posthogId, sourceKind}`. Attempt id kept after `unknown_outcome`, `in_progress` (or no readable answer); new after any other code, and whenever pass/days/tickets/seat picks change. Errors show the server's `detail`. Confirmation shows server `totalChargedCents`, booked session dates, waiver link `/waiver?workshop=<cls>&booking=<bkg>` (same as the confirmation email), calendar links only for a single session.
- `/classes/[id].astro` + `ClassPage.tsx`: card + panel open on load; works for link-only (noindex for link-only); 404 for draft/cancelled/unknown/bad id, 503 if the store can't be read; title = class name, description = "when · price. summary"; respects the BOOKINGS_OPEN/preview gate; `Cache-Control: private, no-store`.

## Tests
- New: `tests/lib/classes/public-view.test.ts` (16), `tests/components/classes/ClassBookingPanel.test.tsx` (13), `tests/components/classes/ClassPage.test.tsx` (2); extended `tests/api/workshops-list.test.ts` (+2, real stores in the temp dir) and `WorkshopExplorer.test.tsx` (+1 routing).
- `npx tsc --noEmit -p .` = 0. Full suite: 253 files, 3158 tests, all green.
- Honest note: tests were written right after the implementation in the same pass, not strictly red-first.
- Smoke: dev server `/classes/cls_nope1234` → 404 with "Class not found" title; `/api/workshops.json` still lists Square classes. I could not render a real class page locally: dev uses emulated Netlify Blobs, not `.data/`, so a hand-written file was not picked up (removed afterwards).

## Choices / concerns for review
1. Brief steps (1) pass/days and (2) counters are on ONE "Details" screen (like the legacy modal) to save taps on phones; per-seat questions/add-ons are their own step only when the class has any.
2. `PublicSession` has an extra `closed` flag and `PublicPass` extra `sessionIds/state/left`, and `own` carries `instructor` and `taxPercent` (checkout.ts is server-only, so the tax % travels in the data). All decided on the server.
3. The client `quote()` uses the browser clock for `sessionsForPass` (started checks). Display only; the server re-prices and refuses if needed.
4. "starts Sat Oct 24" drops the comma to match the controller's example; single-session rows keep "Sat, Oct 24 · 1 PM".
5. The Kids/Adults filter on /workshops still reads the description (`audienceOf`), not `rules.ages`. Our classes with ages only in rules show under All only.
6. On /classes/<id> while bookings are gated closed, the tile's "See details and book" button shows but does nothing (a line above says booking opens soon).
7. Analytics `BookingKindForAnalytics` has no 'class', so the funnel calls use 'workshop'. Items use item_category 'class' + classId as asked.

## Fix round 1 (commit see `git log -1`, on top of 8b55603)
Changes:
1. Sold out refresh: new `GET /api/classes/[id].json` (`src/pages/api/classes/[id].json.ts`) returns `{ workshop }` built by `toPublicClass` with ledger counts now; `Cache-Control: no-store`; link-only allowed; 404 for draft/cancelled/unknown/malformed id; 502 when the store can't be read. On a `sold_out` reply the panel re-fetches it and calls the new `onAvailability(own)` prop; WorkshopExplorer swaps it into the open panel and the list (with `classAvailability`), ClassPage into its card. The panel then drops picked days that are now full/closed and clamps counts to the new cap (trimming from the last ticket type).
2. Continue button carries no total; only Pay does.
3. Choose-N: a tap past N leaves picks unchanged and shows "You’ve picked N days. Tap one to change it." in a `role=status aria-live=polite` line.
4. Per-person answers/add-ons are stored `{ [ticketTypeId]: SeatInfo[] }`; the ordered `seats` array is derived when quoting/sending, so adding an adult never shifts a kid's answers.
5. After `unknown_outcome`, `in_progress`, a dropped connection, or an unreadable success, the panel shows the server's detail (or the unknown-outcome sentence) with only a Close button: no Back, no Pay, no counters. Attempt id is still kept for those (moot within the panel now); new after any definite failure.
6. Kids & teens / Adults filter: new `audienceOfAges(ages, description)` in `src/lib/workshop-copy.ts` reads `rules.ages` first ("8 and up", "Ages 8+", "21+", "18 or older", "Grades 3–5", "adults"), then falls back to `audienceOf(description)`. `WorkshopTile` gained `closedNote`; on /classes/<id> with bookings closed the tile shows "Booking opens soon. Check back, or see what’s on the calendar." instead of the Book button (the separate page line was removed).

Tests: new `tests/api/classes-one.test.ts` (2); panel tests reworked/added (sold out → refetch + new attempt; sold out → cap drops and full day unpickable via a host that applies `onAvailability`; unknown_outcome / in_progress / dropped connection → Close only; decline → new attempt; Continue has no total; past-N note; answers stay with their person); `audienceOfAges` cases; explorer filter on our class's ages; ClassPage closed note.

Commands and output:
- `npx tsc --noEmit -p .` → exit 0
- `npx vitest run tests/api/classes-one.test.ts tests/lib/classes/public-view.test.ts tests/components/workshops/WorkshopExplorer.test.tsx tests/components/classes` → 5 files, 72 tests passed
- `npx vitest run` (full) → 254 files, 3169 tests passed
