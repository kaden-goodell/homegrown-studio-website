# Task 7 review — party checkout (/book: one order, one charge, no Square booking)

Commits bae0412..283f886. Verified: `npx vitest run tests/api/party* tests/lib/parties tests/lib/booking-core` → 18 files / 300 pass; `npx tsc --noEmit` → exit 0.

## Verdict: Needs fixes (one Important, small; the rest of the money path holds)

The core is sound: party id from the key (R35) + stable Square idempotency keys mean no path can charge twice; prices, craft and length come only from settings/catalog; holds are CAS on the month doc and fail closed; R6 (paid → always recorded, overlap flagged) holds through confirmTime failure, record-write failure (checkout kept, webhook/To decide can record later) and lost holds; drift rule matches R14; declined releases; unknown keeps the time with no expiry and alerts with the party id; `pty_` orders skip the catalog; createBooking is never called; no host-page or fix-email path still reads Square bookings.

## Paths traced

| Path | Result |
|---|---|
| Retry same attempt, already recorded | stored answer, `replayed`, no Square call. OK |
| Retry same attempt, hold live (charging / unclear) | `recoverPaid` re-creates the exact stored order → paid → recorded once (one email via `created`); unpaid/unaskable → 409 `in_progress`. OK |
| Retry same attempt, hold expired, time free | treated as first attempt (R17); same order request → same order; new token → pay key reused → `findOrderPayment` → paid recovered. OK. Different request → see I1 |
| Retry same attempt, hold expired, time resold | `recoverPaid` → paid → recorded with `overlap` + alert (R6). OK |
| Concurrent duplicate submits, same key | both can pass the `mine` check; `holdTime` returns `replay:true` and is not treated as in-progress (M1). Money safe (same keys) |
| Hold expiry mid-checkout | 10 min ≫ function timeout; crash after charge → webhook ignores <5 min, nightly reconcile / To decide (15 min) / same-key retry record it. OK |
| Declined | hold + theme claim released, checkout deleted, 402, time offered again. OK |
| Drift +50/−50 | charged Square's total, owners emailed. +150 → released, nothing charged, owners texted, 503. OK |
| Store failure after charge | confirmTime throw → record still saved + alert; record write fails twice → alert, checkout kept → webhook/To decide records later; index write retried + alert. OK |
| Webhook/reconcile `pty_` | recorded → nothing; paid + unclear/stale checkout → recorded once; in-flight left alone; nothing to record from → paid-elsewhere once + text. OK |
| To decide "It wasn't paid" | refused while Square shows the checkout's order paid; same idempotency key means the checked order is the only order that key can make, so a paid time can't be released. But see I1 (item can be unresolvable) |
| Bookings gate / R41 | gate first (403, today's behaviour); R41 after the read-only replay, before any write; host from request URL. OK |
| Gift card / Apple Pay | pre-check before hold unchanged; Apple Pay is a card token. OK |

## Important

**I1. An unclear party whose order id was never learned can't be resolved, and its time is held forever.**
`bookParty` → `createOrder` throws `IDEMPOTENCY_KEY_REUSED` → `unknownOutcome(checkout, null, …)`: hold with no expiry, checkout 'unclear' with `orderId: null` and `order` = the *new* request. In To decide, both "Confirm" and "It wasn't paid" go through `paymentOf`, which re-sends `c.order` — the request Square just refused for key reuse — so it throws every time → 503 "Couldn't reach Square". The owner has no way out; the party time stays blocked indefinitely (no party record exists, so there's no /admin party page to cancel from either). Reachable when a same-key retry arrives after the first try's hold is gone (a response lost after a decline, or a crash mid-charge, then a later retry) and something in the order request changed: customer lookup failed on one try and succeeded on the other (customer lookup is now "not fatal"), or an owner changed a price in between. The same retry also overwrites the first try's checkout (`saveCheckout` replaces by party id), so the first request is lost.
Fix (small): in `paymentOf`, when `orderId` is null and re-sending the order is refused for key reuse, let "It wasn't paid" go ahead (the owner has checked Square; the nightly reconcile still records/flags any paid `pty_` order) and keep "Confirm" refused; and/or before `saveCheckout`, if a checkout for this party already exists, run `recoverPaid` on it first and keep its order request rather than overwriting it. Add a test for the key-reused order path (none exists).

## Minor

- **M1. Concurrent same-key submits.** `holdTime`'s `replay: true` on a request that found no `mine` hold means another request with this key is mid-flight; treat it as `in_progress`. Today both proceed; money is safe (same Square keys), but if Square answers the concurrent duplicate payment with a 4xx, the loser takes the "declined" branch and releases the hold + deletes the checkout while the winner charges (confirmTime re-books it, R6, small resale window), and a different `findOrCreate` result sends the loser down I1.
- **M2. Leftover checkouts show as "unclear" for recorded parties.** If `deleteCheckout` fails after the record is saved (or a concurrent loser re-saves 'unclear' after the winner deleted it), `partyItems` lists a paid, recorded party as "got no answer". Harmless (Confirm is idempotent, Not-paid is refused) but noisy; skip items whose party record exists with a charge.
- **M3. Unpaid unknown = customer stuck until an owner acts.** With the no-expiry hold, a same-key retry gets `in_progress` forever and a new attempt gets `slot_taken`. Accepted by S2-R5a; just make sure Task 8's `in_progress` wording points to texting us, and resolve the conflict between the plan's Task 8 note ("409 in_progress is a known outcome" → new id) and this report's request (keep the id on `in_progress`). Keeping the id is the safer choice: a new id after an actually-paid try can lead to a second charge for another time.
- **M4. Recovered bookings skip analytics.** `recoverPaid` (and webhook recovery) send the email and `announceBooking` but no `reportBooking`/emailCheck. Fine; note for the analytics numbers.
- **M5. Gate before replay.** A paid customer retrying after the bookings gate closes gets 403 instead of their stored confirmation. Rare; could check the record first.
- **M6. Docs drift.** Plan Review Focus #2 and `UNCLEAR_HOLD_HOURS` still say 24 h; parties use no expiry. Update the plan line.
- **For Task 9:** `handlePartyOrder` flags any paid `pty_` order whose record exists but whose payment isn't in `charges` as paid-elsewhere 'other-payment'. Link-payment orders will look exactly like that; Task 9 must route them before this branch.
- **For Task 8:** the modal resets the attempt id on slot/craft/people/theme; it must also reset on package and add-on changes, or a changed order under a reused key lands in I1.

## Concerns 1–6

1. No expiry on unknown (vs brief's 24 h): **accept** — task-7-extra is binding (S2-R5a). Fix the plan text (M6).
2. New `party-checkouts` store: **accept** — needed for R6/R42 on parties; archived; contention on one doc fails closed before the order. Watch the I1 overwrite.
3. Statuses (order failure / price mismatch 503, gate 403, customer lookup non-fatal): **accept** — codes stay `unavailable` (known, not charged), the client mints a new id correctly. Note non-fatal lookup feeds I1.
4. `variationId` = default package id: **accept** — keeps open pages loading; server ignores it.
5. Admin card: email, no announce/analytics; link: nothing sent: **accept**.
6. Party-local R41 copy, integration test can't force non-dev: **accept** — rule unit-tested, call site is before every write; consolidate at merge.
