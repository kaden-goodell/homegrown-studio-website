# Stage 1 final-review fixes (19 Oct 2026)

Branch `kaden/own-booking-system`, from 09af914. Nothing pushed. No live Square calls; every Square answer in tests is a fixture.

**Checks:** `npx vitest run` twice: 305 files, **3930 passed, 0 failed** both times. `npx tsc --noEmit`: **0 errors**.

## Commits

| Commit | What |
|---|---|
| 33bf0f3 | I3 / R43 / M3: one seat rule (`src/lib/classes/seat-status.ts`) |
| cd5eba6 | I2 / R41: a test site with no store of its own never writes live seats or the POS |
| c8960f5 | I1 / R42: Square's payment notice confirms our paid bookings; "Paid, no seat" in To decide. Also T8: one confirmation per booking |
| 4126ecf | M1: public calendar party times respect blocked time, drafts and link-only classes |
| f00c421 | M2: reconcile reads ledgers in parallel only when there are refunds; Square calls time out |
| 6e20c36 | M4, M5, M6, M8 |
| 63e5b2a | Deferred cheap: Undo only when there is something to undo (11b-C M3); T14 n1 one clock |

## Important

**I3 (R43).** `seat-status.ts` holds the rules once, and it is browser-safe:
- `isComing`: confirmed, or refunded with the seat kept.
- `takesSeat`: coming, or a hold still running.
- `isPaidLine`, `seatFreed`, `paidOn`, `refundedOn`, `leftOn`.

Where it is used:
- `seatsTaken` and `staff-view.holdsSeat`.
- `admin-actions` (bookedPeople, totals, groupBookings).
- `square-events`, `refunds`, `to-decide`, `door-unpaid` and `checkout.paidCentsOf` have dropped their own copies.
- `BookingView` now has `seatsComing`.
- `day.json` prints only the lines on that session that take a seat. A freed seat is gone and no longer counts. A kept-seat refund stays.
- ClassSheet decides who is booked from `seatsComing`. That covers the cancel list, Text everyone and the booking count.
- A seat freed with no money back now reads "Seat freed", not "Refunded" (T12).

Tests:
- `day.json`: a kept-seat refund is on the sheet, a freed seat isn't, and the seat count is 2.
- ClassSheet: the kept-seat person is in Text everyone and the cancel list; the fully freed booking isn't.
- `seat-status.test.ts`.

**I2 (R41).**
- `test-site-guard.ts` reads the deploy context (Netlify context, `CONTEXT`, or the host).
- On `deploy-preview` or `branch-deploy` with no `STORE_NAMESPACE`, it refuses with: "This test site has no store of its own. Set STORE_NAMESPACE first."
- Where it runs:
  - Inside the code: seat-ledger writes, class-store create and update, `syncClassToSquare` and `archiveClassInSquare`.
  - In the routes: book.json (simulated or not, online or door), /staff comp-seat for our classes, and the admin class and To decide routes, which answer 503 with that sentence.
- Production, unknown runtimes and local dev are allowed, and so is a preview with a namespace. Tests cover each of these.

**I1 (R42).** In `square-events.handleOrder`, an order with `reference_id` `bkg_…` that contains one of our class variations is handled like this:
- **Paid, with that booking's seats held** (even expired but not yet swept): `confirmBooking` confirms them through the same booking id, with the order, payment and Square total. It is safe to repeat.
  - If the customer's own request is over (hold extended, expired, or older than HOLD_MINUTES), the owners get a "payment cleared up" text and the customer gets the confirmation.
  - Otherwise the live request sends the email itself.
- **Paid, with no held seat and none paid by this order:** a `paid-not-seated` record (kv `paid-not-seated`) and one owner text. Nothing is refunded.
  - To decide shows it as "Paid, no seat", with two choices:
    - "Give them their seat": the order's seats are written as that booking's, source online, on its payment so a later refund finds them, with the Square customer's name, over capacity if need be.
    - "I sorted it out in Square".
  - A second paid order for a booking that is already paid (`other-order`) can only be marked sorted.
