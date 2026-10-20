# Task 15 review: jobs cover our classes (96cd073..f593c1f)

Verdict: **Needs fixes** (2 Important, 6 Minor). Everything else is solid.

Verification (run by reviewer at f593c1f): `npx vitest run` 280 files / 3543 tests, 0 failures. `npx tsc --noEmit` 0 errors.

## Requirements

| Requirement | Status | Where |
|---|---|---|
| Waiver reminders: families from ledger lines that still hold a seat (not refunded-with-free) | Met | src/lib/waiver-reminders.ts:127-144 (`holdsSeat`, staff-view.ts:48) |
| Waiver reminders: each session day of a multi-day class | Met | waiver-reminders.ts:129-131 (`sessionsOn(cls, day)`) |
| Waiver reminders: unnamed counter sales skipped | Met | waiver-reminders.ts:136 (`!l.customer`) |
| Waiver reminders: every family booked later today is checked | **Partly** (Important 2) | waiver-reminders.ts:131 `.find(...)` takes only the first later session |
| Sign-up emails: our classes open / seat opened, legacy copy | Met | signup-emails.json.ts:67-96, 130; closed-for-signups counts as 0 seats (line 87) |
| Minimum-to-run: decide-by day + day before, text + email, "Potholders has 4 of 6, needs 6 by Thu 5 PM", never cancels | Met | src/lib/classes/minimum-to-run.ts:43-63, 81-103 |
| Minimum-to-run: once per class per day (idempotent marker) | Met | minimum-to-run.ts:68-76 (CAS claim `min-<id>-<day>`, failed day retried) |
| Minimum-to-run: run inside daily-warnings, failure never blocks the email | Met | daily-warnings.json.ts:74-77 |
| decideByIso read in studio time (DST-safe) | Met | `studioDate` + string `addDays` (kit-dates.ts:21) |
| Archive: every new store | Met | src/lib/archive-stores.ts:26-45 (classes, class-library, seat-ledger, blocked-time, seat-choices, refund-flags, refund-requests, unmatched-pos, pos-needs-days, class-alerts, class-photos) |
| Archive: test greps makeKvStore names under src/lib/classes and fails if one is missing | Met | tests/lib/archive-stores.test.ts:16-21 (reviewer re-ran the regex: finds 9 names; dropping any fails) |
| Archive: photos included when small, else keys listed | Met | archive-export.ts:77-80, 300 KB cap |
| Daily email: undated items in full the first day, then "N things still to decide on /admin" | Met | src/lib/warning-digest.ts, daily-warnings.json.ts:98-119; commit only after send |
| Dated warnings unchanged | Met | warning-digest.ts:46 |
| Class index with CAS, used by range reads, behaviour identical | Met | class-store.ts:26-129, 151, 193 |
| Index: tested across create/update/cancel, self-heals when missing | Met | tests/lib/classes/stores.test.ts:113-174 |
| Index can never hide a class | **Partly** (Important 1) | class-store.ts:64-69, 104-108 |

## Important

**I1. A rebuild racing a class update can hide the class from range reads indefinitely.**
`indexClass` returns early when there is no usable index (class-store.ts:68, "the next read builds it"). A reader rebuilding at the same moment builds from what it read *before* the update and saves with create-only / old-etag CAS (lines 104-108), which still succeeds because the writer never touched the index. Sequence: index missing or stale → reader R lists and reads class X (old sessions, October) → staff moves X to December, `updateClass` writes X, `indexClass` sees no index and returns → R saves the index with X = October. From then on a December range read never reads X (it is a known id, outside range), so it vanishes from the public list, the party picker's conflict guard, reminders and minimum alerts until X is next edited. The `updatedAt` guard never runs because the writer bailed out. The same happens when the index is marked `stale` (parseIndex returns null for stale too).
Fix (small): when `indexClass` finds no usable index, still CAS-write: create `{ v:1, entries: { [id]: entry } }` when missing, or overwrite a stale/unreadable one the same way (by its etag). A partial index is safe here because every key not in the index is read as a stray (lines 117-127), and the bumped etag makes R's rebuild CAS fail. Add a test: missing index, start a range read, run updateClass between the read of classes and the save (hook in the mocked store), assert the moved class is found in its new range.
Related, lower odds: a function killed between the class write and `indexClass` (or the stale-marker `kv.set` failing, line 74) leaves an old entry with no self-heal. Cheap backstop: put `builtAt` on the index and rebuild by full scan when it is older than ~24 h (one extra full scan per day), so any such drift lasts at most a day.

