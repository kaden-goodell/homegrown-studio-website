# Task 15 re-review, fix round 1 (f593c1f..c0387e7)

Verdict: **Approved**. Every finding is fixed. No new Important problems. Two nits below.

Verification (reviewer, at c0387e7): `npx vitest run` 280 files / 3554 tests, 0 failures. `npx tsc --noEmit` 0 errors (exit 0).

## Findings

| Item | Verdict | Where |
|---|---|---|
| I1 rebuild race can hide a class | **Fixed** | src/lib/classes/class-store.ts:80-84 (a save with no usable index CAS-writes a partial index holding its own entry), :117-125 (`builtAt`, rebuild after 24 h); tests tests/lib/classes/stores.test.ts:180-208 run on an in-memory store with real etags |
| I2 second sitting later the same day | **Fixed** | src/lib/waiver-reminders.ts:139-151 (every later session; dedupe key is booking + session; `startAt` comes from the line's own sitting); test waiver-reminders.test.ts:413 |
| M1 archive ignored STORE_NAMESPACE | **Fixed** | src/lib/blob-store-name.ts (new, no imports), re-exported at blob-store.ts:20-21; netlify/functions/archive-records.ts:31, :113 |
| M2 alert after decide-by passed | **Fixed** | minimum-to-run.ts:55-56 |
| M3 stuck/unreadable marker | **Fixed** | minimum-to-run.ts:77-90 (an unreadable marker can be claimed; `sending` can be claimed again after 15 min, with a log line) |
| M4 quiet day did not commit | **Fixed** | daily-warnings.json.ts:105-109; `commit` swallows its own errors (warning-digest.ts:55), so the 200 reply is unaffected; tested through the job |
| M5 contactless seats merged | **Fixed** | waiver-reminders.ts:80-86 (`booking:<id>` fallback) |
| M6 DST tests | **Fixed** | waiver-reminders.test.ts:443 and minimum-to-run.test.ts:144 |
| Nit: archive test scan | **Fixed** | tests/lib/archive-stores.test.ts:13-21 (recursive scan, any quote style, and it refuses a store named by a variable) |

## Hunted in the new code

**Class index: can a partial index hide a class?** No. A partial index (written by `indexClass` when no usable index exists) is treated as fresh. Every class key that has no entry is read as a stray (class-store.ts:129, 135) and is then added. The only classes skipped are those whose entry's range misses the query, and an entry is written only from a real save (`indexClass`) or a real read (rebuild or stray). So a partial index is never read as complete: it only narrows the reads for classes it actually lists.

**Rebuild races (missing, stale or day-old index).** The reader takes the index etag (class-store.ts:106-109) before it reads any class (:122). Two orders are possible:
- The writer's index write lands after the reader takes the etag. The etag then changes, so the reader's `saveIndex` CAS loses.
- The writer's index write lands before the reader takes the etag. Then the writer's class write also landed before the reader's class reads, so the reader sees the new class.

Either way the reader cannot save an old range. In the day-old case `parseIndex` still accepts the old index (only the reader checks age), so the writer upserts into it and bumps the etag: same result. The unconditional stale marker (:90) also bumps the etag. The stray-save path (:137-140) is protected the same way, and an upsert never replaces an entry with a newer `updatedAt` (:82). The only remaining gap is a function killed between the class write and the index write. That is now capped at 24 h, which was the accepted backstop. `builtAt` is kept on every upsert and stray save, so a busy index still gets a full rebuild once a day.

**blobStoreName move.** The function body is byte-identical to the old one. All importers are updated: blob-store.ts:85 (the only `getStore` in src), archive-records.ts:31 and :113, and tests/lib/blob-store-namespace.test.ts (through the re-export). No other `getStore(` call exists in src/, netlify/ or scripts/.
- Production names are unchanged: with no namespace and SQUARE_ENVIRONMENT=production, the input name is returned as is.
- The archive refuses only the case `NETLIFY=true` + sandbox + no namespace. The throw comes from inside the `try` (archive-records.ts:104), so the run returns a 500 and sends the "Archive FAILED" email. The test mocks nodemailer, so no real email goes out.
- Locally, sandbox with no namespace still uses the plain names. This is unchanged behaviour.

**Reminders when one family is booked in two sittings.** There are no duplicate sends:
- Families are grouped by contact (email, then phone; waiver-reminders.ts:80-86, 163-177).
- Two bookings from the same contact, or one booking whose line holds both sittings, go into one family with two `classes` entries.
- `plan.remind` gets that family once, so it receives one email and one text. The text lists both ("Wheel Pottery at 10 AM and Wheel Pottery at 2 PM").
- The `sentKey` is per family per day, so a later run that day does not send again.

## Nits (no action needed)
- minimum-to-run.ts:73-77: the JSDoc "Claims today's alert…" now sits above `STUCK_SENDING_MS` instead of `claim`. Move it down one declaration.
- No test pins the one-family-two-sittings case: one booking line holding both sittings, or two bookings under the same email. It works by inspection; a two-line test would lock it in. If one line holds both sittings of a two-part class, the text names the class twice ("Pottery at 10 AM and Pottery at 2 PM"). That is accurate and acceptable.
- minimum-to-run.ts:84-85: a `sending` marker with no `at` gives an age of NaN and can never be claimed again. Markers are always written with `at`, so this does not happen today.
