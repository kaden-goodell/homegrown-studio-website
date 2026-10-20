# Task 11b-B re-review 1: fix round 1 (`16e4ff1..717f45a`, worktree `homegrownStudio-admin`, branch `kaden/admin-d`)

- **Commits:** 0f0d3b5 (server), b267c20 (client), 717f45a (camera glyph).
- **Checks:**
  - `npx tsc --noEmit`: clean.
  - Admin suites (`tests/components/admin tests/api/admin* tests/lib/classes`, 31 files / 444 tests): 5 runs with nothing else going, then 3 more with `astro dev` running. **8 of 8 green.**
- **Hands-on:**
  - Server: `ADMIN_PASSCODE=review-only-123 astro dev --port 4338`, with the 11b-B seed in `.netlify/blobs-serve` (the same classes plus the unpaid counter seat).
  - The app ran in a same-origin iframe at 390×800, 820×800 and 1024×768.
  - An iframe `fetch` guard answered every POST with 503, except `link-library`, which is blob-only. For the Q3 stale test it returned a canned 409 stale on `update`.
  - Separately, curl sent `status:'draft'` creates and updates straight to the API. Drafts never call Square, so these tested the R35 replay paths.
  - The server log shows only local POSTs to `classes.json` and `login.json`. Nothing went to Square, email or texting.
- **Cleanup:**
  - The server is stopped and `.netlify/blobs-serve` is empty again; the test classes made through curl went with it.
  - The tab is closed and `git status` is clean at 717f45a.

## Verdict: **Needs fixes**: 1 Important (new) · 4 new quirks · 5 new Minor

All 3 Important, 16 quirks and 9 Minors from the first review are **fixed**. The new Important is a date bug in Run it again. It comes from code that was already there, but M9 now sends every past class to Run it again, which makes it the main path.

---

## Earlier findings

| # | Verdict | Evidence |
|---|---|---|
| I1 (R35) | **Fixed** | See "R35 hunt" below. Covered: the key is reserved before any write (`admin-actions.ts:275-286`), the same ids are used on each try (`:367,386`), `createId` returns an entry that already exists (`library-store.ts:58`), and replay calls `finishCreate` (`:305-320`). Hands-on: the client kept the same `createKey` on a retry after a 503. |
| I2 (R36) | **Fixed** | `linkToLibrary` uses `lib_`+sha(classId) (`admin-actions.ts:293-302`). It links on update (`:541-552`) and on open (`ClassSheet.tsx:111-121`). Hands-on: opening Candle Pouring (cancelled) and Two-Week Pottery sent `link-library`, and Candle Pouring showed up in Library. |
| I3 | **Fixed** | The counter row reads "1 seat · Not paid yet", and "taken so far" is $76.30 (Jane only, with comp, unpaid counter and refunded excluded). Counter sale shows "Refund this at the register". Past shows "2 bookings · 2 seats · $87.20". `takenCents` is at `booking-words.ts:37`. |
| Q1 | Fixed | The row and the panel agree (see the I3 evidence). |
| Q2 | Fixed | "Nobody has been refunded yet…" is worded from the data (`ClassSheet.tsx:418-422`). |
| Q3 | Fixed | Hands-on: I changed the name, the other owner moved the date to 5–7 PM and the price to $36, then got a stale 409. The note said "They changed: Price". The name I typed was kept. Dates refilled to 17:00–19:00, and Save dates stayed **disabled**. |
| Q4 | Fixed | The comp reads "Comped". `tel:`/`mailto:` links are present (screenshot at 820). |
| Q5 | Fixed | "Refund 1 person · $41.42?" |
| Q6 | Fixed | Text everyone scrolls its panel into view (the panel sat at top 139 in an 800px frame). |
| Q7 | Fixed | One date: Print opens with "‹ Back to Punch Needle Coasters", which reopens the class. Several dates: "Print which date?" lists both. |
| Q8 | Fixed | "Replace what you typed?" appears, and Keep mine keeps "My typed name". |
| Q9 | Fixed | `NewClassSheet.tsx:158`. Run it again shows a plain "Add class". |
| Q10 | Fixed | The New class default on Mon Oct 19 is Thu Oct 29. |
| Q11 | Fixed | `onChange` clears `toTell` (`ClassSheet.tsx:494`). |
| Q12 | Fixed | The hint "1 booked on this date…" shows. There's a wording side effect; see QN1 and QN2. |
| Q13 | Fixed | "1 booking on 2 dates", then the per-date list. |
| Q14 | Fixed | No Draft tag. The Past note is on top. |
| Q15 | Fixed | Camera glyph on the tiles and on the New class rows. For the ordering, see QN4. |
| Q16 | Fixed | "$35 a seat · 10 seats" and "Earlier versions (1)". |
| M1 | Fixed | The segment is kept in `sessionStorage`. `homeTabOf('class')` gives classes. |
| M2 | Fixed | `libraryRuns` prefers classes that aren't drafts. |
| M3 | Fixed | `useLibraryList(true)`; the picker filters archived entries out. |
| M4 | Fixed | `admin-actions.ts:520-523` |
| M5 | Fixed | Saving…, Adding… and Moving… show on the button that's working. |
| M6 | Fixed | `sendPhoto` calls `adminSignedOut()` on a 401. |
| M7 | Fixed, with a gap | `expectedVersion` gives a 409. See N4: the gap is worse than the report's "Save stuck disabled". |
| M8 | Fixed | The toast shows (wording: QN3). |
| M9 | Fixed | Past class Dates are read-only (`fieldset disabled`), with a note. This leads to N1. |

