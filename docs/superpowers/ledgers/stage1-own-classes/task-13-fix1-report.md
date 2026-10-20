# Task 13 fix round 1: report

Status: DONE_WITH_CONCERNS (all 12 items done; concerns at the end)
Base 69dec94. Commits (not pushed):
- 43c1d58 `fix(classes): reconcile batches catalog lookups, catches missed refunds, records Square refunds as money` (items 1–8, 11, 12, plus a retry-key guard)
- 8714746 `fix(classes): a taxable class never goes on the POS without its tax; owners hear of a lower Square total` (item 10)
- 5248558 `docs(classes): class and webhook settings in .env.example; webhook setup on ourhometownstudio.com with refund events` (item 9)

Verification: `npx tsc --noEmit -p .` = 0 errors. Full suite: 3364 passed, 3 failed. The 3 failures are the known clock-dependent ones in tests/lib/events.test.ts. That is 18 more passing tests than the 3346 baseline. Each new test failed before its fix. I also broke two fixes on purpose (the refund replace and the split-tender match) to check that their tests then fail.

## Items

### 1. Catalog lookups batched (performance)
- `src/lib/classes/square-events.ts:152` `CatalogCache`. It remembers, per variation id, whether that id is a class item. `prefetch` sends any unknown ids to `POST /v2/catalog/batch-retrieve`, at most 1000 ids per call (`CATALOG_BATCH`). Ids the catalog doesn't return are remembered as "not a class item". A failed lookup is not remembered, so it is asked again next time. Calls still go through the shared `squareFetch`, so `SQUARE_API_VERSION` is unchanged.
- `:207` `indexVariations`. A Map from variation id to {classId, key}, built once per run. It replaces the per-line `classIdFromVariation` scans in both orders and returns.
- `:554` `reconcileClasses` now fetches every page of orders first, then makes one `prefetch` call for every variation id that isn't ours, then handles the orders using the shared `RunContext`. Result: one catalog call per run.
- Webhook: the module-level cache is renewed hourly (`:198` `sharedCache`), so a warm server instance doesn't ask about the same café item again. Tests can clear it with `resetCatalogCache()`.
- Tests (square-events.test.ts, "nightly reconcile"): "looks up unknown items in the catalog once per run" (30 orders over 2 pages give exactly 1 batch call with the 7 distinct ids), "asks the catalog for at most 1000 ids per call" (1001 ids give 1000 + 1), and "the webhook remembers catalog answers between events".

### 2. R25: refunds caught by the nightly run
- `square-events.ts:613`: `GET /v2/refunds?begin_time=<now−48h>&location_id=<loc>[&cursor=…]`, following the cursor (at most 50 pages). Each refund goes through the same `handleRefund`. It is idempotent by `squareRefundId`.
- Before that, a payment→classes index is built once from the ledgers, after this run's sales have landed. Each refund then reads only the ledgers it touches.
- The result now includes `refunds` and `refundsHandled`.
- Test: "catches refunds the webhook missed (ListPaymentRefunds, last 48 hours, every page), once". It covers an itemized refund, a café refund and a plain refund over 2 pages. A second run records nothing new. The test checks the query (begin_time, location_id) and the cursor.

### 3. R26: a plain refund made in Square is recorded as money
- `square-events.ts:381` `recordPlainRefund`. It records the refund at once with `recordRefund(freeSeat: false, by: SQUARE_BY, reason: 'Refunded in Square (amount only)', squareRefundId)`. The money is spread over paid seats in seat order. Each seat is capped at what it has left, and each booking at `bookingCap` (now imported from refunds.ts).
- It is idempotent:
  - A class already carrying that refund id is not written again.
  - Only the part not yet recorded is spread, so a replay after a crash part-way finishes the job.
  - A replay of an already-recorded Square plain refund re-runs this function, which is a no-op apart from making sure the flags exist.
- Only the seat decision becomes a flag: `refund-flags` kind 'plain-refund', id `flag-plain-refund-<refundId>-<classId>`. Its `cents` is what was recorded on that class, and the new `refundCents` is the whole refund.
- `listRefundFlags` (`:662`) hides a plain-refund flag when the ledger carries that refund id recorded by anyone other than `SQUARE_BY`, which means our own flow made it. Flags for refunds made in Square stay visible.
- The race: if Square's webhook lands before our own refund flow saves, `recordRefund` (`seat-ledger.ts:298`) now replaces the Square-side entries for that refund id on that class with the person's entry. Their seat choice, reason and name stand, and a line left with no refunds goes back to 'confirmed'.
- Tests:
  - "a plain amount refund is recorded as money at once…" (replaces the old flag-only test)
  - "a plain refund spreads in seat order, capped…, never recorded twice"
  - "our own refund whose webhook beat the save: our record replaces Square's, and the flag is hidden"

