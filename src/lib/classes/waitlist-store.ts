/**
 * Stage 4 waitlist: one document per class (kv `waitlists`, key `wl-{classId}`),
 * written compare-and-swap, three tries, like the seat ledger. It holds the
 * entries in the order people joined, and the runner's lock (`runner`), so
 * two runs on one class (a refund, Square's webhook and the sweep at once)
 * can never both charge someone.
 *
 * We never store card data: only Square's card id, brand, last 4 and expiry,
 * and the Square customer id.
 *
 * Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'
import type { AgreedLine, BookingRequest } from './pricing'
import type { CardTrouble } from '@lib/saved-cards'
import type { Cents } from './types'
import { assertClassWritesAllowed } from './test-site-guard'

export type WaitlistState = 'waiting' | 'charging' | 'added' | 'declined' | 'skipped' | 'left' | 'removed' | 'closed'

/**
 * One try at adding someone. `n` is the try number; the idempotency keys are
 * made from `attemptId` (`wl:{entryId}:{n}`), so a retry of the same try sends
 * exactly the same order and charge (amount, note) and Square can never take
 * the money twice. A new try (n + 1) is made only once Square says the last
 * one wasn't paid.
 */
export interface WaitlistAttempt {
  n: number
  at: string
  attemptId: string
  bookingId: string
  orderId: string | null
  /** What was (or is being) charged: Square's order total. Sent identically on every retry of this try. */
  amountCents: Cents | null
  /** The payment note, kept so a retry sends the identical charge. */
  note: string | null
  paymentId?: string | null
  /**
   * paid · declined (the card said no) · unknown (Square never answered) ·
   * price-rose (today's price is above what they agreed to; never charged) ·
   * setup (Square refused the request itself; nobody charged) ·
   * no-seat (the seat was taken before the charge was ever sent) · error
   * (Square couldn't make the order; nothing sent) · register (the
   * register's price or listing didn't match; nothing sent) · no-payment
   * (the charge was unclear and Square shows no payment for it; settled
   * without ever sending it again) · unpaid (older name for no-payment) ·
   * null while running
   *
   * I1: a new try (n + 1) is only ever made after a FINAL "not charged":
   * setup, error, register, no-seat (nothing sent), declined, or no-payment
   * decided by an owner or settled read-only. While a try is `unknown` the
   * same order, amount and keys are kept.
   */
  outcome: 'paid' | 'declined' | 'unknown' | 'price-rose' | 'setup' | 'no-seat' | 'error' | 'register' | 'no-payment' | 'unpaid' | null
  /** Why a saved-card charge didn't go through (saved-cards.ts). */
  trouble?: CardTrouble
  /** When the charge was last sent to Square (every resend of this same try updates it). */
  sentAt?: string
  /** price-rose: today's price is higher ('price') or what they picked isn't sold any more ('gone'). */
  skipWhy?: 'price' | 'gone'
  /** What we actually sent the family about this try (M5). */
  told?: { text: boolean; email: boolean }
  /** R4: Square took this charge just as the class was cancelled; nobody told them they're in. Owners refund it from To decide. */
  cancelledPaid?: boolean
}

export interface WaitlistEntry {
  id: string                                  // 'wle_…'
  createdAt: string                           // order on the list
  request: BookingRequest                     // passId, sessionIds, tickets, seats — no promo (OWNER-S4-4)
  sessionIds: string[]                        // resolved at join
  seats: number
  /** The quote total shown at join; never charged above it (OWNER-S4-2). */
  maxCents: Cents
  /**
   * D6: each line's net as quoted at join (early-bird included). A seat that
   * opens later is charged no more than this per line, even once the
   * early-bird ends or the price rises. Older entries don't have it: the
   * runner works it out from the class as it was priced when they joined.
   */
  agreedLines?: AgreedLine[]
  customer: { givenName: string; familyName: string; email: string; phone: string }
  square: { customerId: string; cardId: string; brand: string; last4: string; expMonth: number; expYear: number }
  consent: { textVersion: string; text: string; at: string; ipHash: string }
  /** sha256 of the leave token (the link in their email). */
  leaveHash: string
  state: WaitlistState
  attempts: WaitlistAttempt[]
  history: { at: string; by: By | null; change: string }[]
  /** Set once the saved card is off file (DisableCard answered). Until then the sweep keeps trying (I6). */
  cardOffAt?: string
  /**
   * C1: they asked to leave (their link) while a charge was unclear. From then
   * on that charge is never sent again; Square is only asked. Paid → they're
   * in (and told); not paid → off the list, card off, emailed.
   */
  leaveAskedAt?: string
  /** The booking the waitlist made for them (state added). */
  bookingId?: string
}

