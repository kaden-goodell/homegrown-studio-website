# Task 1 report — booking-core shared charge path

Status: DONE. Commit 5a21237 on kaden/admin-d (not pushed).

## What changed
- New `src/lib/booking-core/ids.ts`: `idFor(prefix, key)` (`${prefix}_` + sha256[0..16]), `CREATE_KEY_RE` (same regex as admin-actions; admin-actions itself left untouched to keep the diff in the checkout area).
- New `src/lib/booking-core/charge.ts`: `PRICE_DRIFT_TOLERANCE_CENTS=100`, `HOLD_MINUTES=10`, `UNCLEAR_HOLD_HOURS=24`, `judgeDrift`, `tellOwnersOfDrift`, `chargeOrder`, `paidOnOrder` per the brief's signatures.
- `src/lib/classes/checkout.ts`: re-exports the three constants from booking-core; `bookingIdFor(a)` now returns `idFor('bkg', a)`. Nothing else moved.
- `src/pages/api/classes/book.json.ts`: drift block → `judgeDrift(..., { tellBelowCents: 1 })` + `tellOwnersOfDrift`; charge block → `chargeOrder`; `paidEarlier` → `paidOnOrder`. Every message, log line and alert text kept verbatim.

## Additive fields beyond the brief's types (optional, so later tasks can ignore them)
- `ChargeResult` paid: `recovered?: true` (unclear answer, order showed paid) — keeps the "Charge answer was unclear but the order is paid" log.
- `ChargeResult` declined: `error?: unknown` (4xx refusal) and `paymentId?: string` (status `failed`) — keeps the two distinct class log lines.
- `paidOnOrder` unknown: `error?: unknown` — keeps the existing error log.

## Behaviour notes
- `tellOwnersOfDrift` text: above → "Square total differed by $X on <ref> (quote $Q, Square $S)"; below → "Square total was $X lower than the quote on <ref> (quote $Q, Square $S)."; a non-empty hint is appended after a period. Classes pass hint '' above and "Check the class's tax on the POS." below → identical to the old emails. Never throws (sync or async email failure swallowed).
- `judgeDrift` default `tellBelowCents` is 0 (any shortfall tells, per R14 "either way"); classes pass 1 to keep today's rule.
- `chargeOrder` keeps the old quirk exactly: a payment recovered via `findOrderPayment` still goes through the `status === 'failed'` → declined check.

## Tests
- New: tests/lib/booking-core/charge.test.ts (26) and ids.test.ts (3+), incl. "unclear charge asks the order", "paid earlier", IDEMPOTENCY_KEY_REUSED → unknown, key = attemptKey(id,'pay').
- `tests/api/classes-book.test.ts` UNEDITED (git diff empty) and passing.
- `npx vitest run tests/lib/booking-core tests/api/classes-book.test.ts tests/lib/classes`: 15 files, 301 tests pass.
- Full `npx vitest run`: 299 files / 3900 tests pass. Two earlier full runs each had one different timing failure in unrelated UI component tests (SettingsSheets.test.tsx 5.3 s timeout; PrivateEventForm.test.tsx) — load flakiness, green on rerun.
- `npx tsc --noEmit`: 0 errors.

## Concerns
- Flaky component tests under full-suite load (above) — pre-existing, not touched.
- `classes/checkout.ts` now imports booking-core/charge (which imports `@config/providers`); checkout.ts was already server-only (imported only by API routes), so no client-bundle impact.
