# Task 3 report — party settings: store, pure time rules, config fallback

Status: DONE. Full suite 303 files / 3993 tests pass; `npx tsc --noEmit` clean.

## What was built
- `src/lib/parties/types.ts` — the brief's types verbatim (+ `WeekdayKey`, `PartySettingsChange`).
- `src/lib/parties/party-times.ts` (pure, browser-safe; test greps it for `node:`/stores/env) — `PARTY_CLEANUP_MINUTES`, `configPartySettings`, `startsOn`, `bookableDates`, `bookableOn`, `partyStartsForDate`, `partyStartsInRange`, `validatePartySettings`, `describePartyChanges`, `publicPartyFacts`. `localHour`/`localDate`/`localToUtcISO` moved here; `party-slots.ts` re-exports them (all imports keep working).
- `src/lib/parties/settings-store.ts` — kv `party-settings`, key `settings`; CAS with 3 attempts (503 after); stale → `StalePartySettingsError` (409, `current`); updatedAt only moves forward; history newest first, capped 50, each with `before`; 60 s cache, replaced on the saving instance.
- `src/lib/party-slots.ts` — `bookableDates`/`bookableOn`/`partyStartsForDate`/`partyStartsInRange` are thin wrappers with `configPartySettings()`; `removeBooked` unchanged; signatures unchanged.
- `src/lib/archive-stores.ts` + `party-settings`; `tests/lib/archive-stores.test.ts` also scans `src/lib/parties`.
- `src/lib/settings-error.ts` (new) — `SettingsError` moved here so the pure module can throw it without importing the store; `studio-settings.ts` re-exports the same class (identity kept; all its users unchanged).

## Tests
- `tests/lib/parties/party-times.test.ts` — "matches today's times": today's rule copied as the oracle; every date Oct 19 … +120, at Oct 19, Nov 1, Dec 15, with config and saved-closures/café `StudioDays` (also `bookableOn` and `bookableDates`); plus Oct 24 five starts, café 12:30/12:31 boundary, closure, `dates[x] = []`, admin (later today, tomorrow, beyond window, never past/begun, closed stays closed), 120-min package widens café gap, `publicPartyFacts`, ~40 validation sentences+fields, `describePartyChanges`.
- `tests/lib/parties/settings-store.test.ts` (in-memory store with real etags, like studio-settings' test, so lost writes and read failures can be simulated) and `settings-store-fs.test.ts` (the real file kv: missing → config, save → get).
- `party-slots.test.ts`, `party-date-overrides.test.ts` unedited and green.

## Decisions taken (flag if wrong)
1. **The config itself fails validation today**: Oct 24's 7:00 PM start + 90 + 60 ends 9:30 PM, past the 9 PM close (the config comment already says "cleanup runs past the 9pm close"). Per the brief's rule this is refused ("Party times on Sat, Oct 24 must start by 6:30 PM, so the party and its cleanup end by closing at 9 PM.", field `times.dates.2026-10-24`). To stop a past date blocking every later save, `validatePartySettings(raw, { now })` (optional 2nd arg, default the clock) skips the hours/gap checks for dated days before studio-today; they're kept as is. Consequence: until Oct 25, an owner's first save of Parties setup is refused unless Oct 24's 7 PM is removed. Task 11/12 should pass `now` and surface the field.
2. **Weekdays with no studio hours** (Mon–Wed, or a dated day on one) are checked only against midnight, so an owner can open a special party day the hours list doesn't cover. Days with hours: start ≥ opening and start + longest + largest extra + 60 ≤ closing.
3. "Longest package" and "largest extra" count only non-archived ones. The gap between starts is longest package + 60 (extras not included, as the brief says); extras count toward closing/midnight.
4. `admin: true` ignores notice and window only; closed days and the first-party-day rule still apply; starts at or before `now` are never offered (R37). The "never past" filter applies to public offers too (matters only with notice 0).
5. A dated day with `[]` does not pull the first bookable day back before `opensDate` and is still `before_opening` before it.
6. Missing/invalid package or extra ids get a fresh `pkg_…`/`add_…`; duplicates are refused. Quick picks outside min–max are dropped silently (≤ 10, sorted). Extra time must have `maxQty` 1. Package length 15 min – 8 h; extras qty 1–60; `online`/`archived` coerce to `=== true`; `readSquareBookings` must be boolean.
7. `savePartySettings` does not re-validate (same as studio-settings); the API (Task 11) validates first.

## Not touched
refund-runner, classes/refunds, refund tests; the homegrownStudio-booking worktree.
