# Stage 1 — Our Own Classes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classes live in our own stores, are run from /admin, are sold with one Square order + one Square payment per booking, and every seat (online, door, comp, POS) is counted in our own seat ledger, all inside one shared studio schedule.

**Architecture:** New domain modules under `src/lib/classes/` (types, validation, pricing, stores, seat ledger, schedule, Square catalog sync) are pure where possible and backed by `makeKvStore` blob stores. New API routes under `src/pages/api/admin/classes/`, `src/pages/api/classes/` and `src/pages/api/webhooks/`. The public list and the staff console read both legacy Square classes (until they run out) and our own classes through one adapter. Checkout reuses the party path (`providers.payment.createOrder` + `processPayment`, merchant app id, Apple Pay).

**Tech Stack:** Astro SSR + React islands, TypeScript, Netlify Blobs (via `src/lib/blob-store.ts`), Square SDK v44 + raw REST where the SDK rejects shapes, vitest + Testing Library. Preview branch runs Square **sandbox** with `STORE_NAMESPACE=preview`.

**Spec:** `docs/superpowers/specs/2026-10-18-own-booking-system-design.md` (read it first; this plan argues from it).

## Global Constraints

- Branch `kaden/own-booking-system` only. Never push `main`. Never push this work to `dev`.
- Never cancel or refund a booking automatically; owners/crew act from a confirm that names the people.
- No guessed Square writes: every Square call new to this codebase is exercised against the **sandbox** (preview) before it is relied on; the real-money checklist is run by Kaden at the end.
- Prices are always computed on the server from the class record, never trusted from the browser.
- Customer copy: no colons, no timelines, "parties" never "birthday", "Craft Café" never "Open Studio". Kaden reviews copy before prod; drafts are fine on the branch.
- Test texts/emails: on a namespaced preview everything already routes to Kaden (`src/lib/preview-outbound.ts`); unit tests never send.
- Money in integer cents. Times stored as UTC ISO; displayed in America/Chicago via `src/lib/studio-time.ts`.
- Tax: per seat line, rounded per line (`seatsTaxCents` style); Square applies the catalog 9% tax via `pricing_options.auto_apply_taxes: true` and the order must **not** also carry `order.taxes`.
- All new stores go through `makeKvStore(name, dir)`; all multi-writer records use `getWithMeta` + `setIfMatch` CAS with 3 attempts.
- Existing waiver/RSVP/check-in/seat-choices records keep their ids; our classes use ids prefixed `cls_`, sessions `ses_`, so `workshop:{id}` event keys never collide with `clssch_`.
- Keep `/staff` screens unchanged except where a task says so.

## Review Focus

1. **Two buyers, one last seat** → only one hold succeeds; the other gets "sold out" before any charge (Task 4 test "concurrent holds").
2. **A charge that gets no answer** → seats stay held, owners alerted, nothing released, retry with the same attempt id never double-charges (Task 8 test "no answer keeps hold").
3. **Editing a scheduled class that already has bookings** (price, sessions, capacity below seats sold) → refused or warned; booked people never silently change (Task 10 tests "edit with bookings").
4. **Daylight-saving and multi-day sessions** (Nov 1 change; a camp spanning it) → session times and clash checks stay right in Chicago time (Task 5 test "across the clock change").
5. **POS sale of a class we can't match** (unknown variation, deleted class) → recorded as an unmatched counter sale and flagged, never dropped and never crashing the webhook (Task 13 test "unknown variation").

---

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

### Task 2: Pricing and quotes