### 4. Split tenders
- `square-events.ts:226` `tenderPaymentIds`. A sale stores every tender's payment id on its POS lines as `square.paymentIds` (only when there is more than one; `seat-ledger.ts:387`). `square.paymentId` is still the first.
- Refund matching uses `paidBy(line, paymentId)` (`seat-ledger.ts:269`), which checks both fields. So does the reconcile's payment index.
- Test: "a split-tender sale: a refund on the second card is ours".

### 5. Manual rerun
- `src/pages/api/jobs/reconcile-classes.json.ts:45`. POST `?force=1` with the /admin owner cookie (`adminAuthorized`, the same check as the other admin routes) runs now, whatever the hour.
- The job key path is unchanged and still waits for 3 AM. The owner cookie without `force` also waits for 3 AM. No cookie gets a 403.
- There is no "last-run marker" in this route (the gate is the 3 AM hour), so `force` skips the hour check.
- Tests: 2 new cases in tests/api/jobs-reconcile-classes.test.ts.

### 6 and 8. Webhook owner note without event data
- `src/pages/api/webhooks/square.json.ts:83`. `details` now holds only `eventType`, `eventId`, `objectType` and `objectId`. Missing ones are left out, so Slack never shows "null" or "[object Object]".
- The error log in `handleSquareEvent` already logged only the type and event id.
- Test: "the owner note carries ids and the type only, never the event data". It checks that no email or address leaks.

### 7. refund.updated FAILED
- `square-events.ts:437`. FAILED or REJECTED on a refund the ledger carries creates a `refund-failed` flag, once per refund. The flag is always shown. The ledger is never changed (R24).
- Test: "refund.updated FAILED on one of our refunds: shown to the owners, the ledger is left alone". It goes through `handleSquareEvent`, replays the event, and checks the ledger is byte-identical afterwards.

### 9. B5/M9: settings and docs
- `.env.example` adds `SQUARE_CLASSES_CATEGORY_ID`, `SQUARE_CLASS_TAX_ID`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_URL` and `STORE_NAMESPACE`, with blank values and one-line comments.
- `docs/square-setup-guide.md`:
  - New "Webhook subscription (own classes)" section with the URL `https://ourhometownstudio.com/api/webhooks/square.json` and the events `order.updated`, `payment.updated`, `refund.created`, `refund.updated`.
  - It explains the 500 (no key) and 403 (wrong URL) failures, and the ?force=1 manual run.
  - The production script example and the env table now use the new domain. The old domain is gone from the guide.
- `scripts/setup-square.ts` WEBHOOK_EVENTS now includes `refund.created` and `refund.updated`.

### 10. B6: tax fails closed; lower totals reach the owners
- `src/lib/classes/square-catalog.ts:113`. `syncClassToSquare` throws `CLASS_TAX_NOT_SET` ("Class tax isn't set up yet.") before any Square call when the class is taxable and `SQUARE_CLASS_TAX_ID` is empty. A cancelled class is still taken off the POS.
- `src/lib/classes/admin-actions.ts:31,143`. The owner sees "Saved, but it isn't on the POS: Class tax isn't set up yet. It can't be sold until it is." instead of the generic sync warning. A class with no POS ids can't be booked: checkout already refuses it as "not on the POS".
- `src/pages/api/classes/book.json.ts:242`. When Square's total is more than 1 cent below our quote, owners are emailed with both totals and a hint to check the class's tax. The booking still charges Square's total. A 1-cent drop still sends no email; upward drift is unchanged.
- Tests: 2 new and 1 reworded in square-catalog.test.ts, 1 in admin-classes.test.ts, 1 in classes-book.test.ts.

### 11. M5: OPEN orders
- The reconcile search uses `state_filter.states = ['COMPLETED','OPEN']` (`square-events.ts:573`).
- `handleOrder` now sorts the lines first, without writing. An OPEN order then needs a COMPLETED payment on one of its tenders (`:289`) before any line counts, including unmatched entries.
- Payments are only looked up when the order has class lines, so OPEN café tabs cost nothing extra.
- Test: "catches an OPEN counter order whose payment went through; an unpaid OPEN order counts nothing". The existing reconcile test now checks the two states.

