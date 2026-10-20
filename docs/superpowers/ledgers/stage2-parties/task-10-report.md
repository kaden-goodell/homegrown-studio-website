# Task 10 report — party refunds on the shared runner; refunds made in Square

Status: DONE. BASE 437e18e.

## Extra items (binding), done first
- `src/lib/booking-core/refund-words.ts`: RefundError, the shared messages (+ `refundCapMessage`), `refundKey`/`refundKeyRaw`, `RefundPlan`. `classes/refunds` re-exports them (class tests unedited); the runner imports only refund-words + refund-requests (no `classRefundBook`, no registry: `registerRefundScope`/`refundBookFor` removed from the runner; its claim is now `claimSquareRefundWith(bookFor, …)`).
- `src/lib/booking-core/refund-books.ts` (static): `'party'` → `partyRefundBook`, `cls_…` → `classRefundBook`, anything else **throws**; holds `claimSquareRefund`. `square-events` imports it from there; `classes/refunds` no longer re-exports `claimSquareRefund`. Comment on `refundBookFor`: scope-only books write, they can't plan.
- Party book implements every RefundBook field (incl. a no-op `afterWrite`, `noteFailed` no-op because the failure count lives on the saved requests and `planPartyRefund` reads it there); test asserts every field.
- Webhook path passes the class name from its list as a label hint (`classRefundBook(..., { label })`, old precedence).
- Sped-up sheet tests (SettingsSheets, PrivateEventForm): one real `getByRole` per distinct element, scoped to the element's parent (`isNamed`).

## Task 10
- `src/lib/parties/refunds.ts`: `partyLabel` ("the Justice party"), `planPartyRefund` (ours only → else `NOT_PAID_HERE`; one charge; simulated charge refused; integer > 0; 20 refunds on the payment (any role) → `SQUARE_REFUND_CAP` message; > `refundableOn` → 400; key prior = non-Square refunds on that payment; failures from saved requests with the same raw key), `partyRefundBook` (write = one `PartyRefund` keyed by request id / Square refund id; a Square-recorded entry with the same id is adopted, not added; only `refunds` changes — never status/items/time/paying), email via `sendRefundEmail` with the party label (`keptSeat` = not cancelled), audits `party-refund` / `party-refund-checked`, `refundParty`, `clearPartyRefundRequest`, `recordSquarePartyRefund` (R26, role 'square', idempotent by Square id), `partyRefundReply` / `partyRefundRequestsReply` (POST refund body `{ partyId, chargeId, cents, reason, attempt, again? }`; `{ action: 'clear' | 'clear-request', partyId, requestId, outcome, reason }`; GET `?partyId=`). Reply data: `{ refundId, cents, refund, refunds, refundable: {chargeId: cents}, emailed, already? }`.
- Routes: `src/pages/api/admin/parties/refund.json.ts` (owners, reason optional), `src/pages/api/staff/party-refund.json.ts` (any signed-in member, reason ≥ 3 chars, logged with their name) — S2-R8.
- `square-events.handleRefund`: party payment index checked first (a read failure throws → nightly retries); `handlePartyRefund`: FAILED/REJECTED on a refund we recorded or sent → one `refund-failed` flag with `classId: 'party'` (R24); COMPLETED → our request claimed (exactOnly by ids when already on the party), else recorded as money (R26), no plain-refund flag; reconcile runs parties through the same path (R25). New outcome `{ action: 'recorded', partyId, recordedCents }`. `flag()` now takes `{ classId, bookingId }`. `flagUnconfirmedRequests` already covers party requests (test added).
- `to-decide`: party flags read "the Justice party", carry `detail.partyId/partyDay`, no classId; unfinished/unconfirmed decide via `clearPartyRefundRequest`; audit target `{ kind: 'party' }`. `ToDecideSheet`: "Open the party" → `open({ kind: 'party', day, id })`.

## Tests
- New: `tests/api/party-refund.test.ts` (10), `tests/lib/parties/refunds.test.ts` (8). Extended: `square-events.test.ts` (+5 party), `to-decide.test.ts` (+2), `ToDecideSheet.test.tsx` (+1), `refund-runner.test.ts` (claim via `claimSquareRefundWith`; refund-books cases incl. unknown scope throws).
- Pinned class tests unedited (`class-refund`, `admin-classes`, `seat-ledger`, `RefundPanel`).
- Full run: 321 files / 4251 tests pass; `npx tsc --noEmit` 0.

## Concerns / notes
- A request finished by "It went through" keeps `squareRefundId: null` on its PartyRefund even after Square's refund later arrives (the request learns the id; the party entry isn't backfilled). Shows once; cosmetic.
- `sendRefundEmail` copy is class-worded for a cancelled party ("another class soon"); fine for a booked party ("still booked").
- Refund unit is per charge but the R29 block is per party (scope = party), as for a class booking.
- Simulated (payment-bypass) charges are refused with a message rather than sent to Square.

## Fix round 1 (review: task-10-review.md)
- I1: `sendRefundEmail` takes `party: { startIso }` → "We refunded $X to your card for your party on Saturday, November 14." (or "for your party."), then "Your party is still booked, so we will see you then." / "We hope to craft with you again soon." The party book sends `className: 'your party'` + `party`; no surname in customer copy (audits/To decide keep "the Justice party"). Tests: email-refund (+1), party-refund and parties/refunds expectations updated.
- I2: warnings.ts: a refund flag with scope 'party' → title/detail "The Justice party" (partyLabel, capitalized), `eventKind: 'party'`, `eventId` = party id. Test in warnings-own-classes.
- M1: test "It went through" then Square's late refund via webhook + nightly → one owner entry, one email; a different same-amount Square refund is recorded as its own money.
- M2: optional `RefundBook.noteSquareId`; the runner's claim calls it on an already-done request; the party book fills the Square id on the request's own entry (never adds money). Classes don't implement it (unchanged).
- M3: party `stillFits` refuses a resend at Square's 20-refund cap with the cap message (409). Test.
- M6: `UnknownRefundScope` error type; `refund-books.claimSquareRefund` catches it, logs, returns false (the caller records Square's refund the usual way); `refundBookFor` still throws elsewhere. Test.
- Focused suites: 38 files / 670 tests pass; `npx tsc --noEmit` 0; pinned class tests unedited.
