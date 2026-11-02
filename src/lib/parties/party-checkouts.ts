/**
 * Party checkouts in flight: kv `party-checkouts`, one small document
 * (key `open`) written compare-and-set (3 attempts). Written just before a
 * party's card is charged and removed once the party is recorded as paid, so
 * a charge whose answer never came back (Square timed out, the server
 * stopped) still has everything needed to record the party later: the
 * party record as it would be saved, the Square order and what was quoted.
 *
 * Entries (removed once settled, so the document stays small):
 *   by party id    state 'charging' (the charge is being sent) or 'unclear'
 *                  (sent, no answer: the hold is kept with no expiry).
 *                  Read by a retry of the same attempt, by Square's payment
 *                  events (webhook and nightly reconcile) and by /admin ›
 *                  To decide ('party-paid-unclear').
 *   by order id    'paid-elsewhere': Square shows one of our party orders
 *                  paid, with nothing here to record it from (no checkout,
 *                  or the party is already paid by another order). An owner
 *                  decides it on /admin › To decide.
 *                  'settled': that payment was decided (refunded, put toward
 *                  the party, already sorted, or refunded in Square). Kept as
 *                  a marker so Square's next event or the nightly run never
 *                  raises it again (kept SETTLED_KEEP_DAYS, then dropped).
 *
 * Nothing here charges, cancels or refunds. Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import type { PartyRecord } from '@lib/party-store'
import type { LineItem } from '@providers/interfaces/payment'
import type { Cents } from './types'

const kv = makeKvStore('party-checkouts', 'party-checkouts')

export interface PartyCheckoutHost { firstName: string; lastName: string; email: string; phone: string }

export interface PartyCheckout {
  partyId: string
  /** retired: an unpaid try let go because the retry changed its choices; its attempt id is not used again. */
  state: 'charging' | 'unclear' | 'paid-elsewhere' | 'retired' | 'settled'
  /** paid-elsewhere only. retired: an earlier try the customer changed and started again (its tombstone holds the old choices). */
  why?: 'no-checkout' | 'other-payment' | 'retired'
  startIso: string
  endIso: string
  /** The party record as it is saved once paid (items still due). Null for paid-elsewhere. */
  draft: PartyRecord | null
  /** The exact order request (same idempotency key → Square gives back the same order). */
  order: { idempotencyKey: string; locationId: string; customerId: string | null; lineItems: LineItem[]; referenceId: string } | null
  orderId: string | null
  quotedCents: Cents
  /** Square's order total, once known. */
  squareCents: Cents | null
  paymentId?: string | null
  host: PartyCheckoutHost
  /** The site the customer booked on (links in the confirmation email). */
  origin: string
  via: 'online' | 'admin-card'
  /** Themed table claim to confirm once paid (kits flag; off). */
  theme?: { ledgerThemeId: string; weekKey: string; claimRef: string; serves: number; displayName: string }
  /**
   * paid-elsewhere: what Square shows already refunded on this payment (read when an owner chose,
   * or from Square's refund event), so the item says what Square did and offers only what still fits.
   */
  squareRefunded?: { cents: Cents; at: string; ids?: string[] } | null
  /** paid-elsewhere: the refund of it Square turned down after it was sent (the item waits again). */
  refundFailed?: { cents: Cents; at: string } | null
  /** settled only: who decided it, when, how. */
  settled?: PaidElsewhereSettled
  /** The customer's email on file to ask about, when the phone matched a near miss. */
  onFile?: string | null
  at: string
  updatedAt: string
}

/** How a paid-elsewhere payment was settled. */
export interface PaidElsewhereSettled {
  how: 'refunded' | 'applied' | 'sorted' | 'refunded-in-square'
  by: { id: string; name: string } | null
  at: string
  cents?: Cents
}

/** A per-order entry (paid-elsewhere or its settled marker), never a party's own checkout. */
export const isOrderEntry = (c: PartyCheckout) => c.state === 'paid-elsewhere' || c.state === 'settled'

const KEY = 'open'
const ATTEMPTS = 3
const RETIRED_KEEP_MS = 7 * 86_400_000
export const SETTLED_KEEP_DAYS = 120
interface Doc { checkouts: PartyCheckout[] }

const sameEntry = (a: PartyCheckout, b: PartyCheckout) =>
  isOrderEntry(a) || isOrderEntry(b)
    ? isOrderEntry(a) && isOrderEntry(b) && a.orderId === b.orderId
    : a.partyId === b.partyId

async function read(): Promise<Doc> {
  const json = await kv.get(KEY)
  return json ? (JSON.parse(json) as Doc) : { checkouts: [] }
}

