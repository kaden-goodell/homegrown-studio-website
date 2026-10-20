# Task 13 — re-review 3 of fix round 4 (2a9c843..07e07dc)

Verdict: **Needs fixes**. There is 1 Important new finding: a retry of a "Refund again" can make a third refund.

Tests: `npx vitest run tests/lib/classes tests/api tests/components` gives 133 files and 1842 passed, with 0 failed.

## Findings under verification

| # | Verdict | Evidence |
|---|---------|----------|
| I1 | Addressed | `continuing` matches the same inputs with no time limit (`refunds.ts:254-261`, `sameAsk` at `refund-requests.ts:85`). A finished match is answered `already` and nothing goes to Square (`refunds.ts:357-371,419`). Only `again` skips a finished match. `answered` is set only when the actor is the asker (`refunds.ts:470,594`). `doneAt` is saved (`refund-requests.ts:180`). Tests cover a reload after someone else's "It went through", and a webhook finish more than 24 h earlier. |
| M1 | Addressed | `saveRefundRequest` (`refund-requests.ts:110-123`) handles every case in one CAS: same id, then same inputs, then a waiting refund (409), then a refund saved since the plan (409 REFUND_JUST_MADE). The turned-down re-send goes through `resendRefundRequest` (`:130`), which is also one CAS. With no token, a double-click continues the first request, so there is one audit and one email. |
| M2/M3 | Addressed | `recordRequestRefund` (`seat-ledger.ts:340-401`) writes the asked seats and the spill-over in one mutate. It is keyed by requestId or squareRefundId (`:360`) and replaces Square's plain entries. `claimSquareRefund` writes the money and then marks the request done (no markRequestSent first). `handleRefund` finishes a half-done request by its ledger request id, matching by id only (`square-events.ts:463-464`). The nightly ListPaymentRefunds goes through the same handler, so it heals there too. "It went through" finishes a half-done check without writing twice (`refunds.ts:373,568-600`). Tests simulate a failure between the two writes on both paths, including spill-over. |
| M4 | Addressed | `emailed: !!rec.emailedAt` in `doneReply` (`refunds.ts:360`). |
| M5 | Addressed | `stillFits` checks each seat and the booking cap (`refunds.ts:264-273`). A request that no longer fits is retired and gets a 409 with no Square call (`:424-429`). A retired request is never continued. |
| M6 | Addressed | `describeRequest` (`refunds.ts:280-291`) gives who, when, cents, people and dates. Every 409 for a waiting or newer refund carries it (`:293`, `:401,413-414,432`). There is a GET on both routes behind their sign-in, with keys and hashes left out (`refunds.ts:668`). |

## New findings

### Important

**N1. A retry of "Refund again" makes a third refund.**
- `RefundPanel.tsx:102-104` makes a new token on every `go(true)`.
- After an error, `already` is not cleared (`:112`), so the "Refund again" button is still on screen. It sits right under Square's "Try again. It won't refund twice."
- On the server, `continuing` drops an exact token match when `again` is set and the request is done (`refunds.ts:257`). Line `:404` then makes a random id, so even a retry that keeps its token is planned fresh.

How it happens:
1. Owner taps "Refund again". Square makes the refund but the call times out, so the panel shows SQUARE_NO_ANSWER.
2. Square's webhook arrives seconds later and finishes the second request (done).
3. Owner taps "Refund again" as told.
4. Under `again`, `sameAsk` leaves out done requests, so the ask is planned again with prior+1. That is a new key, and Square makes a **third refund**.

The same happens for the same-token retry over the API.

Fix:
- Make the "again" token once, when the `already` reply arrives, and reuse it on every retry. `go(true)` sends `attempt` and does not mint a new one.
- On the server, honour an exact token match whatever `again` says (remove `!(again && exact.status === 'done')` at `:257`) and keep `tokenId` as the id. An `again` ask has a new token, so a match can only be its own retry.
- Add a test: again, then no answer, then the webhook finishes it, then the same again retry. Expect 0 more Square calls.

### Minor

- **m1.** After a "Refund again", the next identical ask names the oldest refund (`same[0]`, `refunds.ts:260` and `refund-requests.ts:117`). "Already refunded on Oct 1" hides the Oct 5 one. Name the latest and say how many: "Refunded twice, last on…".
- **m2 (implementer concern: half-done "It went through" not flagged overnight).** Minor. The money is on the ledger once, and the freed seat is freed by the entry itself. Only done, the audit and the customer email are missing. It heals when:
  - the check is done again
  - Square's refund arrives (webhook, or nightly within 48 h, matched as 'sent' + went-through, `refunds.ts:509-512`)
  - the asker retries

  It needs a blob failure between two writes. Flag it in Task 14 next to `flagUnconfirmedRequests`.
- **m3.** The server honours `again: true` whenever it is sent. It doesn't check that the earlier refund was shown. That is fine for RefundPanel. The /staff screen still to be built must send it only from a "Refund again" button that is shown after `already`.
- **m4.** For requests saved before this round (no `doneAt`), the "Already refunded on" date falls back to `updatedAt` (`refunds.ts:362`). Later writes such as the email claim move it. This is cosmetic.

## Other implementer concerns
- **Matching a finished request even with no room left:** agreed. A fresh plan would be refused anyway.
- **The fake store doesn't enforce CAS:** agreed that the decision logic is what's tested. `blob-store.test.ts` covers the etag behaviour.
- **Retired after a wrong "It didn't go through":** agreed, there is no double. Square's refund is on the ledger as a plain refund, so the fresh plan only sees what's left.

## Checked and fine
- **`again` while the same ask is still unfinished:** `sameAsk` still matches pending, sent and turned-down requests under `again`. So "Refund again" after no answer, or after a 500 save failure, continues the second request (the same key). Only the done case leaks (N1).
- **A wrong "It didn't go through", then the Square refund lands:** it is recorded as a plain refund. Re-sending either fails `stillFits` (retired, nothing sent) or re-sends the same key, and the write replaces Square's plain entries.
- **The webhook and our save racing:** both go through `recordRequestRefund` in the ledger CAS, and `carries` makes the second one a no-op. Only the call that moves the request to done audits, and `emailOnce` sends once.
- **'retired' and half-done 'sent' requests:** they are not `isWaiting`, so they never block other refunds.
- **RefundPanel:** a changed ask clears `already` (the effect deps cover every input in the hash). Back clears it. The success copy is true.
