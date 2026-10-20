# Task 7 re-review 1 — fix round 1 (283f886..42caf7b)

Verified: `npx vitest run tests/api/party* tests/lib/parties tests/lib/booking-core` → 18 files / 306 pass; `npx tsc --noEmit` → exit 0.

## Verdict: Needs fixes (one new Important, small)

## Items

- **I1 — Fixed, with a new hole (N1).** Prior checkout is asked about first with its own request (`checkout.ts:461-480`, `recoverPaid(…, prior)` `:729-747`); paid → recorded, never charged; unaskable/other start → `in_progress`, nothing written. Key-reused path in To decide: Confirm refused with `ORDER_UNKNOWN_MESSAGE`, "It wasn't paid" allowed (`square-orders.ts:127-145,157-158`). Tests cover all four.
- **M1 — Fixed.** `held.replay` with no `mine` seen → `in_progress`, nothing released (`checkout.ts:549`). `holdTime` only reports replay for a *live* hold (`party-book.ts:184-189`), so a retry after an expired hold is not trapped.
- **M2 — Fixed** (`to-decide.ts:281-285`). Small: a throw from the new per-item `getPartyRecord` drops the whole "party payments" group via `safe(...)` (`:324`); catch per item and show it instead (N4).
- **M3 — Stands** for Task 8 (keep id on `in_progress`; reset on package/add-on change). N1 makes the package/add-on reset more important, but the server should not depend on it.
- **M4 — Fixed** for the creators (`checkout.ts:760-761,774-788`, `square-orders.ts:107`). Not "exactly once" in one race, see N3.
- **M5 — Fixed, leaks nothing new** (`book.json.ts:24-41`): read-only, UUID-validated attempt id, `status === 'booked'` only, same fields the open path already replays at `checkout.ts:408-411`. Small: the closed path skips the rate limit (`open && rateLimited`), so it is an unthrottled KV read; harmless at 2^122 guess space, optional to throttle.
- **M6 — Fixed** (`charge.ts:25-31`, plan lines).

## Hunted paths

| Path | Result |
|---|---|
| Leftover checkout, paid in Square | `recoverPaid(prior)` re-creates the same order (same key + same request) → paid → `recordPaidParty` (`createPartyRecord` is create-once, payment index idempotent) → no `chargeOrder` call. Cannot charge or record twice. OK |
| Leftover checkout, unpaid, same choices | Carries on with the same order request → same order id, same pay key; Square won't pay one order twice. OK |
| Leftover checkout, unpaid, **different package/add-ons/theme/craft** | **N1** below |
| "It wasn't paid" on a key-reused checkout, order actually paid | `notPaidUnclearParty` releases only this party's own hold (`releaseTime(partyId,…)`) and deletes the checkout. A later payment event / reconcile for that `pty_` order then finds no record and no checkout → `savePaidElsewhere` 'no-checkout' + owner text (`square-orders.ts:80-95`) → a To decide item. Never recorded over another booking, never silent. In practice the key-reused order was never charged (only reachable after decline / order-error / price-mismatch paths, which delete the checkout before any charge succeeds). Caveat: reconcile only looks back 48 h, so a payment older than that is only seen if its webhook arrived — acceptable. OK |
| M1 race | Second request sees A's live hold → `mine` branch, or no hold yet → `holdTime` replay → `in_progress`. Only one request reaches `createOrder`/`chargeOrder`. OK |
| M5 gate replay | see above. OK |

## Important

**N1. A leftover-checkout retry reuses the old order even when the customer changed package, add-ons, theme or craft — they are charged the old total, and the record/email/theme claim disagree.**
`checkout.ts:470-479` reuses `prior` whenever Square says unpaid and the start matches. Then: the order is `reuse.order` (old line items, old total, `:621`); the drift check compares old quote to old order (`:662`), so it passes; the draft is the old one (`:588`). But `finish` builds the email/announce/analytics from the *new* `input`, `craft` and `theme` (`:696`, `:796-835`), and `recordPaidParty` gets `theme: checkoutTheme` from the *new* input (`:589-591`, `:692`) while the old order may or may not carry the themed-table line. Results: the card is charged a different amount than the Pay button showed; the confirmation describes a different party than the record; with a new theme the table is confirmed without being paid for, with a dropped theme a paid table is never confirmed (its claim ages out).
Reachable when a try's checkout survives without its hold (crash mid-charge, or a decline/order-error whose `deleteCheckout` failed) and the retry changes package/add-ons under the same attempt id — today's modal does not reset the id on package/add-on changes (M3/Task 8), and a customer whose card was declined is exactly the one likely to pick a cheaper package.
Fix (small): before reusing, compare the new request with the prior one — the line items (ignore `customerId`), theme id, craft id and guest count (e.g. compare `lineItems` built from `q` + theme against `prior.order.lineItems`, plus `prior.draft.craftId/guestCount`). Same → reuse as now. Different (and Square said unpaid, no hold) → delete the prior checkout and refuse 503 `unavailable` ("start again"), so the client mints a new id; nothing is charged. Add a test: prior checkout unpaid, retry with another package → no `createOrder` with the old request, no charge, `unavailable`.

## Minor

- **N2. Different-start / unaskable prior → `in_progress` with no hold.** `checkout.ts:474`. If Square said unpaid and there is no hold, nothing needs a person; the customer is stuck on this id until an owner acts (the stale-charging item does show in To decide). Could delete the prior and answer `unavailable` when `recovered === 'unpaid'` and the start differs. Optional.
- **N3. Double email/announce/analytics in one race.** `finish` (`:791-835`) always emails, announces and reports, even when `recordPaidParty` returned `created: false`. If a concurrent same-key request takes the `mine` branch and `recoverPaid` records the payment the instant it completes, both send. Pre-existing for email/announce; M4 now adds a second `reportBooking`. Gate `finish`'s side effects on `paid.created` (return the stored answer otherwise).
- **N4.** Per-item `getPartyRecord` in `partyItems` (`to-decide.ts:283`): one failed read hides every party item. Catch per item.
