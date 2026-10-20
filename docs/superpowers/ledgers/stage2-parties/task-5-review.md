# Task 5 review — the party book (commit 6699015)

**Verdict: Needs fixes** (2 Important, both small; the core lock is right).

Checks run (working tree also holds another agent's uncommitted Task 4 edits):
`npx vitest run tests/lib/parties tests/lib/classes/studio-schedule* tests/lib/party*` → 17 files, 267 tests, all pass. `npx tsc --noEmit` → 0 errors.

## What holds up (checked adversarially)
- **Atomicity across servers.** One CAS doc per studio-local month (`month-YYYY-MM`). Every party time in the month, any start, sits in that doc, and the check is `clashes({kind:'party'})` with a 60-min gap against every live hold, inside the CAS loop. So 1:00 and 1:30 (90-min parties) cannot both be held: the second writer's `setIfMatch` fails, it re-reads and sees the first → `taken`. The same goes for the extra half hour (`resizeTime` rechecks inside the CAS) and for a move racing a new booking (both CAS the destination month). The missing-doc case uses `onlyIfNew`, so two servers both creating the first hold of a month also serialize. The two-module race test really proves the cross-server path (no shared in-process lock).
- **Month boundary.** `endsByMidnight` (in `check`, so on hold, resize and move) means a party on day D ends ≤ 23:00 local. A party on D+1 starts ≥ 00:00, so the gap is ≥ 60 by construction. Two book parties that could clash always share a doc. Correct.
- **Expiry / sweep.** Expired holds are ignored by every reader (`holdsBetween`, `check`) and dropped on writes. `confirmTime` still finds an expired-but-unswept own hold and books it.
- **R6.** `confirmTime` never refuses: a swept hold comes back as booked (needs `endIso`), with `overlap` reported. It can still throw if the store is down, after 9 lost CAS rounds, or with no hold and no `endIso`. See M1, plus a note for Task 7.
- **busyBetween.** Fails closed: a party-book read error throws (tested). Held holds (10-min and link) block class saves. Blocked time now keeps 60 min from a party candidate (R11). Closed days stay plain overlap. Café keeps `CAFE_PARTY_GAP_MINUTES`.
- **Concern 5 (behaviour change).** Acceptable. No existing caller passes `kind:'party'` to `clashes` (only class saves in admin-actions.ts), so the R11 change only affects the new party path, where it matches the picker. The new dependency (every class calendar/save now also reads `party-book`) fails closed, on the same blob backend.
- **DST Nov 1.** `monthOf`/`endsByMidnight` use `localDate` on real instants. The 1 PM = 19:00Z test passes.

## Important

**I1 — `moveTime` to the same start silently deletes the party's only hold.**
If `to.startIso` equals `from.startIso` (an owner picks the party's current time in "Another time", maybe with a different end), the replay branch (`live.some(sameTime(h, partyId, to.startIso))`) returns `{ ok: true }` without writing. The documented caller sequence then runs `releaseTime(partyId, from.startIso)`, which removes the one hold. The party record still says booked, but the time is free on the schedule and can be sold again, which is a double booking. A different `to.endIso` is also silently dropped.
Fix (in party-book, not the caller): when `Date.parse(from.startIso) === Date.parse(to.startIso)`, refuse ("That's already this party's time.") or delegate to `resizeTime`. Keep the replay branch only for `from ≠ to` (retry after a successful move). Add a test.

**I2 — `extendHold` can shorten a hold, turn a no-expiry link hold into a 24 h one, and gives up silently (report concern 3).**
`extendHold` overwrites `holdExpiresAt` with `untilIso` unconditionally:
- On a payment-link hold (`holdExpiresAt: null`, never expires), an unclear outcome on the link payment (Task 9) makes it expire in 24 h. If the payment was in fact declined, or nobody resolves it, the party loses its time and the time can be resold.
- It can also move an expiry earlier.
- When the hold is gone, it returns `void` and does nothing. In Task 7's request the hold is seconds old at the charge, so a swept hold is near-impossible there. A delayed path (a later retry, or the link flow) can't re-create it, and the caller can't tell.
This is the same family as stage-1 final I1 (a paid booking with a lost answer loses its seat after 24 h). It is worse for parties: square-events skips `pty_` orders (Task 7), so no webhook or reconcile re-confirms a paid party, and with no record yet, Task 13's "Party with no hold" can't name it.
Fix: `extendHold(partyId, startIso, untilIso: string | null, endIso?)`:
- only lengthen (null = no expiry wins; keep the later of the two times);
- re-create a missing hold as `held` from `endIso` when it doesn't clash with the month's live holds;
- return `{ held: boolean }`, so Task 7 can say "time not kept" in the owner alert.
Consider having Task 7 pass `null` for unknown outcomes: hold until an owner resolves it, which Task 13's "Party hold with no party" warning already surfaces. That closes the after-24 h loss.

## Minor
- **M1 (do before Task 7):** make `confirmTime`'s `endIso` required. With it optional, a caller that forgets it throws after money is taken, which breaks R6 when the hold was swept. The brief's signature is `(partyId, startIso)`, so Task 7 will copy that and forget it. Also note in Task 7: `confirmTime` can still throw (store down, 9 lost rounds). The caller must catch it and still write the record (R6), with an owner alert.
- **M2:** the `holdTime` replay ignores a different `endIso` or `ttlMinutes`. Example: a 10-min hold replayed by a link hold (`ttl null`) stays 10-min, so the link party loses its time 10 min later. Or a replay with the extra half hour keeps the shorter end. On replay, update the end (rechecked) and lengthen the expiry, or refuse when they differ.
- **M3:** `check()` also tests the candidate against `others`, which (from `busyBetween`) contains stale copies of the book's own holds. So a real rival is reported as `clash` "Clashes with a party, Sun …" rather than `taken` (Task 7 maps `taken` → `slot_taken`). An expired/released hold in a stale read also refuses falsely. Drop `others` entries with `b.party` set inside `check`: the locked doc is the authority for book parties.
- **M4:** `moveTime` reads the from-month doc outside the lock/CAS. A concurrent `releaseTime` (a cancel) between that read and the write lets a cancelled party's hold be written at the new time. The record update/`paying` guard in Task 11 probably prevents it. Worth a comment, or re-check the old hold inside `mutate` when same month.
- **M5:** there is no cross-server race test for two *different* overlapping starts (1:00 vs 1:30). The logic is the same as same-start, but Review Focus #1 names this case. A 5-line addition to the two-module test would pin it.
- **M6:** `confirmTime` uses `new Date()` (no `now` param) while the rest take `now`. Fine, but it diverges from the brief.
- **M7:** a hung kv call holds the in-process month lock for every later write on that server. That's acceptable on serverless; noting it.

## Notes carried to later tasks
- Task 7: always pass `endIso` to `confirmTime`; wrap it for R6. Decide the unknown-outcome hold length (see I2). The parties have no webhook reconcile (stage-1 R42 analogue missing), so plan an owner path for "paid, unknown, never retried".
- Task 11: move must not offer the party's own current start (until I1 is fixed in the book).
