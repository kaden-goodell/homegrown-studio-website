# Take-Home Party Kits + In-Studio Themed Tables — Implementation Plan

> **PRD:** docs/plans/2026-07-11-take-home-kits-prd.md (APPROVED 2026-07-11)
> **For agents:** Use team-dev (parallel) or sdd (sequential) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the premium party-in-a-box product (kit orders with rental packages, weekly settings-ledger availability, staff return/cancel console) plus the in-studio themed-table add-on, per the approved PRD.

**Architecture:** Mirrors the party flow throughout: pure step lib (`party-steps` pattern), book-before-charge with compensation, `providers.*` indirection, `makeKvStore` CAS persistence, config-as-single-source with content gating. Two net-new platform capabilities: `PaymentProvider.refundPayment` (Square Refunds API) and `cancelOrder` (void on failed charge). Kits are Square **Orders with PICKUP fulfillment**, not Bookings; the availability ledger is computed from our own kit-store records (created at payment time), never decremented.

**Tech stack:** Astro SSR + React islands, Square SDK v44 (unwrap convention `(resp as any)?.object ?? resp` / `response.<thing>!`, BigInt money), Netlify Blobs via `makeKvStore`, vitest (`npm test`), Gmail via `src/lib/email.ts`.

**Branch:** `kaden/take-home-kits` off `kaden/site-reorg` (keeps the reorg independently mergeable). Commits: conventional (`feat(kits): …`).

