# Task 13 — re-review of fix round 1 (69dec94..5248558)

Verdict: **Needs fixes** (1 Important new finding: a retried owner refund can now refund twice).

Tests: `npx vitest run tests/lib/classes tests/api` → 67 files, 984 passed, 0 failed.

## The 12 items

| # | Item | Verdict | Evidence |
|---|------|---------|----------|
| 1 | Catalog lookups batched once per run | Addressed | `square-events.ts:152-194` CatalogCache (batch-retrieve, ≤1000 ids, `CATALOG_BATCH`), `:207` variation index, `:584-586` one prefetch for the whole reconcile run; webhook cache `:197-201`. Still uses `squareFetch`. |
| 2 | R25 missed refunds via ListPaymentRefunds | Addressed | `square-events.ts:610-626` GET `/refunds?begin_time&location_id&cursor`, each row → `handleRefund`; idempotent by squareRefundId (`:434-448`). |
| 3 | R26 plain Square refund recorded as money; flag only for seat; hide our own | Addressed | `square-events.ts:381-418` recordRefund(freeSeat:false, SQUARE_BY, squareRefundId), seat order, capped per line and per booking; flags `:361-372`; `listRefundFlags` hides ours `:654-667`; race handling `seat-ledger.ts:295-318`. (But see New finding N1.) |
| 4 | Split tenders | Addressed | `square-events.ts:226-228` all tender ids; stored `seat-ledger.ts:385-388`; matched via `paidBy` `seat-ledger.ts:269-271`, `square-events.ts:350`, reconcile index `:603`. |
| 5 | Manual rerun `?force=1` (owner auth) | Addressed | `reconcile-classes.json.ts` POST: `adminAuthorized(request)`; `force` only for the owner cookie; job key path unchanged. |
| 6 | Notification/log without raw event.data | Addressed | `webhooks/square.json.ts:83-88` ids + type only; `square-events.ts:532` logs type + event id only. |
| 7 | refund.updated FAILED → 'refund-failed' flag, never undo | Addressed | `square-events.ts:437-442`; ledger untouched; flag always shown. |
| 8 | Slack note without raw `data` | Addressed | same as 6 (filtered to non-empty strings, so no "[object Object]"/"null"). |
| 9 | B5/M9 env + docs | Addressed | `.env.example` 5 keys with blank values + comments; `docs/square-setup-guide.md:63,79-82,102` new domain + 4 events; `scripts/setup-square.ts:85-86` refund events. |
| 10 | B6 taxable class fails closed; lower drift emails owners | Addressed | `square-catalog.ts:98,111-113` `CLASS_TAX_NOT_SET` before any Square call; `admin-actions.ts:31,143` owner message; `book.json.ts:242-252` email when `drift < -1`. |
| 11 | M5 OPEN orders with completed payment | Addressed | search states COMPLETED+OPEN `square-events.ts:573`; `handleOrder` sorts lines first, then `:289-290` requires COMPLETED order or a COMPLETED tender payment (`anyTenderCompleted` `:128-140`); webhook lets OPEN through `:518`. |
| 12 | I10 plain refund across several classes | Addressed | `recordPlainRefund` loops class by class `:389-410`, one flag per class `:412-414`. |

## New findings

### N1 (Important) — a retried owner refund can refund twice now that Square's webhook records plain refunds

R26 made the webhook write our own in-flight refund into the ledger (as a Square plain refund, spread in seat order) whenever it lands before our save. The retry ("Square didn't confirm the refund. Try again. It won't refund twice." — `refunds.ts:29`, and the "didn't save here, do the same refund again" path) re-plans against that changed ledger. The implementer's `forKey` change (`refunds.ts:84-93,156`) keeps `n` the same, but the key also contains the **line ids and total**, and those are recomputed from `remainingOn` / `bookingCap`, which now include the webhook's entry. If they change, the key changes and Square makes a second real refund.