### 12. I10: a plain refund across several classes
- `recordPlainRefund` spreads class by class (classes in `listClasses` order, bookings within a class, seats in seat order) and writes one "Free a seat?" flag per class on the payment.
- Test: "a plain refund on a payment that covers two classes…". A $40 refund puts $32.70 on class A and $7.30 on class B, makes 2 flags, and a replay adds nothing.

### Extra: retry key guard (needed because of R26)
- The problem: our flow's Square refund succeeds but the save fails, then the webhook records that refund as a Square plain refund. "Do the same refund again" would then count one more prior refund and build a new idempotency key, which could refund twice.
- The fix: `src/lib/classes/refunds.ts:76,156`. `priorRefunds(…, { forKey: true })` leaves Square-recorded plain refunds out of the key count. The retry keeps its key, Square hands back the same refund, and `recordRefund` replaces Square's record of it. The 20-refund cap still counts every refund.
- Test (class-refund.test.ts): "our refund that Square took but did not save here, then recorded from Square's webhook: doing it again reuses the key and our record replaces Square's".

## Concerns
1. **Mixed POS orders.** A plain refund on a payment that also covers café items is recorded against the class seats as ruled in R26. A $4.50 latte refund on a class-plus-latte order lowers that seat's refundable amount by $4.50. This errs toward never refunding twice, and the flag lets a person see it, but the class money on our side is understated.
2. **Our refund replacing Square's record is per class.** If Square's webhook spread one of our in-flight refunds over two classes, which only happens when it exceeds the first class's remaining amount, only the class our flow refunded is replaced. Our online refunds are one class per payment, so this only touches POS payments refunded from /admin.
3. **Split-tender refunds from /admin** still go to `square.paymentId` (the first tender). Square refuses more than that tender's amount. Only matching was asked for; refunding across tenders is not built.
4. **Cache freshness.** The webhook's catalog cache can be up to 1 hour stale. An item moved into the Classes category within the hour could be missed as an "unmatched" sale. The nightly run uses a fresh cache.
5. **Refunds window.** `ListPaymentRefunds` `begin_time` filters on when the refund was created. A refund created more than 48 h ago that changes status inside the window is not seen by the nightly run (the webhook still sees it).
6. **Not checked against real Square.** Nothing was checked against real Square (all tests mock fetch). The `/v2/refunds` query parameters and the payload shapes follow the documented 2026-01-22 API.
7. The untracked `docs/superpowers/plans/2026-10-19-stage2-parties.md` in the worktree is not mine and was left alone.

---

# Fix round 2

Status: DONE. Commit ae081a1 `fix(classes): owner refunds keep one saved request so a retry can never refund twice` (not pushed).

Verification:
- `npx tsc --noEmit -p .` = 0 errors.
- Full suite: 3373 passed, 3 failed. The 3 failures are the known clock-dependent ones in tests/lib/events.test.ts.
- Mutation check: I made the retry ignore the saved request and re-plan from the ledger. 4 of the new refund tests then failed. While doing this I found the "no answer, no webhook" test was too weak, made it stricter, and fixed the gap it then exposed (fitting the split, below).

## N1: a retried owner refund can't refund twice

### The saved request
- New file `src/lib/classes/refund-requests.ts`. There is one document per booking (kv `refund-requests`, written with CAS).
- Each request stores:
  - `id`, which is a hash of the inputs plus the attempt token
  - `inputHash`, the inputs without the token
  - the payment, kind, freeSeat, reason, who asked and their role
  - the exact per-seat `lines` split, `totalCents`, `prior`, `rawKey`, `failures` and `idempotencyKey`
  - `status` (pending, sent, done or turned-down), `squareRefundId`, `answered`, `createdAt` and `updatedAt`
- Helpers: `createRefundRequest` (if two tries race, the first one wins), `changeRefundRequest`, `markRequestSent`, `markRequestDone` (returns true only for the call that moved it to done), and `allRefundRequests`.

### The owner's refund flow
`refundClassBooking` (`refunds.ts:318`) now works like this:
1. **Find the saved request** with `continuing` (`:239`). It checks, in order:
   - the request for this attempt token
   - an unfinished request with the same inputs (a retry after a page reload)
   - a same-inputs request that Square's webhook finished in the last 24 h, which the person never got a success reply for
