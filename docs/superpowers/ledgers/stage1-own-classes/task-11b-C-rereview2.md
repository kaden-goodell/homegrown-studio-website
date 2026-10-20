# Task 11b-C re-review 2 (fix round 2)

Range 7303f6d..59adc1c (one commit, 59adc1c), branch kaden/own-booking-system. Reviewer changed no tracked file.

**Verdict: Approved.** N1–N7 and R40 are fixed. No Important findings. 3 small Minors below, none blocking.

## Checks
- `npx tsc --noEmit`: 0 errors.
- `npx vitest run`: 300 files, 3863 passed, 0 failed.
- `npx vitest run tests/api/class-refund.test.ts` (the only class-refund* file): 59 passed. R29–R31 hold.

## Earlier findings
| # | Verdict | Where |
|---|---|---|
| N1 Undo overbooks / un-frees the wrong seat | **Fixed.** Entries get `id: rfe_…` in `recordRefund`. The decision snapshots entry ids before, diffs after, and stores `{lineId, entryId}`. `unfreeSeats` runs inside `mutate` (CAS). It refuses when the entry is gone or moves money, when a money refund came after it, or when a coming session would be over capacity (`seatsTaken(after) > capacity`; `seatsTaken` counts unexpired holds + confirmed + refunded-that-kept-the-seat). Only sessions on that line that haven't started are checked. An already-free seat records no entries, so there's no undo. | seat-ledger.ts:343, 654-678; to-decide.ts:411-423, 484-494, 535-542, 601-607 |
| N2 counter move takes the wrong lines | **Fixed.** `paid` is now limited to the same pass, ticket, `confirmed` and no refunds. Can't strand a payment: a line that isn't moved keeps its own Square ids, and moved sources are cleared only when paired with a target. See M1 for one silent no-op. | seat-ledger.ts:618-619 |
| N3 naming step left by closing | **Fixed.** The unmount effect calls `finish()` once when `made` is set and neither Add names nor Skip ran. The all-named path never sets `made`, so there's no double reload. | ToDecideSheet.tsx:223-229, 273-285 |
| N4 two id forms | **Fixed.** `tokenOf` moved to decided.ts. `minimumItemId` goes through it, so warnings, minimum alerts and To decide use one form. | decided.ts:11-17; to-decide.ts:238 |
| N5 / R40 Texted silences alerts | **Fixed per R40.** "Texted" writes `note-<id>` (not `done-`), audited `to-decide-texted`. `decidedIds` and `listDecided` read only `done-`, so the alerts and the /staff warning continue. Only `keep-running` records a decision. | to-decide.ts:315-324, 522-532 |
| N6 flaky test | **Fixed.** `findByRole`; `asyncUtilTimeout` 5000 on the three admin sheet tests. Full run green. | SettingsSheets.test.tsx etc. |
| N7 noon/midnight | **Fixed.** /admin `clockRange` capitalises a leading "Noon"/"Midnight". The public café uses the new `formatCafeRange`/`formatCafeHours`. **Display only:** consumers are `/api/cafe-hours.json`, index.astro:205 and craft-cafe.astro:51. No stored data changes. No email, SEO or studio-hours path uses them, and `formatRange` is untouched. | shell/time.ts:30-32; config/hours.ts:125-141; site.config.ts:255; cafe-hours.json.ts:28-29 |

## New-code hunt
- **Refund ids and old entries:**
  - `id` is optional on the type. `entryIds` and `newFreeEntries` skip entries without an id.
  - Refund caps don't use ids: `refundedOn`/`paidOn`, `seen` by `squareRefundId`, the `replacing` Square-entry swap and `carries` are unchanged.
  - Idempotency is unchanged: `requestId` and `squareRefundId` keys.
  - The id is minted inside the CAS callback, so a retry mints a fresh one. Only the written one is read back afterwards, so this is fine.
- **Old Decided records** with `undo.lineIds` (from before this commit) → `entries ?? []` → "There's nothing here to undo." (409). Safe, and it's dev-only data anyway.
- **Undo capacity uses the right sessions:**
  - It checks the sessions of the restored line (`sessionIds`), skipping ones that have started.
  - It counts the ledger *after* restore, so `>` (not `>=`) is correct.
  - A line with an earlier money refund (state `refunded`) keeps that state after the undo, and `counts()` then counts it again. Correct.
- **`onSeatFreed` is a no-op today** (refunds.ts:238), so Undo has nothing to retract.

## Minor (new)
- **M1. A move after the matched seat was refunded does nothing, but says it moved.**
  - **Where:** seat-ledger.ts:618-640; to-decide.ts:552-556.
  - **What happens:** say the counter-sale seat (`from`) got a refund or a free after the check item appeared. The item still lists, because `listCounterMatchChecks` keys off `counterMatch`. If that booking has no other movable seat, `paid` is empty: nothing moves, an unchanged ledger is written, and the decision records "It was X: the payment moved".
  - **Impact:** X's seat stays unpaid and comes back as door-unpaid, so no money is lost or stranded. Only the message is wrong.
  - **Fix:** throw "That sale's seat was refunded since. Open the class." when `paid` is empty, or skip such lines in `matchItems`.
- **M2. Attribution window.** The `before` snapshot (to-decide.ts:485, 537) is read outside the ledger lock. If a second owner frees the *same* seat in the milliseconds between, `decideRefundFlag` swallows "already free" and `newFreeEntries` claims the other owner's entry, so this Undo could take it back. The window is tiny with two owners. Note only.
- **M3. Undo is shown when there's nothing to undo.** The toast offers Undo whenever the choice has `undo`, even when the server recorded none (the seat was already free). Tapping it gives "That can't be undone from here." The message is clear, so this is cosmetic. `note-*` keys are also never deleted (one per class, negligible).
