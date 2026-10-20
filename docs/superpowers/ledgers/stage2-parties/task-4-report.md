# Task 4 report — party records v2, pricing, money, payments index

Status: DONE. Commit 4045106 on kaden/admin-d (not pushed). Base 179ba06.

## What changed
- `src/lib/party-store.ts`: PartyRecord gains every optional field from the brief (source, status, endIso, packageId, craftId, items, charges, refunds, payToken, paying, linkSent, cancelled, overlap, history). New `PartyItem`, `PartyCharge`, `PartyRefund` (defined here, `Cents` type-imported from parties/types), `isOurs`, `PARTY_HISTORY_CAP = 100`, `PartyNotFoundError`, `createPartyRecord` (create-only via `setIfMatch(null,false)`; lost → `{ kind: 'exists', rec: stored }`), `updatePartyRecord(id, fn, change, by)` (CAS ×3 on the record as just read; fn gets a structuredClone; null → no write, current returned; history appended, last 100 kept; bookingId pinned; missing or hidden-simulated-in-prod → PartyNotFoundError; 3 lost races → throws). `savePartyRecord` kept (doc: only the old book route).
- `src/lib/parties/pricing.ts` (pure; type imports only): `quoteParty`, `quoteAddOn`, `orderLineItems`, plus `QuoteItem`, `Audience`, `WHOLE_STUDIO_PACKAGE_ID`.
- `src/lib/parties/money.ts` (pure): `dueCents`, `paidCents`, `refundableOn`, `paymentState`, `claimPaying`.
- `src/lib/parties/party-payments.ts`: kv `party-payments`, `recordPartyPayment(paymentId, partyId, chargeId)` → `{ kind: 'created' | 'exists' | 'refused', entry }` (refused = already another party's/charge's; stored entry kept and returned), `partyForPayment(paymentId)` → entry | null; read errors throw.
- `src/pages/api/booking/fix-email.json.ts`: party branch → `updatePartyRecord(id, r => ({...r, hostEmail}), 'Host email changed', null)`; PartyNotFoundError is silent (same as old "no record → nothing").
- `src/lib/archive-stores.ts`: + `parties`, `party-payments`.

## Decisions (flag if wrong)
1. Package choice: `packageId` if given; else for public/link audiences the `linkPackageId`; else the first non-archived `everyone` package. `link` package allowed for public/link only when `linkPackageId === pkg.id`; `admin` package only for admin; `link`/`admin` audiences otherwise behave alike (online extras only for both non-admin audiences).
2. Add-on quantity: `addOns[id] = n` is "n per party" (per-party) or "n per guest" (per-guest; normally 1). Item `qty` = n × guests for per-guest, `unitCents` = the extra's price, `extraMinutes` = extra's minutes × n. 0 = skipped; negative/fraction/over maxQty → "You can add up to N <label>." with field `addOns.<id>`; unknown/archived/offline-for-public → "That extra isn’t available." Guests error "Parties are for 10 to 30 guests." field `guests`; package error "That party package isn’t available." field `packageId`.
3. `quoteAddOn` counts what the party already has toward maxQty (per-guest items counted as qty ÷ guestCount, min 1 — approximate if guests were later edited); refuses legacy ("This party was booked in Square. Change it there.") and cancelled parties.
4. `orderLineItems` got an optional 3rd arg `{ packageId }` (additive) so extras paid later on a pkg_whole party (no package item in the order) keep the "Whole Studio Party — " prefix. Task 9 should pass `rec.packageId`. Package line for other packages uses `pkgName` (falls back to the item label).
5. Line `note` = the package/extra id (e.g. `pkg_whole`, `add_bags`). Note: Square may print line notes on receipts — if Task 7/14 sees it on a receipt and dislikes it, change to a friendlier text (only this function).
6. `paymentState`: not ours → legacy; cancelled → cancelled; due 0 → paid; some item charged → partly; else waiting. Refunds never change it. `paidCents` uses what Square took (`charge.cents`), not the quote.
7. `claimPaying` on the same attempt refreshes `until` (now + ttl).
8. Item ids (`itm_`) are not minted here — `idFor`'s prefix type is `'bkg' | 'pty' | 'chg'`; Task 7 will need to add `'itm'` (or derive item ids another way).

## Tests
- New: tests/lib/parties/pricing.test.ts (19, incl. "items keep their price", browser-safe import check), money.test.ts (11), party-payments.test.ts (4, in-memory store).
- tests/lib/party-store.test.ts now uses an in-memory store with real etags (visibility tests kept): legacy read, create-only exists, update + history, lost race keeps a concurrent `charges` write, gives up after 3, null change writes nothing, missing/hidden → PartyNotFoundError, history capped 100, bookingId pinned.
- tests/api/booking-fix-email.test.ts: party test now asserts the updater keeps a concurrent `charges` write and savePartyRecord isn't called; missing party → 200.
- Brief's run set: 9 files / 134 pass. Full `npx vitest run`: 306 files / 4038 tests, 0 failures. `npx tsc --noEmit`: 0.

## Not touched
Task 3 files (parties/types.ts, party-times.ts, settings-store.ts and tests); the homegrownStudio-booking worktree.

## Fix round 1 (review task-4-review.md, ruling S2-R4a)

Commit: see `git log` — "fix(parties): extras remember their own count; top-ups charge only new guests" (on top of 6699015; Task 5 files untouched).

- `PartyItem` gains `count?` (what was chosen: 1 for a package, n per party, or n per guest), `forGuests?` (per-guest items: guests covered) and `topUp?: true`. `quoteParty`/`quoteAddOn` set them when pricing.
- Quota: `quoteAddOn` sums the stored `count` of the extra's non-top-up items; an older item with no count is derived once as before (per guest: max(1, round(qty ÷ guests)); per party: qty).
- Top-ups: `quoteAddOn(s, rec, addOnId, count, forGuests?)`. No `forGuests` → priced for every current guest (a new extra). With `forGuests` → a top-up for guests who joined later: per-guest extras only; the extra must already be on the party ("Add <label> for every guest first."); count ≤ the count already chosen; guests left = guestCount − (fewest guests any base item covered + guests earlier top-ups covered); refused when none left ("Every guest already has <label>.") or more than left ("Only N guests don’t have <label> yet."). Top-ups don't count toward maxQty.
- `quoteAddOn` errors always carry `field` (`addOns.<id>`, `forGuests`, `status`, `source`).
- `orderLineItems(items, pkgName, packageId)`: `packageId` required (string, not an options object); whole-studio naming decided by it alone. No call sites outside tests yet — Tasks 7 and 9 pass `rec.packageId` / the quote's package id.
- `createPartyRecord` / `updatePartyRecord` refuse an empty id ("A party needs an id.") before any read or write.
- Tests: 30 → 10 guests then add (quota from count, not 30 ÷ 10; a three-a-guest extra allows +2 for the 10 guests); an older item without count derives as before; 10 → 20 top-up charges 10 guests only, 11 refused, a second top-up refused, top-up doesn't use quota; top-up preconditions; field on every error; empty id. Full `npx vitest run`: 307 files / 4069 tests, 0 failures. `npx tsc --noEmit`: 0.
- Task 11 note: guest edits don't re-price; owners top up per-guest extras through `forGuests`.
