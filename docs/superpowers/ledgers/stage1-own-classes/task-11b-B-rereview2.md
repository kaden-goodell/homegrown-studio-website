# Task 11b-B re-review 2: fix round 2 (`717f45a..e35305d`, worktree `homegrownStudio-admin`, branch `kaden/admin-d`)

- **Commits:** 0f66aab (server), e35305d (client).
- **Checks:** `npx tsc --noEmit` clean. `npx vitest run`: 283 files, **3650 passed, 0 failed**.
- **Hands-on:** not run this round (optional). Every item was checked by reading the code against the scoped hunts below; the client paths each have a new test. Nothing was started, so there is nothing to clean up. `git status` is clean at e35305d.

## Verdict: **Approved**, with 0 Important · 3 new Minor

All of N1–N6 and QN1–QN4 are fixed. None of the scoped hunts found a regression.

## Earlier findings

| # | Verdict | Evidence |
|---|---|---|
| N1 (R37) | **Fixed** (see RM1 for a wording gap with R37) | The server has `noPastStarts` (`admin-actions.ts:110-117`) on create (`:386`), duplicate (`:446`) and update (`:528`, and only when `sessions` is sent). The client uses `onOrAfter` (`DateRows.tsx:48-54`) in Run it again (`NewClassSheet.tsx:120`). The server's refusal shows under the dates (test). |
| N2 | Fixed | `NewClassSheet.tsx:200-204`. On a replay that differs from what was sent, the toast reads "This class was already added. Here it is." Every other toast follows `made.status`, so it never says "draft" for an open class. |
| N3 | Fixed | `createClass` is create-only (`class-store.ts:64`, `ClassExistsError`). The fs store honours `exists=false` with `wx` (`blob-store.ts:157-168,201`). The parallel test gives 1 class and 1 library entry. |
| N4 | Fixed | `LibrarySheets.tsx:147,154,217`. The form stays mounted, the error shows inline with Try again, and Save is disabled while `fetching`. |
| N5 | Fixed | Server: `linkToLibrary` reads the class again and skips the write when it is already linked (`admin-actions.ts:322-324`). Client: `keepAfterStale` returns the fresh `updatedAt` and re-sends once, only when no content (`contentChanges`), status or sessions changed (`ClassSheet.tsx:207-218`). A second stale shows the note (`retried`). |
| N6 | Fixed | `paidOf`/`chargedFor` (`admin-actions.ts:89-94`) count counter lines by their own price and tax. Used in `groupBookings` (`:701`) and `bookedPeople` (`:617`). |
| QN1 | Fixed | `DateRows.tsx:125-127`: "Has bookings" in place of Remove. |
| QN2 | Fixed | `DateRows.tsx:112`: `!disabled`. |
| QN3 | Fixed | `ClassSheet.tsx:294-295`, using `mounted.current`. "Refunded 0 of 1." is kept (the suggested rewording was optional). |
| QN4 | Fixed | `ClassesTab.tsx:207-217`. The order is ran (newest first), then coming up (soonest first), then not run yet (latest edit first). |

## Scoped hunts

**The past-date refusal doesn't block editing a class with earlier sessions.**
- Details saves send no `sessions`, so the check never runs (`:528`).
- Dates saves resend every row. An unchanged session is skipped by id plus `startIso`/`endIso` (`:113`).
- **Is the "unchanged" match reliable?** Both sides go through `validateSessions` → `toIso` (`validate.ts:37-41`), which gives `new Date(ms).toISOString()`, so an offset or a millisecond difference can't make a false "changed".
- The client rebuilds the ISO from `partsOf` → `toIsoAt` in studio time, with the same id (`rowsOf` keeps `s.id`). Every stored class comes from `scheduleClass`/`duplicateClass`, and `createClass` has no other callers, so starts are always whole minutes. The round trip is exact, apart from the repeated 1–2 AM hour in November, when the studio is shut.
- A past session whose seats are changed is still allowed (capacity isn't compared). The server test covers saving a past class with its date unchanged plus a status change.
- **Door sales and legacy flows:** not affected. Door seats, POS sales and refunds write to the ledger, not to these three actions. `classes.json.ts:34-36` is the only route into them.

**Create-only writes don't break updates.**
- `updateClass` still writes with `etag, true` (`class-store.ts:111`).
- Every `mutate`-style caller passes `value !== null` (waiver, event-meta, kit, checkin, open-studio, ledger, refund-requests, library). On the fs store, a first write is now an exclusive create. A loser returns false and retries, which reads the winner's value. That is the intended behaviour, and the full suite is green.
- Production uses the Netlify store path, which this diff doesn't change.

**A clash with itself treated as a replay can't hide a real clash.**
- The clash catch only returns a replay when `getClass(reserved.classId)` exists (`:389-394`). That id is reserved for this exact create key, so the Add has already happened and returning it is the correct idempotent answer. The class that exists passed its own clash check when it was written.
- With no key, or when the reserved class doesn't exist, the clash is thrown as before.
- `ClassExistsError` → `finishCreate(getClass(e.id)!)` is safe, because the error only fires when the key exists.

**N6: the split sums exactly to the sale.**
- `recordPos` units come from `splitCents(total - tax, qty)` and `splitCents(tax, qty)` per line (`square-events.ts:288-294`). `splitCents` hands out the remainder, so each line's units sum exactly to `total_money`, which is after discounts.
- The sale's `chargedCents` is the sum of those line totals for the class (`:296`).
- Seats from the door that a sale claims take that sale's unit price and tax (`seat-ledger.ts:466-468`). Summed across bookings, the result equals `chargedCents` to the cent.
- One edge: a door-counter seat that carried add-ons at the door now also counts its `addOnCents`, which aren't part of the sale's class-only `chargedCents`, because POS add-on lines aren't attached. That money was really taken at the register, so this reads as more correct, not less.

## New Minor

- **RM1. Run it again's lower bound is a week out, not "from today".** The fix calls `onOrAfter(..., defaultDay())`, and `defaultDay()` is today + 7, then the next open day (`NewClassSheet.tsx:34-37`).
  - Example: on Mon Oct 19, Run it again for last Saturday's class (Oct 17) used to give Sat Oct 24. That date is in the future and fine. Now it's pushed to Oct 31, which is the Halloween closure, so it lands on **Sat Nov 7**.
  - The usual weekly re-run therefore skips one or two good weeks. R37 says "next open day from today".
  - Fix: pass a "next open day from today" bound (`today()` or the first open day ≥ today), not `defaultDay()`. Or leave it if the controller prefers a week's notice. The report's Kinusaiga example shows this behaviour, so it may be intended. **Needs a ruling, not a blocker.**
- **RM2. `duplicate` doesn't turn a clash with itself into a replay** the way `create` does (`admin-actions.ts:448` calls `checkClashes` bare). The report says both do. No client calls `duplicate` (Run it again uses `create`), so only an API caller could see the 409. Low.
- **RM3. A small window is left in `linkToLibrary`.** The re-read (`:323`) and `updateClass` (`:325`) aren't atomic. Passing `{ expectedUpdatedAt: now.updatedAt }` and treating `StaleClassError` as "already linked" would close the window. The client's quiet re-save (N5) already covers the visible effect. Low.

Not flagged:
- `onOrAfter` only skips a closure on the first copied date. That is fine for the usual single-date re-run.
- A session that has started can't have its end time changed. That's an edge case and in the spirit of R37.