Concrete case (custom amount, the most common partial refund): 2-seat booking, $25 a seat, charged $50. The owner refunds a custom $20 with no seats picked. The plan is `[s1]` $20 with key `refund:bkg:s1:2000:0`. Square refunds it, but our side times out (or the save fails). The webhook's COMPLETED event records $20 on s1. The owner presses the same refund again. s1 now has $5 left, so the plan becomes s1 $5 + s2 $15, with key `refund:bkg:s1,s2:2000:0`. That is a new key, so Square makes a **second $20 refund**.

The same happens with a `person` refund when the booking cap is below the seat total, or when the webhook's seat-order spread lands partly on the chosen seat (then the total changes). For a `booking` refund the retry instead fails with "Nothing is left to refund". That is safe, but our record is never written and the seat is never freed.

The new test (class-refund.test.ts) covers only a case where the plan happens not to change.

Fix: make the retry independent of what the webhook wrote. Options:
- (a) Before calling Square, persist the pending request on the ledger (raw key, line ids, cents). A matching retry then reuses that exact plan and key. The webhook and reconcile skip, or defer, a refund on a payment that has a pending intent of the same amount.
- (b) Make planRefund build lines, total and key from a view of the ledger without the Square-plain entries. Keep the caps on the full ledger and refuse when they conflict.

Add tests for the custom-amount case and the cap-trimmed person case, for both the 502 no-answer path and the save-failed path.

### N2 (Minor) — a failed batch lookup turns the reconcile back into per-order catalog calls
`CatalogCache.prefetch` does not remember failed ids (`:183-185`). If the one batch call fails (for example a 429), every later `handleOrder` → `classLike` → `prefetch` tries again, once per order. That brings back the timeout risk exactly when Square is struggling. Remember the failed ids for the rest of the run, and let the next nightly run retry.

### N3 (Minor) — more Square calls from café traffic
Webhook `order.updated` events in state OPEN (café tabs) now each do a GET order (`:518-519`). This runs in `waitUntil`, and the catalog answer is cached, so it is harmless at this volume. Noting it because it touches café traffic. Café and party behaviour is otherwise unchanged: their payments never appear in the class ledgers, so their refunds are ignored as 'not-ours'.

### N4 (Minor) — an OPEN order can still change after its seats are counted
Once an OPEN order is counted, a line later removed or reduced on that still-open ticket keeps its counted seats. This is rare at the counter. Track it with the pos-needs-days/unmatched review.

Checked and fine:
- The webhook still answers 200. Class work runs in `waitUntil`, and `handleSquareEvent` catches everything. The `!` lookups (`:269`, `:439`) are guaranteed by construction. Unknown or missing money reads as 0.
- POS seats can't be double-counted: `recordPos` is idempotent by order + line uid + unit across the OPEN→COMPLETED order events and every tender's payment event, with the same `bkg_pos_<order>` booking id.
- Replaying a plain refund is a no-op. A crash part-way is finished by the replay (`already`/`carries`, `:384-410`).
- The replace in `recordRefund` removes only entries with by 'square' and this exact refund id, and resets 'refunded' back to 'confirmed' only when no refunds are left.
- The 20-refund cap still counts every refund (`refunds.ts:157` uses the full `priorRefunds(booking)`).
- Customer data stays out of logs and Slack.

## Implementer's concerns
1. **Mixed POS order (latte refund recorded against the class seat).** Minor, defer. The error is in the safe direction: we under-refund, never double-refund, and the flag shows it. Task 14's flag UI should say "this payment also covered other items".
2. **The replace is per class.** Minor, defer. Only POS payments that span classes are affected. It understates what is left to refund, never double-refunds. Note that it disappears if N1 is fixed with option (a).
3. **Split-tender refunds from /admin go to the first tender.** Minor, defer. Square refuses anything over that tender's amount, which is a clear failure and no double refund.
4. **The catalog cache can be up to 1 hour stale.** Minor, defer. The nightly run uses a fresh cache.
5. **Refunds window filters on created time.** Minor, defer. The webhook covers status changes. Could later add an updated-time filter.

## To approve
Fix N1 with tests. N2 is cheap and worth doing in the same round.
