# Task 10 review: party refunds on the shared runner; refunds made in Square (commit 75261fd)

Verdict: **Needs fixes**. Two Important items, both small and neither about money. The money paths are sound: nobody is refunded twice, nothing refunds on its own, and every Square refund on a party is recorded once.

## Verification
- `npx vitest run tests/api/class-refund.test.ts tests/api/party* tests/lib/parties tests/lib/booking-core tests/lib/classes/square-events.test.ts tests/lib/classes/to-decide*`: 27 files, 492 tests pass.
- `npx tsc --noEmit`: exit 0.
- A temporary scenario test (deleted afterwards, tree clean) covered two cases.
  - "It went through" with no Square id, then Square's refund arrives through the webhook and again through the nightly run. Result: claimed twice as `ours`, one owner entry on the party, one email. A different Square refund of the same amount is still recorded as its own `square` entry.
  - "It didn't go through", but the refund had in fact gone through. The webhook records it as `square` money. Asking for the same refund again resends the same key, and Square's refund is adopted. The party ends with one entry and no double money.

## Requirements
| Requirement | Status | Where |
|---|---|---|
| refund-words split; classes/refunds re-exports; runner imports no kind | Met | booking-core/refund-words.ts:1-68; classes/refunds.ts:25-33; refund-runner.ts:21-24 |
| Static refund-books, unknown scope throws, holds claimSquareRefund; square-events imports it directly | Met | refund-books.ts:28-46; square-events.ts:44 |
| Party book implements every RefundBook field + write-side-only comment | Met | parties/refunds.ts:150-200; refund-books.ts:22-27; test refunds.test.ts:53 |
| Webhook passes class name from its list (old precedence) | Met | refund-runner.ts:349-353; classes/refunds.ts:276 (`opts.label \|\| cls name`); square-events.ts:486 |
| Party book: scope {party, partyId}; plan one charge ≤ refundableOn | Met | parties/refunds.ts:70-87 |
| PartyRefund keyed by request id + Square id; Square-recorded entry adopted, not added | Met | parties/refunds.ts:107-128 |
| Email with party label; audit party-refund / party-refund-checked | Met, but the copy is wrong for a party (I1) | parties/refunds.ts:186-198 |
| Owner route, crew route (reason ≥3, name logged) via shared partyRefundReply; GET list; clear action | Met | api/admin/parties/refund.json.ts; api/staff/party-refund.json.ts; parties/refunds.ts:282-344 |
| Legacy Square party refused (NOT_PAID_HERE) | Met | parties/refunds.ts:71, 233 |
| Caps: per charge (refundableOn), 20 per payment (any role) | Met | parties/refunds.ts:77-79 |
| handleRefund: party payment first; claim, else role 'square' by Square id (R26) | Met | square-events.ts:465-467, 566-603; parties/refunds.ts:261-275 |
| FAILED/REJECTED on ours → one refund-failed flag, party scope (R24) | Met | square-events.ts:577-582 |
| Nightly catch-up runs parties through the same handler (R25) | Met | square-events.ts:723 → handleRefund |
| flagUnconfirmedRequests covers party requests | Met | square-events.ts:753-776 (reads all `reqs-` docs) |
| To decide: "the Justice party", opens #party-<day>-<id>; unfinished/unconfirmed for parties | Met | to-decide.ts:158-186, 524-531; ToDecideSheet.tsx:95-105 |
| Party refund flags read right everywhere they are shown | **Partly (I2)** | warnings.ts:331-334 |
| Step-1 tests | Met. One test is missing: "It went through" followed by a late Square refund (minor m1) | tests/api/party-refund.test.ts, tests/lib/parties/refunds.test.ts, square-events.test.ts (+5), to-decide.test.ts (+2) |

## Class refunds unchanged (keys)
- `refundKeyRaw` and `refundKey` moved byte for byte: the same template, the same `:f<n>` suffix, the same sha256 and slice(0, 38). `planRefund` calls them with the same arguments. The cap message moved into `refundCapMessage()` with the same text. No pinned class test was edited, and class-refund passes.
- Class flag ids are unchanged: `flag(...)` still builds the id from the class id.
- One small difference: every class refund event now reads `partyForPayment` first. If that read fails, a class refund the webhook would have handled now throws. The webhook swallows the error and the nightly run tries again within 48 hours, so nothing is lost. Acceptable (m4).

## Registry: unknown scope throws
- **Legacy scopes.** A saved request's `classId` is only ever written by `runRefund` from `book.scope`. For classes that is `cls.id` from the class store. Every class id comes from `newId('cls')` (class-store.ts:153; admin-actions.ts:308 reserves `newId('cls')`; no other createClass caller passes an id). Parties are always `'party'`. The refund-request store is not on origin/main, so it never reached production. **No stored scope exists that is neither `cls_` nor `party`.**
- **Can the throw be reached on the webhook path?** Only through `claimSquareRefundWith`. There `found` comes from `listRefundRequests(b.classId, …)`, and `b` is supplied by the caller: a `cls_` class from the class store, or `'party'`. So the throw needs a corrupted request doc. If it did happen: the webhook logs it and returns null, so Square does not retry. The nightly run retries for 48 hours and then the refund drops out of its window, unrecorded, with only an error log. That breaks "every Square refund recorded".
- **Proposed hardening (Minor, cheap; keeps the binding throw for every other caller).** In `refund-books.claimSquareRefund`, catch an `UnknownRefundScope` error type thrown by `refundBookFor`. Log it as an error and return `false`. The caller then records Square's refund the usual way. For a class, `recordPlainRefund` raises a plain-refund To decide item. For a party, the refund is recorded as `square` money. The stuck saved request then becomes a `refund-unconfirmed` item after 24 hours. The refund is recorded, a person sees it, and nothing writes twice, because no book exists that could write that request later. `refundBookFor` itself still throws, so wiring misses in other callers still surface.