**Key decisions locked by PRD/conversation** (do not relitigate): tiers 10/15/20 (@$75/$100/$125); deposits $50/$75/$100 by tier; crafts exact-per-guest; pickup = latest Thursday ≤ party date, return-by = pickup+6 (Wednesday), order cutoff = 7 days before pickup; launch themes Gilded + Prism deep (`ownedSettings: 45`, `heroSets: 3` each — physical 60 is a purchasing note, not code), Sweet Sixteen = Gilded styling variant, Sterling/Bluebell/Linen waitlist-only; NO card storage, NO per-piece replacement billing, NO automatic charges; address required on kit orders; retrieval fee $25 config; over-commitment radar in staff view; return-reminder cron DEFERRED.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/config/kit.config.ts` | Create | Numbers: tiers, prices, deposits, cadence, lead time, retrieval fee, Square ids (filled after seeding) |
| `src/config/kit-content.ts` | Create | Themes (display + stocked/waitlist + ownedSettings/heroSets), hero copy, FAQ, contents-card keep/return lists |
| `src/config/site.config.ts` | Modify | `features.kits: { enabled: boolean }` + interface |
| `src/providers/interfaces/payment.ts` | Modify | Add `refundPayment` + `cancelOrder` to interface + types |
| `src/providers/square/payment.ts` | Modify | Implement both against Square SDK |
| `src/providers/mock/payment.ts` (wherever mock lives — mirror existing) | Modify | Mock impls |
| `src/lib/kit-dates.ts` | Create | Pure date math: pickup/return derivation, cutoff, week keys (America/Chicago) |
| `src/lib/kit-ledger.ts` | Create | Pure availability math over consumption records |
| `src/lib/kit-store.ts` | Create | Blob-store persistence: kit orders + custody events (CAS via `makeKvStore`) |
| `scripts/seed-kits.ts` | Create | Seeds category, Kit Assembly, Party Package (theme×tier), Rental Deposit (tier) |
| `src/pages/api/kits/service-info.json.ts` | Create | Crafts (reuse party source) + themes + constants |
| `src/pages/api/kits/weeks.json.ts` | Create | Selectable party dates + per-theme availability |
| `src/pages/api/kits/order.json.ts` | Create | Validate → ledger re-check → customer → order+fulfillment → charge → persist → email/slack |
| `src/pages/api/staff/kits.json.ts` | Create | Bucketed list + over-commitment radar |
| `src/pages/api/staff/kit-return.json.ts` | Create | Check-in complete/partial/undo → refund via refundPayment |
| `src/pages/api/staff/kit-cancel.json.ts` | Create | Cancel + policy refund; missed-pickup resolution |
| `src/lib/email.ts` | Modify | `sendKitConfirmationEmail` |
| `src/lib/kit-steps.ts` | Create | Pure step model: crafts→guests→theme→when→pay |
| `src/pages/kits.astro` | Create | Landing page (party-page mold) |
| `src/components/kits/KitLanding.tsx` | Create | Island: themes gallery, craft cards, waitlist, modal opener |
| `src/components/kits/KitModal.tsx` | Create | Flow engine (mirrors PartyModal) |
| `src/pages/api/party/service-info.json.ts` | Modify | Append `themes` (stocked only) for in-studio add-on |
| `src/pages/api/party/book.json.ts` | Modify | Optional `themeVariationId` → extra line item + ledger record |
| `src/components/party/PartyModal.tsx` | Modify | Optional "Add a themed table" content on guests step |
| `src/pages/api/staff/parties.json.ts` | Modify | Surface theme |
| `src/components/staff/StaffConsole.tsx` | Modify | New `kits` phase: buckets, check-in, cancel, radar |
| `src/pages/index.astro` + `src/pages/book.astro` | Modify | Teaser → live link behind `features.kits.enabled` |
| `tests/lib/kit-dates.test.ts`, `tests/lib/kit-ledger.test.ts`, `tests/lib/kit-steps.test.ts`, `tests/api/kits-order.test.ts`, `tests/api/kit-return.test.ts` | Create | TDD anchors (mock pattern from `tests/api/party-book.test.ts`) |

Parallelization groups (no file overlap): **A** config (T1) · **B** payments (T2) · **C** date/ledger libs (T3) · **D** kit-store (T4, after C — imports `LedgerRecord`) · **E** seed script (T5) · **F** kit APIs (T6, after A–D) · **G** staff APIs (T7, after B–D) · **H** email (T8, after A) · **I** kit UI (T9, after F,H) · **J** party add-on (T10, after A,C,D,E-ids) · **K** staff UI (T11, after G,J) · **L** teasers + verify (T12, last).

---

## Task 1: Config foundation

**Files:** Create `src/config/kit.config.ts`, `src/config/kit-content.ts`; Modify `src/config/site.config.ts`.
**Dependencies:** none. Branch setup happens here: `git checkout kaden/site-reorg && git pull && git checkout -b kaden/take-home-kits`.

- [ ] **Step 1:** Create `src/config/kit.config.ts`:

```ts
/** Numbers for the take-home kit product. Content/copy lives in kit-content.ts. */
export const kitConfig = {
  /** Assembly fee, always charged, one per order. */
  assemblyFeeCents: 5000,
  /** Package tiers offered at launch. Tier price + deposit by tier size. */
  tiers: [
    { serves: 10, packagePriceCents: 7500, depositCents: 5000 },
    { serves: 15, packagePriceCents: 10000, depositCents: 7500 },
    { serves: 20, packagePriceCents: 12500, depositCents: 10000 },
  ],
  minGuests: 10,
  /** Max guests when a package is selected (largest tier). Crafts-only orders share the cap for assembly sanity. */
  maxGuests: 20,
  /** Order cutoff: days between order time and pickup Thursday. */
  leadTimeDays: 7,
  /** Horizon for the party-date picker. */
  bookingWindowDays: 90,
  /** Wednesday drop-off window (display only). */
  returnWindow: '4–6 PM',
  /** Deducted from deposit if we have to go get the pieces (agreement §6a(b)). */
  retrievalFeeCents: 2500,
  timezone: 'America/Chicago',
  square: {
    // Filled by scripts/seed-kits.ts output; empty string = kits API returns 503 (not seeded yet).
    assemblyItemId: '',
    assemblyVariationId: '',
    packageItemId: '',
    depositItemId: '',
    /** themeId -> { tierServes -> variationId } */
    packageVariations: {} as Record<string, Record<number, string>>,
    /** serves -> deposit variation id */
    depositVariations: {} as Record<number, string>,
  },
} as const
```

- [ ] **Step 2:** Create `src/config/kit-content.ts` (content-gating conventions of `party-content.ts`: empty string hides, `TODO(Kaden)` tracked in `docs/NEEDS-FROM-KADEN.md`):

```ts
export interface KitTheme {
  id: string            // stable slug, used in kitConfig.square.packageVariations keys
  displayName: string
  tagline: string
  scheme: string        // 'gold' | 'rainbow' | ... (styling hook)
  photo: string         // placeholder until Kaden's real shots
  /** Stocked themes are bookable; others render as waitlist cards (notify-me). */
  stocked: boolean
  /** Weekly settings ledger inputs (stocked themes only). */
  ownedSettings: number
  heroSets: number
  /** Contents card lists (draft — Kaden refines in NEEDS-FROM-KADEN). */
  keeps: string[]       // consumables the customer keeps
  returns: string[]     // rental pieces that come back
  /** Styling variant of another theme: shares that theme's ledger (same physical tableware). */
  ledgerThemeId?: string
}

