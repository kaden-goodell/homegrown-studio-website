# Task 3 review (4e27d42..179ba06)

Verdict: Approved (one Important item to settle with the owner/Task 11, not a code defect).

Checks run: vitest on tests/lib/parties, party-slots, party-date-overrides, studio-settings, archive-stores: 7 files / 123 pass. `npx tsc --noEmit` clean. (The `tests/lib/settings*` glob matches nothing.)

## Requirements
- types.ts matches the brief: Met.
- party-times.ts (pure): Met. Imports only config files, cafe-days (config-only imports), and the new settings-error.ts (no imports). No node:, store or env reaches the client.
- settings-store.ts: Met. kv party-settings/settings; CAS with 3 attempts then 503; StalePartySettingsError 409 with current (settings-store.ts:~75); stamp moves forward; history newest-first, capped 50, with `before`; 60 s cache, replaced on the saving instance; strict throws, non-strict falls back to last good then config.
- party-slots.ts wrappers: Met. Signatures and re-exports unchanged; removeBooked untouched; the two old tests pass unedited.
- archive-stores + test scan of src/lib/parties: Met.
- Validation: Met. HH:MM, gap (longest + 60) with the "at least 2 hours 30 minutes apart" sentence, closing/midnight with largest extra, window 1-365, notice 0-60, guests 1-60 and min <= default <= max, integer cents 0-1,000,000, unique ids, label <= 60, one non-archived everyone package, 20/20/120 caps, real calendar dates for dated days. Past dated days kept unvalidated (party-times.ts validatePartySettings loop `if (ymd < today) continue`).

## Fallback equals today
The test's oracle is a verbatim copy of the old partyStartsForDate/bookableOn/bookableDates (diffed against 4e27d42:src/lib/party-slots.ts: same). It compares every date for 121 days at now = Oct 19, Nov 1 (clock change day, also covered as a date) and Dec 15, with CONFIG_STUDIO_DAYS and a saved closures/café StudioDays, and asserts >100 starts so it is not vacuous. Closures and café come from the `days` argument, not config. Minor differences that cannot show with today's config: new code drops starts at or before `now` (old never did; minLeadDays 7 makes it unreachable), and an empty dated day no longer counts as "early"/non-before_opening (config has none empty). Café gap uses the shortest everyone package = 90 min = old.

## Owner bookings
`admin` skips too_soon/too_far only; closed and before_opening still refuse; past starts never offered. Matches the ruling.

## Findings
Important
1. The config itself fails the new validation (Oct 24 7 PM start ends 9:30 PM after the 9 PM close). Until Oct 25 an owner's first save is refused unless they remove that start. Implementer's `{now}` option only exempts days before today. This is a real UX trap on the exact day-one save. Task 11/12 must pass `now`, surface `times.dates.2026-10-24`, and the owner should be told in the UI sentence (it is already owner-readable). Alternatively seed-fix the Oct 24 override to 6:30 PM (that changes production behaviour, so only with Kaden's OK). Not blocking Task 3.

Minor
2. `admin` also refuses `before_opening`; an owner cannot book a private party before the first party day. Task spec says "ignore notice/window", so fine, but confirm the intended owner behaviour in Task 11.
3. Equivalence loop never uses a `now` early enough to offer pre-opening dated days (only the dedicated Oct 9 test does, with 5 starts but no oracle comparison). Add Oct 9 to `nows` for a full oracle compare.
4. Saved docs are parsed without re-validation (same as studio-settings); a hand-edited doc could break time rules. Acceptable.
5. Quick picks outside min-max are dropped silently (documented decision 6).
