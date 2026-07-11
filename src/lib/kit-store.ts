/**
 * Persistence for take-home kit orders and the weekly theme reservation ledger.
 *
 * Two kinds of blob live in this store:
 *  - **kit orders**, keyed by Square order id — the money-and-custody record,
 *    mutated through the same 3-attempt CAS loop as checkin-store.
 *  - **claims blobs**, keyed `claims__<ledgerThemeId>__<weekKey>` — the atomic
 *    reservation ledger (LR-1). `claimWeek` recomputes availability INSIDE the
 *    CAS transaction, so two customers racing for the last slot can't both win:
 *    the loser retries, re-reads the winner's claim, and gets `'full'`.
 *
 * kit-store is the source of truth for availability (not Square order scans);
 * Square remains the source of truth for money. Netlify Blobs in prod,
 * `.data/kits/` on disk in dev.
 */
import { createLogger } from '@lib/logger'
import { makeKvStore, type KvStore } from '@lib/blob-store'
import { availabilityFor, CLAIM_TTL_MS, type WeekClaim, type LedgerRecord } from '@lib/kit-ledger'

const logger = createLogger('kit-store')

let kv: KvStore = makeKvStore('kits', 'kits')

/** @internal test-only: inject a kv (e.g. an in-memory blob-backed store). */
export function _setKitKvForTests(store: KvStore): void {
  kv = store
}

/** Custody/finance actions on an order. Taxonomy from PRD §4. */
export type KitEventAction =
  | 'order'
  | 'pickup'
  | 'return-complete'
  | 'return-partial'
  | 'forfeit'
  | 'cancel'
  | 'undo'

export interface KitEvent {
  at: string // ISO
  action: KitEventAction
  note?: string
  byStaff?: string
  amountCents?: number
}

export interface KitOrderRecord {
  orderId: string
  paymentId: string
  reference: string // short human ref (party-store pattern)
  createdAt: string // ISO
  contact: { name: string; email: string; phone: string; address: string }
  /** `personalized` crafts are made to order — staff collect names/details before assembly. */
  crafts: { craftId: string; name: string; qty: number; perHeadCents: number; personalized?: boolean }[]
  guests: number
  /** Absent for crafts-only orders (no rental deposit, no return tracking). */
  theme?: { themeId: string; ledgerThemeId: string; serves: number; packagePriceCents: number; depositCents: number }
  partyDate: string
  pickupDate: string
  returnBy: string
  weekKey: string
  /** What was actually charged online at booking. Deposit-only model: $50
   *  (themed = the refundable rental deposit; crafts-only = the assembly fee).
   *  Pre-deposit-model records carry the full amount here. */
  totalChargedCents: number
  /** The full order quote (crafts + assembly + package + deposit). Absent on
   *  pre-deposit-model records, where totalChargedCents was the whole quote. */
  quoteTotalCents?: number
  /** Due on the POS at pickup: quote − charged. Absent/0 on old records. */
  balanceDueCents?: number
  depositRefund?: { amountCents: number; refundId: string; at: string }
  status: 'upcoming' | 'out' | 'returned' | 'cancelled' | 'forfeited'
  events: KitEvent[]
}

const EVENTS_CAP = 200
const CLAIMS_PREFIX = 'claims__'

/** Blob key for a theme-week's claims list. */
export function claimsKey(ledgerThemeId: string, weekKey: string): string {
  return `${CLAIMS_PREFIX}${ledgerThemeId}__${weekKey}`
}

// ─── Kit orders ──────────────────────────────────────────────────────────────

export async function createKitOrder(record: KitOrderRecord): Promise<void> {
  record.events = record.events.slice(-EVENTS_CAP)
  await kv.set(record.orderId, JSON.stringify(record, null, 2))
  logger.info('Kit order stored', { orderId: record.orderId, reference: record.reference })
}

export async function getKitOrder(orderId: string): Promise<KitOrderRecord | null> {
  const json = await kv.get(orderId)
  return json ? (JSON.parse(json) as KitOrderRecord) : null
}

/** All kit orders, newest first. Claims blobs and the probe key are excluded. */
export async function listKitOrders(): Promise<KitOrderRecord[]> {
  const keys = (await kv.list()).filter((k) => k !== '__probe__' && !k.startsWith(CLAIMS_PREFIX))
  const records = await Promise.all(keys.map(getKitOrder))
  return records
    .filter((r): r is KitOrderRecord => r !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Apply a mutation to an order with optimistic concurrency (3 attempts). */
export async function mutateKitOrder(orderId: string, fn: (o: KitOrderRecord) => void | Promise<void>): Promise<KitOrderRecord> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await kv.getWithMeta(orderId)
    if (!value) throw new Error(`Kit order not found: ${orderId}`)
    const record = JSON.parse(value) as KitOrderRecord
    await fn(record)
    record.events = record.events.slice(-EVENTS_CAP)
    if (await kv.setIfMatch(orderId, JSON.stringify(record, null, 2), etag, true)) return record
  }
  throw new Error('Concurrent update — please retry')
}

