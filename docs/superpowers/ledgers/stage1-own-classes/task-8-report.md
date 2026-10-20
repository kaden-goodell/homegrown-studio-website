# Task 8 report: Class booking endpoint

Status: DONE. Commit db63752 `feat(classes): booking endpoint — one order, one charge, held seats` on kaden/own-booking-system (not pushed).

## Files
- src/pages/api/classes/book.json.ts (new): POST route.
- src/lib/classes/checkout.ts (new): CLASS_TAX_PERCENT=9, HOLD_MINUTES=10, PRICE_DRIFT_TOLERANCE_CENTS=100, PRICE_MISMATCH_MESSAGE, classMessages (workshopMessages + class wording + in_progress), ClassCheckoutCode (= CheckoutErrorCode | 'in_progress'), bookingIdFor (bkg_ + 16 hex of sha256(attemptId)), classCutoffHours, cutoffRefusal, orderLinesFor, seatsLabelFor, paidCentsOf, soldOutMessage.
- src/lib/classes/confirmation.ts (new): sendClassConfirmation → sendWorkshopConfirmationEmail with seatsLabel, session dates, picks; waiver link `/waiver?workshop=<cls_id>&booking=<bkg_id>`; share link `/classes/<id>` (Task 9 page).
- src/lib/email.ts: optional `sessionLines` on sendWorkshopConfirmationEmail ("Your dates" block when > 1 session). No change for existing callers.
- tests/api/classes-book.test.ts (new): 35 tests, real seat ledger (fs kv), mocked providers/class-store/email/alerts.

## Flow
gate('workshops') → rate limit class-book:<ip> 5/min → body checks (names/email/phone same messages as workshops; attemptId must be a UUID; paymentToken required unless simulated) → getClass (404 not_open if missing) → ledger lookup by bookingId: paid lines → stored 200 (replayed:true, no Square calls); unexpired held → 409 in_progress → status must be 'open' (link-only allowed) → quote (field errors 400 invalid, others 409 not_open) → cutoff from first quoted session (cutoffClosedMessage) → simulated: hold+confirm with orderId sim-<bkg> → variation check (missing → owner text "Class <name> isn't on the POS yet. Open it in /admin and Save.", 502, nothing held) → findOrCreate (not fatal, customerId null) → hold ttl 10 (sold_out 409 "Only N seats are left on <day>. Nothing was charged.") → createClassOrder (key <attempt>:order, referenceId bkg) → price drift rule (owner ruling: ≤0 charge Square; 1..100 charge Square + owner EMAIL; >100 release + 502 + owner text with both numbers and class name) → processPayment (key <attempt>:pay, amount = Square total) → refused 4xx → release 402; unknown → findOrderPayment, else keep hold + owner text with bookingId and attemptId, 502 unknown_outcome; status failed → release 402 → confirm (if it throws: owner text, still 200) → email/announce/report via waitUntil, failures never fail the booking.
Reply data: bookingId, classId, orderId, paymentId, receiptUrl, totalChargedCents (charged amount), seatsBooked, ticketsLabel, sessionIds, emailSent, [replayed], [simulated].

## Tests
classes-book 35/35; full suite 250 files / 3112 tests green; tsc 0.

## Concerns / deviations
- in_progress message uses a curly apostrophe (We’re) like every other customer message; ruling text had a straight one.
- 'in_progress' is not in CheckoutErrorCode (adding it would force entries in partyMessages/workshopMessages); route-local ClassCheckoutCode instead. Task 9's panel must handle it (it is a known outcome, not "unknown").
- No-answer path keeps the hold at its 10-minute ttl (per ruling; brief's "extend to 30" not done). After it lapses a retry with the same attemptId re-holds, reuses the order key and gets IDEMPOTENCY_KEY_REUSED on pay → findOrderPayment → confirm if paid, else unknown_outcome again. Never a second charge.
- A retry reusing an attemptId after a declined card (client contract says it should mint a new one) would hit IDEMPOTENCY_KEY_REUSED and answer unknown_outcome with seats held.
- verificationToken is accepted but not forwarded: processPayment has no field for it.
- No email-fix ticket (emailCheck) in the reply: email-fix kinds are only workshop/party and its fix path targets Square bookings. alsoTo (Square record's near-match email) is still used.
- reportBooking kind is 'workshop' (ServerBooking has no 'class'); extra.own_class=true, class_id set.
- Gift cards pass straight through as the payment source; no balance pre-check (a short card comes back as a decline → card_declined).
- Square total far BELOW the quote is charged without alert (per ruling, diff ≤ 0).

## Fix round 1 (commit afdce99)

Changes
1. Unclear charges.
   (a) `extendHold(classId, bookingId, untilIso)` added to seat-ledger.ts. It uses the same CAS mutate as the rest, changes only that booking's held lines, and returns how many lines it changed. The route calls it with now + 24h (`UNCLEAR_HOLD_HOURS = 24` in checkout.ts) on an unknown outcome and when confirm throws after a charge.
   (b) `paidEarlier()` re-creates the order with the same `attemptKey(attemptId,'order')`, the same lines and the same customer, then calls `findOrderPayment`. If the payment is completed, it confirms with the fallback, which ignores capacity and marks seats overCapacity, then runs finish (email/announce/report) and returns 200 with the amount Square charged. It runs when hold() says sold_out and on an in_progress retry (item 3). If Square can't be asked, the sold-out answer becomes "That class just filled up. If you already paid, check your email for a receipt before trying again." It does not claim "Nothing was charged".
   Deviation: it does NOT run when the ledger has no lines for the booking. That case is also every first attempt, so running it there would add an order plus a lookup to every booking. A swept hold with seats still free is already covered: the retry re-holds, Square refuses the reused pay key (IDEMPOTENCY_KEY_REUSED), the route finds the paid order with findOrderPayment, and it confirms. A test covers this.
   Also: a createClassOrder failure with IDEMPOTENCY_KEY_REUSED now gives unknown_outcome, keeps the hold for 24h and alerts the owners. It no longer gives "released, nothing charged".
2. Test added: confirm throws after a charge → 200, an owner alert naming the order, seats held 24h.
3. An in_progress retry first runs paidEarlier. Paid → 200, otherwise 409 in_progress.
4. `square.chargedCents` on LedgerLine. confirm takes an optional `chargedCents` and writes it on every line of the booking. A replay answers with it, falling back to the sum of the lines.
5. Simulated confirm goes through the same `confirmPaid` try/catch.
6. `cleanSeats(cls, seats)` (checkout.ts) keeps only answers to the class's own question ids, as strings, before the quote and the ledger.

Tests: classes-book now has 45 tests (new: hold extended to 24h; resold-but-paid → 200 overCapacity and never "Nothing was charged"; resold-and-unpaid → normal sold_out; swept-hold retry → key reused → paid order found; in_progress retry paid → 200; confirm throws; simulated confirm throws; replay uses chargedCents; stray answer keys dropped. The sold-out test now expects the check order and no charge). seat-ledger.test has 3 new tests (extendHold scope and the expiry it keeps counting to, confirmed seats untouched, chargedCents on every line).

Command: `npx tsc --noEmit -p .` → exit 0; `npx vitest run tests/api/classes-book.test.ts tests/lib/classes/seat-ledger.test.ts` → 73 passed (73); full `npx vitest run` → 250 files, 3124 passed.

New concern: every genuine sold-out answer now also creates an unpaid Square order, because Square only says whether an earlier try paid once the order exists. Those orders stay OPEN and unpaid, like the ones a declined card already leaves.
