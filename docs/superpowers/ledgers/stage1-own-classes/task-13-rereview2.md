# Task 13 — re-review of fix rounds 2–3 (5248558..2a9c843)

Verdict: **Needs fixes** (1 Important new finding: after "It went through", the asker re-doing the same refund from a reloaded screen makes a second refund).

Tests: `npx vitest run tests/lib/classes tests/api` → 67 files, 997 passed, 0 failed.

## Findings under verification

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| N1 | A retried owner refund could refund twice (split and key re-planned from a ledger the webhook changed) | Addressed | The request is saved with its split and key before Square is called: `refunds.ts:374-383`, `refund-requests.ts:81-86`. A retry continues it (`continuing`, `refunds.ts:243-252`) and re-sends `rec.totalCents` and `rec.idempotencyKey` exactly as saved (`:394-399`). It is never planned again. When status is 'sent' it only saves (`:386`). The webhook and the nightly run match our request (`claimSquareRefund` `:449-476`, called from `square-events.ts:461`) and save it as that request with nothing of Square's. `recordRefund` skips lines that already have this refund id (`seat-ledger.ts:307,312`), so the webhook and our save landing together is idempotent. Tests cover the reviewer's custom-$20 case, no answer with no webhook, a failed save, and the webhook landing first. |
| N2 | A failed batch catalog lookup was asked again for every order | Addressed | `square-events.ts:159-160,175,190`: `rememberFailures` is used only by the reconcile cache (`:575`). The webhook cache still retries. A test checks that 12 orders make 1 call. |
| R29 | Refuse a different refund while one has no answer, until a person checks | Addressed (with the Minor race M1) | `refunds.ts:366-373` gives a 409 `STILL_WAITING_ON_SQUARE` plus `pending` details. Retrying the same ask still continues it. `clearRefundRequest` `:488-535` claims with CAS from pending to sent or turned-down, so two checks can't both save. The routes are `refunds.ts:610-619`. Crew need a reason: the staff route passes `reasonRequired: true` (`api/staff/class-refund.json.ts`); owners on /admin don't. |
| R30 | One customer email per request, whoever finishes it | Addressed (Minor M2 and M4) | `emailOnce` `refunds.ts:318-338` claims `emailedAt` with CAS (`refund-requests.ts:131-144`) and gives the claim back on a failed send. It is used by our reply (`:434`), the webhook and the nightly run (`:474`), and "It went through" (`:531`). The "done" replay doesn't send (`:359-364`). |

## New findings

### I1 (Important): after "It went through", the asker re-doing the same refund makes a second real refund
`clearRefundRequest` marks the request done with `answered: true` (`refunds.ts:529`). `continuing` replays a finished request only when it matches the attempt token, or when it is `!answered` and under 24 h old (`:244-251`).

The asker's screen said "Square didn't confirm the refund. Try again. It won't refund twice." (`:33`). Suppose they reload, which gives RefundPanel a new token, or use a screen with no token (the /staff screen isn't built yet), and enter the same refund again after someone has marked it "It went through". Then nothing matches. The ask is planned again from the ledger, which now shows the first refund. That makes a new key with `prior` + 1, and Square makes a **second refund**.

The same thing happens when Square's webhook finished the request more than 24 h before the retry. There the window is counted from `createdAt`, not from when the request finished.

The round-3 test covers this only with the same token (`class-refund.test.ts:532`).

Fix:
- Leave `answered` false when the person who checked is not the asker. Measure the replay window from the finish time (`cleared.at` or `updatedAt`), not `createdAt`.
- Or reply to any same-inputs request that is done but unanswered as already done, with no time limit, until the asker sees it once.
- Add a test: "It went through", then the same ask with a new token. Expect 0 Square calls.

### M1 (Minor): the R29 check isn't atomic
The waiting check reads the `saved` snapshot (`refunds.ts:356,368`). `createRefundRequest` removes duplicates only by id (`refund-requests.ts:83`). Two different refunds on one booking in the same second (two people) both pass, both plan against the same ledger, and both go to Square.

The same race affects one ask with no token (double-click on a screen without a token). That gives two request ids with the same key. Square makes only one refund, but there are **two audits and two customer emails**, because each is a separate request for R30.

Fix: inside the `createRefundRequest` CAS, refuse when there is another pending request with no id, and reuse a same-inputs unfinished request instead of adding one.