/** Read-modify-write with CAS. `fn` returns the next list, or null to write nothing. */
async function mutate<T>(fn: (list: PartyCheckout[]) => { next: PartyCheckout[] | null; result: T }): Promise<T> {
  for (let i = 0; i < ATTEMPTS; i++) {
    const { value, etag } = await kv.getWithMeta(KEY)
    const doc: Doc = value ? JSON.parse(value) : { checkouts: [] }
    // Retired attempts are kept a week (long enough for any page still retrying them), then dropped.
    const cutoff = Date.now() - RETIRED_KEEP_MS
    const settledCutoff = Date.now() - SETTLED_KEEP_DAYS * 86_400_000
    const { next, result } = fn(doc.checkouts.filter((c) => (c.state !== 'retired' || Date.parse(c.updatedAt) > cutoff)
      && (c.state !== 'settled' || Date.parse(c.updatedAt) > settledCutoff)))
    if (!next) return result
    if (await kv.setIfMatch(KEY, JSON.stringify({ checkouts: next }), etag, value !== null)) return result
  }
  throw new Error('Party checkouts: concurrent update, try again')
}

/** The checkout of this party, if one is in flight or unclear. Throws when the store can't be read. */
export async function getCheckout(partyId: string): Promise<PartyCheckout | null> {
  return (await read()).checkouts.find((c) => !isOrderEntry(c) && c.partyId === partyId) ?? null
}

/** Adds or replaces this party's checkout. Throws on failure. */
export async function saveCheckout(c: PartyCheckout): Promise<void> {
  await mutate((list) => ({ next: [...list.filter((x) => !sameEntry(x, c)), c], result: undefined }))
}

/** The party is recorded (or the time let go): the checkout is done. */
export async function deleteCheckout(partyId: string): Promise<void> {
  await mutate((list) => {
    const next = list.filter((x) => isOrderEntry(x) || x.partyId !== partyId)
    return { next: next.length === list.length ? null : next, result: undefined }
  })
}

/**
 * Square shows a party order paid that nothing here can record: kept once per
 * order for an owner. 'saved' = new; 'kept' = already waiting; 'settled' = an
 * owner (or Square) already settled that payment: never raised again.
 */
export async function savePaidElsewhere(c: PartyCheckout & { orderId: string }): Promise<'saved' | 'kept' | 'settled'> {
  const entry: PartyCheckout = { ...c, state: 'paid-elsewhere' }
  return mutate((list) => {
    const there = list.find((x) => sameEntry(x, entry))
    if (there) return { next: null, result: there.state === 'settled' ? 'settled' as const : 'kept' as const }
    return { next: [...list, entry], result: 'saved' as const }
  })
}

/**
 * The payment is settled: its entry becomes a settled marker (who, when, how),
 * so it leaves To decide and is never raised again. Idempotent: an order
 * already settled keeps its first marker. With no entry left (settled before
 * markers were kept), a bare marker is written.
 */
export async function settlePaidElsewhere(orderId: string, settled: PaidElsewhereSettled): Promise<void> {
  await mutate((list) => {
    const i = list.findIndex((x) => isOrderEntry(x) && x.orderId === orderId)
    if (i >= 0 && list[i].state === 'settled') return { next: null, result: undefined }
    const at = settled.at
    const base: PartyCheckout = i >= 0 ? list[i] : {
      partyId: '', state: 'settled', startIso: '', endIso: '', draft: null, order: null, orderId, quotedCents: 0, squareCents: settled.cents ?? null,
      host: { firstName: '', lastName: '', email: '', phone: '' }, origin: '', via: 'online', at, updatedAt: at,
    }
    const next = [...list]
    const marker: PartyCheckout = { ...base, state: 'settled', settled, updatedAt: at }
    if (i >= 0) next[i] = marker
    else next.push(marker)
    return { next, result: undefined }
  })
}

/** A settled payment waits again (Square turned its refund down after it was sent). Idempotent. */
export async function reopenPaidElsewhere(orderId: string, patch: Partial<PartyCheckout>): Promise<boolean> {
  return mutate((list) => {
    const i = list.findIndex((x) => x.state === 'settled' && x.orderId === orderId && !!x.paymentId)
    if (i < 0) return { next: null, result: false }
    const next = [...list]
    const { settled: _drop, ...rest } = next[i]
    next[i] = { ...rest, ...patch, state: 'paid-elsewhere', updatedAt: new Date().toISOString() }
    return { next, result: true }
  })
}

/** Notes on a waiting paid-elsewhere entry (what Square shows refunded). No-op when it isn't waiting. */
export async function notePaidElsewhere(orderId: string, patch: Pick<PartyCheckout, 'squareRefunded'>): Promise<void> {
  await mutate((list) => {
    const i = list.findIndex((x) => x.state === 'paid-elsewhere' && x.orderId === orderId)
    if (i < 0) return { next: null, result: undefined }
    const cur = list[i]
    if (JSON.stringify(cur.squareRefunded ?? null) === JSON.stringify(patch.squareRefunded ?? null)) return { next: null, result: undefined }
    const next = [...list]
    next[i] = { ...cur, ...patch }
    return { next, result: undefined }
  })
}

/** Every checkout in flight or unclear, and every paid-elsewhere order. Throws when the store can't be read. */
export async function listCheckouts(): Promise<PartyCheckout[]> {
  return (await read()).checkouts
}