2. **A finished request** is answered without refunding again, and is then marked as answered.
3. **No request found:** plan it from the ledger once and save it with its key, before Square is called.
4. **Status 'sent'** (Square took it): only save it on the ledger. Square is not called again.
5. **Otherwise** send the saved total with the saved key, exactly as saved:
   - No answer: the request stays pending, so the next try sends the same key. "Try again. It won't refund twice." stays true.
   - FAILED or REJECTED: status becomes turned-down and the failure count goes up, so the next try uses a new key, as before. A retry sets it back to pending while it is in flight.
   - Success: status becomes sent, then the refund is saved on the ledger, then done.
6. **Audit** happens once, by whichever of our flow and Square's webhook saved it first.

### Fitting the split to the ledger
- `fitSplit` and `writeToLedger` (`:257`, `:281`). Square has already refunded the saved total, so all of it is always saved.
- A seat that now has less left than its share (because a separate refund was made in Square in between) keeps what fits. The rest goes on the booking's other paid seats in seat order.
- Those spill-over seats are written with the seat kept. Only the seats that were asked about can be freed.
- Entries already written for the same Square refund id don't count against what is left. Anything that still can't fit is logged; that would mean Square refunded more than the booking has left.

### What Square's webhook and the nightly run do
- `claimSquareRefund` (`refunds.ts:421`) is called from `handleRefund` (`square-events.ts:461`) before any return lookup or plain-refund recording.
- A COMPLETED refund matches one of our requests on that booking when it has the same Square refund id, or when it is a pending request with no id on the same payment for exactly that amount.
- A match is saved as that request, by the person who asked, and the result is `{ action: 'ignored', why: 'ours' }`. Nothing is written as a refund made in Square.

### Requests Square never confirmed
- The nightly run's third step, `flagUnconfirmedRequests` (`square-events.ts:657`), handles requests still pending with no Square refund 24 h after they were made. Each gets a `refund-unconfirmed` flag (new kind) with its `requestId`. They are never retried.
- `listRefundFlags` hides that flag once the request is settled.
- The run's result gains `staleRequests`.

