# Task 4 report: Seat ledger with holds

Status: DONE. Commit 33232e2 `feat(classes): seat ledger with locked holds` (not pushed).

## Files
- `src/lib/classes/seat-ledger.ts` (new): types, seatsTaken, getLedger, hold, confirm, release, recordRefund, setNames.
- `src/lib/classes/validate.ts`: newId prefix union gains 'led' | 'bkg'.
- `tests/lib/classes/seat-ledger.test.ts` (new): 18 tests.

## Design
- One doc per class, kv `seat-ledger`, key `ledger-{classId}`. Every write goes through `mutate()`: getWithMeta → fn(fresh data) → setIfMatch, 3 attempts, then throws `Concurrent update — please retry`. hold re-checks capacity inside fn, so every retry checks against freshly read data.
- Additionally an in-process per-key promise lock serialises a class's read-modify-write within one server. Reason: the fs backend's setIfMatch always succeeds, so two same-process holds (local dev, tests) could both take the last seat; the lock fixes that (verified: removing it fails the Promise.all test). Across servers CAS is what protects.
- LedgerLine per ruling: one line per 'seat' QuoteLine; add-on QuoteLines folded in (addOns counts by id from `variationKey 'addon:<id>'`, plus `addOnCents`/`addOnTaxCents`). `seat` is 1-based (quote's is 0-based). `passId`, `seats` (per-seat answers/addOns, R1) are hold inputs; answers come from `input.seats[i].answers`, add-on counts come from the server quote (not the input).
- seatsTaken: unexpired held + confirmed + refunded where no refund freed the seat. hold drops expired holds from the stored doc whenever it writes.
- confirm: held → confirmed, holdExpiresAt null, sets square orderId/paymentId; all-already-confirmed returns them without writing.
- release: only 'held' lines → 'released' (kept in doc for audit); confirmed untouched; no-op write when nothing held.
- recordRefund: allowed on confirmed/refunded lines only; refuses if prior refunds + cents > price+tax+addOn+addOnTax.

## Tests (18, all green; tsc 0; full suite 244 files / 3009 tests green)
Capacity 2 → third sold_out; partial-left sold_out reports `left`; line shape/money/add-on folding; CAS race via mocked setIfMatch (competing write of the last seat to the underlying store, then false → retry sees it, sold_out, exactly one held); lost race with room left → retry keeps both; 3 lost races → throws; Promise.all two holds → exactly one ok; expired hold frees + is pruned; confirm + idempotent retry; confirm of unknown booking throws; release held-only; refund freeSeat true/false; over-refund refused (counts prior refunds, exact boundary passes); refund of held refused; multi-session vs one-day pass; allowOverCapacity 41/40; setNames; empty ledger.

## Judgement calls / concerns
1. `recordRefund` cents is applied PER LINE (each listed line gets a refund entry of `cents`). The brief was ambiguous for multiple lineIds; documented in JSDoc. Later tasks must pass per-seat amounts.
2. `hold` throws `That booking already has seats.` if the bookingId already has non-released lines (prevents a retried hold double-booking). If a later task wants to add seats to an existing booking it must use a new bookingId or relax this.
3. `confirm` throws `That booking has no seats on hold any more.` if the hold was pruned/released before payment confirmation. Callers that already took money must handle this (never auto-refund) — e.g. re-hold with allowOverCapacity and flag to staff.
4. confirm does not check expiry: a payment that lands on a held line past its expiry (but not yet pruned) still confirms, which can put a session over capacity if someone else took the freed seat. Intentional (money taken wins), but worth flagging to the checkout task.
5. hold throws (not sold_out) if a quote session id is missing from the class.

## Fix: confirm never refuses a paid booking (controller ruling on concerns 3 and 4)

New contract:
`confirm(classId, bookingId, square: { orderId; paymentId | null }, fallback: { cls: ScheduledClass; quote: Quote; input: HoldInput }, now: Date): Promise<LedgerLine[]>`
- All of the booking's held/confirmed lines already confirmed → no write, returns them (idempotent).
- Has held lines (expired or not, swept or not by others) → converts this booking's held lines to confirmed (holdExpiresAt null, Square ids set), keeps the line ids; sweeps other bookings' expired holds.
- No held/confirmed lines (expired + swept, or released) → re-creates lines from `fallback.quote` + `fallback.input` (bookingId forced to the confirm's), state confirmed, capacity ignored. Released lines stay for audit.
- After either path, any confirmed line of this booking on a session where seatsTaken > capacity gets `overCapacity: true` (new optional LedgerLine field). Never throws for a paid booking (only the generic 3-lost-races retry error remains).
- Line building is shared with hold via `buildLines()`.

Tests: removed "confirm of unknown booking throws"; added re-create after expiry+sweep, seat taken meanwhile (overCapacity, taken = capacity+1), expired-but-unswept hold crowded by another server's seat (original line converted, overCapacity), confirm after release, repeated confirm without duplicates. Ledger file 22/22, tsc 0, full suite 244 files / 3013 tests green.

## Fix round 1

1. confirm after a refund rebuilt seats (Important). Change: confirm now treats any 'confirmed' or 'refunded' line of the booking as "already paid and recorded". With no held line and at least one paid line it returns the paid lines (confirmed + refunded) and writes nothing. It rebuilds from fallback only when the booking has nothing but released lines or swept holds. When held lines exist they are converted as before; the result is the booking's confirmed + refunded lines.
2. recordRefund idempotency (Minor). Change: a line that already has a refund with the same non-null squareRefundId is skipped (no entry, no over-refund check); if every line is skipped nothing is written and the current lines are returned. Null ids are never treated as duplicates.

Tests added: confirm → full refund (freeSeat true, and false) → confirm again → ledger deep-equal before/after, states stay 'refunded', seatsTaken unchanged (0 and 2); goodwill refund on one of two seats → confirm returns both paid seats, still 2 lines; retried refund with same squareRefundId recorded once (and not refused although it would exceed the paid amount), different id recorded, null ids always recorded.

Command: `npx vitest run tests/lib/classes/seat-ledger.test.ts` → `Test Files 1 passed (1) / Tests 26 passed (26)`. `npx tsc --noEmit -p .` → 0 errors. Full suite → 244 files / 3017 tests passed.
