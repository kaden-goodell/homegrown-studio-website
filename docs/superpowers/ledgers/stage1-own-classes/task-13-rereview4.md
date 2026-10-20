# Task 13 — re-review 4 of fix round 5 (07e07dc..5e4b167)

Verdict: **Approved**. There are no Important findings. Three Minor notes follow.

Tests: `npx vitest run tests/lib/classes tests/api tests/components` gives 133 files and 1847 passed, with 0 failed.

## Findings under verification

| # | Verdict | Evidence |
|---|---------|----------|
| N1 | Addressed | **Panel:** `againOf` is made once, when the `already` reply arrives (`RefundPanel.tsx:117-121`). `go(true)` sends that same value on every retry (`:113`). It is dropped on success (`:124`), on Back (`:229`) and on any change to the ask (`:65`). The button is disabled without it (`:228`). **Server:** an exact token match wins first, even under `again` (`refunds.ts:408-413`). A finished match answers `already` and sends nothing. The id is deterministic (`:401-402`, `:433`), so no random id is made for a repeat. **Test:** the reviewer's case (timeout, then webhook, then retry) gives exactly 2 Square calls. |
| R31 | Addressed | **Shape:** `again: {of, token}` is validated in `readRefundBody` (`refunds.ts:681-685`). The old `again: true` gets a 400. **Exact token:** honoured first (`:408-413`). A retired one under `again` gets a 409 and is never re-planned (`:409`). **Stale `of`:** a 409 `AGAIN_IS_STALE` in the pre-check (`:419-420`). The same check runs again inside the CAS (`refund-requests.ts:123-126`). The `have` check by same id comes before it (`:120`), so a double tap still resolves to one request. |
| m1 | Addressed | `doneAsks` sorts latest first by `doneAt ?? createdAt` (`refund-requests.ts:90-92`). `doneReply` names the latest and gives `count`, so the message says "twice" or "N times" (`refunds.ts:358-372`). `doneAt` is set only on the move to done and never rewritten (`refund-requests.ts:190-193`), so the order is stable. |
| m4 | Addressed | `at = doneAt ?? cleared.at ?? null` (`refunds.ts:364`). There is no `updatedAt` fallback. A missing time gives "Already refunded by X." (tested). |

## Hunt: new problems in this diff

### Is there any path to a third (or extra) refund?
None found. I traced these:
- **Retry of a repeat:**
  - pending or sent: re-sends the same key
  - turned-down: goes through `stillFits`
  - half-done "went through": finishes it, no Square call
  - done: `already`
  - retired: 409
- **Double tap:** the same id goes to `have` → `mine`, so both taps use one key.
- **A new token while the repeat is unfinished:** step 2 continues the same request.
- **A new token after the repeat finished:** the stale `of` gets a 409.
- **Two owners, both repeating `of`=A, after B is done:** the second gets a 409.

### Is any legitimate repeat refund now impossible?
None found.
- After any `already` reply, the panel has a fresh `{of: latest, token}`, and the server accepts it while `of` is still the latest.
- A reload loses `againOf`. The plain ask then answers `already` with the current latest, and that gives a fresh repeat.

### Does the panel ever tell the owner something false?
No. One thing could be clearer (see Minor 1).

### Can a token be reused across different bookings or different amounts?
- **Different bookings:** no. The repeat id hashes classId and bookingId (`refunds.ts:402`), and requests are stored per booking.
- **Different amounts:** the panel can't do it, because `againOf` clears on any input change. The server could (see Minor 2).

### Minor

1. **A retried repeat that Square already finished shows "Refunded twice already, last on … by Owner." and offers "Refund again" again.** This happens when the retry follows a timeout and the webhook.
   - What it says is true, but it is not a success screen. `onDone` isn't called, so the booking list isn't refreshed, and the panel stays open with a live button for a THIRD refund (a new `{of: B, token}`).
   - No money moves without another deliberate tap.
   - Suggestion: when the reply's `latest.requestId` is the repeat's own id, treat it as success: show "Refunded $X.", call `onDone`, and close the panel. Alternatively, accept it as part of the noted deviation. It is fine for Task 14.
2. **The repeat id is not bound to the inputs** (`refunds.ts:402`; the attempt path is bound through `inputHash`).
   - Over the API, the same `{of, token}` sent with a different amount or seats hits the exact match. It continues or answers the ORIGINAL request, and the reply carries the original cents.
   - There is no money risk: it can only re-send its own saved key. But the new ask is quietly ignored.
   - One-line fix: add `inputHash` to that hash, or require `exact.inputHash === inputHash` before honouring it.
3. **Two owners repeat the same `of` while the first repeat is still unfinished.** Step 2 (`refunds.ts:415`, and `refund-requests.ts:121` in the CAS) continues the first owner's request B before the stale check runs.
   - The second owner gets "Refunded $X." for B, the same key and one refund. Their own repeat never happens, and they get no 409.
   - Money is safe: 2 refunds in all, which is what each owner expected. The only issue is that the second owner is told of a refund that is really the first owner's.
   - This deviates from R31's "stale `of` → 409" only while B is in flight. It is acceptable. If wanted, refuse under `again` when the unfinished match is a repeat of the same `of` made with a different token.

### Checked and fine
- `doneReply` marking `answered` on an already-done request doesn't touch `doneAt`.
- The save step's `out.rec.status === 'done'` handling (`refunds.ts:446`): a plain `mine` is a replay, and `same` or `again` gives `already`.
- `readRefundBody` treats `again: false` or `null` as no repeat. It refuses any other non-object, or an object with ids that don't match the pattern.
- Updating the existing tests to the new shape didn't weaken any assertion: the 400 "nothing left" and the key-difference checks are kept.
- The m3 note for the /staff screen is carried into the report for Task 14.