export const kitThemes: KitTheme[] = [
  {
    id: 'gilded', displayName: 'The Gilded Table', tagline: 'Warm gold, candlelight, and celebration',
    scheme: 'gold', photo: '/images/party-hero.jpg', stocked: true, ownedSettings: 45, heroSets: 3,
    keeps: ['Napkins', 'Candles'], returns: ['Liberty-print plates', 'Cake stand', 'Trays', 'Candle holders'],
  },
  {
    id: 'prism', displayName: 'The Prism Table', tagline: 'Every color invited',
    scheme: 'rainbow', photo: '/images/party-hero.jpg', stocked: true, ownedSettings: 45, heroSets: 3,
    keeps: ['Napkins', 'Candles'], returns: ['Liberty-print plates', 'Cake stand', 'Trays', 'Candle holders'],
  },
  {
    id: 'sweet-sixteen', displayName: 'The Sweet Sixteen', tagline: 'Sixteen only happens once',
    scheme: 'sweet-sixteen', photo: '/images/party-hero.jpg', stocked: true, ownedSettings: 0, heroSets: 0,
    keeps: ['Napkins', 'Candles', 'Sweet-sixteen details'], returns: ['Liberty-print plates', 'Cake stand', 'Trays', 'Candle holders'],
    ledgerThemeId: 'gilded', // styling variant: consumes Gilded's tableware
  },
  { id: 'sterling', displayName: 'The Sterling Table', tagline: 'Polished, cool, and effortlessly elegant', scheme: 'silver', photo: '/images/party-hero.jpg', stocked: false, ownedSettings: 0, heroSets: 0, keeps: [], returns: [] },
  { id: 'bluebell', displayName: 'The Bluebell Table', tagline: 'Fresh blues straight out of an English garden', scheme: 'blue', photo: '/images/party-hero.jpg', stocked: false, ownedSettings: 0, heroSets: 0, keeps: [], returns: [] },
  { id: 'linen', displayName: 'The Linen Table', tagline: 'Soft naturals for gatherings that glow quietly', scheme: 'neutral', photo: '/images/party-hero.jpg', stocked: false, ownedSettings: 0, heroSets: 0, keeps: [], returns: [] },
]

