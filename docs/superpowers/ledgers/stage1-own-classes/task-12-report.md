# Task 12 report: Refunds

Status: DONE. Commit fd5db1b `feat(classes): refunds from /admin and /staff with seat release` on kaden/own-booking-system (not pushed).

## What was built
- `src/lib/classes/refunds.ts`
  - `planRefund(ledger, req)` (pure): picks lines and per-line cents for the four choices.
    - booking: every paid line, full remaining (lines with 0 left skipped).
    - person: exactly one line, full remaining.
    - session: each chosen line gets `floor(priceCents / sessionIds.length)` + `round(share * taxCents / priceCents)`; add-ons not prorated; refuses a one-session seat or a share bigger than what's left.
    - custom: total `cents` spread over chosen lines (all booking lines if none chosen) in seat order, never past a line's remaining.
    - freeSeat: explicit boolean wins; default custom keeps seat, others free it.
    - Refusals: 404 unknown class/booking/seat; 400 "Refund this one in Square, where it was paid." when no paymentId (comp/POS/counter); 400 over remaining / nothing left; 409 at 20 prior refunds on the booking's payment.
  - `refundKey(bookingId, lineIds, totalCents, n)`: hashes `refund:${bookingId}:${sortedLineIds}:${totalCents}:${n}` to `refund:` + 38 hex = 45 chars, because Square caps idempotency keys at 45 characters (the raw string would be ~80+). n = distinct prior refunds on the booking.
  - `refundClassBooking`: one `providers.payment.refundPayment` for the total → `recordRefund` with the Square refund id → `onSeatFreed` (no-op hook) when freeing → `sendRefundEmail` (best effort, never fails the refund) → audit `class-refund` (by+role, reason, cents, lines, freeSeat, kind, bookingId, squareRefundId).
    - Square throws or returns FAILED/REJECTED → 502 plain sentence, nothing written, no email, no audit.
    - Ledger write fails after Square succeeded → 500 "The refund went through in Square but didn't save here. Do the same refund again to save it." A repeat computes the same key (n unchanged), so Square replays the same refund and the ledger records it once.
    - Square reason sliced to 192 chars (Square limit); omitted when empty.
  - `readRefundBody` / `refundReply` shared by both routes. Server never takes prices from the browser: only line ids and, for custom, an amount checked against the ledger.
