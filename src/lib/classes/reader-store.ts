/**
 * Charge on the reader: what we keep about each sale sent to the Square app,
 * and which Square orders paid which sale.
 *
 *   kv 'reader-sales'   key `rdr-{bookingId}`  one record per sale (who, what,
 *                       how much, the quote it was held at, and how it ended);
 *                       written compare-and-set ×3
 *   kv 'reader-orders'  key `ord-{orderId}`    create-only: the booking a Square
 *                       order paid. A second booking can never claim it (a
 *                       replayed or borrowed transaction id is refused).
 *
 * The record outlives the seat hold, so a payment that comes back late (or
 * only shows in Square) still finds what was sold and seats it. Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'
import type { BookingRequest, Quote } from './pricing'
import type { LedgerLine } from './seat-ledger'
import type { Cents } from './types'
import { assertClassWritesAllowed } from './test-site-guard'
import type { OrderRefusal } from './reader'

const salesKv = makeKvStore('reader-sales', 'reader-sales')
const ordersKv = makeKvStore('reader-orders', 'reader-orders')
const ATTEMPTS = 3
const safeKey = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_')
const saleKey = (bookingId: string) => `rdr-${safeKey(bookingId)}`
const orderKey = (orderId: string) => `ord-${safeKey(orderId)}`

export type ReaderSaleState = 'waiting' | 'paid' | 'cancelled' | 'let-go'

export interface ReaderSale {
  bookingId: string
  classId: string
  className: string
  /** first session of the booking (for the note, the roster and To decide) */
  firstStartIso: string
  /** "2 Adults" */
  seatsLabel: string
  seats: number
  amountCents: Cents
  startedAt: string
  by: By & { role?: 'owner' | 'crew' }
  customer: NonNullable<LedgerLine['customer']>
  request: BookingRequest
  overCapacity: boolean
  /** "Email them a confirmation" was ticked */
  sendEmail: boolean
  /** the quote the seats were held at (seat-ledger confirm rebuilds from it if the hold ran out) */
  quote: Quote
  state: ReaderSaleState
  /** Square took it offline; it finishes when the iPad is back online */
  offline?: { clientTransactionId: string; at: string }
  /** the last order Square showed that didn't pass (the seat stays held; owners decide) */
  problem?: { why: OrderRefusal | 'linked'; orderId: string; at: string; paidCents?: Cents; paymentIds?: string[] }
  paid?: {
    orderId: string; paymentId: string | null; paymentIds: string[]; tipCents: Cents; at: string
    /** 'kept': an owner kept a payment that didn't match ("Keep it, they paid $X") */
    how: 'return' | 'check' | 'square' | 'kept'
    /** what Square shows was paid for the seat (less any tip), when an owner kept it */
    paidCents?: Cents
    kept?: { by: By; at: string; why: OrderRefusal | 'linked'; shortCents: Cents }
  }
  /**
   * R2: other payments Square shows for this sale once it was paid (the card run twice), or the
   * order that didn't match when another one paid the seat. Each is an item in To decide
   * (Refund it · It's already sorted) until an owner answers it.
   */
  extraPayments?: ReaderExtraPayment[]
  /**
   * R3: paid after the seat was let go, or after its 30-minute hold ran out and the class filled
   * (seated over capacity). An item in To decide (Keep them · Refund and free the seat).
   */
  late?: { at: string; overCapacity: boolean; afterLetGo: boolean; decided?: { what: 'kept' | 'refunded'; by: By; at: string } }
  /** Refunds sent back on payments of this sale that weren't its seat's (the shared refund runner writes these). */
  refunds?: { paymentId: string; orderId: string; cents: Cents; squareRefundId: string | null; requestId: string; at: string; by: By }[]
  ended?: { at: string; why: string; by: By | null }
  /** the crew-facing answer of the return that finished it, so a replay gets the same one */
  answer?: { message: string; outcome: string }
}

export interface ReaderExtraPayment {
  orderId: string
  paymentIds: string[]
  /** what Square shows (less any tip) */
  cents: Cents
  at: string
  /** the order that didn't match before another paid the seat (so it's a second payment now) */
  from: 'second' | 'mismatch'
  decided?: { what: 'refunded' | 'sorted'; by: By; at: string }
}