export const kitContent = {
  hero: {
    eyebrow: 'Take-Home Party Kits',
    headline: 'The party, boxed and beautiful',
    subline: 'Crafts for everyone, a styled table worth photographing, and nothing to plan. Pick up Thursday — we take it from there.',
  },
  howItWorks: [
    { n: '1', title: 'Order a week ahead', text: 'Kits need 7 days of love and assembly.' },
    { n: '2', title: 'Pick up Thursday', text: 'Everything packed, styled, and labeled — crafts, table, the works.' },
    { n: '3', title: 'Party, then return the pretties', text: 'Keep the crafts and consumables. Rental pieces come home to us by Wednesday, 4–6 PM.' },
  ],
  depositLine: 'Fully refunded when the rental pieces come home clean by Wednesday.',
  earlyDropLine: 'Need a different drop-off time? Reach out and we’ll try — no promises we can make anything work.',
  faq: [] as { q: string; a: string }[], // TODO(Kaden): kit FAQ copy
} as const
```

- [ ] **Step 3:** `src/config/site.config.ts`: add `kits: { enabled: boolean }` to the `features` interface block and `kits: { enabled: false },` to the config object (next to `parties`).
- [ ] **Step 4:** `npm test` green (config-only; `providers.test.ts` spreads siteConfig so new required field is inherited). Commit: `feat(kits): config foundation — kit.config, kit-content themes, feature flag`.

## Task 2: Refund + cancel-order payment capability (net-new)

**Files:** Modify `src/providers/interfaces/payment.ts`, `src/providers/square/payment.ts`, mock payment provider (locate via `grep -rn "class MockPaymentProvider\|mock" src/providers --include='*.ts' -l`); Create `tests/providers/square/payment-refund.test.ts` (mirror an existing square provider test's harness).
**Dependencies:** none.

- [ ] **Step 1 (RED):** Test: `refundPayment` calls Square `refunds.refundPayment` with `{ idempotencyKey, paymentId, amountMoney: { amount: BigInt(cents), currency: 'USD' }, reason }`, unwraps `response.refund!`, returns `{ id, paymentId, amountCents, status }`; `cancelOrder` calls `orders.update` with `{ order: { locationId, version, state: 'CANCELED' } }`. Mock the Square client the way the existing square provider tests do. Run → FAIL (method missing).
- [ ] **Step 2 (GREEN):** Interface additions:

```ts
export interface Refund { id: string; paymentId: string; amountCents: number; status: string }
// on PaymentProvider:
refundPayment(input: { paymentId: string; amountCents: number; idempotencyKey: string; reason?: string }): Promise<Refund>
/** Void an order after a failed charge (kits: no orphaned orders). */
cancelOrder(input: { orderId: string; version: number; locationId: string }): Promise<void>
```

Square impl follows the file's conventions exactly (BigInt in, `Number(...)` out, `response.<thing>!` unwrap). Mock impl returns canned success + records calls. Run tests → PASS.
- [ ] **Step 3:** `npm test` green. Commit: `feat(payments): refundPayment + cancelOrder — Square Refunds API (net-new capability)`.

## Task 3: Date math + weekly ledger (pure libs, TDD)

**Files:** Create `src/lib/kit-dates.ts`, `src/lib/kit-ledger.ts`, `tests/lib/kit-dates.test.ts`, `tests/lib/kit-ledger.test.ts`.
**Dependencies:** Task 1 (types only — kitConfig tiers/lead time).

- [ ] **Step 1 (RED), kit-dates:** tests for: `pickupThursdayFor(partyDate)` = latest Thursday ≤ partyDate (party ON a Thursday picks up that morning — decided; PRD's "Thursday before" reads as "that party-week's Thursday"); `returnByFor(pickup)` = pickup+6d (always a Wednesday); `weekKeyFor(partyDate)` = pickup Thursday's YYYY-MM-DD; `isOrderable(partyDate, now)` = pickup − now ≥ 7 days (studio-local, `en-CA`/`America/Chicago` convention from WhatsOnCalendar's `todayISO`); `tierFor(guests)` = ceil(guests/5)*5 clamped to configured tiers (11→15, 16→20, 21+→null = no package available). Include month/year-boundary and DST cases.
- [ ] **Step 2 (GREEN):** implement as pure functions on YYYY-MM-DD strings (no Date-object timezone traps — split/UTC-noon arithmetic like `formatDate` in UpcomingWorkshops).
- [ ] **Step 3 (RED), kit-ledger:** define the record + math:

```ts
export interface LedgerRecord {
  id: string; kind: 'kit' | 'party'
  themeId: string            // LEDGER theme (variant already resolved to ledgerThemeId)
  serves: number             // tier
  weekKey: string            // pickup Thursday YYYY-MM-DD (party add-on: Thursday of its week)
  status: 'upcoming' | 'out' | 'returned' | 'cancelled' | 'forfeited'
  returnBy: string           // kits only
}
export interface ThemeWeekAvailability { themeId: string; weekKey: string; settingsLeft: number; heroSetsLeft: number; offeredTiers: number[] }
export function availabilityFor(themeId: string, weekKey: string, records: LedgerRecord[], today: string): ThemeWeekAvailability
export function overCommittedWeeks(records: LedgerRecord[], today: string): { themeId: string; weekKey: string; committed: number; owned: number }[]
```

Tests: consumption = records with matching ledger theme where (`weekKey === W`) OR (kit, `status === 'out'`, `returnBy < today`, `record.weekKey < W ≤ weekKeyFor(today)+1wk` — overdue kits block forward weeks until checked in); cancelled records never consume; hero-set count = number of consuming records; `offeredTiers` = tiers whose serves ≤ settingsLeft (and heroSetsLeft ≥ 1); radar flags weeks where Σ committed > owned.
- [ ] **Step 4 (GREEN):** implement; suite green. Commit: `feat(kits): date math + weekly settings ledger (pure, tested)`.

## Task 4: Kit store (persistence)

**Files:** Create `src/lib/kit-store.ts`, `tests/lib/kit-store.test.ts` (mirror checkin-store's test if one exists; else test the pure normalize/mutate helpers with the fs-backed dev store).
**Dependencies:** Task 3 (imports the `LedgerRecord` interface from `kit-ledger.ts` for the adapter — do NOT duplicate the type). Pattern-copy of `checkin-store.ts` + `makeKvStore('kits','kits')`.

- [ ] **Step 1:** Shapes:

```ts
export interface KitOrderRecord {
  orderId: string; paymentId: string; reference: string   // short human ref, party-store pattern
  createdAt: string
  contact: { name: string; email: string; phone: string; address: string }
  crafts: { craftId: string; name: string; qty: number; perHeadCents: number }[]
  guests: number
  theme?: { themeId: string; ledgerThemeId: string; serves: number; packagePriceCents: number; depositCents: number }
  partyDate: string; pickupDate: string; returnBy: string; weekKey: string
  totalChargedCents: number; depositRefund?: { amountCents: number; refundId: string; at: string }
  status: 'upcoming' | 'out' | 'returned' | 'cancelled' | 'forfeited'
  events: KitEvent[]  // { at, action, note?, byStaff?, amountCents? } — action taxonomy from PRD §4
}
```

Functions: `createKitOrder(record)`, `getKitOrder(orderId)`, `listKitOrders()` (kv.list — fine at this scale), `mutateKitOrder(orderId, fn)` with the exact CAS loop from `checkin-store.mutateCheckin` (3 attempts, `getWithMeta`/`setIfMatch`), events capped `.slice(-200)`. Also `toLedgerRecords(orders, partyThemeRecords)` → `LedgerRecord[]` adapter.
- [ ] **Step 2:** In-studio party theme consumption: party bookings with themes are stored here too as minimal records (`kind:'party'`, key `party__<bookingId>`) via `createPartyThemeRecord(...)` — written by Task 10's book.json change.
- [ ] **Step 3:** Tests green. Commit: `feat(kits): kit-store — CAS-persisted orders + custody events`.

## Task 5: Catalog seed script

**Files:** Create `scripts/seed-kits.ts`.
**Dependencies:** Task 1 (theme ids/tiers). Runs manually against production Square AFTER review (lead runs it; implementer only writes it).

- [ ] **Step 1:** ⚠️ Review-swarm correction: `seed-catalog.ts` is NOT idempotent (always-create temp ids, deprecated behind RUN_DEPRECATED) — do not copy its create logic. Combine: **`add-party-craft.ts`'s by-name idempotency** (findByName → reuse real object id + version on update) with **`seed-catalog.ts`'s multi-variation object shape**. The by-name-lookup-per-variation logic is net-new — list existing items in the category first, match item AND each variation by name, only mint `#temp` ids for genuinely-new objects. Safety: refuse a live (non-dry-run) run when `kitConfig.square.packageItemId` is already non-empty unless `--force`. Seed — category `Take-Home Kits`; ITEM `Kit Assembly` (one variation, $50); ITEM `Party Package` with a variation per stocked-theme×tier named `"{displayName} — serves {N}"` at `kitConfig.tiers` prices (Sweet Sixteen gets its own variations — its SELLABLE identity is distinct even though its ledger shares Gilded); ITEM `Rental Deposit` with a variation per tier (`"Deposit — serves {N}"`, $50/$75/$100). Output: prints a ready-to-paste `kitConfig.square` block (item ids + variation id maps).
- [ ] **Step 2:** Dry-run mode (`--dry-run` prints the batch without upserting). Commit: `feat(kits): seed-kits catalog script (idempotent, dry-run)`.

