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
 *                  checks it in Square.
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
  state: 'charging' | 'unclear' | 'paid-elsewhere'
  /** paid-elsewhere only */
  why?: 'no-checkout' | 'other-payment'
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
  /** The customer's email on file to ask about, when the phone matched a near miss. */
  onFile?: string | null
  at: string
  updatedAt: string
}

const KEY = 'open'
const ATTEMPTS = 3
interface Doc { checkouts: PartyCheckout[] }

const sameEntry = (a: PartyCheckout, b: PartyCheckout) =>
  a.state === 'paid-elsewhere' || b.state === 'paid-elsewhere'
    ? a.state === b.state && a.orderId === b.orderId
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
    const { next, result } = fn(doc.checkouts)
    if (!next) return result
    if (await kv.setIfMatch(KEY, JSON.stringify({ checkouts: next }), etag, value !== null)) return result
  }
  throw new Error('Party checkouts: concurrent update, try again')
}

/** The checkout of this party, if one is in flight or unclear. Throws when the store can't be read. */
export async function getCheckout(partyId: string): Promise<PartyCheckout | null> {
  return (await read()).checkouts.find((c) => c.state !== 'paid-elsewhere' && c.partyId === partyId) ?? null
}

/** Adds or replaces this party's checkout. Throws on failure. */
export async function saveCheckout(c: PartyCheckout): Promise<void> {
  await mutate((list) => ({ next: [...list.filter((x) => !sameEntry(x, c)), c], result: undefined }))
}

/** The party is recorded (or the time let go): the checkout is done. */
export async function deleteCheckout(partyId: string): Promise<void> {
  await mutate((list) => {
    const next = list.filter((x) => x.state === 'paid-elsewhere' || x.partyId !== partyId)
    return { next: next.length === list.length ? null : next, result: undefined }
  })
}

/** Square shows a party order paid that nothing here can record: kept once per order for an owner. False when already kept. */
export async function savePaidElsewhere(c: PartyCheckout & { orderId: string }): Promise<boolean> {
  const entry: PartyCheckout = { ...c, state: 'paid-elsewhere' }
  return mutate((list) => (list.some((x) => sameEntry(x, entry)) ? { next: null, result: false } : { next: [...list, entry], result: true }))
}

export async function deletePaidElsewhere(orderId: string): Promise<void> {
  await mutate((list) => {
    const next = list.filter((x) => !(x.state === 'paid-elsewhere' && x.orderId === orderId))
    return { next: next.length === list.length ? null : next, result: undefined }
  })
}

/** Every checkout in flight or unclear, and every paid-elsewhere order. Throws when the store can't be read. */
export async function listCheckouts(): Promise<PartyCheckout[]> {
  return (await read()).checkouts
}
