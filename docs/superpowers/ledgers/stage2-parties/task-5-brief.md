### Task 5: The party book — locked holds on the shared schedule

**Files:**
- Create: `src/lib/parties/party-book.ts` (kv `party-book`, key `month-YYYY-MM` by studio-local start month)
- Modify: `src/lib/classes/studio-schedule.ts` (`partyBusy` = party-book holds ∪ legacy parties (Task 6 fills the legacy half; until then the existing Square read stays); `Busy` gains optional `party?: { state: 'held' | 'booked'; partyId: string }`; `gapNeeded` for a **party** candidate against `blocked` = 60 (R11) instead of 0; `clashes` also takes the cleanup gap from the module constant in `party-times.ts`), `src/lib/archive-stores.ts` (+ `party-book`)
- Test: `tests/lib/parties/party-book.test.ts`, extend `tests/lib/classes/studio-schedule.test.ts`

**Interfaces:**
- Consumes: `Busy`, `clashes`, `clashMessage`, `busyBetween` (studio-schedule), `PARTY_CLEANUP_MINUTES`.
- Produces:

```ts
export interface PartyHold { partyId: string; startIso: string; endIso: string; state: 'held' | 'booked'; holdExpiresAt: string | null; at: string }
export async function holdsBetween(fromIso: string, toIso: string, now: Date): Promise<PartyHold[]> // unexpired held + booked; throws on read error
export async function holdTime(
  input: { partyId: string; startIso: string; endIso: string; ttlMinutes: number | null },
  others: Busy[],             // everything else around the time from busyBetween (classes, café, blocked, closed, legacy parties)
  now: Date,
): Promise<{ ok: true; replay: boolean } | { ok: false; reason: 'taken' | 'clash'; message: string }>
export async function confirmTime(partyId: string, startIso: string): Promise<void>                 // held → booked; re-creates a lost hold as booked (R6) and returns overlap info
export async function extendHold(partyId: string, startIso: string, untilIso: string): Promise<void>
export async function releaseTime(partyId: string, startIso: string): Promise<void>
export async function resizeTime(partyId: string, startIso: string, newEndIso: string, others: Busy[], now: Date): Promise<{ ok: true } | { ok: false; message: string }>
export async function moveTime(partyId: string, from: { startIso: string }, to: { startIso: string; endIso: string }, others: Busy[], now: Date): Promise<{ ok: true } | { ok: false; message: string }> // write new (CAS) → caller updates the record → removeOld
```

Rules: `holdTime` reads the month doc with its etag, drops expired holds, checks the candidate against the doc's other holds **and** `others` with `clashes({ kind: 'party', … })`, then `setIfMatch`, 3 attempts. The same `partyId` already holding the same start is a replay (ok). A move across months writes the new month first; a crash between the writes leaves an extra hold that daily warnings name ("Party hold with no party", Task 13), never a double booking. Because no party or its cleanup crosses midnight (Task 3 validation, and admin "Another time" obeys the same rule), two parties that could clash always share a month doc. Residual race between a class save and a party hold (two different stores) is accepted as in stage 1 (Task 10 minor): the daily "class over party" warning catches it.

- [ ] **Step 1: Failing tests** (fs kv): hold → `holdsBetween` sees it; **"concurrent holds"**: two `holdTime` calls on the same start with a wrapped `setIfMatch` that lets the first writer win → exactly one ok, the other `taken` with a sentence; a 1:00 and a 3:30 party on one Sunday both fit (150-min step); **"extra time clashes"**: 1:00 + 30 extra (ends 3:00, + 60) refuses 3:30 and vice versa; resize refused on a clash, allowed when free; expired hold frees; confirm keeps; release frees; move within a month and Oct→Nov; a Sun Nov 1 hold (clock change) uses real instants; **"no party crosses midnight"** (a hold whose end + 60 passes local midnight is refused with a sentence); party candidate vs blocked time keeps 60 min (R11); `partyBusy` lists holds with `party.state`; a party-book read error makes `busyBetween` throw.
- [ ] **Step 2–4:** run, implement, run `npx vitest run tests/lib/parties tests/lib/classes/studio-schedule.test.ts tests/lib/archive-stores.test.ts` — PASS.
- [ ] **Step 5: Commit** `feat(parties): locked party holds on the shared studio schedule`.