- The item disappears once the booking's seats are recorded by that order, for example by the customer's own retry.
- Orders of ours that aren't for one of our classes (parties, kits) are still skipped.
- Confirmation emails go out once per booking. `claimConfirmation` does a create-only write in kv `class-confirmations`. This also fixes T8: two finishes used to send two emails.
- The owners' texts in book.json no longer say "Add them by hand".

Tests:
- A lost answer: the webhook confirms with the payment. One text and one email. The replay and the reconcile change nothing.
- A live hold: confirmed, with no email or text from the webhook.
- An unpaid order: unchanged.
- **Hold expired and the seat resold:** a paid-not-seated item, no refund call, and the "seat" action seats them over capacity on that payment. Repeating it is idempotent.
- "Sorted": the item closes.
- A party order: ignored.
- The UI sheet, both kinds.
- book.json: a retry racing the first try sends exactly one email.

## Minor
- **M1:** `calendar.json` takes party starts off `ownSpansBetween`, the same spans the picker uses: every class but cancelled ones, blocked time and closed days. If they can't be read, no party time is shown. Tests cover a draft, a link-only class, blocked time and the store failing.
- **M2:**
  - The refunds list is read first.
  - The payment index is built only when there are refunds, reading ledgers 8 at a time.
  - The webhook's `linesForPayment` reads them in parallel too.
  - `squareFetch` gives up after 8 s (20 s for photo uploads), unless the caller passes its own signal.
- **M3:** the seat rules are shared, via R43. The id makers and patterns were not touched, as the brief scoped it to seat rules.
- **M4:** the Slack note goes for `booking.*` events only.
- **M5:** a class rule switch is on only for `true` or `"true"`.
- **M6:** `OwnClassData.rules` is `PublicRules`. The minimum to run, the waitlist cutoff and canShareRoom are no longer sent to the browser.
- **M8:** the sitemap already used the class index (a range query). Added an edge cache header (`Netlify-CDN-Cache-Control`, 1 h) and a test.

## Deferred "cheap to fix now" items, done
- T1 `!!` booleans (M5).
- 11b-C M3: Undo is offered only when the server returns something to undo.
- T13 scan (M2).
- T12 "Seat freed".
- T8 duplicate confirmation email.
- T14 n1: the door-seat retry uses the request's clock. A test fails without the fix.

## Left alone, as triaged
- **Check during testing:**
  - T8 SCA `verificationToken` (real-money C1/C2).
  - T6 `archiveClassInSquare` read-only fields, removal by omission, create-retry idempotency (sandbox E2E).
- **Fine to leave:**
  - M7 open orders on sold-out.
  - M9: Square-class-era code goes on the switch-over checklist.
  - Everything else marked "Fine" or "Stage 4" in the triage table.