### The attempt token
- `readRefundBody` accepts an optional `attempt` (`[A-Za-z0-9_-]{6,80}`).
- `RefundPanel` (`src/components/admin/classes/RefundPanel.tsx:53`) sends a token that stays the same across retries and is replaced after a success.
- Without a token (the /staff screen isn't built yet), a retry is still safe through the "same inputs, unfinished" and "finished by the webhook, never answered" rules. What is still open is a lost success reply after we saved. With a token, that case is answered as done instead of making a new refund.

### Tests
In tests/api/class-refund.test.ts, "fix round 2":
- the reviewer's case (custom $20 on 2 × $25, no answer, webhook, retry: 1 Square call, seat 1 $20 only)
- no answer and no webhook, after a separate $6 register refund: the same key and amount are re-sent, and the $20 is saved as $19 on seat 1 and $1 on seat 2
- the save failed after Square took it, retried without a token: no second Square call, and a late webhook changes nothing
- the webhook lands before our save: one record by the owner, one audit, one Square refund
- the charged total is below the seat prices: one Square refund, and the cap still allows only $15 more
- the same attempt after a success is a replay; a new attempt is a new refund

Also:
- tests/lib/classes/square-events.test.ts: "an owner refund Square never confirmed is flagged after 24 hours, never retried; the flag goes once it is done".
- tests/components/admin/classes/RefundPanel.test.tsx: the token is sent, is the same on a retry, and is new after a success.
- All Task 12 refund tests still pass unchanged (turned-down gets a new key, no answer keeps the same key, the other request's retry key is left alone, a deliberate second refund is a new one).

## N2: a failed catalog lookup is remembered for the run
- `CatalogCache` takes `{ rememberFailures }`. The reconcile run's cache sets it (`square-events.ts:190`), so ids whose batch call failed are not asked about again in that run; the next nightly run asks again.
- The webhook's hourly cache does not remember failures, so a passing outage isn't stored for an hour.
- Test: "a failed catalog lookup is remembered for the rest of the run (no call per order)". 12 orders give 1 call.

## Concerns (round 2)
1. **Changed request after "no answer":** if the person changes the refund after "no answer" (a different amount or seats), it is a new request with a new key. If the first one had in fact gone through, both refunds happen; the webhook saves the first as its own request, so the ledger stays right. I didn't block other refunds while one is unconfirmed, because Task 12's test "a turned-down refund on one request leaves another request's retry key alone" expects a different request to go through.
2. **Matching by amount:** a pending request is matched to a Square refund by payment and exact amount when Square's refund id isn't known yet. A real register refund of exactly the same amount on the same payment, made while our request is unconfirmed, would be saved as our request. The money is still all on the ledger; only who made it and which seats it is on would be wrong.
3. **No email from the webhook:** a refund saved through Square's webhook doesn't email the customer. The person's retry, which is answered as done, doesn't email either.
4. The earlier `priorRefunds({ forKey })` change is kept. It is harmless now that saved requests carry their own key.

---

# Fix round 3

Status: DONE. Commit 2a9c843 `fix(classes): a refund still waiting on Square blocks other refunds until a person checks; one customer email per refund` (not pushed).

Verification:
- `npx tsc --noEmit -p .` = 0 errors.
- Full suite: 3378 passed, 3 failed. The 3 failures are the known clock-dependent ones in tests/lib/events.test.ts.
- The new tests failed before the change. The one test that already passed is "our own successful refund emails once even when the webhook landed first"; it guards against a regression.

## R29: a refund still waiting on Square
- **Refusing a different refund** (`src/lib/classes/refunds.ts:368`). A new request (one that doesn't continue a saved one) on a booking that has a request still pending with no Square refund id is refused with a 409. The reply's `error` is `STILL_WAITING_ON_SQUARE` ("A refund on this booking is still waiting on Square. Check it in Square first.", `:38`). Next to it, `pending: { requestId, cents, at, by, kind }` says which refund to check. `RefundError` now carries optional `extra` fields for the reply.
- **Retries of the same request** still continue the saved request and re-send its key.
- **"I checked Square"** (`clearRefundRequest`, `:488`). Both the admin and staff refund routes accept `{ action: 'clear-request', classId, bookingId, requestId, outcome, reason }` (`:610`).
  - Crew must give a reason of at least 3 characters. The reason is optional for owners.
  - The request is claimed with CAS (pending to sent, or to turned-down) before anything else, so two people checking at once can't both save it. A request that isn't waiting any more answers 409 ("That refund isn't waiting on Square any more."). An unknown request is a 404, and an unknown outcome a 400.
  - **'went-through':** the saved split is written on the ledger by the person who asked (the Square refund id is not known yet). The request records `cleared: { at, by, role, outcome, reason }`. The customer is emailed once. Audit: `class-refund` with `via: 'checked-in-square'`, plus `class-refund-checked`. If the ledger save fails, the request goes back to pending and the route answers 503.
  - **'did-not-go-through':** nothing is saved, and the request becomes turned-down with `cleared` recorded. It no longer blocks new refunds. Asking that same refund again re-sends its original key (the failure count is not raised), so if it had in fact gone through, Square hands that refund back instead of making a second. Audit: `class-refund-checked`.
  - **Square's refund showing up after "It went through":** when it later arrives through the webhook or the nightly run, it matches the finished request (same payment, same amount, no Square id yet, `:458`). Only its Square id is stored; nothing more is written and no second email goes.
- **The Task 12 test** "a turned-down refund on one request leaves another request's retry key alone" is now "while one refund has no answer from Square, a different refund on the booking is refused; the same one retried reuses its key". It checks the 409, the message, that the waiting request is named, that Square is not called, and that the retry re-sends the original key.
- **Tests** (class-refund.test.ts, "fix round 3"):
  - "It went through": saved as asked, by who asked, cleared by who checked; one email; Square's refund later changes nothing; the retry is answered as done; a different refund is then allowed
  - "It didn't go through": nothing saved; a different refund is allowed; the same one again re-sends its key
  - clearing needs the request to still be waiting; crew must give a reason (audited as them); 404 and 400 cases
- UI wiring is left for the admin rebuild, as ruled.

## R30: one customer email per refund
- `claimRequestEmail` and `releaseRequestEmail` (`refund-requests.ts:131`) claim the email with CAS on the request's new `emailedAt` field.
- `emailOnce` (`refunds.ts:318`) sends only for the caller that claims it. It is used by our own reply, by Square's webhook and the nightly run (`claimSquareRefund`), and by "It went through". A send that fails gives the claim back, so a later finish can try again.
- A retry answered as done never sends. Our reply's `emailed` is true when the customer was emailed for that request by anyone.
- Tests:
  - "finished by Square's webhook: the customer is emailed once; the retry answered as done does not email again"
  - "our own successful refund emails once even when the webhook landed first"
  - the email assertions inside the "It went through" test

## Notes
- Round 2's concern 2 (a register refund of the same amount matched as ours) is accepted as Minor by the coordinator.
- **A waiting request blocks until someone checks Square.** One still pending with no Square refund blocks other refunds on that booking with no time limit. After 24 h the nightly run also shows it as a 'refund-unconfirmed' flag.
