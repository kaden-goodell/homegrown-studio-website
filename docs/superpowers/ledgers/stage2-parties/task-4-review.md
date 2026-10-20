# Task 4 review: party records v2, pricing, money, payments index

Commits 179ba06..4045106. Reviewer: review-t4. Read-only.

## Verdict: Approved (one Important item to carry into Task 11, no blocker for Task 5)

Checks run:
- `npx vitest run tests/lib/parties tests/lib/booking-core tests/lib/archive-stores.test.ts tests/lib/party-store.test.ts tests/api/booking-fix-email.test.ts`: 12 files, 183 tests, all pass.
- `npx tsc --noEmit`: 0 errors.

## Requirements

| Requirement | Status | Where |
|---|---|---|
| New optional PartyRecord fields; legacy records load unchanged | Met | src/lib/party-store.ts:69-91; test party-store.test.ts:84 |
| PartyItem / PartyCharge / PartyRefund shapes as in the plan | Met | party-store.ts:93-136 |
| `createPartyRecord` create-only, `exists` returns the stored record | Met | party-store.ts:175-182 (`setIfMatch(null,false)`) |
| `updatePartyRecord` CAS x3, null = no change, throws when missing, history capped 100 | Met | party-store.ts:191-217; bookingId pinned, hidden simulated in prod → PartyNotFoundError |
| `isOurs` | Met | party-store.ts:141 |
| `savePartyRecord` kept, documented as legacy-only | Met | party-store.ts:153-156; only remaining callers are the old book route |
| pricing.ts pure / browser-safe | Met | type-only imports; test pricing.test.ts:179 |
| `quoteParty` package + guests + extras, audiences public/link/admin | Met | pricing.ts:55-89 |
| `quoteAddOn` | Met (see Important 1) | pricing.ts:92-103 |
| `orderLineItems`, `pkg_whole` keeps "Whole Studio Party — studio fee" | Met (signature extended, see Minor 1) | pricing.ts:112-127 |
| money.ts due/paid/refundable/state/claimPaying | Met | money.ts:15-49 |
| party-payments index, create-only, cross-party reuse refused | Met | party-payments.ts:23-33 |
| fix-email party branch uses `updatePartyRecord` | Met | fix-email.json.ts:51-58; test keeps a concurrent `charges` write |
| archive store list + `parties`, `party-payments` | Met | archive-stores.ts:41-43; archive test passes |

## Pricing correctness
- Package price from settings only; nothing in the request carries a price (test pricing.test.ts:110).
- Per-guest extras: `qty = n × guests`, `unitCents = priceCents`, `cents = qty × unitCents`. All integers (guests and n are checked integers, priceCents are integer cents from Task 3 settings), so no rounding can occur; the order lines (`quantity × pricePerUnit`) add up exactly to `totalCents`.
- Limits: negative / fraction / non-number counts refused, 0 skipped, `> maxQty` refused; guests checked against the package's own min/max; string guests ("10") refused. Unknown keys, archived extras, `__proto__`-style keys and array/string `addOns` all fall through to "That extra isn’t available."
- Audiences: `everyone` for all; `link` only when `linkPackageId === pkg.id` (or admin); `admin` only for admin; offline extras admin-only. Correct per plan.
- OWNER-1: `orderLineItems` returns name/quantity/price/note only, no tax or pricing_options. Task 7 must keep it that way when it builds the Square order.
- "Items keep their price" covered (pricing.test.ts:143); items are copies, nothing re-reads settings.

## Records and payments index
- CAS is on the record as just read, `fn` gets a structuredClone, history appended after `fn` (so a `fn` that rewrites history cannot drop the new line). fs dev mode falls back to unconditional write, same as every other store.
- Old Square-booked parties: `getPartyRecord` unchanged; `paymentState` → 'legacy', `dueCents` → 0, `quoteAddOn` refuses. Good.
- Payment index: create-only via `onlyIfNew`; same party+charge → `exists`; any other party or charge → `refused`, stored entry kept, logged as error. A read error throws rather than reading as "not a party". Good.

## Report concerns 1–6
1. Package choice fallback (packageId → linkPackageId for non-admin → first open `everyone` package): agree.
2. Add-on count meaning ("n per party" / "n per guest"): agree; it matches the plan's Task 8 test "a per-guest add-on follows the guest count".
3. / 4. Per-guest quota derived from `qty ÷ guestCount`: **Important 1** below.
5. Line `note` = package/extra id: acceptable now; agree with the report that a friendlier note may be wanted once seen on a real receipt (only this function changes). Minor.
6. `paymentState` ignores refunds; `paidCents` uses what Square took: agree (plan says refunds never change status).
7. Same-attempt `claimPaying` refreshes `until`: agree.
8. No `itm_` prefix in `idFor`: correct observation; Task 7 must add `'itm'` to the prefix union (plan line 49 names `itm_`). Flag it in the Task 7 brief.

## Important

1. **Per-guest extras: the quota is guessed from the guest count, and goes wrong once guests are edited (pricing.ts:97-99).** Task 11 lets owners change the guest count without touching item prices. Examples with goodie bags (per guest, maxQty 1):
   - Booked 30 guests with bags (qty 30), guests edited to 10: `have = round(30/10) = 3 > 1`, so the extra is "full" and any further add is refused even though it was bought once. Harmless in itself but the number is wrong.
   - Booked 10 with bags (qty 10), guests edited to 20: `have = 1`, so adding bags for the 10 new guests is refused; and if allowed, `quoteAddOn` would price `n × 20` (all guests again), not the 10 missing. There is no way to top up.
   Proposed fix (small, before Task 11 consumes it): store the chosen count on the item, e.g. `PartyItem.count?: number` (the `n` the host/owner picked; equals `qty` for per-party extras), set by `addOnItem`, and count `have` as `Σ (it.count ?? derived)`. Keep the derived fallback only for safety. Separately, Task 11 needs a decision on "guests went up after bags were bought": either `quoteAddOn` takes a units override for per-guest extras (`units = guests − units already bought`) or the plan says owners add those by hand. Not a blocker for Task 5, which does not use `quoteAddOn`.

## Minor
1. `orderLineItems` gained an optional 3rd arg `{ packageId }` (pricing.ts:112-115). Without it, extras paid later on a `pkg_whole` party (no package line in the order) come out as "Party — Goodie bags" instead of "Whole Studio Party — Goodie bags". Additive and tested, but Task 9's brief must say to pass `rec.packageId`; consider making it required to avoid a silent wrong name on the tax report.
2. `createPartyRecord` `exists` path (party-store.ts:179-181) returns the stored record without the `visibleHere` check that reads apply. Ids are random `pty_`, so a clash with a hidden simulated record is practically impossible; note only.
3. `createPartyRecord` does not refuse an empty `bookingId`. Callers mint ids, so low risk.
4. `quoteAddOn` returns an error without `field`, unlike `quoteParty`; fine for the admin sheet but inconsistent.
5. `paidCents` can in theory go negative if a refund names a missing charge; refunds are capped by `refundableOn`, so only bad data would do it.