### M2 (Minor): a webhook or nightly save that fails halfway is never finished, and can leave spill-over money unrecorded
`writeToLedger` writes in two separate `recordRefund` calls: the asked seats, then the spill-over seats (`refunds.ts:296-297`). If `claimSquareRefund` throws after the first, every replay of that refund hits `entries.length` in `handleRefund` (`square-events.ts:451-454`) and returns 'already-recorded'. That has two effects:
- The spill-over cents are never written (money Square refunded that isn't recorded).
- The request stays 'sent', so there is no done, no audit and no customer email. 'sent' is also not flagged by `flagUnconfirmedRequests` (`:657-659`).

Our own retry path heals this, because 'sent' leads to `writeToLedger` again, but only if someone retries.

Fix: write both groups in one ledger mutation. Or, in `handleRefund`, when a request with this `squareRefundId` is not done, send it to `claimSquareRefund` and don't treat it as 'already-recorded'.

### M3 (Minor): a save after "It went through" that fails halfway isn't idempotent
"It went through" writes with `squareRefundId: null` (`refunds.ts:522`). `recordRefund`'s `seen` check doesn't apply to null, and `fitSplit`'s `same` doesn't either. If the spill-over write fails after the asked-seat write:
- The request goes back to pending (`:525`).
- A second "It went through" writes the asked seats again, so the ledger over-states what was refunded.
- Choosing "It didn't go through" instead leaves money on the ledger for a request marked turned-down. When Square's real refund arrives, it isn't matched and is recorded a second time as a plain refund.

This is narrow. The same single-write fix as M2 removes it.

### M4 (Minor): a "done" replay reports `emailed: false`
The "done" replay returns `emailed: false` even when the customer was emailed (`refunds.ts:363`). The report says it is "true when the customer was emailed for that request by anyone". Read `emailedAt` there.

### M5 (Minor): a turned-down request is re-sent with its old split and never checked again
A request that Square turned down, or that a person marked "It didn't go through", is re-sent with its original split even days later, after other refunds (`:386-399`). Square won't go past the payment total. For an online booking, payment total = booking, so nothing is over-refunded. On a payment that also covers other items, the excess goes to `fitSplit`'s "saved what fits" log only. This is acceptable. Note it with round-2 concern 2.

### M6 (Minor, ruled): no way to clear a waiting refund in the UI yet
Until the admin rebuild adds "It went through / It didn't go through" buttons, a waiting request blocks other refunds on that booking. The way out today is either the API, or re-doing the exact same ask (it continues and re-sends the key). The 409's `pending` gives cents and kind but not the seats or the free-seat choice, so the owner may not be able to re-create the exact ask. Consider adding `lineIds` and `freeSeat` to `pending`.

## Checked and fine
- **Webhook landing between the pending save and the Square call.** There is nothing to match yet. Our own refund can't arrive before Square answers.
- **Webhook landing between Square's answer and `markRequestSent`.** It matches the pending request by payment and amount, then saves, marks it done, audits and emails. Our flow then:
  - `markRequestSent` on a done request only fills in the id
  - `writeToLedger` is skipped by `seen`
  - `markRequestDone` doesn't flip, so there is no second audit
  - `emailOnce` loses the claim, so there is no second email
- **Double-click with the same token.** Both use one request id (`createRefundRequest` returns the existing one) and one key. Square gives one refund and `recordRefund` removes the duplicate.
- **"It didn't go through" when the refund actually succeeded.** Square's refund arrives and isn't matched (the request is turned-down), so it is recorded as a plain Square refund. The money is on the ledger. If the same ask is made again, it re-sends the original key: Square hands back the same refund, and our write replaces the 'square' entries (`seat-ledger.ts:297-306`). A *different* ask made after a wrong "didn't go through" is a human-error double refund, which R29 accepts. Both refunds are recorded.
- **Reconcile replays.** A completed refund with entries already saved is a no-op. A request matched by `squareRefundId` is idempotent. Audit happens only for the call that moves the request to done.
- **Spill-over never frees seats.** Spill-over seats are always written with `freeSeat: false` (`refunds.ts:292,297`). Only seats in `rec.lines` follow `rec.freeSeat`. `holdsSeat` checks `freedSeat`, not `state` (`square-events.ts:365`), so `state: 'refunded'` on a spill-over seat doesn't free it.
- **Crew can't mark "went through" without a reason.** /staff always passes `reasonRequired: true` and needs 3+ characters (`refunds.ts:612`). Crew can't reach the /admin route.
- **A stuck 'sent' request** (Square took it, our save failed) doesn't block other refunds, because only pending with no id blocks. Retrying it only saves it here.
- **The nightly 24 h flag** is shown only while the request is still pending with no id. It is never retried.