## R35 hunt (idempotent create)

- **Key reserved before writes:** Yes. `reserveCreate` runs before validation, the clash check and every write. A bad key gives 400 with nothing written (checked with curl).
- **Retry after a lost reply:**
  - The second call returns the class with `replay:true`.
  - The library `createId` returns the entry that already exists.
  - The Square create key is `cls-create:<classId>:<hash>`, and `findItemBySku` adopts an item made earlier, so finishing a missing POS sync can't make a second item.
  - A retry that lands **while the first request is still syncing** also syncs again. It sends the same object with the same key, so Square answers with the same item. **No second item.**
- **Concurrent requests with the same key:** correct by design, given that the store honours `onlyIfNew`. I ran 3 parallel curl creates with the same key against local `astro dev` and got **3 classes and 3 library entries**. The cause is the local blob emulator: it doesn't enforce `onlyIfNew`/etags (`blob-store.ts:26-33`), and the fs store used by the tests doesn't either. So this is unproven, not shown to be broken; see N3.
- **Retry after the class was edited or cancelled:** the server returns the current class as it is (checked: after a rename, the retry returned "Replay Test EDITED"). Nothing is overwritten. The client ignores `replay`, though; see N2.
- **Different sheets never share a key:** each sheet open remounts under `key={open.n}` (`AdminShell.tsx:383`), and `useRef(newKey())` makes a new key each time. The key is also renewed after a success.
- **The "This class and the library" path on retry:** the second try finds no differences from the version the first try saved, so it never adds a second version.

## R36 hunt (self-heal)

- **Two sheets open the same unlinked class at once:** you get one library entry. The id is deterministic, and the library's `mutate` uses `onlyIfNew`. The test at `admin-classes.test.ts:736` covers it.
  - Both requests write the same `libraryId`. One sheet then holds an older `updatedAt`; see N5.
- **The heal on open updates the sheet's `data.cls`:** a save right after opening doesn't hit a false stale. The pre-R21 case doesn't apply in production, because the class store isn't on `main` or `dev` yet.

## Money wording against /staff

Wording: `moneyWords` = `paidWay` (the same function `/staff/Roster.tsx:79` uses) plus the amount. The words and the totals agree on the row, in "taken so far", on Past and in the cancelled list. There's one data problem underneath; see N6.

## Flake

**Not reproduced.** The admin suites passed 8 times in a row, including 3 runs with `astro dev` up. Tests use their own temporary blob directory (`tests/setup.ts:9`), so they can't collide with the dev server's store. The implementer saw it during the dev server's shutdown, which points to a test timeout under CPU load rather than a test-order or shared-state bug. **No test is named.** If it happens again, record the test's name.

---

## New Important

### N1. Run it again fills in a date in the past, and nothing refuses a class in the past
**Where:**
- `DateRows.tsx:38-40`: `weekLater` = the class's own dates + 7 days
- `NewClassSheet.tsx:120`
- `checkRows` and server `okSessions`: no past check

