### Task 6: Open party times from our book; legacy Square parties read only

**Files:**
- Create: `src/lib/parties/legacy-square.ts` (read only: Square bookings at the location **filtered to the party service variation**, as `Busy` with `id` = Square booking id; `[]` without calling Square when `readSquareBookings` is false or on the sandbox; `legacyRemaining(now)` = future non-cancelled ones, for Parties setup)
- Create: `src/lib/parties/open-times.ts`
- Modify: `src/lib/classes/studio-schedule.ts` (`partyBusy` = book ∪ legacy, deduped by id; `busyBetween(from, to, days?, opts?: { legacyClasses?: 'strict' | 'ignore-failure' })` — party offering passes `ignore-failure` (spec E), everything else stays strict), `src/lib/party-availability.ts` and `src/lib/party-open-dates.ts` (delegate to `open-times.ts`; `bookingHeldBy` deleted; `loadPartyVariationId`/`onSandbox`/`isNotFound` move into `legacy-square.ts` with re-exports for `settings-effects.ts`), `src/lib/class-guard.ts` (`findPartyClashes` from `busyBetween` party entries), `src/lib/warnings.ts` (`scan().parties` from `partyBusy`), `src/pages/api/calendar.json.ts` (booked party times from `partyBusy`), `src/pages/api/party/available-dates.json.ts`, `src/pages/api/party/availability.json.ts` (settings + `open-times.ts`; accept and ignore `serviceVariationId`; `packageId`, `addOns` optional)
- Test: `tests/lib/parties/open-times.test.ts`, `tests/lib/parties/legacy-square.test.ts`; update `tests/lib/party-availability.test.ts`, `tests/lib/party-availability-own-classes.test.ts`, `tests/lib/party-open-dates.test.ts`, `tests/lib/warnings.test.ts`, `tests/api/calendar.test.ts`, `tests/api/party-available-dates.test.ts`, `tests/api/staff-conflicts.test.ts`

**Interfaces:**
- Consumes: Tasks 3 and 5; `getStudioDays({ strict: true })`.
- Produces:

```ts
// src/lib/parties/open-times.ts — every function throws when anything can't be read (fail closed)
export async function openPartyStarts(date: string, want?: { packageId?: string; addOns?: Record<string, number>; admin?: boolean; ignorePartyId?: string }, now?: Date): Promise<string[]>
export async function openPartyStartsInWindow(now?: Date, want?: { packageId?: string }): Promise<string[]>
export async function isStartOpen(startIso: string, minutes: number, opts?: { admin?: boolean; ignorePartyId?: string }, now?: Date): Promise<{ ok: true } | { ok: false; message: string }>
export const PARTY_TIMES_UNREADABLE = "We couldn't load party times. Try again in a minute."
```

- [ ] **Step 1: Failing tests:** a booked `pty_` party removes its start and every start whose span + 60 overlaps it; **"legacy blocks"**: a Square party booking removes its start while `readSquareBookings` is true, and no Square call is made when false or on the sandbox; **"only the party service counts"**: a Square booking of another service variation is not a party (fixes `partyBusy`'s unfiltered read); **"legacy read fails closed"**: Square read throws while the switch is on → `openPartyStarts` throws and the APIs answer 503 with `PARTY_TIMES_UNREADABLE` (no longer "show every time"); **"store down refuses"**: party-settings or party-book read error → 503; a legacy **class** lookup failure is still ignored on the party offering path; R18: `blockTime` over a `pty_` party answers 409 naming it; scheduling a class over a `pty_` party is refused naming it; staff conflicts and warnings "class over party" see a `pty_` party; the public calendar shows a `pty_` party as booked.
- [ ] **Step 2–4:** run, implement, run `npx vitest run tests/lib tests/api/calendar.test.ts tests/api/party-available-dates.test.ts tests/api/staff-conflicts.test.ts tests/api/admin-classes.test.ts` — PASS.
- [ ] **Step 5: Commit** `feat(parties): open party times come from our party book; legacy Square parties read only and fail closed`.