**Files:**
- Create: `src/lib/classes/pricing.ts`
- Test: `tests/lib/classes/pricing.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:

```ts
export interface BookingRequest {
  passId: string
  /** session ids the buyer picked (for 'choose'); ignored otherwise */
  sessionIds?: string[]
  /** count per ticket type id */
  tickets: Record<string, number>
  /** per seat: answers and add-on counts, seat index = order of seats (ticket types in content order) */
  seats?: { answers?: Record<string, string>; addOns?: Record<string, number> }[]
  promoCode?: string // stage 4
}
export interface QuoteLine { kind: 'seat' | 'addon'; seat: number; ticketTypeId: string; label: string; cents: Cents; taxCents: Cents; variationKey?: string }
export interface Quote { sessionIds: string[]; seats: number; lines: QuoteLine[]; subtotalCents: Cents; taxCents: Cents; totalCents: Cents }
export function sessionsForPass(cls: ScheduledClass, passId: string, picked: string[] | undefined, now: Date): Result<string[]>
export function quote(cls: ScheduledClass, req: BookingRequest, now: Date, taxPercent: number): Result<Quote>
```

- [ ] **Step 1: Failing tests** for: one-price class (3 people × $15 at 9% → per-line tax 135 each, total 4905); Adult/Kid cells; full series vs one-day pass on a 4-session camp; `choose` needs exactly N distinct sessions of this class; `remaining` returns only sessions with `startIso > now`, refused when `joinPartway` is false and the first session has started, refused when none remain; a not-sold cell refused ("Kid tickets aren't sold for this pass."); zero people refused; over `maxPerBooking` refused; add-on counts beyond `maxPerSeat` refused; missing required answers refused naming the seat ("Seat 2 needs a pumpkin color."); non-taxable class has 0 tax; seat ordering (ticket types in content order).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Tax per line = `taxCents(cents, taxPercent)` from `@lib/tax`; add-ons are their own lines with their own tax; `variationKey` = `${passId}:${ticketTypeId}` for seat lines and `addon:${addOnId}` for add-ons.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(classes): pricing and quotes`.

### Task 3: Stores — library (with versions), scheduled classes, blocked time

**Files:**
- Create: `src/lib/classes/library-store.ts`, `src/lib/classes/class-store.ts`, `src/lib/classes/blocked-time.ts`
- Test: `tests/lib/classes/stores.test.ts`

**Interfaces:**

```ts
// library-store.ts (kv 'class-library')
export async function listLibrary(opts?: { includeArchived?: boolean }): Promise<LibraryClass[]>
export async function getLibrary(id: string): Promise<LibraryClass | null>
export async function saveLibraryVersion(input: { id?: string; content: ClassContent; by: By; note: string }): Promise<LibraryClass> // new id when absent; appends version n+1
export async function restoreLibraryVersion(id: string, version: number, by: By): Promise<LibraryClass> // appends a copy as a new version
export async function archiveLibrary(id: string, archived: boolean, by: By): Promise<LibraryClass>
// class-store.ts (kv 'classes')
export async function listClasses(range?: { fromIso: string; toIso: string }): Promise<ScheduledClass[]> // overlapping range
export async function getClass(id: string): Promise<ScheduledClass | null>
export async function createClass(input: { content: ClassContent; sessions: Session[]; libraryId?: string; libraryVersion?: number; status: ClassStatus; by: By }): Promise<ScheduledClass>
export async function updateClass(id: string, patch: { content?: ClassContent; sessions?: Session[]; status?: ClassStatus; square?: ScheduledClass['square'] }, by: By, change: string): Promise<ScheduledClass> // CAS
// blocked-time.ts (kv 'blocked-time')
export interface BlockedTime { id: string; startIso: string; endIso: string; reason: string; by: By; at: string }
export async function listBlocked(range?: { fromIso: string; toIso: string }): Promise<BlockedTime[]>
export async function addBlocked(input: { startIso: string; endIso: string; reason: string; by: By }): Promise<BlockedTime>
export async function removeBlocked(id: string, by: By): Promise<void>
```

`By` is `import type { By } from '@lib/staff-auth'`. Keys: `lib-{id}`, `class-{id}`, `blocked-{id}`; `listClasses` reads every `class-` key (the store is small; add an index only if a test shows it is needed).