export async function getReaderSale(bookingId: string): Promise<ReaderSale | null> {
  const raw = await salesKv.get(saleKey(bookingId))
  return raw ? (JSON.parse(raw) as ReaderSale) : null
}

/** Saves a new sale; refuses one already there (the same booking id is never started twice). */
export async function createReaderSale(sale: ReaderSale): Promise<boolean> {
  assertClassWritesAllowed()
  const k = saleKey(sale.bookingId)
  const { value, etag } = await salesKv.getWithMeta(k)
  if (value) return false
  return salesKv.setIfMatch(k, JSON.stringify(sale), etag, false)
}

/**
 * Read-modify-write one sale (CAS ×3). `fn` gets the fresh record and returns
 * the next one, or null to leave it. Returns the record as it is afterwards.
 */
export async function updateReaderSale(bookingId: string, fn: (cur: ReaderSale) => ReaderSale | null): Promise<ReaderSale | null> {
  assertClassWritesAllowed()
  const k = saleKey(bookingId)
  // One server instance changes a sale one at a time (a double return lands on the same one); across
  // instances the conditional write is what keeps it right.
  return withLock(k, async () => {
    for (let i = 0; i < ATTEMPTS; i++) {
      const { value, etag } = await salesKv.getWithMeta(k)
      if (!value) return null
      const cur = JSON.parse(value) as ReaderSale
      const next = fn(cur)
      if (!next) return cur
      if (await salesKv.setIfMatch(k, JSON.stringify(next), etag, true)) return next
    }
    throw new Error('Concurrent update — please retry')
  })
}

const locks = new Map<string, Promise<unknown>>()
function withLock<T>(k: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(k) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => undefined)
  locks.set(k, tail)
  void tail.then(() => { if (locks.get(k) === tail) locks.delete(k) })
  return run
}

/** Every sale on file (To decide also looks at paid ones: a second payment, a late payment). */
export async function listReaderSales(): Promise<ReaderSale[]> {
  const keys = (await salesKv.list()).filter((k) => k.startsWith('rdr-'))
  const all = await Promise.all(keys.map((k) => salesKv.get(k)))
  return all.filter((j): j is string => !!j).map((j) => JSON.parse(j) as ReaderSale)
}

/** Every sale still waiting on the reader (for the roster and To decide). */
export async function listWaitingReaderSales(): Promise<ReaderSale[]> {
  return (await listReaderSales()).filter((s) => s.state === 'waiting')
}

export interface ReaderOrderLink {
  orderId: string
  bookingId: string
  classId: string
  /** what the seats came to before tax, and their tax (OWNER-S4-8: Square sees a plain amount) */
  netCents: Cents
  taxCents: Cents
  at: string
}

/**
 * Ties a Square order to a booking, once. 'linked' = this call tied it;
 * 'same' = it was already this booking's (a replay); 'other' = another
 * booking has it (never paid twice from one payment).
 */
export async function linkReaderOrder(link: ReaderOrderLink): Promise<'linked' | 'same' | 'other'> {
  assertClassWritesAllowed()
  const k = orderKey(link.orderId)
  for (let i = 0; i < ATTEMPTS; i++) {
    const { value, etag } = await ordersKv.getWithMeta(k)
    if (value) return (JSON.parse(value) as ReaderOrderLink).bookingId === link.bookingId ? 'same' : 'other'
    if (await ordersKv.setIfMatch(k, JSON.stringify(link), etag, false)) return 'linked'
  }
  throw new Error('Concurrent update — please retry')
}

export async function getReaderOrderLink(orderId: string): Promise<ReaderOrderLink | null> {
  const raw = await ordersKv.get(orderKey(orderId))
  return raw ? (JSON.parse(raw) as ReaderOrderLink) : null
}

/** Every reader order we seated (the tax report takes their tax from here, OWNER-S4-8). */
export async function listReaderOrderLinks(): Promise<ReaderOrderLink[]> {
  const keys = (await ordersKv.list()).filter((k) => k.startsWith('ord-'))
  const all = await Promise.all(keys.map((k) => ordersKv.get(k)))
  return all.filter((j): j is string => !!j).map((j) => JSON.parse(j) as ReaderOrderLink)
}
