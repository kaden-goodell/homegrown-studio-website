# Task 11b-C re-review 1 (fix round 1)

Range d499982..7303f6d (57a05ed, 02a6574, 7303f6d), branch kaden/own-booking-system. Reviewer changed no tracked file.

**Verdict: Needs fixes.** 1 Important (new), 6 Minor (new). All 4 earlier Important findings and all 14 minors are fixed.

## Checks
- `npx tsc --noEmit`: 0 errors.
- `npx vitest run`: 299 files, 3852 passed, **1 failed**. The failure is `tests/components/admin/sheets/SettingsSheets.test.tsx` › "closing before it opens is caught before sending" (no `alert` role found). The file passes 3 times out of 3 when run alone. The test predates this round (e3d7808). It's a timing flake under load (see N6).

## Short hands-on
- **Setup:** `astro dev --port 4341` with `SQUARE_ACCESS_TOKEN`, `GMAIL_APP_PASSWORD` and `QUO_API_KEY` overridden to junk, so nothing could reach live Square, Gmail or texts. `LOOKUP_SIGNING_SECRET=review-secret` and `ADMIN_PASSCODE=review-only-123`. Local blob store empty to start.
- **What I checked:**
  - **Nightly job route:** no key → 401. With the right key → `{status:'not-live', "Not the live site: Square left alone."}`. Square was not called.
  - **Settings save that closes a café Saturday (Nov 14):** `square: {status:'skipped', "Square isn’t updated from the test site."}`. Only a booking *read* was logged (for the booked list), and it went out with the junk token.
  - **`square-retry`:** skipped the same way.
  - **Settings save that closes a Thursday (no café that day):** `square: null`. No Square call.
  - **`/api/cafe-hours.json`:** reflects the saved settings.
- **Cleanup:**
  - Every blob I created was deleted: settings, classes index, 3 audit rows. The store is empty, as before.
  - The server is stopped and the cookie jar deleted.
  - `git status` shows only the untracked stage 2-4 plans, which are not mine.

