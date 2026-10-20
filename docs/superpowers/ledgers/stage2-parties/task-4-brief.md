### Task 4: Party records v2, pricing, money, payments index

**Files:**
- Modify: `src/lib/party-store.ts` (new optional fields; `createPartyRecord` create-only; `updatePartyRecord` CAS; `savePartyRecord` kept only for legacy writes until Task 7 removes its last caller)
- Create: `src/lib/parties/pricing.ts` (pure, browser-safe), `src/lib/parties/money.ts` (pure), `src/lib/parties/party-payments.ts` (kv `party-payments`, key `pay-<paymentId>` → `{ partyId, chargeId }`, create-only)
- Modify: `src/pages/api/booking/fix-email.json.ts` (party branch uses `updatePartyRecord`), `src/lib/archive-stores.ts` (+ `parties`, `party-payments`)
- Test: `tests/lib/parties/pricing.test.ts`, `tests/lib/parties/money.test.ts`, `tests/lib/parties/party-payments.test.ts`, extend `tests/lib/party-store.test.ts`, `tests/api/booking-fix-email.test.ts`

**Interfaces:**
- Consumes: `PartySettings` (Task 3), `idFor` (Task 1), `makeKvStore`.
- Produces:

```ts
// added to PartyRecord (all optional; legacy records load unchanged; no `source` = 'square')
source?: 'square' | 'ours'
status?: 'booked' | 'cancelled'
endIso?: string                       // start + package minutes + extra minutes (cleanup not included)
packageId?: string
craftId?: string                      // resolved on the server (Task 7)
items?: PartyItem[]
charges?: PartyCharge[]
refunds?: PartyRefund[]
payToken?: string                     // payment-link key, separate from hostToken (S2-R6)
paying?: { attemptId: string; until: string } | null // one payment in flight (link or admin card)
linkSent?: { at: string; by: By | null; email: boolean; text: boolean }[]
cancelled?: { at: string; by: By; note: string }
overlap?: true                        // R6: paid after its time was taken
history?: { at: string; by: By | null; change: string }[] // capped 100

export interface PartyItem { id: string; kind: 'package' | 'addon'; refId: string; label: string; qty: number; unitCents: Cents; cents: Cents; extraMinutes: number; chargeId: string | null; addedAt: string; by: By | null }
export interface PartyCharge { id: string; via: 'online' | 'admin-card' | 'link'; orderId: string; paymentId: string; cents: Cents; quotedCents: Cents; itemIds: string[]; receiptUrl: string | null; at: string; by: By | null; simulated?: true }
export interface PartyRefund { id: string; chargeId: string; paymentId: string; cents: Cents; reason: string; by: By | null; role: 'owner' | 'crew' | 'square'; squareRefundId: string | null; requestId: string | null; at: string }

export async function createPartyRecord(r: PartyRecord): Promise<{ kind: 'created' | 'exists'; rec: PartyRecord }>
export async function updatePartyRecord(id: string, fn: (r: PartyRecord) => PartyRecord | null, change: string, by: By | null): Promise<PartyRecord> // CAS ×3; null = no change; throws when missing
export const isOurs = (r: PartyRecord) => r.source === 'ours'

// pricing.ts
export interface PartyRequest { packageId?: string; guests: number; addOns?: Record<string, number> }
export interface PartyQuote { pkg: PartyPackage; minutes: number; items: Omit<PartyItem, 'id' | 'chargeId' | 'addedAt' | 'by'>[]; totalCents: Cents }
export function quoteParty(s: PartySettings, req: PartyRequest, audience: 'public' | 'link' | 'admin', linkPackageId?: string): { ok: true; value: PartyQuote } | { ok: false; error: string; field?: string }
export function quoteAddOn(s: PartySettings, rec: PartyRecord, addOnId: string, qty: number): { ok: true; value: PartyQuote['items'][number] } | { ok: false; error: string }
export function orderLineItems(items: Pick<PartyItem, 'label' | 'qty' | 'unitCents' | 'refId' | 'kind'>[], pkgName: string): { name: string; quantity: number; pricePerUnit: Cents; note: string }[]
// pkg_whole keeps 'Whole Studio Party — studio fee'; its add-ons 'Whole Studio Party — <label>'; other packages 'Party — <name>' / 'Party — <label>'

// money.ts
export function dueCents(r: PartyRecord): Cents            // booked: items with chargeId null; cancelled: 0
export function paidCents(r: PartyRecord): Cents           // charges − refunds
export function refundableOn(r: PartyRecord, chargeId: string): Cents // never below 0
export function paymentState(r: PartyRecord): 'paid' | 'waiting' | 'partly' | 'legacy' | 'cancelled'
export function claimPaying(r: PartyRecord, attemptId: string, now: Date, ttlMinutes: number): { ok: true; rec: PartyRecord } | { ok: false; reason: 'busy' } // same attempt → ok (retry)
```

- [ ] **Step 1: Failing tests.** Pricing: whole studio 10 guests = 30000; 9 or 31 guests refused ("Parties are for 10 to 30 guests."); unknown or archived package refused; `link` package refused for public without its id, allowed with it and for admin; `admin` package only for admin; per-guest add-on × guests; `maxQty`; offline add-on refused for public; extra half hour adds 30 minutes; line names keep `Whole Studio Party — studio fee` for `pkg_whole`; **"items keep their price"**: changing the saved price never changes an existing record's items. Money: due/paid/partly/legacy/cancelled; refundable per charge never negative; `claimPaying` refuses a second attempt inside the TTL, lets the same attempt through, frees after expiry. Store: a legacy record without new fields reads; create-only returns `exists` with the stored record; update CAS retries a lost race; history capped; fix-email keeps a concurrent `charges` write. Payments index: create-only, second write with another party refused.
- [ ] **Step 2–4:** run (FAIL), implement, run `npx vitest run tests/lib/parties tests/lib/party-store.test.ts tests/api/booking-fix-email.test.ts tests/lib/archive-stores.test.ts` — PASS.
- [ ] **Step 5: Commit** `feat(parties): party records with items, charges and refunds; server pricing; payment index`.