export interface Waitlist {
  classId: string
  entries: WaitlistEntry[]
  /** The run in progress on this class, if any. A lock that ran past `until` can be taken over. */
  runner?: { id: string; until: string } | null
}

const kv = makeKvStore('waitlists', 'waitlists')
const key = (classId: string) => `wl-${classId}`
const ATTEMPTS = 3
export const WAITLIST_RETRY = 'Concurrent update — please retry'

// One server runs a class's read-modify-write one at a time; across servers the conditional write keeps it right.
const locks = new Map<string, Promise<unknown>>()
function withLock<T>(k: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(k) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => undefined)
  locks.set(k, tail)
  void tail.then(() => { if (locks.get(k) === tail) locks.delete(k) })
  return run
}

const parse = (classId: string, json: string | null): Waitlist => (json ? (JSON.parse(json) as Waitlist) : { classId, entries: [] })

export async function getWaitlist(classId: string): Promise<Waitlist> {
  return parse(classId, await kv.get(key(classId)))
}

/** Every class that has (or had) a waitlist. */
export async function waitlistClassIds(): Promise<string[]> {
  return (await kv.list()).filter((k) => k.startsWith('wl-')).map((k) => k.slice(3))
}

/**
 * Read-modify-write with CAS and 3 tries. `fn` gets fresh data each try and
 * returns the next document (or null to write nothing) and a result.
 */
export async function mutateWaitlist<T>(classId: string, fn: (cur: Waitlist) => { next: Waitlist | null; result: T }): Promise<T> {
  assertClassWritesAllowed() // R41: a test site with no store of its own never writes the live waitlist
  const k = key(classId)
  return withLock(k, async () => {
    for (let i = 0; i < ATTEMPTS; i++) {
      const { value, etag } = await kv.getWithMeta(k)
      const { next, result } = fn(parse(classId, value))
      if (!next) return result
      if (await kv.setIfMatch(k, JSON.stringify(next), etag, value !== null)) return result
    }
    throw new Error(WAITLIST_RETRY)
  })
}

/** Off the list for good (their card should be off file). */
export const isFinal = (e: Pick<WaitlistEntry, 'state'>): boolean => e.state !== 'waiting' && e.state !== 'charging'

/** I6: an entry off the list whose saved card isn't confirmed off file yet. */
export const cardStillOn = (e: Pick<WaitlistEntry, 'state' | 'cardOffAt'>): boolean => isFinal(e) && !e.cardOffAt

/** Entries still on the list: waiting, or being charged right now. */
export const isOnList = (e: Pick<WaitlistEntry, 'state'>): boolean => e.state === 'waiting' || e.state === 'charging'

/** The latest try at adding them, if any. */
export const lastAttempt = (e: Pick<WaitlistEntry, 'attempts'>): WaitlistAttempt | undefined => e.attempts[e.attempts.length - 1]

/** Changes one entry (by id) with a history line. Returns the entry as written, or null when it isn't there. */
export async function updateEntry(
  classId: string,
  entryId: string,
  change: (e: WaitlistEntry) => WaitlistEntry | null,
  history: { by: By | null; change: string } | null,
  now = new Date(),
): Promise<WaitlistEntry | null> {
  return mutateWaitlist(classId, (cur) => {
    const i = cur.entries.findIndex((e) => e.id === entryId)
    if (i < 0) return { next: null, result: null }
    const changed = change(cur.entries[i])
    if (!changed) return { next: null, result: cur.entries[i] }
    const withHistory = history
      ? { ...changed, history: [...changed.history, { at: now.toISOString(), by: history.by, change: history.change }].slice(-50) }
      : changed
    const entries = cur.entries.map((e, n) => (n === i ? withHistory : e))
    return { next: { ...cur, entries }, result: withHistory }
  })
}

/** For pages that only show counts: the waitlist, or null when it can't be read (nothing on a paying path uses this). */
export async function waitlistOrNull(classId: string): Promise<Waitlist | null> {
  try {
    return await getWaitlist(classId)
  } catch {
    return null
  }
}
