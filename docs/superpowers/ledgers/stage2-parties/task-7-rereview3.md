# Task 7 re-review 3 — fix round 3 (a2f96e5..6b1b19e)

Verified at 6b1b19e: `npx vitest run tests/api/party* tests/lib/parties` → 15 files / 264 pass; `npx tsc --noEmit` → exit 0.

## Verdict: Approved (no Important findings; minors optional)

## Items

- **N5 — Fixed.** `recordPaidParty` sets `threw` on any failed save and reports `created` when the retry then finds the record (`checkout.ts:288-296`, `:332`). The checkout is no longer cleared there; every creator calls `confirmationDone` after sending: `finish` (`:864`), `recoverPaid` (`:821`), `tellBooked` (webhook + To decide Confirm, `square-orders.ts:108`). `confirmationDone` notes `{at, sent}` on the record then clears the checkout (`checkout.ts:340-345`); with no record it keeps the checkout (`:341`). Replays now answer from `rec.confirmation.sent` (`:446`, `:820`, `:859`). Test covers "save lands then throws → one email, confirmation noted, checkout cleared".
- **N6 — Fixed.** Before letting an earlier try go: `unclear` → `in_progress` (`checkout.ts:519`); a live (unexpired, `holdsBetween` filters expiry, `party-book.ts:143`) hold of this party at the prior start → `in_progress` (`:520-524`); unreadable → refuse (`:525-528`). Because the earlier request holds its time before saving its checkout, a visible charging checkout always has a live hold for its first 10 minutes. Tests cover unclear, live hold and expired hold.
- **N7 — Fixed.** Let-go now saves a `retired` tombstone (`checkout.ts:532`); a same-id retry is refused with `CHOICES_CHANGED_MESSAGE` before any Square call (`:508`). Tombstones are dropped after 7 days on the next write (`party-checkouts.ts:80-82`). Test covers "no createOrder".

## Hunt

| Question | Result |
|---|---|
| Two creators → at most two emails, never zero | Only one `setIfMatch` create wins; a second caller is a creator only if it also threw before finding `exists`. Bounded by the number of concurrent paths (finish / recoverPaid / webhook / Confirm), and the webhook only acts on `unclear` or charging ≥5 min old, so in practice ≤2. Zero only if the process dies between record save and the send — same as before this diff (was zero then too), and the checkout now stays behind as evidence. OK |
| Tombstone blocks a new attempt (different id) | No. Tombstone is keyed by partyId (= attempt id); its hold was released (`:531`); To decide skips it (`to-decide.ts:278-279`: only unclear / paid-elsewhere / stale charging). The modal mints a new id on any plain 503-with-code (`PartyModal.tsx:673`). OK |
| Webhook finds a retired attempt's order paid | `square-orders.ts:74` no longer records from it (only `unclear` or stale `charging`), `:82` doesn't swallow it, so it falls through to `savePaidElsewhere` + owner text "Nothing was refunded. Open To decide" (`:84-96`). Flagged, never silent. OK (see M2 for wording) |
| An in-flight earlier request writes over the tombstone | Its later writes (`:737` order id, `:774` unclear) are `{...checkout}` with its own state. Only possible after its 10-min hold expired (N6 guard), i.e. a hung request; overwriting to `unclear` is the correct outcome anyway, and a paid finish clears it via `confirmationDone`. OK |
| Leftover checkouts after a crash | Crash between record and `confirmationDone`: a `charging`/`unclear` entry stays. To decide hides it because the record has charges (`to-decide.ts:284-287`); webhook ignores it (record exists). Never pruned, but only arises on a process death mid-request. Acceptable (see M1). |
| `confirmationDone` failing | Note-on-record failure is caught and logged; checkout still cleared. Replay then says `emailSent: false` though the email went (cosmetic). OK |

## Important

None.

## Minor (optional)

- **M1. A crash after the record is saved but before the email leaves the party with no confirmation and nothing showing it.** The left checkout is hidden by To decide because the record has charges. Cheap follow-up: in `partyItems` (`to-decide.ts:284-287`) keep showing a stale checkout whose record has charges but no `confirmation` ("Booked, but the confirmation may not have gone out"). Not a regression.
- **M2. Wording of the paid-retired flag.** For a retired attempt the owner text and To decide say "there is nothing here to book it from" (`square-orders.ts:92`, `to-decide.ts:297`), but the tombstone still holds the full draft. Accurate enough to act on (check Square); could say "the customer changed their choices and started again".
- **M3. Replays of older records** (saved before `confirmation` existed) now report `emailSent: false` (`checkout.ts:446`). The page only uses it for a "we couldn't email you" style hint. Cosmetic.
- **M4. Test gaps:** no test for the webhook on a `retired` checkout (should flag, not record), or for the 7-day pruning.
