# Task 5 report: One shared studio schedule

Status: DONE. Commit 489f99f `feat(schedule): one shared studio schedule for classes, parties, café and blocked time`.

## Files
- NEW `src/lib/classes/studio-schedule.ts`: `busyBetween`, `clashes`, `clashMessage`, types `Busy`/`BusyKind`/`Candidate`, plus source helpers `ourClassBusy`, `blockedAndClosedBusy`, `legacyClassSpans` (exported so party-availability reuses them; no circular import).
- MOD `src/lib/party-availability.ts`: `classSpansBetween` = legacy Square classes + our sessions + blocked + closed days; `classSpansOrNone` keeps legacy fail-open exactly (same log line), but our store is fail-closed. All exports kept.
- `src/lib/conflicts.ts`: unchanged (existing exports were enough).
- NEW tests `tests/lib/classes/studio-schedule.test.ts` (18), `tests/lib/party-availability-own-classes.test.ts` (6). Existing party-availability tests unchanged and green.

## Rules as implemented
- Our classes: every session of draft/open/closed classes; cancelled skipped. `Busy.id` = class id (cls_…), extra optional `sessionId` (ses_…); `ignoreIds` matches either, so a class moving ignores all its own sessions.
- Party busy: non-cancelled `listBookings` (same path as party-availability/class-guard), label "the Rivera party" via `partyName` + party record.
- Café: `cafeRunsOn && cafeHoursOn` as party-slots; class = plain overlap; party = CAFE_PARTY_GAP_MINUTES buffer (same arithmetic as partyStartsForDate).
- Party vs class/legacy/party: `cleanupBufferMinutes` (60 ok, 59 clashes). Class vs class: plain overlap unless both canShareRoom (legacy never shares).
- Blocked/closed: plain overlap. Closed = Chicago 00:00 to next 00:00 (half-open).
- `busyBetween` throws if any source fails (incl. legacy Square), per ruling.
- `clashMessage`: "Clashes with X, Sun Oct 18 4 PM." / "A, … and B, …." / up to 3 then "and N more." Empty list → ''.
- DST test: camp Oct 30–Nov 2 9–12 keeps 09:00 local (14:00Z then 15:00Z); clash checks on real instants.

## Verification
- `npx tsc --noEmit -p .` → 0.
- Full suite: 246 files, 3041 tests passed.

## Concerns
1. Party side applies the 60-min cleanup buffer to blocked time and closed days too (they ride as ClassSpans through `removeClassBlocked`), whereas `clashes()` uses plain overlap for them. Conservative (only hides more party times). Closed days are already excluded by `bookableOn`, so only blocked time is affected.
2. Our store failing now makes `openPartyStarts`/`classSpansOrNone` throw (fail closed). But `book.json` already catches `isStartOpen` errors and proceeds ("lookup failure must not block booking"), so on a store outage the pre-charge re-check would not refuse. Changing book.json was out of scope; flag for controller.
3. availability.json fallback path calls `classSpansOrNone` again inside its catch; if our store is down that throws to the outer 500 handler (picker shows an error rather than free times) — intended fail-closed.

## Fix round 1 (commit below)

Changes:
1. `listClasses` (class-store.ts) and `listBlocked` (blocked-time.ts) now filter keys by prefix, read all keys in parallel (`Promise.all`, like listParties), parse once, range-filter with bounds computed once, and sort as before. Behaviour unchanged.
2. Stale comments reworded in `src/pages/api/party/availability.json.ts` and `src/pages/api/party/available-dates.json.ts`: a failed legacy Square lookup never blocks; our own class store failing fails closed.
3. `clashMessage`: a closed day reads "Clashes with a day the studio is closed, Sat Oct 31." (no time); a blocked time with no reason is labelled "blocked time", giving "Clashes with blocked time, Thu Oct 22 6 PM."

Tests added:
- stores.test.ts: listClasses keeps first-session order regardless of creation order, includes draft/cancelled (store-level), skips out-of-range; listBlocked keeps start order regardless of add order, hides tombstoned blocks, skips out-of-range.
- studio-schedule.test.ts: both new clashMessage wordings via real busyBetween entries.

Command: `npx vitest run tests/lib/classes tests/lib/party-availability.test.ts tests/lib/party-availability-own-classes.test.ts tests/lib/party-open-dates.test.ts tests/api` → Test Files 60 passed (60), Tests 816 passed (816). `npx tsc --noEmit -p .` → exit 0.
dc45733
