# Task 14 re-review 3 (fix round 3)

Range 68a8514..96cd073 (4 commits), branch kaden/own-booking-system. Reviewed 19 Oct 2026.

**Verdict: Approved.** I1 and every Minor are fixed. Nothing Important is new. Two small new Minors are listed below, and neither blocks.

Checks:
- `npx vitest run`: 277 files, 3508 passed, 0 failed.
- `npx tsc --noEmit`: 0 errors.
- I only read code. I wrote no files apart from this one.

## Items

| # | Status | Evidence |
|---|---|---|
| I1 a family's own seats flagged as ambiguous | Fixed. The check counts distinct bookings among the candidates, and each booking is flagged at most once per sale. A multi-unit sale keeps filling the booking it started. One booking with 2 seats and a 2-unit sale raises no check. | `seat-ledger.ts:470-494`; tests in `seat-ledger.test.ts` |
| m1 check doesn't name the class | Fixed: "Counter sale of <class> on <day> …". | `warnings.ts:339` |
| m2 typo fix gives a new attempt | Fixed. Name, email and phone are no longer part of `askShape`. A found customer's id is. | `CompSeatSheet.tsx:223-224` |
| m3 replay rebuilds a swept hold past capacity | Fixed. `confirm(..., { requireLiveHold: true })` writes nothing unless a live held line exists inside the same CAS. Otherwise it returns null and goes to a fresh `hold()`, which checks capacity. | `seat-ledger.ts:216-218`; `staff-seats.ts:92-99` |
| m4 a confirmed retry after close answers "closed" | Fixed. The confirmed-seat replay runs before the status and `quote()` checks. | `staff-seats.ts:59-70` |
| m5 | Accepted (fails safe). | — |
| m6 "That day is full." before a day is picked | Fixed: `(!choose \|\| picked.length > 0)`. | `ClassBookingPanel.tsx:240-241` |
| m7 the register-only refund is a UI guard only | Fixed. `planRefund` refuses `pos` and `door-counter` with 409 AT_THE_REGISTER. That covers /admin and /staff, because both go through `refundClassBooking` and then `planRefund`. | `refunds.ts:164-165`; `class-refund.test.ts:272` |
| m8 freed or refunded seat stays on the check list | Fixed. It skips `released`, and `refunded` with `freedSeat`. `freeSeatOnly` writes `state: 'refunded'` with a `freedSeat` entry, so a door seat freed at the register drops off. | `door-unpaid.ts:76-77`; `seat-ledger.ts:335,409` |

## Questions checked

- **Can a paid online confirm now fail or lose a seat (R6)?** No. `requireLiveHold` is opt-in and defaults to `{}`. The online and door-card path `book.json.ts:376` calls `confirm(...)` without it, so its behaviour is unchanged: it converts any held line, otherwise rebuilds from fallback, and never throws for capacity. The only caller that passes it is the staff replay (`staff-seats.ts:97`). That caller treats `[]` as "hold afresh".
- **Sale-filling order across bookings.**
  - Candidates come in ledger order. A booking's lines are appended together in seat order.
  - The pool puts the booking already being filled first, then the oldest of the rest.
  - `filling` carries across sale lines. So an Adult line plus a Kid line paying one family's adult and kid both land on that family, with one flag at most.
  - The sort comparator returns 0 between different bookings. That is not a strict ordering, but the input is already in the right order, so it is harmless. See n2.
- **m7 vs legitimate card refunds.** The refusal matches only `pos` and `door-counter`. `online` and `door-card` (Paid on the iPad, `book.json.ts:310`) are untouched. Freeing the seat goes through `freeSeatOnly`, a separate path that never calls `planRefund`, and it still works (tested). `claimSquareRefund` (webhook side) doesn't use `planRefund`. A refund request saved before this change continues without re-planning, which is fine.
- **m2 attempt key.**
  - Fixing a typo keeps the attempt. If the first add went in, the retry replays it, so there is no second seat.
  - Changing option, days, tickets, picks, waiver people or the found customer gives a new attempt.
  - The sheet has no "add another" reset: `done` is never cleared. So a second person always means reopening the sheet, which mints a new `attemptRef`.
  - Residual: after a lost reply where person A *was* added, a crew member who overwrites the hand-typed fields with person B gets told "Added", but the seat is A's. This is the trade-off re-review 2 offered, and it is very rare. Not a blocker.

## New Minors (non-blocking)

- n1. **Mixed clocks in replay.**
  - `replay()` checks the hold with `new Date()` (`staff-seats.ts:97`), but `hold()` uses the request's `now`.
  - Suppose a hold expires in the milliseconds between the two. Replay sees it as gone and returns null. `hold()` still sees it as live and throws "already has seats". The second replay returns null again, so the request fails with a 500.
  - A retry clears it, and production never passes `now`, so the window is sub-second. Passing `now` (or using `new Date()` throughout) would remove it.
- n2. `pool.sort((a, b) => a.bookingId === b.bookingId ? a.seat - b.seat : 0)` is not a consistent comparator. It works only because candidates are already in seat order within each booking (`seat-ledger.ts:483`). It can be dropped, or made total by comparing ledger index.
- n3. The early m4 replay skips the `cls.status` check. A retry landing after the class was cancelled answers "Added" with the existing, now refunded, lines. This is harmless and only an edge case.