- [ ] **Step 1: Failing tests** (fs-backed kv as in `tests/lib/event-meta.test.ts`): versions increment and keep `by`; restore appends; archived hidden by default; class create/get/update keeps history capped at 100; update CAS retries on a lost race (mock `setIfMatch` once false); range filter; blocked add/list/remove; invalid content refused through `validateContent`.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(classes): library, class and blocked-time stores`.

### Task 4: Seat ledger with holds

**Files:**
- Create: `src/lib/classes/seat-ledger.ts`
- Test: `tests/lib/classes/seat-ledger.test.ts`

**Interfaces:**

```ts
export type SeatSource = 'online' | 'door-card' | 'door-counter' | 'comp' | 'pos'
export interface LedgerLine {
  id: string                 // 'led_'…
  bookingId: string          // groups a booking's lines ('bkg_'…)
  sessionIds: string[]
  ticketTypeId: string
  passId: string
  seat: number               // 1-based within the booking
  priceCents: Cents; taxCents: Cents
  addOns: Record<string, number>
  answers: Record<string, string>
  source: SeatSource
  state: 'held' | 'confirmed' | 'released' | 'refunded'
  holdExpiresAt: string | null
  customer: { givenName: string; familyName: string; email: string; phone: string } | null // null = POS sale with no name yet
  square: { orderId: string | null; paymentId: string | null; lineUid: string | null }
  by: By | null
  refunds: { at: string; cents: Cents; reason: string; by: By; freedSeat: boolean; squareRefundId: string | null }[]
  at: string
}
export interface Ledger { classId: string; lines: LedgerLine[] } // kv 'seat-ledger', key `ledger-{classId}`
export function seatsTaken(ledger: Ledger, sessionId: string, now: Date): number // held (unexpired) + confirmed
export async function getLedger(classId: string): Promise<Ledger>
export async function hold(cls: ScheduledClass, q: Quote, input: { bookingId: string; source: SeatSource; customer: LedgerLine['customer']; answers/addOns per seat; ttlMinutes: number; allowOverCapacity?: boolean; by?: By }, now: Date): Promise<{ ok: true; lines: LedgerLine[] } | { ok: false; reason: 'sold_out'; sessionId: string; left: number }>
export async function confirm(classId: string, bookingId: string, square: { orderId: string; paymentId: string | null }): Promise<LedgerLine[]>
export async function release(classId: string, bookingId: string): Promise<void>
export async function recordRefund(classId: string, lineIds: string[], input: { cents: Cents; reason: string; by: By; freeSeat: boolean; squareRefundId: string | null }): Promise<LedgerLine[]>
export async function setNames(classId: string, lineIds: string[], customer: NonNullable<LedgerLine['customer']>): Promise<void>
```

Rules: `hold` reads with etag, drops expired holds, checks every session in `q.sessionIds` has `capacity − seatsTaken ≥ q.seats` (skip check when `allowOverCapacity`, used by POS and door "squeeze one more"), writes with `setIfMatch`, retries 3×. A refunded line with `freedSeat:false` still counts as taken.

- [ ] **Step 1: Failing tests:** capacity 2, two holds of 1 → both ok, third → sold_out; **concurrent holds**: two `hold()` calls racing on the last seat (fs kv + a wrapped `setIfMatch` that makes the first writer win) → exactly one ok; expired hold frees the seat; confirm moves held→confirmed and keeps expiry null; release frees; refund with freeSeat true frees, false keeps; multi-session pass takes a seat on every session and a one-day pass only on its day; `allowOverCapacity` lets it reach 41 of 40.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(classes): seat ledger with locked holds`.

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

### Task 6: Square catalog sync (POS items) and sandbox seed

