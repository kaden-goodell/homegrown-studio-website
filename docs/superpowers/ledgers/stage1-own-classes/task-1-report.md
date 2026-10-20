# Task 1 report
Implemented src/lib/classes/types.ts (verbatim from brief) and validate.ts (Result, defaultRules, newId, validateContent, validateSessions, sellableCells), tests in tests/lib/classes/validate.test.ts (19 tests).
RED: first run failed, module missing. GREEN: 19/19. Full suite 2966 passed (241 files).
tsc: 6 errors, all pre-existing (astro:content / import.meta.env in the worktree), identical with my changes stashed; none in classes.
Choices beyond brief: defaultCapacity defaults 12, defaultMinutes 90 when omitted; maxPerSeat defaults 1; sessions require >=1; back-to-back sessions allowed; extra bounds (cutoff hours 0-720, minutes 5-1440).
Concern: tsc is not at 0 errors in this worktree (pre-existing).

## Fix round 1
Added toIso() in validate.ts: requires full ISO datetime with Z or +-HH:MM offset, returns new Date(ms).toISOString(). Used for session startIso/endIso and minimumToRun.decideByIso. New tests: offset stored as Z, zone-less refused, "1" refused, decideByIso normalised/refused. Updated the sort test to the canonical .000Z form.
Command: npx vitest run tests/lib/classes/validate.test.ts -> 22 passed. tsc --noEmit -> 0 errors.