## Earlier findings
| # | Verdict | Where |
|---|---|---|
| I1 / R38 | **Fixed.** Script reads prod `studio-settings/settings` via `studioDaysFromJson` (same rule as the site). Nightly scheduled function `15 6 * * *` knocks on an HMAC-keyed job. `rewriteCafeWindows` writes only when `programDates` differs. | scripts/set-cafe-windows.ts:36-38; netlify/functions/cafe-windows.ts; src/pages/api/jobs/cafe-windows.json.ts:20-36; src/lib/cafe-roll.ts; src/lib/cafe-windows.ts:141-144 |
| I2 | **Fixed.** `send(..., {reload:false})` keeps CounterSale mounted. `finish()` runs after Add names / Skip, or straight away when every seat is named. The test's fake now marks the item done. | ToDecideSheet.tsx:37-49, 251-266 |
| I3 | **Fixed.** `resolveUnmatchedPos` on match and dismiss; `listUnmatchedPos` filters `resolved`. Keep running / Texted are hidden from warnings and minimum alerts via `decidedIds`. | square-events.ts:723-738; to-decide.ts:419-421, 451; warnings.ts:314; minimum-to-run.ts:99-101 |
| I4 | **Fixed.** An empty weekly list replaces the build-time hours with "by special day only" plus a pointer (below / the days / the calendar). Checked hands-on that the API shape matches. | cafe-hours-live.ts:33-45 |
| R39 | **Fixed and verified hands-on.** Every path that writes the café windows is guarded. 1) Settings save and Try again: `squareFrom`, settings.json.ts:31-32. 2) The nightly roll: `rollCafeWindows`, cafe-roll.ts:29. Only `production`, or `CAFE_WINDOWS_WRITE=1`, writes; that flag isn't in `.env`. The script is the only unguarded writer. It needs an explicit `--write`, targets production by design, and now writes the production-saved settings, so it can't undo an owner's save. Accepted. | settings-effects.ts:44-54 |
| m1 seat guess | Fixed. `guessMatch` uses the variation id, else the pass label in the variation name; no default otherwise. | to-decide.ts:121-144 |
| m2 confirm + Undo | Fixed (in-sheet `FreeConfirm`, Undo in toast), **but see N1** | ToDecideSheet.tsx:63-74; to-decide.ts:552-572 |
| m3 Square note only on café change | Fixed (`windowsFor` before vs after); verified hands-on | settings.json.ts:86-89 |
| m4 midnight/noon | Fixed in admin `clock`/`clockRange` and To decide's `whenText` | shell/time.ts:17-33; to-decide.ts:89-93 |
| m5 booked rows tappable | Fixed (class / party / legacy) | SettingsSheets.tsx:356-366 |
| m6 counter-check button names person | Fixed | ToDecideSheet.tsx |
| m7 cross-reference | Fixed (door item carries `related`; check names the overlap) | to-decide.ts:255-271 |
| m8 "Ask <other owner>" | Fixed | SettingsSheets.tsx:132-133, 264 |
| m9 Add with no From scrolls/focuses | Fixed | SettingsSheets.tsx:308-313 |
| m10 Block time next open day | Fixed (`nextOpenDay` moved to dates.ts, uses saved closures) | BlockTimeForm.tsx:33-35; dates.ts:52-57 |
| m11 shorter toast | Fixed | SettingsSheets.tsx:328-331 |
| m12 local-dev footgun | Fixed by R39 | — |
| m13 inline styles | Fixed (0 `style={{` in the four files) | admin.css |
| m14 grammar | Fixed | ToDecideSheet.tsx:417 |
| Deviation 3 edge (whole booking's lines move) | Done, **but see N2** | seat-ledger.ts:615-639 |

## Important (new)
**N1. Undo of "Free the seat" can overbook a class. It doesn't check that the seat is still free.**
- **Where:** `unfreeSeats` (seat-ledger.ts:647-659) removes the free-seat entry and sets the line back to `confirmed` with no capacity check. `undoDecision` (to-decide.ts:560-572) calls it unconditionally within 10 minutes. The report says this is on purpose ("restores it even if the session filled meanwhile").
- **What breaks:**
  - "Free a seat" on a *plain refund* is for a coming class. The freed seat goes straight back on sale online (`onSeatFreed`).
  - If a customer buys it within the window, Undo gives the original person the seat back too. The class is then one over capacity, and the owner is told "The seat is theirs again."
  - For door-unpaid items (past sessions) this doesn't matter.
- **Two smaller holes on the same path:**
  - `decideRefundFlag` swallows "already free". The decision then records `lineIds` (the seats held when the item loaded) as freed by this decision. Undo would then unfree a seat someone else freed in the meantime.
  - A money refund put on that line within the window keeps its entry. Undo then leaves a refunded line holding a seat again.
- **Fix:**
  - In `unfreeSeats`, for any of the line's sessions that haven't started, refuse when `seatsTaken(...) >= capacity`. The reply would be "Someone has taken that seat since. Open the class to add them."
  - Only remove the free-seat entry this decision made: match its `at` to the decision's `at`, or store the entry's `at` in `undo`.
  - Refuse when the line now has any money refund after it.
- **Tests:**
  - Undo after the session filled → refused, ledger unchanged.
  - Undo after "already free" → nothing unfreed.

## Minor (new)
- **N2. `moveCounterPayment` moves lines it shouldn't (seat-ledger.ts:616-618).**
  - **What happens:** `paid` takes every line of the first booking from that order, whatever its pass, ticket or state. Targets are limited to `from`'s pass and ticket.
  - **What breaks:**
    - Take one order with "Full series + One day", or adult + child once ticket types return. The *other* line's payment and price can land on a seat of a different pass.
    - A refunded or freed line's Square ids can move onto a seat that is still held.
  - **Fix:** filter `paid` to `passId`/`ticketTypeId === from`'s, and `state === 'confirmed'` with no refunds.
  - **Also, existing and not new:** each moved line copies `chargedCents` (the whole order's total). After a partial move, both bookings carry the full total as their refund cap. Square's per-payment limit is the only backstop.
- **N3. Naming step left by closing the sheet.** Closing it (X or back) instead of Add names / Skip never calls `finish()`. The Inbox list and badge keep showing the item as waiting until the next reload. Tapping it again is safe: the server answers 409 "Already done". Call `finish()` when CounterSale unmounts while `made` is set.
- **N4. Two id forms that only match by luck.** `decidedIds()` returns stored ids (`tokenOf(...)`). warnings.ts:314 and minimum-to-run.ts:101 compare them with the raw `minimumItemId(cls.id)`. This only works because `cls_` ids pass `tokenOf` unchanged. Compare `tokenOf(minimumItemId(id))`, or put `tokenOf` inside `minimumItemId`.
- **N5. "Texted" silences the minimum alerts and the /staff warning (decided.ts via `ACTIONS['below-minimum']`).**
  - Texting the booked people isn't deciding to run.
  - Once texted, nothing reminds the owners that the class is still short before the decide-by time.
  - Consistent with "Texted = Done" accepted earlier, so this is a ruling for the lead: keep it, or let only Keep it running clear the alerts.
- **N6. A pre-existing test flakes under load.** SettingsSheets.test.tsx:83-92 checks for the alert synchronously right after the click. Use `findByRole('alert')`.
- **N7. "noon" and "midnight" at the start of a line.** `clock()` now returns lower-case "noon"/"midnight", so a time list or cell can start with "noon–2 PM". Also, the public `/api/cafe-hours.json` still says "9 AM – 12 PM" while /admin says "9 AM–noon". Cosmetic.

## Things checked and found right
- **Nightly job auth:** HMAC of `job:cafe-windows` with `LOOKUP_SIGNING_SECRET`, compared with `timingSafeEqual`. No secret → 401.
- **Nightly job, live site only:** the function runs on production only (Netlify scheduled functions), and the route refuses anything but `production` anyway.
- **Repeat runs:** a re-run with the same windows → `unchanged`, no write. In practice it writes about once per past café day, as old windows fall off. That's the intended roll-forward. The café start date is still clamped in `cafeWindows`.
- **Failure email sent once:**
  - The marker is set only after a *sent* email. An unsent email retries the next night.
  - A good night clears the marker. `''` counts as empty.
  - `not-live` doesn't touch the marker.
- **Undo can't move money:** it only removes `cents === 0 && !squareRefundId && freedSeat` entries.
- **Undo can't run twice:** the done record is blanked, so a second Undo → 409. `listDecided` now keys off non-empty records, so the item waits again.
- **Moving a family's payments:** no double payment (each source line pairs with at most one target, and its `square` is cleared). No lost seat (the source stays `confirmed`, unpaid, and shows again as door-unpaid). Extra paid lines stay with their booking. Only the first door line per booking carries `counterMatch`, so no confirm-then-move clash.
- **Decisions don't hide unrelated items:** `resolveUnmatchedPos` is keyed by order + line uid, and `decidedIds` is only used for `min-<classId>`. Other kinds are still cleared by their own setters.