**I2. Waiver reminders miss families in a second session later the same day.**
`sessionsOn(cls, day).find((x) => Date.parse(x.startIso) > now)` (waiver-reminders.ts:131) picks only the first later session; lines are then filtered to `l.sessionIds.includes(session.id)`. A class with two sittings on one day (10 AM and 2 PM, a "choose 1" pass, or seats sold per session) never reminds the 2 PM families, and the owners' summary does not list them either. Fix: take every session on that day that starts later than now, keep lines whose `sessionIds` hit any of them, and use the line's own session for `startAt`. Add a test with two same-day sessions and a line in each.

## Minor

- M1 (concern 1). netlify/functions/archive-records.ts:29 and :111 call `getStore({ name })` without `blobStoreName`, so on a namespaced deploy it reads live stores and writes the snapshot into the live `archive` store. Netlify runs scheduled functions only on the published production deploy, so nothing leaks today, but fix it now: `blobStoreName` lives in blob-store.ts which imports `@lib/logger`, and this function deliberately imports only alias-free modules, so move `blobStoreName` into a tiny alias-free module (re-exported from blob-store.ts) and use it for both the reads and the `archive` write. That also brings the "sandbox without a namespace is refused" guard to the archive.
- M2 (concern 2). The decide-by-day alert goes out even after the decide-by time has passed (e.g. decide-by 6 AM, job 7 AM CDT), saying "needs 6 by Thu 6 AM" in the past. Skip the decide-by-day alert once `now >= decideByIso`; the dated `below-minimum` line (warnings.ts:308-318) still appears in the same daily email every day, so nothing is lost.
- M3. A marker that is unparseable, or stuck at `sending` because a run died mid-send, makes `claim` return false for the rest of that day (minimum-to-run.ts:70-74, error swallowed at line 87 and counted as `already`). Acceptable trade against double texts; at least treat unparseable as claimable and log when a `sending` marker is older than ~30 min.
- M4. Digest: when a day has no lines at all the job returns before `commit` (daily-warnings.json.ts:105), so the first-seen map is not cleared. An item with the same id that comes back later is then counted as old and shown only in the count line. The digest unit test ("decided and comes back") commits `[]` directly, which the job never does. Low impact (ids are mostly unique per sale/flag); fix by committing on the empty path too, or test through the job.
- M5. Named but contactless counter-sale customers (`email: ''`, `phone: ''`) all share family key `phone:` (waiver-reminders.ts:80), so several of them collapse into one "no email or phone" entry under the first one's name in the owners' summary. Key such lines by booking id when there is no contact.
- M6. No DST test for the minimum alert or reminders around Sun Nov 1 (decide-by Nov 1 → day-before Oct 31; job at 12:00 UTC is 6 AM CST). Logic is DST-safe by inspection (studio-date strings throughout); a one-line test would pin it.

## Nits
- The archive test only scans single-quoted `makeKvStore('…')` in src/lib/classes (non-recursive); a store made with a variable name or in a subfolder would slip through. Fine today.
- `audit`, `parties`, `kits`, `gift-cards`, `confirmation-copies` are not in the archive; out of this task's scope, but worth a decision later (the staff audit log especially).
- Sign-up copy line "Friday, October 16 at 7:00 PM" (signup-due.ts:142) has a colon in the time; legacy, unchanged here.

## Concerns 1–6 from the report
1. STORE_NAMESPACE in the archive function: **agree, fix it** via `blobStoreName` (see M1; needs an alias-free home for the function), and cover the `archive` snapshot write too. Not urgent in practice since scheduled functions do not run on previews.
2. Alert after the decide-by time passed: **agree, skip once passed** (M2). The dated below-minimum warning keeps it in front of the owners.
3. Lowest seat price in the sign-up email: fine, matches the card.
4. Photos over 300 KB listed by key and size: fine; the live store keeps them and the email stays small.
5. `warnings-seen` not archived: fine, throwaway like `otps`.
6. One `kv.list()` per range read: fine; the index only had to cut the per-class reads.