## Task 6: Kit customer APIs

**Files:** Create `src/pages/api/kits/{service-info,weeks,order}.json.ts`, `tests/api/kits-order.test.ts`.
**Dependencies:** Tasks 1–4.

- [ ] **Step 1, service-info:** GET, `Cache-Control: no-store`. Reuses the party craft assembly by DUPLICATING the ~40 craft-listing lines from `api/party/service-info.json.ts` (lines ~43–104) with a provenance comment — decided: do NOT extract a shared helper, because Task 10 edits that same file in parallel and the no-overlap guarantee matters more than DRY here (a shared `craft-catalog.ts` extraction is a fine post-merge cleanup). Response `{ data: { crafts, themes: [{id,displayName,tagline,scheme,photo,stocked,tiers:[{serves,packagePriceCents,depositCents}]}], assemblyFeeCents, minGuests, maxGuests, leadTimeDays, returnWindow } }`. Returns 503 `{error:'kits not seeded'}` when `kitConfig.square.packageItemId` is empty.
- [ ] **Step 2, weeks:** Same 503-when-unseeded short-circuit as service-info (never emit `offeredTiers` built from empty variation maps). GET `?theme=<id>` optional. Computes for each selectable party date (today+lead→horizon): orderable? + per-stocked-theme `offeredTiers` via `availabilityFor(ledgerThemeId, weekKey, toLedgerRecords(await listKitOrders()), todayISO())`. Response `{ data: { dates: [{ partyDate, pickupDate, returnBy, themes: Record<themeId, number[] /*offeredTiers*/> }] } }`. `Cache-Control: no-store` (availability must be live).
- [ ] **Step 3 (RED), order:** test via the `party-book.test.ts` harness pattern (mock `@config/providers`, `@lib/email`, `@lib/kit-store`): happy path creates order with correct line items and charges; rejects guests<10; rejects package with guests>20; rejects short-notice partyDate; rejects taken theme-week (ledger says tier unavailable); rejects missing rentalTermsAccepted when theme selected; rejects missing/short address; **failed charge → `cancelOrder` called and 402 returned**; amount-guard mismatch → cancelOrder + 500.
- [ ] **Step 4 (GREEN):** POST body per PRD §3. Sequence (party book.json:95-343 as the template, adapted):
  1. `rateLimited('kit-order:'+clientAddress, 5, 60_000)` → 429
  2. Validate (incl. `tierFor(guests)` consistency with `themeVariationId`, address ≥ 8 chars, `isOrderable(partyDate)`)
  3. Re-check ledger availability → 409 `theme week taken`
  4. `providers.customer.findOrCreate(...)`; append address to customer note (`appendNote` exists per scout §7)
  5. `providers.payment.createOrder({ locationId, customerId, lineItems: [assembly variation ×1, each craft variation ×qty? — NO: crafts are catalog items priced per head; line = {catalogObjectId: craftVariationId… crafts from party service-info carry item ids not variation ids — use `{name: 'Craft — '+craft.name, quantity: guests, pricePerUnit: perHeadCents}` ad-hoc lines exactly like the party fee line], package variation ×1 (catalogObjectId), deposit variation ×1 (catalogObjectId)] })`. **PICKUP fulfillment**: `createOrder` doesn't support fulfillments — pass through a new optional `fulfillment?: { type:'PICKUP'; pickupAt: string; recipientName: string }` on the createOrder input, mapped in the Square impl to `order.fulfillments=[{type:'PICKUP', pickupDetails:{ pickupAt, recipient:{ displayName }}}]` (interface + square + mock updated here, NOT in Task 2 — no file conflict: Task 2 must be merged first; declare blockedBy)
  6. Amount guard: `order.totalAmount === expectedTotal` else `cancelOrder` + 500
  7. `processPayment(...)`; throw → `cancelOrder` + 502; `status==='failed'` → `cancelOrder` + 402
  8. `createKitOrder(record)` (status `upcoming`, event `order`); build summary; `sendKitConfirmationEmail`; Slack notify (party book pattern); respond `{data:{orderId, reference, summary:{pickupDate,returnBy,returnWindow,totalChargedCents,depositCents,receiptUrl,emailSent}}}`
  0. (before step 4) **Dev payment bypass**: mirror book.json:140 `paymentBypassEnabled()` — synthetic `dev_<ts>` order id, skip steps 4–7, still persist + email; astro-dev only. (Owned HERE, not Task 9 — Task 9 only verifies it.)