- `src/lib/classes/seat-ledger.ts`: `recordRefund` `cents` now also accepts a map line id → cents, so one Square refund spread unevenly over seats is written atomically in one CAS write (needed so a partial write can't change n and produce a second, different idempotency key). Number form unchanged for existing callers.
- Routes: `src/pages/api/admin/classes/refund.json.ts` (adminAuthorized, by ADMIN_BY, role owner, reason optional); `src/pages/api/staff/class-refund.json.ts` (staffAuthorized, by byOf(member), role = member.role, reason ≥ 3 chars).
- `src/lib/email.ts`: `sendRefundEmail({ to, givenName, className, cents, last4?, keptSeat })`, no colons, no timelines, uses formatMoney.
- `src/lib/classes/admin-actions.ts`: `BookingView` gains `refundable` (per paid seat: id, seat, ticket, sessions, remainingCents, sessionCents) and `paidHere`, so the panel can preview amounts.
- `src/components/admin/classes/RefundPanel.tsx`: self-contained; props `classId, booking, ticketLabel?, endpoint (ADMIN_REFUND | STAFF_REFUND), reasonRequired, last4?, onDone`. Refund button → in-page panel: whole / one person / one session / another amount, free-seat checkbox (defaults per kind), reason (required for crew), summary "Refund $X to the card ending in …" or "to their card", Confirm refund. Comp → nothing; POS/counter → "Refund this one in Square, where it was paid." Mounted in ClassBookings' `data-refund-slot` for non-held bookings.

## Tests
- `tests/api/class-refund.test.ts` (16): each choice, proration, custom spread, over-remaining, comp, 20-refund cap, 404s, Square error leaves ledger untouched (502, no audit/email), email failure doesn't fail, second deliberate refund gets new key, owner + crew audited, crew reason required, auth.
- `tests/lib/classes/seat-ledger.test.ts` +1 (per-line cents map), `tests/lib/email-refund.test.ts` (2), `tests/components/admin/classes/RefundPanel.test.tsx` (5), ClassBookings test updated for the Refund button.
- `npx tsc --noEmit -p .` = 0. Full suite: 267 files, 3306 tests, all passing.

## Concerns / notes
1. Card last4 isn't stored anywhere (ledger has only the payment id), so the panel always says "to their card" unless a layout passes `last4`. Getting it would need a Square payment read or saving it at confirm time.
2. Freeing a seat on a multi-session line frees it for EVERY session on that line (the ledger has one line per pass). So "one session" with the free-seat default (on, per the ruling) frees the whole pass seat. The UI shows the checkbox, but owners may expect it to free only that session. Consider defaulting it off for one-session refunds.
3. A seat that was refunded in full but kept can't be freed later through this flow: there's no money left, and the planner refuses a total of zero. That needs a separate "free seat" action if it's wanted.
4. `refundPayment` has never run against live Square. A refund that comes back PENDING counts as success. If it fails later, we only find out from Square, since nothing watches refund webhooks.
5. The staff route exists, but /staff has no screen that mounts RefundPanel yet. The panel is ready for it (`endpoint={STAFF_REFUND} reasonRequired`).

---

# Fix round 1 (commit 50399cf)

## Changes
1. **R22: free-seat defaults.** When `freeSeat` is omitted, whole booking and one person free the seat. One session and custom keep it. Changed in the server (`planRefund`) and in RefundPanel (`choose`).
2. **R23: freeing a seat with no money.**
   - New `freeSeatOnly(classId, bookingId, lineIds, actor, reason)` in refunds.ts. `actor` is `{by, role}` instead of a bare `by`, because the audit needs the role.
   - It writes a `{cents 0, freedSeat true, squareRefundId null}` entry. It never calls Square, calls `onSeatFreed`, and audits `class-free-seat`.
   - With no line ids it frees every seat that is still held. A seat that is already free gets 409 "That seat is already free."
   - Both routes accept `{action: 'free-seat', ...}`. Crew need a reason of at least 3 characters.
   - `priorRefunds` (which drives the 20-refund cap and the key's n) now skips entries with 0 cents and no Square id.
   - RefundPanel has its own "Free their seat" button. It opens an in-page confirm with a seat picker when there are several seats and a reason box, then "Yes, free the seat". Comp seats now get this button too.
3. **502 wording.** When Square throws or gives no answer, the reply is "Square didn't confirm the refund. Try again. It won't refund twice." (`SQUARE_NO_ANSWER`).
4. **Retry after Square says no.** A FAILED or REJECTED status calls the new `noteRefundFailed` in seat-ledger.ts, which bumps `refundFailures` on every line of the booking. The reply is 502 "Square turned the refund down, so nothing was refunded. Try again."
   - `refundKey(..., failures)` adds `:f<n>` to the raw string when the count is above 0, so the next try is a new request.
   - A throw or timeout leaves the count alone, so the retry keeps the same key.
5. **Charged-total cap.**
   - New `bookingCap(lines)` = `chargedCents` minus all refunds on the booking, or null when no charged total is recorded.
   - Whole booking and one person are trimmed to the cap in seat order. Custom is checked against the smaller of the seats' remaining and the cap. Any total over the cap is refused with a 400.
   - BookingView gains `refundableCents` (capped) and `RefundableSeat.freed`. The panel uses the capped amount for "whole booking" and "up to".
6. **Email failure log.** It now records only the error's name and code, never the message.

## Tests
`tests/api/class-refund.test.ts` gained 7 tests:
- free-seat defaults per kind
- freeing a seat (no Square call, audit, already-free gives 409, the next refund's key still uses n=0)
- seat-only frees don't count toward the 20-refund cap
- crew freeing a seat needs a reason and is audited as them
- FAILED changes the next key while timeouts keep it
- charged cap (custom of 6001 refused; whole booking refunds 6000 as 3270 + 2730)
- email failure log has no address

The 502 test now checks the exact sentence and that it doesn't say "in Square". RefundPanel tests gained per-kind defaults, the capped preview, and the free-seat flow. The ClassBookings fixture was updated.

## Commands and output
- `npx vitest run tests/api/class-refund.test.ts tests/components/admin/classes/RefundPanel.test.tsx tests/components/admin/classes/ClassBookings.test.tsx tests/lib/classes/seat-ledger.test.ts tests/lib/email-refund.test.ts tests/api/admin-classes.test.ts` → 95 passed.
- `npx tsc --noEmit -p .` → exit 0.
- Full suite: 266 of 267 files pass. All 3 failures are in `tests/lib/events.test.ts` ("a class that already started…", "listEvents prefers listAllWorkshops…"). They fail the same way with my changes stashed, so they come from the date or time (the clock passed midnight into Oct 19) and have nothing to do with refunds.

---

# Fix round 2 (commit see `git log`, message "fix(classes): refund retry keys count turn-downs per request; …")

## Changes
1. Failure count per request: `LedgerLine.refundFailures` is now `Record<rawKey, count>` (rawKey = `refund:${bookingId}:${sortedLineIds}:${totalCents}:${n}`, new export `refundKeyRaw`). `noteRefundFailed(classId, bookingId, rawKey)` bumps only that request's count; `planRefund` looks up the count for its own rawKey and returns it with `rawKey`. A FAILED/REJECTED on request Y no longer changes the key of a retry of request X.
2. Capped whole-booking refund with freeSeat keeps seats trimmed to 0 cents (and seats with nothing left) so they are marked freed under the same Square refund id; seats already freed are skipped (same rule now applied to custom).
3. RefundPanel: one-person preview is capped at the booking's `refundableCents`; one-session preview over that shows "That is more than is left to refund." and disables Confirm (the server refuses it).

## Tests
- class-refund.test.ts: X times out, Y gets FAILED, retry of X reuses X's original key; capped whole booking (charged 3270, two 3270 seats) refunds 3270 and frees both (second seat 0 cents, freedSeat true, Square id). FAILED test updated to the map shape.
- RefundPanel.test.tsx: capped one-person preview and one-session over-cap refusal.

## Command / output
`npx vitest run tests/api/class-refund.test.ts tests/components/admin/classes/RefundPanel.test.tsx tests/components/admin/classes/ClassBookings.test.tsx tests/lib/classes/seat-ledger.test.ts tests/lib/email-refund.test.ts tests/api/admin-classes.test.ts` → 98 passed. `npx tsc --noEmit -p .` → 0.