/**
 * A kit order as the ledger sees it — for the overdue-forward-block input to
 * `availabilityFor` and the staff radar. Crafts-only orders (no theme) don't
 * touch the ledger and map to null.
 */
export function kitOrderToLedgerRecord(o: KitOrderRecord): LedgerRecord | null {
  if (!o.theme) return null
  return {
    id: o.orderId,
    kind: 'kit',
    themeId: o.theme.ledgerThemeId,
    serves: o.theme.serves,
    weekKey: o.weekKey,
    status: o.status,
    returnBy: o.returnBy,
  }
}

// ─── Claims ledger (LR-1) ────────────────────────────────────────────────────

function parseClaims(value: string | null): WeekClaim[] {
  return value ? (JSON.parse(value) as WeekClaim[]) : []
}

/** A theme-week's current claims (read path for availability computation). */
export async function getWeekClaims(ledgerThemeId: string, weekKey: string): Promise<WeekClaim[]> {
  return parseClaims(await kv.get(claimsKey(ledgerThemeId, weekKey)))
}

/**
 * Atomically reserve a slot on a theme-week. Availability is recomputed from
 * the claims blob (and any overdue kit orders) INSIDE the CAS transaction, so a
 * writer that loses the race retries, re-evaluates against the winner's claim,
 * and returns `'full'` if the slot is now gone. Idempotent on `ref` (a retry of
 * the same order doesn't double-claim). Stale pending claims are pruned on write.
 */
export async function claimWeek(params: {
  ledgerThemeId: string
  weekKey: string
  serves: number
  kind: 'kit' | 'party'
  ref: string
  today: string
  overdueOrders?: LedgerRecord[]
  now?: number
}): Promise<'ok' | 'full'> {
  const { ledgerThemeId, weekKey, serves, kind, ref, today } = params
  const now = params.now ?? Date.now()
  const key = claimsKey(ledgerThemeId, weekKey)

  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await kv.getWithMeta(key)
    const existing = parseClaims(value)
    if (existing.some((c) => c.ref === ref)) return 'ok' // idempotent retry

    // Drop dead pending claims so the blob stays bounded; confirmed always kept.
    const live = existing.filter((c) => c.status === 'confirmed' || now - Date.parse(c.at) < CLAIM_TTL_MS)
    const avail = availabilityFor(ledgerThemeId, weekKey, live, params.overdueOrders ?? [], today, now)
    if (!(avail.settingsLeft >= serves && avail.heroSetsLeft >= 1)) return 'full'

    const next = [...live, { ref, kind, serves, status: 'pending' as const, at: new Date(now).toISOString() }]
    if (await kv.setIfMatch(key, JSON.stringify(next), etag, value !== null)) return 'ok'
    // Lost the CAS race — loop, re-read, and re-evaluate (may now be 'full').
  }
  throw new Error('Concurrent update — please retry')
}

async function mutateClaims(key: string, fn: (claims: WeekClaim[]) => WeekClaim[]): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await kv.getWithMeta(key)
    const next = fn(parseClaims(value))
    if (await kv.setIfMatch(key, JSON.stringify(next), etag, value !== null)) return
  }
  throw new Error('Concurrent update — please retry')
}

/**
 * Promote a pending claim to confirmed (order paid). If the pending claim is
 * gone — it aged past the TTL during a slow payment, or a concurrent claimWeek
 * pruned it, or a release raced — the order is still PAID, so we reinstate the
 * slot as `confirmed` rather than let a paid order hold zero capacity (which
 * silently reintroduces overbooking). Money reality outranks capacity math: if
 * reinstating overshoots owned capacity, the over-commitment radar catches it.
 * Callers should log the `'reinstated'` path loudly. Needs `serves`/`kind` to
 * reconstruct a missing claim.
 */
export async function confirmWeekClaim(params: {
  ledgerThemeId: string
  weekKey: string
  ref: string
  serves: number
  kind: 'kit' | 'party'
  now?: number
}): Promise<'ok' | 'reinstated'> {
  const { ledgerThemeId, weekKey, ref, serves, kind } = params
  const now = params.now ?? Date.now()
  let outcome: 'ok' | 'reinstated' = 'ok'
  await mutateClaims(claimsKey(ledgerThemeId, weekKey), (claims) => {
    const present = claims.some((c) => c.ref === ref)
    outcome = present ? 'ok' : 'reinstated'
    if (present) return claims.map((c) => (c.ref === ref ? { ...c, status: 'confirmed' as const } : c))
    logger.warn('confirmWeekClaim: pending claim absent — reinstating as confirmed', { ledgerThemeId, weekKey, ref })
    return [...claims, { ref, kind, serves, status: 'confirmed' as const, at: new Date(now).toISOString() }]
  })
  return outcome
}

/** Release a claim (charge failed, order cancelled, booking cancelled). Idempotent. */
export async function releaseWeekClaim(ledgerThemeId: string, weekKey: string, ref: string): Promise<void> {
  await mutateClaims(claimsKey(ledgerThemeId, weekKey), (claims) => claims.filter((c) => c.ref !== ref))
}
