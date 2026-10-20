### Task 1: Class domain types and validation

**Files:**
- Create: `src/lib/classes/types.ts`
- Create: `src/lib/classes/validate.ts`
- Test: `tests/lib/classes/validate.test.ts`

**Interfaces:**
- Produces:

```ts
// src/lib/classes/types.ts
export type Cents = number
export interface TicketType { id: string; label: string }            // default [{id:'person',label:'Person'}]
export type PassCovers =
  | { kind: 'all' }                       // full series
  | { kind: 'choose'; count: number }     // buyer picks N sessions
  | { kind: 'fixed'; sessionIds: string[] } // e.g. weekend
  | { kind: 'remaining' }                 // join partway: every session not yet started at purchase
export interface Pass { id: string; label: string; covers: PassCovers }
export interface SeatQuestion { id: string; label: string; choices: string[] }
export interface AddOn { id: string; label: string; priceCents: Cents; maxPerSeat: number }
export interface Session { id: string; startIso: string; endIso: string; capacity: number }
export interface ClassRules {
  ages: string            // free text shown on card, '' = none
  dropOff: boolean
  madeToOrder: boolean
  taxable: boolean        // default true
  maxPerBooking: number   // default 10
  signupCutoffHours: number | null // null = default (0, or 24 when madeToOrder or questions)
  minimumToRun: { count: number; decideByIso: string } | null
  linkOnly: boolean
  joinPartway: boolean    // when false, a 'remaining' pass is never offered once the first session starts
  waitlistCutoffHours: number // default 2 (stage 4 uses it)
  canShareRoom: boolean   // allows overlap with another class
}
export interface ClassContent {
  name: string
  description: string     // paragraphs separated by blank lines
  imageUrl: string | null
  instructor: string | null // null/'' shows nothing
  rules: ClassRules
  ticketTypes: TicketType[]
  passes: Pass[]
  /** prices[passId][ticketTypeId] = cents; a missing cell is not sold. */
  prices: Record<string, Record<string, Cents>>
  questions: SeatQuestion[]
  addOns: AddOn[]
  defaultCapacity: number
  defaultMinutes: number
}
export interface LibraryVersion { version: number; at: string; by: { id: string; name: string }; content: ClassContent; note: string }
export interface LibraryClass { id: string; archived: boolean; versions: LibraryVersion[] } // versions newest last
export type ClassStatus = 'draft' | 'open' | 'closed' | 'cancelled'
export interface ScheduledClass {
  id: string                 // 'cls_' + 10 base36
  libraryId: string | null
  libraryVersion: number | null
  content: ClassContent      // the editable copy
  sessions: Session[]        // sorted by startIso
  status: ClassStatus
  square: { itemId: string | null; variations: Record<string, string> } // key `${passId}:${ticketTypeId}` → variation id
  createdAt: string
  updatedAt: string
  by: { id: string; name: string }
  history: { at: string; by: { id: string; name: string }; change: string }[] // capped at 100
}
```

```ts
// src/lib/classes/validate.ts
export type Result<T> = { ok: true; value: T } | { ok: false; error: string; field?: string }
export function defaultRules(): ClassRules
export function newId(prefix: 'cls' | 'ses' | 'lib' | 'pas' | 'tkt' | 'q' | 'add'): string
export function validateContent(raw: unknown): Result<ClassContent>
export function validateSessions(raw: unknown): Result<Session[]>
export function sellableCells(content: ClassContent): { passId: string; ticketTypeId: string; cents: Cents }[]
```

- [ ] **Step 1: Write the failing tests** — `tests/lib/classes/validate.test.ts` covering:
  - a minimal content (name, one 'all' pass, default ticket type, one price) validates and fills `defaultRules()`;
  - refuses: empty name; name > 80 chars; no price at all; a price on an unknown pass/ticket; negative or fractional cents; duplicate pass/ticket/question ids; a `choose` pass with count < 1; a `fixed` pass with no sessions; questions with < 2 choices; add-on price < 0; `maxPerBooking` outside 1–40; `defaultCapacity` outside 1–999;
  - sessions: refuses end ≤ start, overlapping sessions of the same class, more than 60 sessions, capacity outside 1–999; sorts by start;
  - `sellableCells` lists only filled cells, in pass then ticket order;
  - instructor `''` normalises to `null`.
- [ ] **Step 2: Run** `npx vitest run tests/lib/classes/validate.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** both files. Ids: `${prefix}_${Date.now().toString(36)}${random 4}`. Error messages are plain sentences an owner reads in the form ("Add at least one price.").
- [ ] **Step 4: Run** the test file — PASS.
- [ ] **Step 5: Commit** `feat(classes): class domain types and validation`.

