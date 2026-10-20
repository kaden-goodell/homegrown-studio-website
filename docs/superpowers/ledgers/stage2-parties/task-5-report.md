# Task 5 report — the party book (locked holds on the shared schedule)

**Status:** DONE. Commit `6699015` feat(parties): locked party holds on the shared studio schedule (on kaden/admin-d, not pushed).

## What was built
- `src/lib/parties/party-book.ts` (kv `party-book`, key `month-YYYY-MM` by studio-local start month): `PartyHold`, `holdsBetween`, `holdTime`, `confirmTime`, `extendHold`, `releaseTime`, `resizeTime`, `moveTime`, plus `holdBusy(h)` (hold → `Busy` with `party: { state, partyId }`) and exported types `HoldResult`.
  - Every write: in-process per-key lock + `getWithMeta` / `setIfMatch` CAS, 3 attempts (confirm: 9). Expired holds swept on write.
  - `holdTime`: replay when the same party already holds the same start; month's other live holds → `taken` ("That party time was just taken. Please pick another time."); `others` → `clash` with `clashMessage`; end + 60 past local midnight → `clash` "A party and its hour of cleanup have to finish by midnight."; `ttlMinutes: null` = no expiry (payment link). Throws on read error or end ≤ start.
  - `moveTime` writes the new time only (state/expiry copied; the party's own old hold never blocks its move); the caller updates the record, then `releaseTime(partyId, from.startIso)`. Refuses when the party has no live hold at `from`.
  - `releaseTime` removes held or booked.
- `studio-schedule.ts`: `Busy.party?`; `partyBusy` now exported = party-book holds ∪ existing Square read (deduped by id, book first; either failing throws, so `busyBetween` fails closed); party candidate vs `blocked` keeps 60 min (R11); all party gaps use `PARTY_CLEANUP_MINUTES` (dropped `partyConfig` import). Closed days stay plain overlap.
- `archive-stores.ts`: + `party-book`.

## Tests
- `tests/lib/parties/party-book.test.ts` (22): the fs kv is wrapped with real per-key CAS (atomic version etags). **"concurrent holds"** loads two separate module copies of party-book (two servers, no shared in-process lock) and races them on one start → exactly one ok, the other `taken`, exactly one write, and one conditional write really lost. Also: same-server race, 1:00 + 3:30 fit (90-min party, 150 step), extra time clashes both ways, class clash names it, R11 blocked 60, no-crossing-midnight, expiry, link holds never expire, confirm (idempotent; lost+resold → booked with `overlap: true`; lost with no rival → re-created), extendHold 24 h, release, resize, move within month + Oct→Nov, Sun Nov 1 2026 real instants (1 PM = 19:00Z), read error throws.
- `studio-schedule.test.ts`: party vs blocked 60 either side; `partyBusy` lists holds with `party.state` plus the legacy booking; party-book read error makes `busyBetween` throw.
- `npx vitest run`: 307 files, 4064 tests, 0 failures. `npx tsc --noEmit`: 0 errors.

## Deviations / notes for later tasks
- **`confirmTime(partyId, startIso, endIso?)` returns `Promise<{ overlap: boolean }>`**, not `void`: the brief's comment says it "returns overlap info" and Task 7 needs `overlap: true`. The optional `endIso` is required to re-create a hold that was swept (no other way to know the end); without it and no hold in the book it throws. Task 7 should always pass `endIso`. It judges other holds by the real clock (no `now` param, per the signature).
- `confirmTime` overlap only checks other party holds in the book, not classes/blocked; callers wanting that pass through `clashes` themselves.
- `extendHold` is a no-op when the hold is already gone or booked (cannot re-create without an end).
- Hold labels in `Busy` are "a party" (no host name in the book); Task 6 may relabel from records.
- `busyBetween` / `partyBusy` use `new Date()` for hold expiry (`partyBusy` takes an optional `now`).
- Fs-mode `setIfMatch` without etags is last-write-wins across processes (existing blob-store behaviour); in-process lock covers local dev, Netlify Blobs etags cover production.
- Did not touch Task 4 files.

## Fix round 1 (review task-5-review.md; ruling S2-R5a: holds only ever get longer, a paid party's time is never lost)
Only `src/lib/parties/party-book.ts` and its tests (`tests/lib/parties/party-book.test.ts`, `tests/lib/classes/studio-schedule.test.ts` call sites) changed.
- **I1** `moveTime` refuses when `from.startIso === to.startIso`: "That's already this party's time." (end changes there go through `resizeTime`). The retry-replay branch is kept for from ≠ to only. Tested: the hold stays.
- **I2** `extendHold(partyId, startIso, untilIso: string | null, endIso, now?) → { held: boolean; clash?: string }`. It only lengthens (null = no expiry wins; otherwise the later time), so a payment-link hold stays never-expiring and a booked time is `held: true`. A hold that ran out, or is gone, is rebuilt from `endIso` as held when the month's live holds don't clash; otherwise `held: false` with the sentence. Tested: never shortens, null on an unclear outcome, link hold kept, rebuilt after expiry, refused when resold, booked.
- **M1** `confirmTime(partyId, startIso, endIso, now?)`: `endIso` is now **required**. It never throws for a paid party on a clash or sweep: it books, keeps the later of the stored and given ends, and returns `{ overlap }`. **It still throws on store failures** (down, timed out, 9 lost write races). **Task 7 must catch that and still save the party record, with an owner alert (R6).**
- **M2** A repeat `holdTime` for the same party and start is a replay that only grows. A later end is rechecked and kept (refused `taken`/`clash` if it would clash). A longer expiry is kept (null wins). A shorter end or expiry is ignored.
- **M3** `check()` drops `others` entries that have `party` set (stale copies of book holds). The locked month doc is the only source for book parties, so a real rival is `taken`, and a released stale copy no longer refuses.
- **M4** `moveTime` reads the old hold inside the lock: same month in the same read-modify-write as the new time; across months under the old month's lock just before. The residual cross-month race with a cancel is documented (an extra hold the daily warning names; Task 11 guards keep move and cancel apart).
- **M5** Cross-server race test with two module copies, 1:00 vs 1:30: exactly one wins, the other is `taken`, one CAS lost.
- **M6** `confirmTime` and `extendHold` take an optional `now`.
- **M7** Every store call inside the month lock goes through a 10 s timeout ("The party book did not answer in time."), so a hung call can't block the month. Tested with a hanging read (`_setStoreTimeoutMs` test hook): the hold throws, and the next write goes through.
- Notes for later tasks: Task 7 always passes `endIso` to `confirmTime` and catches its store errors. For an unknown outcome, consider `extendHold(..., null, endIso)` (hold until an owner resolves it) and put `held: false` in the owner alert.