**Files:**
- Create: `src/lib/classes/square-catalog.ts`
- Create: `scripts/seed-sandbox.ts` (sandbox only: refuses unless `SQUARE_ENVIRONMENT=sandbox`)
- Modify: `src/config/site.config.ts` — add `square.classesCategoryId` and `square.classTaxId` read from env `SQUARE_CLASSES_CATEGORY_ID`, `SQUARE_CLASS_TAX_ID` (prod values set by Kaden later; sandbox values set by the seed script's printed commands)
- Test: `tests/lib/classes/square-catalog.test.ts`

**Interfaces:**

```ts
export function variationPlan(cls: ScheduledClass): { key: string; name: string; cents: Cents }[] // seat cells + add-ons
export async function syncClassToSquare(cls: ScheduledClass): Promise<ScheduledClass['square']> // upsert ITEM (REGULAR) in Classes category, tax_ids [classTaxId] when taxable, one variation per plan key, item name `${content.name} · ${first session date label}`; removes variations no longer in the plan; uploads image when imageUrl changed (CreateCatalogImage via fetch of imageUrl)
export async function archiveClassInSquare(cls: ScheduledClass): Promise<void> // marks variations sold out / item hidden from POS (visibility PRIVATE / available_for_pickup false; never deletes — past orders reference it)
export function classIdFromVariation(variationId: string, classes: ScheduledClass[]): { classId: string; key: string } | null
```

Use raw REST `POST /v2/catalog/batch-upsert` (Square-Version 2025-01-23) as `scripts/create-class.ts` does, with the client's base URL chosen by environment (sandbox → `connect.squareupsandbox.com`).

- [ ] **Step 1: Failing tests** with mocked `fetch`: plan has one variation per filled cell + add-on; request body shape (product_type REGULAR, category, tax ids only when taxable, prices); re-sync keeps existing variation ids by key and drops removed ones; non-2xx throws a plain error; `classIdFromVariation` finds and misses.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5:** Write `scripts/seed-sandbox.ts`: ensure a "Classes" category and a 9% "Sales tax" (`applies_to_custom_amounts: true`, inclusion ADDITIVE) exist in the sandbox; print the two ids and the exact `! npx netlify env:set … --context branch:kaden/own-booking-system` lines for Kaden (they are not secrets; the agent may set these two itself).
- [ ] **Step 6: Commit** `feat(classes): Square catalog sync for POS items; sandbox seed script`.

### Task 7: Order + payment for a class booking

**Files:**
- Modify: `src/providers/interfaces/payment.ts`, `src/providers/square/payment.ts`, `src/providers/mock/payment.ts`
- Test: `tests/providers/square/payment-class-order.test.ts`

**Interfaces:**

```ts
// added to PaymentProvider
createClassOrder(params: {
  locationId: string; customerId: string | null; idempotencyKey: string
  lines: { catalogObjectId: string; quantity: 1; note: string }[]  // one per seat/add-on line
  discount?: { name: string; cents: Cents } // stage 4 promo
  referenceId: string // our bookingId
}): Promise<{ orderId: string; totalCents: number; lineUids: string[] }>
```

Square body: `order: { location_id, customer_id?, reference_id, line_items: [{ catalog_object_id, quantity: '1', note }], pricing_options: { auto_apply_taxes: true } }` and **no** `taxes`. Payment reuses `processPayment` (`amount` = returned `totalCents`; the server compares it with its own quote and refuses to charge when they differ by more than 0 cents, releasing the hold).

- [ ] **Step 1: Failing tests** (mock fetch/SDK): body has pricing_options and no taxes; returns line uids in order; mismatch handling lives in Task 8.
- [ ] **Step 2–4:** run, implement (raw REST, environment-aware base URL), pass.
- [ ] **Step 5: Commit** `feat(payments): class orders from catalog lines with auto-applied tax`.

### Task 8: Class booking endpoint

**Files:**
- Create: `src/pages/api/classes/book.json.ts`
- Create: `src/lib/classes/checkout.ts` (pure orchestration helpers + messages)
- Test: `tests/api/classes-book.test.ts`

**Flow:** validate body → load class (status open, not cancelled, sign-up cutoff not passed, link-only allowed by direct id) → `quote` → find/create customer (`providers.customer.findOrCreate`, fills missing fields) → `hold` (ttl 10) → `createClassOrder` (idempotency `attempt:{attemptId}:order`) → compare totals → `processPayment` (idempotency `attempt:{attemptId}:pay`, buyer email) → `confirm` → save picks to ledger lines → confirmation email (`sendWorkshopConfirmation`-style, new `sendClassConfirmation` in `src/lib/classes/confirmation.ts` reusing `sendWorkshopConfirmationEmail` with `seatsLabel`) → owner text (`announceBooking`) → analytics (`reportBooking`). Responses use the same `{ data }` / `{ error, code, detail }` shapes and `classifyCheckoutError` codes as `src/pages/api/party/book.json.ts`.

Failure paths: sold_out before charge → 409 nothing held; order create fails → release, 502; total mismatch → release, 502 "We couldn't price your booking. Nothing was charged."; card declined → release, 402; **no answer** → keep hold (extend to 30 min), alert owners with booking id, 502 `unknown_outcome`; retry with same `attemptId` after a success returns the stored result (look up ledger by bookingId derived from attemptId) and never charges twice.

- [ ] **Step 1: Failing tests** for every path above plus: price comes from the class, not the body (body `price` ignored); link-only class bookable by id; draft/cancelled refused; cutoff refused; `choose` pass sessions; gift card token passes through as source (sandbox nonce `cnon:gift-card-nonce-ok` in E2E); rate limit 5/min.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(classes): booking endpoint — one order, one charge, held seats`.

### Task 9: Public list and booking panel for our classes

**Files:**
- Create: `src/lib/classes/public-view.ts` (ScheduledClass → `WorkshopData` + new optional fields)
- Modify: `src/pages/api/workshops.json.ts` (merge legacy + ours; ours excluded when draft/cancelled/linkOnly; sorted by first session)
- Modify: `src/components/workshops/WorkshopExplorer.tsx` (`WorkshopData` gains `own?: { classId: string; sessions: {id,startIso,endIso,left}[]; passes; ticketTypes; prices; questions; addOns; rules }`)
- Create: `src/components/classes/ClassBookingPanel.tsx` (used when `own` is present; legacy `WorkshopBookingModal` stays for Square classes)
- Create: `src/pages/classes/[id].astro` (direct link page, works for link-only)
- Modify: `src/components/workshops/workshop-status.tsx` (`priceLabel` from cells: "From $15" when several prices, "$20 adult · $15 kid" when one pass and ≤ 3 tickets)
- Test: `tests/lib/classes/public-view.test.ts`, `tests/components/classes/ClassBookingPanel.test.tsx`, extend `tests/api/workshops-list.test.ts`

Panel steps: (1) pass picker (only when > 1 pass) and session picker for `choose`; (2) ticket counters per type (min 0 each, total ≥ 1, ≤ maxPerBooking and ≤ seats left on every picked session); (3) per-seat questions and add-ons; (4) contact + payment with `PaymentForm` (merchant app id, **no** `environmentOverride`, wallet for any seat count) and a summary listing lines and tax, total only on the Pay button; (5) booked screen. Calls `/api/classes/book.json` with one token.

- [ ] **Step 1: Failing tests:** public view hides drafts/link-only, sold-out per session, `left` per session; panel: pass switch resets sessions; choose-N requires N; counters cap at seats left; Pay shows `quote` total (client uses the same `quote` function from Task 2 for display); body sends `{ classId, passId, sessionIds, tickets, seats, attemptId, paymentToken, customer }`.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(classes): public list and booking panel for our own classes`.

### Task 10: Admin API — library, scheduling, blocked time, bookings

**Files:**
- Create: `src/pages/api/admin/classes/library.json.ts` (GET list; POST save version {id?, content, note}; POST restore {id, version}; POST archive)
- Create: `src/pages/api/admin/classes/classes.json.ts` (GET range; POST create {from library or content, sessions, status}; POST duplicate {id, sessions}; POST update {id, content?, sessions?, status?, alsoUpdateLibrary?}; POST cancel {id})
- Create: `src/pages/api/admin/classes/blocked.json.ts`
- Create: `src/pages/api/admin/classes/bookings.json.ts` (GET by class: ledger lines grouped by booking)
- Create: `src/pages/api/admin/classes/photo.json.ts` (multipart upload → stored image; returns URL; reuse the approach in `src/pages/api/admin/application-photo.ts`)
- Create: `src/lib/classes/admin-actions.ts` (pure-ish orchestration so routes stay thin)
- Test: `tests/api/admin-classes.test.ts`

Rules: every route `adminAuthorized(request)` (owners). Create/update/move run `clashes()` and refuse with `clashMessage`. **Edit with bookings:** refuse lowering a session's capacity below seats taken; refuse removing a session or pass or price cell that has confirmed seats; price changes allowed but only affect new bookings (ledger keeps paid prices); changing session times with bookings requires `confirmMove: true` and returns the list of people to tell. After every create/update, `syncClassToSquare` and save returned ids; a Square failure keeps our change and returns a warning ("Saved. The POS item didn't update; try Save again."). Cancel sets status cancelled, archives the Square item, returns everyone booked, never refunds. Audit every action with `recordAudit`.

- [ ] **Step 1: Failing tests** for auth, each action, clash refusal, edit-with-bookings rules, duplicate copies content and new sessions with no bookings, alsoUpdateLibrary appends a version, cancel never calls refund.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(admin): class library, scheduling, blocked time and bookings API`.

### Task 11: Admin screens

**Files:**
- Modify: `src/components/admin/AdminApp.tsx` (tabs: Calendar, Classes, Library, Block time + existing Events/Messages/Teachers)
- Create: `src/components/admin/classes/CalendarView.tsx` (week/month; legacy classes, our classes, parties, café, blocked, closures; tap opens)
- Create: `src/components/admin/classes/ClassEditor.tsx` (one form; collapsible sections Sessions, Passes & prices grid, Ticket types, Questions, Add-ons, Rules; photo upload with crop to 4:3; live card preview using the public card component; Save offers "Just this date" / "Also update the library" when scheduled from the library)
- Create: `src/components/admin/classes/LibraryList.tsx`, `ScheduleDialog.tsx`, `BlockTimeForm.tsx`, `ClassBookings.tsx` (with Refund buttons from Task 12), `PrintDay.tsx` (print stylesheet; rosters, prep counts, waiver status)
- Test: `tests/components/admin/classes/*.test.tsx`

- [ ] **Step 1: Failing tests:** editor validates and shows server errors in place; price grid adds/removes cells; schedule dialog shows clash message; calendar renders each kind with its colour and opens the right panel; block time form; print day lists rosters.
- [ ] **Step 2–4:** run, implement, pass (phone width 400px works; buttons ≥ 44px).
- [ ] **Step 5: Commit** `feat(admin): calendar, class editor, library, block time, print day`.

### Task 12: Refunds

**Files:**
- Create: `src/pages/api/admin/classes/refund.json.ts` (owners)
- Create: `src/pages/api/staff/class-refund.json.ts` (crew, `reason` required, ≥ 3 chars)
- Create: `src/lib/classes/refunds.ts`
- Modify: `src/lib/email.ts` (add `sendRefundEmail`)
- Test: `tests/api/class-refund.test.ts`

Flow: pick lines (whole booking / one seat / one session of a series → prorated `priceCents × sessions/sessionsInPass`, rounded down, plus that share's tax) or a custom amount ≤ remaining refundable; `freeSeat` boolean; call `providers.payment.refundPayment({ paymentId, amountCents, reason, idempotencyKey: refund:{lineIds}:{cents} })`; on success `recordRefund`; email; audit; (stage 4 hook: `onSeatFreed(classId, sessionIds)` no-op now). Refuse: more than paid, a comp/POS line with no payment id (POS refunds happen in Square), 21st refund on one payment (Square cap 20).

- [ ] **Step 1: Failing tests** for each choice, proration, cap, crew reason required, owners and crew both audited, a Square error leaves the ledger untouched.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(classes): refunds from /admin and /staff with seat release`.

### Task 13: Square webhooks and nightly reconcile

**Files:**
- Modify: `src/pages/api/webhooks/square.json.ts` (route `order.updated`, `payment.updated`, `refund.created`, `refund.updated` to handlers; keep signature verification; 200 fast)
- Create: `src/lib/classes/square-events.ts`
- Create: `src/pages/api/jobs/reconcile-classes.json.ts` + `netlify/functions/reconcile-classes.ts` (nightly 3 AM Chicago; SearchOrders for the last 48 h at our location; same handlers; idempotent by order id + line uid)
- Test: `tests/lib/classes/square-events.test.ts`

Rules: a COMPLETED order whose line `catalog_object_id` maps (via `classIdFromVariation`) to one of our classes and whose `reference_id` is not one of our bookings → `pos` ledger lines (one per quantity unit, `allowOverCapacity`, `customer: null`, square ids set). Lines we already recorded (same order id + line uid) are skipped. **Unknown variation** in the Classes category → stored in kv `unmatched-pos` and shown in warnings; never throws. A refund on one of our payments with itemized returns (`order.returns` lines mapping to our variations) → `recordRefund(freeSeat: true)`; a plain amount refund → kv `refund-flags` entry "Free a seat?" shown on /admin and /staff warnings, never changing seats.

- [ ] **Step 1: Failing tests:** POS sale of 2 → 2 counter seats; replayed webhook → no duplicate; our own online order echoed back → ignored; unknown variation → unmatched entry; itemized return → seat freed; plain refund → flag only; reconcile finds a missed sale.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(classes): POS sales and Square refunds reach the seat ledger; nightly reconcile`.

### Task 14: Staff console on the new ledger

**Files:**
- Modify: `src/lib/events.ts` (our classes become `StudioEvent`s: id = class id, days = session dates, seats/capacity from ledger per session; legacy kept)
- Modify: `src/pages/api/staff/roster.json.ts` (bookings from ledger for our classes; counter sales show as "Counter sale, no name yet"; names filled from waiver at check-in via `setNames`)
- Modify: `src/pages/api/staff/comp-seat.json.ts` (for our classes: `hold`+`confirm` with source comp/door-counter, no Square dashboard; door-card path opens the class checkout on the iPad)
- Modify: `src/components/staff/CompSeatSheet.tsx` (for our classes: pass/ticket/session pickers; "Pay on the iPad" opens `ClassBookingPanel` in door mode with `source: 'door-card'`)
- Create: `src/components/staff/StaffCalendar.tsx` (read-only version of the admin calendar) + a "Calendar" entry on /staff nav
- Modify: `src/lib/warnings.ts` (our classes: oversold shows "41 of 40", minimum-to-run short, unmatched POS sales, refund flags)
- Test: extend `tests/api/staff-*.test.ts`, `tests/lib/events.test.ts`, `tests/lib/warnings*.test.ts`

- [ ] **Step 1: Failing tests** for each modified behaviour, including a multi-day class showing on each of its days in This week with that day's seats.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(staff): staff console reads and writes the class seat ledger`.

### Task 15: Jobs — waiver reminders, sign-up emails, minimum to run, archive

**Files:**
- Modify: `src/lib/waiver-reminders.ts` (our classes: families from confirmed ledger lines; still-booked = line confirmed and not refunded-with-free)
- Modify: `src/pages/api/jobs/signup-emails.json.ts` (our classes open/sold out)
- Create: `src/lib/classes/minimum-to-run.ts` + run inside `daily-warnings` (on `decideByIso` day and the day before: text + email owners "Potholders has 4 of 6 by Thu 5 PM"; never cancels)
- Modify: `netlify/functions/archive-records.ts`, `scripts/archive-records.ts` (add `classes`, `class-library`, `seat-ledger`, `blocked-time`, `seat-choices`)
- Test: extend the matching tests

- [ ] **Steps 1–5** as usual; commit `feat(jobs): reminders, sign-up emails, minimum-to-run alerts and archive cover our classes`.

### Task 16: Tax report

**Files:**
- Modify: `src/lib/tax-report.ts` (a line whose catalog item is in the Classes category counts as "classes"; ad hoc party fee lines count as "parties" by name prefix `Whole Studio Party`)
- Test: extend `tests/lib/tax-report*.test.ts`

- [ ] **Steps 1–5**; commit `fix(tax-report): classify our class items and party fees`.

### Task 17: Sandbox end-to-end suite and the real-money checklist

**Files:**
- Create: `scripts/sandbox-e2e.ts` — runs against `https://kaden-own-booking-system--iridescent-croissant-494fc3.netlify.app` with `ADMIN_PASSCODE`/staff passcode from the branch env (never printed), using Square sandbox test nonces (`cnon:card-nonce-ok`, `cnon:card-nonce-declined`, `cnon:gift-card-nonce-ok`, `cnon:card-nonce-rejected-cvv`).
- Create: `docs/superpowers/plans/stage1-real-money-checklist.md`

E2E scenarios (each asserts the API result, the ledger via admin bookings API, and the Square sandbox order/payment via SearchOrders):
1. Create library class → schedule → appears in public list with right price label.
2. One-price booking of 3 → one payment, total = quote, tax per line, 3 ledger seats.
3. Adult+2 Kids → line prices 2000/1500/1500 + tax.
4. 4-session camp: full series and one-day pass; seats per session correct; choose-2 pass.
5. Join partway after session 1 (shift session times into the past via admin edit on a test class).
6. Sold out: capacity 2, book 2, third refused before charge.
7. Concurrent last seat: two bookings in parallel → one 200, one 409, one charge.
8. Declined card → nothing held afterwards, no order paid.
9. Gift card nonce pays.
10. Refund one seat freeing it → seats left +1, sandbox refund exists; goodwill refund keeps seat.
11. POS-style sale: create a sandbox order + payment for a class variation directly through the API (simulating the POS), run reconcile → counter seat appears; replay → no duplicate.
12. Cancel class → status cancelled, nobody refunded, Square item archived.
13. Clash: schedule over a blocked time and over a party slot → refused with message.
14. Link-only class: absent from list, bookable by link.
15. Edit with bookings: lowering capacity below sold refused.
16. Comp and door-counter from /staff → ledger lines, no Square charge.

- [ ] **Step 1:** write the script with a `--only N` flag and a summary table.
- [ ] **Step 2:** deploy the branch, run `npx tsx scripts/sandbox-e2e.ts`; every scenario PASS. Failures become new failing unit tests in the owning task, fixed, re-run.
- [ ] **Step 3:** write the real-money checklist (Apple Pay on prod, a real card, a POS sale, a refund) for Kaden.
- [ ] **Step 4: Commit** `test(e2e): sandbox end-to-end suite for our own classes`.