## Concerns
1. **R42 email timing.** The webhook sends the confirmation only when the customer's request is clearly over. Suppose a function dies silently within its first 10 minutes, before replying, and the webhook arrives in that window. The seats are confirmed, but no email or owner text goes out. This is rare, and the seats are right.
2. **"Paid, no seat"** is in To decide and texted, but is not in the /admin warnings panel.
3. **R41 coverage.** R41 guards seats, classes and the POS sync. Blocked time and the class library are not guarded on a non-namespaced preview, and blocked time is shared with live party availability. Calls with no request rely on the Netlify runtime context (or the last request's). An unknown context is treated as production, so the guard is not applied.
4. **Hand-off for Kaden:** on any preview without `STORE_NAMESPACE`, /admin class saves and test bookings are now refused with the sentence above. To use them, give the `dev` branch-deploy context its own namespace and the sandbox.
5. **Machine load.** While other agents' runs had the machine at load average 240, the full suite timed out in UI tests. Both verification runs above were taken after the load dropped, and both were clean.

---

# Follow-up (coordinator, 19 Oct 2026)

Commit **cc544c6**.

1. **R41 covers every owner write.** The guard now also runs in:
   - blocked time (`addBlocked`, `removeBlocked`);
   - the class library (every library write, and the Square import);
   - studio settings saves (`saveStudioSettings`; the settings route answers 503 with the sentence);
   - To decide (`decide`, `undoDecision` and `nameCounterSeats` answer a 503 DecideError).

   The rule:
   - Production is allowed.
   - Local dev is allowed: either the dev context, or an unknown context off Netlify.
   - Any deploy with a `STORE_NAMESPACE` is allowed.
   - A deploy preview or branch deploy without one is refused.
   - **On Netlify, a context that can't be told is refused** (fail safe).

   Tests cover each case, plus every new write refused on a branch deploy and on Netlify-unknown, and local dev allowed.

2. **One confirmation and one owners' note per booking, with no time window.**
   - When Square's payment notice or the reconcile confirms held seats, it sends the customer's confirmation and the owners' text if it wins the existing one-per-booking marker (`claimConfirmation`).
   - The customer's own request now claims the marker before both its email and its owners' note (`announceBooking`), so whoever claims first sends both.

   Tests in `classes-book.test.ts`. Each case gives exactly one email and one owners' note:
   - dead request, then the notice (plus a replay);
   - live request that the notice beats;
   - live request that finishes first, then the notice.

   `square-events` test: the marker already taken → seats confirmed, nothing sent.
3. **"Paid, no seat" on the warnings panel.** New warning code `paid-not-seated`. It is undated, so it shows until it's sorted, in the panel and the daily email.
   - It comes from `openPaidNotSeated()`, the same list To decide uses. That list leaves out ones whose seats have since been recorded by that order.
   - Test in `warnings-own-classes.test.ts`.

Concern 1 in the first report (the 10-minute window) is closed, and so is concern 2 (warnings panel).

The webhook's email has no receipt link. Whichever path claims the marker first sends its own version. When the notice beats a live request, the customer gets the webhook's email, without the receipt link.

**Checks after the follow-up:** `npx vitest run` twice: 305 files, **3935 passed, 0 failed** both times. `npx tsc --noEmit`: 0 errors.

---

# Re-review polish (final-rereview.md N1, N2, N3, N5)

Commit **63d1722**.

- **N1.** To decide › Below minimum › "Text the people booked" filters with `isComingBooking` (R43).
  - Test: a refund that kept the seat is listed and texted; a booking whose seats were all freed isn't.
- **N2.** Webhook-sent confirmation (`confirmByEmail`):
  - The email goes first, then the owners' text.
  - The text says when there is no email on file, or when the email didn't send.
  - A failed email releases the marker and leaves one retry record (`markConfirmationRetry`).
  - Only the nightly reconcile takes that record (`takeConfirmationRetry`, CAS, once), and it retries the email once. A replay of the notice never does.
  - The owners hear "went out on the retry" or "still didn't send… Please send them the details".
  - There is no third try.
  - Tests: the email comes before the text; the failure is in the text; a replay doesn't retry; the reconcile retries once and reports success; a second failure says to send it by hand; there is no third attempt.
- **N3.** `squareCatalogRefusal` / `assertSquareCatalogWriteAllowed` (`test-site-guard.ts`):
  - Square catalog writes are allowed on production, or on any site using Square's sandbox. Anything else is refused with "This test site uses the live Square. Switch it to the sandbox before changing the POS.", whatever its `STORE_NAMESPACE`. That includes local dev on the live Square.
  - It is applied in `syncClassToSquare`, `archiveClassInSquare`, every batch-upsert and the image upload.
  - A class save shows "Saved, but not on the POS." with that reason.
  - Not applied to the Craft Café hours write (`cafe-windows`). It is already production-only, apart from Kaden's explicit `CAFE_WINDOWS_WRITE=1` override (R39).
  - Tests: the rule table, plus a namespaced branch deploy on live Square refused, with no Square call.
- **N5.** The class list's booking count is `seatsComing > 0`. The test now has a fully freed booking (not counted) and a kept-seat refund (counted).

N4 is left as noted: theoretical edge cases, with no production write path.

**Checks:**
- `npx tsc --noEmit`: 0 errors.
- Focused (`tests/lib/classes`, `tests/api`, `tests/components/admin`, warnings): 1469 passed.
- Full suite once: 305 files, **3940 passed, 0 failed**.
