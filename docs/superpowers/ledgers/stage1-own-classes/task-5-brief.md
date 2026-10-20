### Task 5: One shared studio schedule

**Files:**
- Create: `src/lib/classes/studio-schedule.ts`
- Modify: `src/lib/party-availability.ts` (class spans include our classes and blocked time), `src/lib/conflicts.ts` (no behaviour change; export what the schedule needs)
- Test: `tests/lib/classes/studio-schedule.test.ts`, extend `tests/lib/party-availability*.test.ts` if present

**Interfaces:**

```ts
export type BusyKind = 'class' | 'legacy-class' | 'party' | 'cafe' | 'blocked' | 'closed'
export interface Busy { kind: BusyKind; id: string; label: string; startIso: string; endIso: string; canShareRoom?: boolean }
export async function busyBetween(fromIso: string, toIso: string): Promise<Busy[]> // all sources
export function clashes(candidate: { startIso: string; endIso: string; kind: 'class' | 'party'; canShareRoom?: boolean; ignoreIds?: string[] }, busy: Busy[]): Busy[]
export function clashMessage(list: Busy[]): string // "Clashes with Kids Halloween Cookie Decorating, Sun Oct 18 4 PM."
```

Sources: our classes (`listClasses`, every session, status open/closed/draft — drafts block too), legacy Square classes (`providers.workshop.listAllWorkshops`), parties (existing party bookings path used by `party-availability.ts`), Craft Café windows (`cafeHoursOn`), blocked time, and closures (`src/config/closures.ts`, whole days). Buffers: party↔class `partyConfig.cleanupBufferMinutes`; café rules exactly as `party-slots.ts` applies today (parties keep ≥ 60 min from café); class↔class overlap is a clash unless both `canShareRoom`; anything inside `blocked` or `closed` clashes.

- [ ] **Step 1: Failing tests:** each source contributes; buffer exactly 60 is fine, 59 clashes; two classes overlap clash unless both share; blocked time stops a class and a party; closures day; `ignoreIds` lets a class move without clashing with itself; **across the clock change**: a 4-day camp Oct 30–Nov 2 at 9–12 Chicago keeps 9 AM local each day and clash checks use real instants.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; then make `party-availability.ts` `classSpansBetween` also return our class sessions and blocked/closed windows as spans so the public party picker and the party pre-charge re-check refuse them. Keep its existing exports and behaviour for legacy classes.
- [ ] **Step 4: Run** new tests + `npx vitest run tests/lib` — PASS.
- [ ] **Step 5: Commit** `feat(schedule): one shared studio schedule for classes, parties, café and blocked time`.

