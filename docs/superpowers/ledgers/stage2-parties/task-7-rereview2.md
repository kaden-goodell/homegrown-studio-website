# Task 7 re-review 2 — fix round 2 (42caf7b..a2f96e5)

Verified: `npx vitest run tests/api/party* tests/lib/parties` → 15 files / 261 pass; `npx tsc --noEmit` → exit 0.

## Verdict: Needs fixes (one Important, small)

## Items

- **N1 — Fixed.** `sameChoices` (`checkout.ts:125-131`) compares start, the full order lines built by the same `orderLines(q, theme)` used for the real order (`:115-120`, `:640`), craft, guests and themed-table id. Unpaid + different → hold released, checkout deleted, 503 `unavailable` + `CHOICES_CHANGED_MESSAGE` (`:495-506`); the old order is never charged. Test covers it.
- **N2 — Fixed** (same branch: start is part of `sameChoices`). Test covers it. See N6 for one race this opens.
- **N3 — Fixed for the race it targeted** (`checkout.ts:827`). Every other creator (`recoverPaid` `:769-783`, webhook `square-orders.ts:79`, owner Confirm `:161`) sends when it creates. But see **N5**: "only the creator sends" can now leave a paid party with no message at all.
- **N4 — Fixed** (`to-decide.ts:284-287`). Test covers it.

## Comparison hunt

| Case | Result |
|---|---|
| Extras quantities, guest-dependent extras | Lines carry `quantity` + `pricePerUnit` per item; per-head lines scale with guests; guests also compared directly. Caught. |
| Package audience / link package | They only change price through `quoteParty` → items → lines (name, price, note=refId). Caught. |
| Themed table | Theme line (variation id = theme+serves, price) in lines; `themeId` compared against `draft.theme.themeId` (`:233` stores it there); week depends on start, compared. Caught. |
| Owner changed a price/label in Parties setup between tries | Lines differ → let go + "Something changed". Safe direction (old order never charged at a stale price). OK |
| Customer id | Not in `lineItems`; not compared. No false difference. |
| Whitespace / host details | Not compared at all, so no false difference. (Reuse keeps the earlier host/draft — pre-existing, not price.) |
| Key order / undefined fields in stored JSON | Same builder both sides; `JSON.stringify` drops undefined on both. OK |
| `!prior.order \|\| !prior.draft` | Dead: `recoverPaid` returns null for those, so `:494` already answered `in_progress`. Harmless. |

## Race hunt (letting the earlier try go while its payment is in flight)

- **Same start:** the earlier request holds the time before it saves its checkout (`:576` then `:661`), so whenever its checkout is visible its hold is live (10 min) and the `mine` check (`:462`) answers `in_progress` before this branch. Safe.
- **Different start:** see N6. Reachable only by a client that keeps the id across a time change; the modal resets it (`PartyModal.tsx:251-253`).

## Important

**N5. "Only the request that created the record sends" leaves a paid party with no email, no owner text and no analytics when the record write succeeded but reported an error.**
`recordPaidParty` retries `createPartyRecord` (`checkout.ts:287-293`). If the first `setIfMatch` wrote the record but threw (a timeout after the write landed), the retry gets `exists` → `created: false` (`:328`). The checkout is then deleted (`:327`, `saved` is set), so no webhook/reconcile/owner path will ever send either. `finish` takes the new replay branch (`:827`) and also tells the page `emailSent: true`. Before this diff `finish` always emailed, so this is new on the main card path. The same applies to the webhook and Confirm paths (already gated in round 1).
Fix (small): in `recordPaidParty`, count it as created when an earlier attempt in this same call threw and the retry found `exists` (`created: saved?.kind === 'created' || (threwBefore && saved?.kind === 'exists')`). Worst case is a second email in a double-rare race, never none. Add a test: first `createPartyRecord` writes then throws → one email, one report, one owner text.

## Minor

- **N6. Different start, same attempt id, earlier request still charging → its live hold is released and its checkout deleted mid-charge.** `mine` only looks at the *new* start (`:462`), so request A's hold at T1 isn't seen. B asks Square (not paid yet), releases T1 and deletes A's checkout (`:500-501`), answers "Nothing was charged". A then charges and `recordPaidParty` books it without a hold (overlap + owner text if someone took T1 meanwhile); A still emails. Not reachable from today's modal (id resets on time change). Same branch also deletes an `unclear` checkout whose no-expiry hold failed to save (rare) if Square hasn't settled yet, and tells the customer nothing was charged; a late payment then surfaces as a "paid elsewhere" item, not silently. Guard (one check): before letting go, if `prior.state === 'unclear'`, or a hold of this party exists at `prior.startIso`, answer `in_progress` instead.
- **N7. After "Something changed", a client that retries with the same id** sends a new order request under the old order's idempotency key → `IDEMPOTENCY_KEY_REUSED` → unknown outcome: owner text, time held with no expiry. The modal mints a new id (503 with a `code` is not "unknown", `checkout-messages.ts:57-65`), so not reachable today. Optional: keep a small tombstone (or keep the old order request) so a same-id retry is refused plainly.
- `finish` replay (`:827`) returns `emailSent: true` even when the creator's email failed. Cosmetic.