**What happens:**
- Hands-on: Past → Paint Your Own Mug (Oct 10) → Run it again opens on **10/17/2026**, two days ago.
- Any class older than a week does this. Since M9, "use Run it again" is the only option a past class offers, so this is now the main path.
- If she taps Add class:
  - an open class is created in the past;
  - it is pushed to the POS;
  - it lands straight in Past;
  - the toast says "Added. It's on the calendar".

**Fix:**
- When `weekLater` would give a past date, move the dates forward by whole weeks until the first one is on or after `defaultDay()`. That keeps the weekday and the gaps between dates.
- Have `checkRows`, and ideally the server for `create`/`duplicate`, refuse a start in the past: "That date has passed. Pick a day from today on."
- Test: Run it again from a class 3 weeks old gives a future date.

## New Minor

- **N2. Replay ignores what was sent, and the toast doesn't say so.**
  - Where: `NewClassSheet.tsx:192-198`, which ignores `replay`.
  - Example: after a lost reply, "Didn't save", she fixes the price, or taps **Save as draft** instead. The server returns the first class unchanged (open, old price). The toast still says "Saved as a draft… goes on the website when you open it" while the class is open and bookable.
  - Fix: when `r.data.replay`, toast "This was already added on your first try. Check it below." and open the sheet as now.
- **N3. Nothing tests concurrent creates with the same key.**
  - The tests' fs store and the local emulator both ignore `onlyIfNew`, so the reservation's compare-and-set is only proven by reading the code.
  - `createClass` writes without a condition (`class-store.ts:63`). Using `setIfMatch(..., null, false)` there (create only) would give a second guard independent of the reservation.
  - Two syncs at once with a photo would each call `uploadImage` with a random key, which risks two images. Low.
- **N4. Library Edit details: a stale save followed by a failed refetch throws away the typing.**
  - Where: `LibrarySheets.tsx:146`. `useOne`'s `error` swaps `LibraryForm` for `<Failed>`, which unmounts the form. After Try again, the form opens on the fresh copy.
  - The note "Your edits are kept" is then untrue. The report's "Save stuck disabled" understates this.
  - Fix: keep the form mounted and show the load error inline above it.
- **N5. A `link-library` that loses a race leaves one sheet on an older `updatedAt`.**
  - Two sheets open the same unlinked class at once, and both write the link. The first sheet's next save gets "Someone else changed this class" with no "They changed:" list.
  - Rare, and it recovers. A fix is to skip the `updateClass` in `linkToLibrary` when a fresh re-read shows the class is already linked.
- **N6. A POS sale covering two door bookings counts its money twice.**
  - Where: `seat-ledger.ts:455,469`. Every door-counter line it settles gets the sale's whole class `chargedCents`, and `classBookings` takes `paidCents = first.square.chargedCents` (`admin-actions.ts:654`).
  - With two families rung up in one sale, each row shows the full sale amount, and "taken so far" and Past add it twice.
  - The code was already there, but it now feeds `takenCents`. Fix: per-line `paidOn` for door-counter lines, or split `chargedCents` per booking.

Accepted from the report:
- Create-key records are never pruned. They are tiny, one per Add. A later sweep of records older than 30 days would do.
- Opening a cancelled unlinked class links it (accepted in progress.md).

## New UX quirks

1. **QN1:** On a booked date, the hint says "it can't be removed while people are booked", but **Remove date N stays active**. The server refuses it at Save. Hide or disable Remove on a booked date (`DateRows.tsx:105`).
2. **QN2:** A past class's read-only Dates still show "Moving it asks first; it can't be removed…". Leave out the booked hint when `disabled`.
3. **QN3:**
   - Refund everyone with failures: the toast says "Refunded 0 of 1. **Open the class** to try the rest." while she is in the class.
   - "0 of 1" reads badly. Better: "None of the refunds went through. Try again below."
   - Say "Open the class…" only when the sheet was closed.
4. **QN4: Library order.** The fallback for a class with no runs is "last edited" (`ClassesTab.tsx:207`). So "Not run yet" entries jump above classes that actually ran: drafts, and old cancelled classes healed today. Hands-on: four "Not run yet" tiles sat above "Paint Your Own Mug, Last ran Oct 10". Sort entries that have run first, then the rest by last edit.

## Deviations judged
- The heal on open covers cancelled classes too: **accept** (R36 says any unlinked class).
- The replay skips the clash check: **accept**. Otherwise the class would clash with itself.