- [ ] **Step 5:** Suite green. Commit: `feat(kits): customer APIs — service-info, weeks (ledger), order (book-before-charge)`.

## Task 7: Staff APIs

**Files:** Create `src/pages/api/staff/{kits,kit-return,kit-cancel}.json.ts`, `tests/api/kit-return.test.ts`.
**Dependencies:** Tasks 2, 3, 4.

- [ ] **Step 1, kits.json:** GET, `staffAuthorized` gate. Returns all non-settled orders bucketed (pickup today / awaiting / missed pickup [pickupDate < today && status upcoming] / out / due back today / overdue / recently settled last 14d) + `radar: overCommittedWeeks(...)`.
- [ ] **Step 2 (RED), kit-return:** tests: complete → `refundPayment(paymentId, depositCents)` called, status `returned`, event `return-complete`, `depositRefund` recorded; partial → refund of `depositCents - withheldCents`, event `return-partial` with note required when withholding; forfeit (`{action:'forfeit'}`) → no refund, status `forfeited`; **undo** → compensating action is IMPOSSIBLE for an already-sent refund via API alone, so undo is only offered while `depositRefund` is absent (forfeit-undo, wrong-note-undo); attempting undo after refund → 409 with human instructions (Square dashboard refund reversal is manual) — THIS IS THE DECIDED BEHAVIOR, do not silently promise money reversal we can't execute.
- [ ] **Step 3 (GREEN):** implement via `mutateKitOrder` CAS; refund idempotency key = `kitret-${orderId}` (retry-safe). Pickup marking: `{action:'pickup'}` sets status `out` (staff clicks at handoff — this starts the consumption-until-checkin clock). Explicit terminal states (swarm fix): **partial return also sets `status:'returned'`** (distinguished only by the `return-partial` event + withheld amount); **successful undo reverts `status` to `'out'`** (its pre-mistake value — matters for the ledger's overdue clause; test asserts it).
- [ ] **Step 4 (RED then GREEN), kit-cancel:** POST `{orderId}`: **precondition `status === 'upcoming'`, else 409** (RED tests: cancel on out/returned/forfeited/already-cancelled all rejected; double-submit safe). Policy refund via `refundPayment` — full `totalChargedCents` if today ≤ pickup−7d, else `totalChargedCents − assemblyFeeCents`; idempotency `kitcancel-${orderId}`; status `cancelled` (frees the ledger week instantly), event `cancel`. Missed-pickup path: same endpoint (missed-pickup orders are still `upcoming` — the bucket is derived, not a status), staff decides timing.
- [ ] **Step 5:** Suite green. Commit: `feat(kits): staff APIs — buckets+radar, return/forfeit/undo, cancel with policy refund`.

## Task 8: Kit confirmation email

**Files:** Modify `src/lib/email.ts` (append; no changes to existing functions).
**Dependencies:** Task 1.

- [ ] **Step 1:** `sendKitConfirmationEmail({to, hostName, reference, crafts:[{name,qty}], themeName?, keeps?, returns?, partyDate, pickupDate, returnBy, returnWindow, earlyDropLine, depositCents?, totalChargedCents, receiptUrl})` — follows `sendPartyConfirmationEmail`'s structure/brand styles; subject `Your kit is booked — pickup Thursday {pickupDate} ({reference})` (unique-subject house rule); body sections: what's in the box (keeps vs "comes home to us" lists), the three dates big and bold, deposit line, drop-off window + early-drop expectation line. Text + HTML variants.
- [ ] **Step 2:** `npm test` green (email module has existing tests? follow suit if so). Commit: `feat(kits): confirmation email with pickup/return dates and keep-vs-return lists`.

## Task 9: Kit UI — steps lib, landing page, modal

**Files:** Create `src/lib/kit-steps.ts` + `tests/lib/kit-steps.test.ts`, `src/pages/kits.astro`, `src/components/kits/KitLanding.tsx`, `src/components/kits/KitModal.tsx`.
**Dependencies:** Tasks 6, 8 (APIs live in dev).

- [ ] **Step 1 (RED+GREEN), kit-steps:** copy `party-steps.ts` shape exactly with `KitStepId = 'craft'|'guests'|'theme'|'when'|'pay'`, `LABELS = {craft:'Crafts', guests:'Guests', theme:'Themed Table', when:'Party Date', pay:'Details & Payment'}`, `FlowInput { craftSettled: boolean }` (only `craft` ever drops — `?craft=` deeplink parity with /book). Tests mirror `party-steps.test.ts`.
- [ ] **Step 2, kits.astro:** party-page mold (`book.astro` structure): hero from `kitContent.hero`, how-it-works strip, `<KitLanding client:load />`; render only when `siteConfig.features.kits.enabled` else redirect `/book` (pre-launch safety).
- [ ] **Step 3, KitLanding:** fetch kits/service-info (`json.data ?? json`); a 503 (not-seeded) renders a distinct internal-preview notice ("Kits aren't live yet — catalog not seeded") separate from the generic error-with-retry state; theme gallery — stocked themes as selectable cards, waitlist themes as dimmed cards with "Join the waitlist" (email field → POST `/api/party/notify-me.json` — reused verbatim, plus Slack ping carries theme name in the message body); craft cards reuse the visual pattern from PartyLanding (grid, price badge, share NOT needed); `?craft=` deeplink parity (PartyLanding:104-113 pattern); opens `<KitModal ...>`.
- [ ] **Step 4, KitModal:** structural mirror of PartyModal (props `{onClose, initialCraftId?}`; state machine with `visibleSteps`; 200ms transitions; progress bar). Steps:
  - **craft**: multi-select with per-craft qty defaulting to guests? NO — PRD: crafts priced exact per guest; UI = pick ONE OR MORE craft types and the per-guest split: keep v1 simple, decided: single-select craft (matches party flow) × guests. `crafts:[{craftId, qty: guests}]` on submit. (Multi-craft mixing is out of scope v1; PRD's array shape future-proofs the API.)
  - **guests**: stepper 10–20, quick picks [10,15,20]; live tier label when a theme is chosen ("serves-15 package") on boundary cross.
  - **theme**: stocked theme cards + explicit first-class "No themed table — just crafts" option; shows tier price for computed tier + deposit line (`kitContent.depositLine`).
  - **when**: party-date picker fed by weeks.json — selectable dates only; selecting shows derived `Pick up Thu {date} · Return by Wed {date}, {returnWindow}`; theme-unavailable dates greyed with reason.
  - **pay**: contact fields (name/email/phone/**address** — required, minLength 8, placeholder "Where the party's happening — in case we need to rescue our plates 😄"), rental terms checkbox (link `/waiver`, gate pay when theme selected), line-item summary (crafts ×N, assembly, package, deposit), `<PaymentForm environmentOverride="production" wallet={{amount, label:'Homegrown Kit', bnpl:true}}>` — **no applicationIdOverride** (party convention, scout §2); `handlePay` → POST kits/order, unwrap, confirmation.
  - **confirmation**: green-check parity; the three dates prominent; "what comes back to us" list; no host-page/invite (kits have none, v1).
- [ ] **Step 5:** Manual dev-server pass: full order with theme (dev payment bypass per book.json pattern — verify `paymentBypassEnabled()` is honored in kits/order too; add it in Task 6 mirroring book.json:140). Commit: `feat(kits): landing page + five-step modal with ledger-aware date picker`.

## Task 10: In-studio themed-table add-on

**Files:** Modify `src/pages/api/party/service-info.json.ts`, `src/pages/api/party/book.json.ts`, `src/components/party/PartyModal.tsx`, `src/pages/api/staff/parties.json.ts`, **`src/lib/party-store.ts`** (theme carried on the PartyRecord — see Step 4).
**Dependencies:** Tasks 1, 3, 4 (+ seeded ids to fully exercise).

- [ ] **Step 1, service-info:** append `themes` to the envelope: stocked themes only, `{id, displayName, tagline, photo, tiers}` (omit when kits flag off — party UI must not offer unbuyable themes).
- [ ] **Step 2, book.json:** accept optional `theme: { themeId, variationId, serves, priceCents }`; validate serves === tierFor(people) and ledger availability for the party's week (`weekKeyFor(studioDateOf(startTime))`); add line item `{catalogObjectId: variationId, quantity: 1}` to the createOrder call (deposit-only order becomes deposit+package); amount guard updated to `basePriceCents + (theme?.priceCents ?? 0)`; on success `createPartyThemeRecord({bookingId, ledgerThemeId, serves, weekKey})`; include theme in confirmation email craft line (append `— with ${displayName}` to slotLabel is enough v1) and in `specialRequests` JSON alongside craft.
- [ ] **Step 3, PartyModal:** on the guests step (after the stepper), an optional collapsed "Add a themed table" section: theme cards (small), computed tier price, none-selected default; summary line on pay step. Fetch themes from the party service-info it already loads (no new fetch). **Keep the change additive and small** — this file is 1500 lines; do not refactor it.
- [ ] **Step 4, theme → staff display path** (review-swarm fix): `specialRequests` is written to the Square Booking but never read back — the actual staff data source is `party-store.ts`'s `PartyRecord`. So: `PartyRecord` gains optional `theme?: { themeId: string; displayName: string }` (the SELECTED theme — e.g. "The Sweet Sixteen" — NOT the ledger-collapsed `ledgerThemeId`, which would mislabel variants); `persistParty()` in book.json passes it through; `staff/parties.json.ts` includes `themeName: p.theme?.displayName ?? null` in each row. kit-store's `createPartyThemeRecord` stays pure ledger math (collapsed id) — party-store is staff-display truth, kit-store is availability truth.
- [ ] **Step 4b, cancellation path (swarm fix):** Modify `src/pages/api/booking/cancel.json.ts` (add to this task's file list): after a successful `cancelBooking`, call `cancelPartyThemeRecord(bookingId)` (new kit-store helper: marks the `party__<bookingId>` record `cancelled` if one exists, no-op otherwise) — a cancelled themed party must free its theme-week in the ledger, or the slot stays falsely consumed all week and the radar false-positives.
- [ ] **Step 5:** `npm test` green — party-book tests extended: theme accepted, wrong-tier rejected, ledger-conflict rejected, amount guard includes package (exact formula `basePriceCents + (theme?.priceCents ?? 0)` — both sides of the guard change together); cancel frees the ledger record. Commit: `feat(party): themed-table add-on — shared kit ledger, package line item`.

## Task 11: Staff console — kits phase

**Files:** Modify `src/components/staff/StaffConsole.tsx`.
**Dependencies:** Tasks 7 AND 10 (the parties-phase badge in Step 2b consumes Task 10's `themeName` field).

- [ ] **Step 1:** Add `phase: 'kits'` to the phase machine + a nav affordance from `parties` phase ("Kits" button, matching existing chrome). Kits phase renders: **radar banner first** (red glass card listing over-committed weeks: "Week of {date}: {theme} committed {committed}/{owned} — call somebody"), then buckets in operational order (pickup today → due back today → overdue → missed pickup → awaiting → out → recently settled).
- [ ] **Step 2:** Order card: reference, name/phone/address, crafts, theme+tier, three dates, deposit state. Actions per status: `Mark picked up` (upcoming) · `Check in return` (out/overdue → panel: complete [refund $X] / withhold [amount + required note] / forfeit) · `Cancel + refund` (upcoming/missed, shows computed policy amount) · `Undo` (only when no refund sent — matches Task 7 semantics). All confirmations inline (no native dialogs — house rule).
- [ ] **Step 2b:** Parties phase: render `themeName` (from Task 10's staff/parties row field) as a `Badge` on each party card when present — the person staging the room sees "The Sweet Sixteen" at a glance.
- [ ] **Step 3:** Manual staff-flow pass on dev (seeded fake records via kit-store dev fs). Commit: `feat(staff): kits console — buckets, check-in, cancel, radar + party theme badges`.

## Task 12: Teaser flips, docs, verification

**Files:** Modify `src/pages/index.astro`, `src/pages/book.astro`, `docs/NEEDS-FROM-KADEN.md`; verification.
**Dependencies:** all.

- [ ] **Step 1:** `index.astro`: Take-Home offering card driven by the flag — `siteConfig.features.kits.enabled ? { href:'/kits', cta:'Build your kit', price:'Kits from $200' } : current coming-soon shape`. `book.astro`: teaser card becomes a link to `/kits` when enabled (keeps Coming Soon otherwise). Flag stays **false** in this branch — flip is a launch decision.
- [ ] **Step 2:** Append kit content asks to `docs/NEEDS-FROM-KADEN.md` (theme photos, FAQ copy, contents-list refinement, per-theme price tweaks).
- [ ] **Step 3:** Gates: `npm test` green; `npm run build` clean; dev-server browser pass: /kits end-to-end w/ dev bypass (crafts-only AND with-theme), /book party flow incl. themed table, staff kits phase, teasers still "coming soon" with flag off. Push `kaden/take-home-kits`; do NOT merge to site-reorg/dev until Kaden reviews the preview.
- [ ] **Step 4:** Seeding runbook note for the lead: run `npx tsx scripts/seed-kits.ts --dry-run`, review, run live, paste ids into `kit.config.ts`, commit `chore(kits): seeded catalog ids`.

---

## Self-review notes
- Fulfillment support intentionally lands in Task 6 (not 2) — Task 6 declares blockedBy Task 2; both touch `payment.ts` files, so they MUST NOT run in parallel (lead: serialize B before F, already implied by dependency).
- Undo semantics honestly constrained: no refund-reversal API exists; undo is pre-refund only (tested).
- `kit-store` is the ledger's source of truth (not Square order scans) — decided for latency + PICKUP-order query limitations; Square remains money-truth.
- Sweet Sixteen sells under its own variations but consumes Gilded's ledger via `ledgerThemeId` — seed script + ledger adapter both honor it.
- Party add-on validates tier against the PARTY guest count; party guests max 30 but package tiers stop at 20 — parties of 21–30 simply see no package offer v1 (PRD tier bounds; note in UI copy "themed tables available for parties up to 20").