## Caps
- Per charge: `refundableOn` (charge minus every refund on it, Square-made ones included). Per party: the sum of the per-charge caps, which equals `paidCents` because a refund always names one charge. A pending request does not reduce `refundableOn`, but R29 stops a second request while one waits, and the `changed` check stops a stale plan. `stillFits` on a resend re-checks `refundableOn`.
- 20 per payment counts every refund role on that payment (parties/refunds.ts:64, 78). `stillFits` does not re-check the 20 cap on a resend. Square would refuse it anyway (m3).

## Crew reason and audit
- /staff needs a reason of at least 3 characters, for both the refund and the clear (parties/refunds.ts:285, 330). The actor is `byOf(member)` with the member's own role, so the request, the PartyRefund and the `party-refund` audit all carry their name and reason. Test at party-refund.test.ts:89.

## R29 blocking per party
- The scope is the party, so a request waiting on Square for charge A blocks a refund on charge B. This is acceptable and on the safe side. Parties have one or two charges (deposit and balance). The block lasts only until someone presses "It went through" or "It didn't go through", which any signed-in member can do from /staff, or an owner from To decide after 24 hours. Blocking per charge would reopen the `changed` and stale-plan race across charges for no real gain. The message says "on this booking", which reads fine for a party. Keep it.

## Idempotency by Square refund id
- Webhook and nightly run: `recordSquarePartyRefund` checks the Square id inside the compare-and-swap update, so a race records once. Ours: `writeRequest` matches by request id or Square id, so a racing claim writes nothing new. `markRequestDone` makes the audit happen once, and `claimRequestEmail` makes the email go once.
- "It went through" with no Square id: the later Square refund is matched by amount to the done, went-through request. Only the request learns the id, and the next event matches it by that id, so it shows once (verified above). The party entry keeps `squareRefundId: null`, which is cosmetic, as the report says. Optionally, `claimSquareRefundWith`'s done branch could call `book.write(found, refund.id)`: `writeRequest` already fills a null id in on the same entry (m2).

## Important

**I1. Party refund email uses class wording.** parties/refunds.ts:186-191 reuses `sendRefundEmail`. A cancelled party gets "We hope to see you at another class soon." The host is also told "for the Justice party", which is their own surname used as a label, when "your party" is what they would expect. This is customer-facing. Fix: add a `kind: 'party'` option, or a small `sendPartyRefundEmail`, with this wording (no colons, never "birthday", no bank timeline):
- `We refunded $50.00 to your card for your party on Saturday, November 14.` (the day from `startIso`, studio time; it falls back to `for your party.`)
- Still booked: `Your party is still booked, so we will see you then.`
- Cancelled: `We hope to craft with you again soon.`
- Keep `Questions? Text us at …` and the subject line. The audit and To decide labels stay "the Justice party". Update the test at refunds.test.ts:95 and party-refund.test.ts:152.

**I2. Party refund flags show as "A class" on the /staff warnings panel and in the daily warnings email.** warnings.ts:331-334 maps every refund flag through `nameOf(f.classId)`, which calls `getClass('party')`, gets null, and falls back to "A class". The warning also gets `eventKind: 'workshop'` and `eventId: 'party'`. A failed, unconfirmed or unfinished party refund therefore appears as "A class: Square couldn't finish a $50.00 refund." and links to a class that does not exist. Fix: when `f.classId === PARTY_SCOPE`, read the party record and use `partyLabel(rec)` as the title, `eventKind: 'party'` and `eventId: f.bookingId`. Add a warnings test.

## Minors
- m1. Add a test for "It went through" followed by a late Square refund on a party (the scenario verified above). It is the report's own concern and is currently untested.
- m2. Optionally fill in the party entry's `squareRefundId` when a late Square refund matches a request someone checked (see Idempotency above).
- m3. `stillFits` could also refuse when the payment is at the 20 cap, to give a clearer message than Square's refusal.
- m4. `partyForPayment` failing now blocks class refund handling for that event too. Acceptable, because the nightly run retries. Alternatively, catch the error and continue down the class path only when the payment index read fails for a class payment, but that cannot be told apart, so leave it.
- m5. `handlePartyRefund` with an index entry but no party record returns `ignored` with only an error log, so that Square refund is never recorded. Parties are never deleted, so this cannot happen today. A `refund-failed`-style flag would make it visible.
- m6. The unknown-scope hardening described under Registry.
- m7. In `partyRefundBook`, `label` prefers the record's surname over `opts.label`. That is fine and consistent, but it means the hint is used only for a host with no name.
