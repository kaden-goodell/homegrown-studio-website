# Task 1 review — booking-core shared charge path

Range dda611c..5a21237 (one commit, 5a21237). Reviewer: review-t1, 2026-10-19.

**Verdict: Approved.** No Critical or Important findings.

## Verification (run by reviewer)
- `tests/api/classes-book.test.ts` unedited (`git diff --quiet dda611c..5a21237 -- tests/api/classes-book.test.ts` → no diff).
- `npx vitest run tests/api/classes-book.test.ts tests/lib/booking-core tests/lib/classes` → 15 files, 301 tests pass.
- `npx tsc --noEmit` → 0 errors.

## Spec
| Item | Status |
|---|---|
| `ids.ts`: `idFor(prefix,key)`, `CREATE_KEY_RE` | Met (`idFor('bkg',a) === bookingIdFor(a)` tested on 20 UUIDs) |
| `charge.ts`: constants, `judgeDrift`, `tellOwnersOfDrift`, `ChargeResult`, `chargeOrder`, `paidOnOrder` | Met (extra optional fields, see below) |
| `classes/checkout.ts` re-exports constants, `bookingIdFor` via `idFor`; nothing else moved | Met |
| `book.json.ts` drift / charge / `paidEarlier` use shared functions, texts kept | Met |
| Required tests (judgeDrift cases, chargeOrder incl. "unclear charge asks the order", key = attemptKey(id,'pay'), paidOnOrder incl. "paid earlier", ids) | Met |
| classes-book test passes unedited | Met |

## Behaviour, old vs new (line by line)
- **Drift.** Old: `>100` refuse; `>0` email; `< -1` email. New: `judgeDrift(q, sq, {tellBelowCents:1})` → `>100` refuse, `>0` charge-and-tell, `< -1` charge-and-tell, else same. Identical, including -1 cent silent. Refuse path (log, `letGo('price mismatch')`, owner text, 502 PRICE_MISMATCH_MESSAGE) untouched. Warn log lines unchanged and chosen by sign as before.
- **Drift emails.** Above: `Square total differed by $X on booking <id> (quote $Q, Square $S)` (no trailing period, hint ''). Below: `… lower than the quote on booking <id> (quote …, Square …). Check the class's tax on the POS.` Byte-identical to old; same subject, to, html. Old `.catch(() => undefined)` → try/catch around await, which also swallows a synchronous throw (strictly safer). Both asserted in classes-book.test.ts (lines 270, 283).
- **Idempotency key.** `attemptKey(input.attemptId, input.step ?? 'pay')`; classes pass no step → `attemptKey(attemptId,'pay')`, unchanged. Order key untouched (createOrder not moved). Retry cannot get a different key.
- **Charge error handling.** `chargeOutcomeOf` returns only `'not_charged' | 'unknown'`, so old "lookup only if unknown, else declined if not_charged, else unknownOutcome" == new "declined if not_charged, else lookup, else unknown". IDEMPOTENCY_KEY_REUSED still unknown → lookup (tested both places). Lookup throw swallowed, original error passed to `unknownOutcome` as before. `null` payment → `unknownOutcome(new Error('no payment returned'))` unchanged.
- **Declined.** 4xx → log "Class payment refused — releasing seats" with codes/message, `letGo('card declined')`, 402. `status==='failed'` → log "Class payment failed" with paymentId, `letGo('payment failed')`, 402. Branch chosen on `paymentId !== undefined`; `Payment.id` is a required string, so the split is reliable.
- **Unknown outcome / hold extension.** Still `unknownOutcome(cls, order, err)` — the 24 h `extendHold` and owner alert live there and were not touched.
- **Recovered charge.** Log "Charge answer was unclear but the order is paid — confirming" kept. Only change: old printed it before the `failed` check, new only when the result is paid. Unobservable in practice — `findOrderPayment` only ever returns `status:'completed'` (square/payment.ts:223). The "kept quirk" (recovered payment still passes the failed check) is harmless and correct to keep.
- **Paid-confirm never throws (R6).** Everything after `result.payment` (confirmPaid, emails, etc.) is untouched.
- **paidEarlier / sold-out / R15 / R17.** `paidOnOrder(() => createOrder(lines))`: create+lookup in one try → unknown (same log text with `String(error)`), `!found || status!=='completed'` → unpaid (null), else paid with the same order. Callers of `paidEarlier` (sold-out / no-lines retry paths) unchanged, so R15 recovery and R17's "no paid-check on first-attempt no-lines" stand as before.

## Shared API fit for parties (plan Tasks 7/8)
- `bookParty` and `pay.json` call `judgeDrift` (default `tellBelowCents` 0 = "tell owners on any drift", matches the plan and R14's "either way"), `chargeOrder`, `paidOnOrder`; `idFor('pty'|'chg', key)` for R35. `step` lets later per-charge keys (`pay-N`) be used.
- No class-specific leaks: subject, ref ("party pty_…") and hint are caller-supplied; module has no class imports. The class-only wording ("Check the class's tax on the POS.") stays in book.json.ts.

## Implementer's concerns — judged
- **Extra optional fields** (`recovered?`, declined `error?`/`paymentId?`, unknown `error?` on paidOnOrder): fine. They are additive, optional, needed to keep the class log lines verbatim, and parties may use them for their own logs.
- **`tellBelowCents`** default 0, classes pass 1: correct — preserves today's class rule exactly and gives parties the plan's "any drift" rule.
- **Kept quirk**: keep it (see above).
- **Flaky UI tests under full-suite load**: unrelated to this diff.

## Minors (non-blocking)
1. `CREATE_KEY_RE` is now defined twice (booking-core/ids.ts and classes/admin-actions.ts:288). Same regex; consider importing it in admin-actions when a later task touches that file so they can't drift.
2. Declined variants are told apart by `paymentId !== undefined`. A small explicit tag (e.g. `why: 'refused' | 'failed'`) would read more clearly for the party callers; optional.
3. charge.test.ts: the recovered case uses `toMatchObject` and doesn't assert `recovered: true`; the `failed` case doesn't assert `paymentId: 'PAY1'`. Both are covered end-to-end by classes-book.test.ts, but the unit tests would document the contract the class route relies on.
4. `tellOwnersOfDrift` puts `ref` and `hint` into HTML unescaped. Same as before and all inputs are server-made, so no issue today; worth remembering if a party ref ever includes customer text.
