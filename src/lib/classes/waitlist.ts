/**
 * Stage 4 waitlist: join, leave, remove, close (Task 9). The runner that adds
 * and charges people is waitlist-runner.ts (Task 10).
 *
 * Join: the class is open, every picked session is too full for this group,
 * the waitlist hasn't closed, they aren't already waiting for these dates →
 * priced now (that total is the most they are ever charged) → their Square
 * customer → Square saves the card (we keep its id, brand, last 4 and expiry,
 * never the number) → the entry is written → "You're on the waitlist" email
 * with a leave link. A spot that opened meanwhile refuses the join and takes
 * the card back off file, so they book it instead.
 *
 * Server only.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { providers } from '@config/providers'
import { recordAudit } from '@lib/audit'
import { sendWaitlistJoinedEmail, sendWaitlistMissedEmail, sendWaitlistOffEmail } from '@lib/email'
import { createLogger } from '@lib/logger'
import { cardTroubleOf, SAVE_CARD_MESSAGES } from '@lib/saved-cards'
import { alertCardSetupOnce } from '@lib/saved-card-alerts'
import type { By } from '@lib/staff-auth'
import { formatSlotLabel } from '@lib/studio-time'
import { CLASS_TAX_PERCENT, cleanSeats, seatsLabelFor } from './checkout'
import { fitsNow, waitlistClosesIso, waitlistOpen } from './waitlist-rules'
import { getClass } from './class-store'
import { quote, type BookingRequest } from './pricing'
import { getLedger } from './seat-ledger'
import type { ScheduledClass } from './types'
import {
  getWaitlist, isOnList, mutateWaitlist, updateEntry, type Waitlist, type WaitlistEntry,
} from './waitlist-store'
import { closesLabel, consentText, CONSENT_VERSION, MAX_WAITING_PER_CLASS, WAITLIST_MESSAGES } from './waitlist-words'

const logger = createLogger('classes:waitlist')

export class WaitlistError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message) }
}

export { fitsNow, waitingOn, waitlistClosesIso, waitlistCutoffHours, waitlistOpen } from './waitlist-rules'

// ── Leave links ──────────────────────────────────────────────────────────────

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/** A leave link's token: `{classId}.{entryId}.{secret}`; only its sha256 is stored. */
export function makeLeaveToken(classId: string, entryId: string): { token: string; hash: string } {
  const token = `${classId}.${entryId}.${randomBytes(24).toString('base64url')}`
  return { token, hash: sha(token) }
}

/** Reads a token; null when it isn't one of ours (same answer as a wrong one). */
export function readLeaveToken(token: unknown): { classId: string; entryId: string; hash: string } | null {
  if (typeof token !== 'string' || token.length > 200) return null
  const m = /^(cls_[A-Za-z0-9_-]{1,40})\.(wle_[0-9a-f]{16})\.([A-Za-z0-9_-]{20,64})$/.exec(token)
  return m ? { classId: m[1], entryId: m[2], hash: sha(token) } : null
}

const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export const leaveUrl = (origin: string, token: string) => `${origin}/classes/waitlist/${encodeURIComponent(token)}`

/** The entry a leave token is for, or null (wrong token and missing entry look the same). */
export async function entryForToken(token: unknown): Promise<{ cls: ScheduledClass | null; entry: WaitlistEntry } | null> {
  const t = readLeaveToken(token)
  if (!t) return null
  const list = await getWaitlist(t.classId)
  const entry = list.entries.find((e) => e.id === t.entryId)
  if (!entry || !sameHash(entry.leaveHash, t.hash)) return null
  return { cls: await getClass(t.classId).catch(() => null), entry }
}

// ── Words ────────────────────────────────────────────────────────────────────

export const entryId = (attemptId: string) => `wle_${sha(`waitlist:${attemptId}`).slice(0, 16)}`
const whenOf = (cls: ScheduledClass | null, sessionIds: string[]) => {
  const s = cls?.sessions.filter((x) => sessionIds.includes(x.id)).sort((a, b) => a.startIso.localeCompare(b.startIso))[0]
  return s ? formatSlotLabel(s.startIso).replace(' CT', '') : 'the date you picked'
}
const seatsWords = (cls: ScheduledClass, e: Pick<WaitlistEntry, 'request' | 'seats'>) => {
  const seats = cls.content.ticketTypes.flatMap((t) => Array.from({ length: e.request.tickets[t.id] ?? 0 }, () => ({ ticketTypeId: t.id })))
  return seatsLabelFor(cls, seats.length ? seats : Array.from({ length: e.seats }, () => ({ ticketTypeId: '' })))
}
export const nameOfEntry = (e: Pick<WaitlistEntry, 'customer'>) => `${e.customer.givenName} ${e.customer.familyName}`.trim()

// ── Join ─────────────────────────────────────────────────────────────────────

export interface JoinInput {
  classId: string
  attemptId: string
  request: BookingRequest
  customer: { givenName: string; familyName: string; email: string; phone: string }
  cardToken: string
  verificationToken: string | null
  consent: boolean
  ip: string
  origin: string
}

export interface JoinResult {
  entryId: string
  position: number
  waiting: number
  card: { brand: string; last4: string }
  emailSent: boolean
  replayed?: true
}

const positionOf = (list: Waitlist, id: string) => list.entries.filter((e) => isOnList(e)).findIndex((e) => e.id === id) + 1

/** Takes a card back off file. Never throws: a failure is logged (the card sits unused on file; Square keeps it). */
async function cardOff(cardId: string, why: string): Promise<boolean> {
  try {
    await providers.payment.disableCard(cardId)
    return true
  } catch (err) {
    logger.error('Saved card not taken off file', { why, error: err instanceof Error ? err.message : String(err) })
    return false
  }
}

export async function joinWaitlist(input: JoinInput, now = new Date()): Promise<JoinResult> {
  if (!input.consent) throw new WaitlistError(400, 'consent', WAITLIST_MESSAGES.consent)
  const cls = await getClass(input.classId)
  if (!cls) throw new WaitlistError(404, 'not_open', WAITLIST_MESSAGES.notOpen)
  const id = entryId(input.attemptId)
  // Only this class's own questions and add-on counts are kept (as at checkout).
  const req: BookingRequest = { ...input.request, ...(input.request.seats ? { seats: cleanSeats(cls, input.request.seats) } : {}) }

  // A retry of a join that already landed: the stored answer.
  const before = await getWaitlist(cls.id)
  const mine = before.entries.find((e) => e.id === id)
  if (mine) {
    return { entryId: id, position: positionOf(before, id), waiting: before.entries.filter(isOnList).length, card: { brand: mine.square.brand, last4: mine.square.last4 }, emailSent: true, replayed: true }
  }

  if (cls.status !== 'open') throw new WaitlistError(409, 'not_open', WAITLIST_MESSAGES.notOpen)
  const priced = quote(cls, { ...req, promoCode: undefined }, now, CLASS_TAX_PERCENT)
  if (!priced.ok) {
    throw priced.field ? new WaitlistError(400, 'invalid', priced.error) : new WaitlistError(409, 'not_open', `${priced.error} Nothing was charged.`)
  }
  const q = priced.value
  if (!waitlistOpen(cls, q.sessionIds, now)) throw new WaitlistError(409, 'closed', WAITLIST_MESSAGES.closed)
  if (q.totalCents <= 0) throw new WaitlistError(409, 'not_open', WAITLIST_MESSAGES.notOpen)

  const ledger = await getLedger(cls.id)
  if (fitsNow(cls, ledger, q.sessionIds, q.seats, now)) throw new WaitlistError(409, 'spot_open', WAITLIST_MESSAGES.spotOpen)
  const email = input.customer.email.trim().toLowerCase()
  const sameDates = (e: WaitlistEntry) => isOnList(e) && e.customer.email.toLowerCase() === email && [...e.sessionIds].sort().join() === [...q.sessionIds].sort().join()
  if (before.entries.some(sameDates)) throw new WaitlistError(409, 'duplicate', WAITLIST_MESSAGES.duplicate)
  if (before.entries.filter(isOnList).length >= MAX_WAITING_PER_CLASS) throw new WaitlistError(409, 'full', WAITLIST_MESSAGES.full)

  // Their Square customer: a saved card must belong to one.
  let customerId: string
  try {
    customerId = (await providers.customer.findOrCreate({ email: input.customer.email, givenName: input.customer.givenName, familyName: input.customer.familyName, phone: input.customer.phone })).id
  } catch (err) {
    logger.error('Customer lookup failed before saving a waitlist card', { error: String(err) })
    throw new WaitlistError(502, 'unavailable', WAITLIST_MESSAGES.unavailable)
  }

  // Square saves the card (STORE). Nothing is charged.
  let card: Awaited<ReturnType<typeof providers.payment.saveCard>>
  try {
    card = await providers.payment.saveCard({
      customerId, sourceToken: input.cardToken, verificationToken: input.verificationToken,
      idempotencyKey: `wl:${input.attemptId}:card`, referenceId: id,
    })
  } catch (err) {
    const trouble = cardTroubleOf(err)
    logger.warn('Waitlist card not saved', { classId: cls.id, trouble })
    if (trouble === 'setup') await alertCardSetupOnce('save', now)
    throw new WaitlistError(402, 'card', SAVE_CARD_MESSAGES[trouble])
  }

  const consent = consentText(waitlistClosesIso(cls, q.sessionIds)!, q.totalCents)
  const { token, hash } = makeLeaveToken(cls.id, id)
  const entry: WaitlistEntry = {
    id,
    createdAt: now.toISOString(),
    request: { passId: req.passId, tickets: { ...req.tickets }, ...(req.sessionIds ? { sessionIds: [...req.sessionIds] } : {}), ...(req.seats ? { seats: req.seats } : {}) },
    sessionIds: [...q.sessionIds],
    seats: q.seats,
    maxCents: q.totalCents,
    customer: { ...input.customer },
    square: { customerId, cardId: card.cardId, brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear },
    consent: { textVersion: CONSENT_VERSION, text: consent, at: now.toISOString(), ipHash: sha(`ip:${input.ip}`).slice(0, 16) },
    leaveHash: hash,
    state: 'waiting',
    attempts: [],
    history: [{ at: now.toISOString(), by: null, change: 'Joined the waitlist' }],
  }

  // A seat may have opened while the card was saved: they book it instead, and the card comes off.
  let written: { list: Waitlist } | { refused: WaitlistError } | null = null
  try {
    const fresh = await getLedger(cls.id)
    if (fitsNow(cls, fresh, q.sessionIds, q.seats, now)) written = { refused: new WaitlistError(409, 'spot_open', WAITLIST_MESSAGES.spotOpen) }
    else {
      written = await mutateWaitlist(cls.id, (cur): { next: Waitlist | null; result: { list: Waitlist } | { refused: WaitlistError } } => {
        if (cur.entries.some((e) => e.id === id)) return { next: null, result: { list: cur } }
        if (cur.entries.some(sameDates)) return { next: null, result: { refused: new WaitlistError(409, 'duplicate', WAITLIST_MESSAGES.duplicate) } }
        if (cur.entries.filter(isOnList).length >= MAX_WAITING_PER_CLASS) return { next: null, result: { refused: new WaitlistError(409, 'full', WAITLIST_MESSAGES.full) } }
        const next = { ...cur, entries: [...cur.entries, entry] }
        return { next, result: { list: next } }
      })
    }
  } catch (err) {
    logger.error('Waitlist entry not written — taking the card back off', { classId: cls.id, error: String(err) })
    await cardOff(card.cardId, 'entry not written')
    throw new WaitlistError(502, 'unavailable', WAITLIST_MESSAGES.unavailable)
  }
  if ('refused' in written) {
    await cardOff(card.cardId, written.refused.code)
    throw written.refused
  }
  const list = written.list

  const emailSent = (await sendWaitlistJoinedEmail({
    to: input.customer.email, givenName: input.customer.givenName, className: cls.content.name,
    whenLabel: whenOf(cls, q.sessionIds), seatsLabel: seatsWords(cls, entry), maxCents: q.totalCents, last4: card.last4,
    leaveUrl: leaveUrl(input.origin, token), closesLabel: closesLabel(waitlistClosesIso(cls, q.sessionIds)!),
  }).catch(() => ({ sent: false }))).sent
  if (!emailSent) logger.warn('Waitlist joined email not sent (they are on the list)', { classId: cls.id, entryId: id })

  return { entryId: id, position: positionOf(list, id), waiting: list.entries.filter(isOnList).length, card: { brand: card.brand, last4: card.last4 }, emailSent }
}

// ── Leave, remove, close ─────────────────────────────────────────────────────

/** Off the list for one reason; the card comes off file. Only an entry still waiting changes. */
async function takeOff(
  cls: ScheduledClass | null, classId: string, entry: WaitlistEntry, state: 'left' | 'removed' | 'closed',
  by: By | null, change: string, now: Date,
): Promise<WaitlistEntry | null> {
  const changed = await updateEntry(classId, entry.id, (e) => (e.state === 'waiting' ? { ...e, state } : null), { by, change }, now)
  if (!changed || changed.state !== state) return null
  if (await cardOff(changed.square.cardId, state)) {
    await updateEntry(classId, entry.id, (e) => ({ ...e, cardOffAt: now.toISOString() }), null, now).catch(() => undefined)
  }
  return changed
}

export type LeaveResult = { result: 'left' | 'already-off' | 'added'; className: string }

/** The leave link: off the list, card off file, "You're off the waitlist" email. */
export async function leaveWaitlist(token: unknown, now = new Date()): Promise<LeaveResult> {
  const found = await entryForToken(token)
  if (!found) throw new WaitlistError(404, 'not_found', WAITLIST_MESSAGES.notFound)
  const { cls, entry } = found
  const className = cls?.content.name ?? 'the class'
  if (entry.state === 'charging') throw new WaitlistError(409, 'charging', WAITLIST_MESSAGES.charging)
  if (entry.state === 'added') return { result: 'added', className }
  if (entry.state !== 'waiting') return { result: 'already-off', className }
  const classId = readLeaveToken(token)!.classId
  const off = await takeOff(cls, classId, entry, 'left', null, 'Left the waitlist (their link)', now)
  if (!off) {
    const again = (await getWaitlist(classId)).entries.find((e) => e.id === entry.id)
    if (again?.state === 'charging') throw new WaitlistError(409, 'charging', WAITLIST_MESSAGES.charging)
    return { result: again?.state === 'added' ? 'added' : 'already-off', className }
  }
  await sendWaitlistOffEmail({ to: entry.customer.email, givenName: entry.customer.givenName, className, whenLabel: whenOf(cls, entry.sessionIds), byStudio: false }).catch(() => undefined)
  return { result: 'left', className }
}

/** An owner takes someone off (/admin class sheet): card off file, they're emailed. */
export async function removeFromWaitlist(classId: string, id: string, by: By, now = new Date()): Promise<WaitlistEntry> {
  const cls = await getClass(classId)
  if (!cls) throw new WaitlistError(404, 'not_found', 'That class is gone. Reload the page.')
  const entry = (await getWaitlist(classId)).entries.find((e) => e.id === id)
  if (!entry) throw new WaitlistError(404, 'not_found', 'They aren’t on this waitlist any more. Reload the page.')
  if (entry.state === 'charging') throw new WaitlistError(409, 'charging', 'They’re being added to the class right now, so they can’t be taken off. Check again in a few minutes.')
  if (entry.state !== 'waiting') throw new WaitlistError(409, 'not_waiting', 'They aren’t waiting any more. Reload the page.')
  const off = await takeOff(cls, classId, entry, 'removed', by, `Taken off by ${by.name}`, now)
  if (!off) throw new WaitlistError(409, 'not_waiting', 'They aren’t waiting any more. Reload the page.')
  const emailed = (await sendWaitlistOffEmail({ to: entry.customer.email, givenName: entry.customer.givenName, className: cls.content.name, whenLabel: whenOf(cls, entry.sessionIds), byStudio: true }).catch(() => ({ sent: false }))).sent
  await recordAudit({ by: { ...by, role: 'owner' }, action: 'waitlist-remove', target: { kind: 'class', id: classId, label: cls.content.name }, details: { entryId: id, name: nameOfEntry(entry), emailed } })
  return off
}

/**
 * The waitlist for these dates has closed (cutoff passed) or the class was
 * cancelled: everyone still waiting comes off, cards off file. `tell`: email
 * them ("No spot opened…"); a cancelled class doesn't (the owners contact
 * everyone about a cancel). Returns how many came off.
 */
export async function closeEntries(cls: ScheduledClass, ids: string[], why: 'cutoff' | 'cancelled', now = new Date(), origin = siteOrigin()): Promise<number> {
  let n = 0
  const list = await getWaitlist(cls.id)
  for (const id of ids) {
    const entry = list.entries.find((e) => e.id === id)
    if (!entry || entry.state !== 'waiting') continue
    const off = await takeOff(cls, cls.id, entry, 'closed', null, why === 'cutoff' ? 'The waitlist closed before a spot opened' : 'The class was cancelled', now)
    if (!off) continue
    n++
    if (why === 'cutoff') {
      await sendWaitlistMissedEmail({
        to: entry.customer.email, givenName: entry.customer.givenName, className: cls.content.name, whenLabel: whenOf(cls, entry.sessionIds),
        why: 'closed', last4: entry.square.last4, classUrl: `${origin}/workshops`,
      }).catch(() => undefined)
    }
  }
  return n
}

/** Cancel: the whole list closes, nobody is charged. Never throws. */
export async function closeWaitlist(classId: string, now = new Date()): Promise<number> {
  try {
    const cls = await getClass(classId)
    if (!cls) return 0
    const list = await getWaitlist(classId)
    return await closeEntries(cls, list.entries.filter((e) => e.state === 'waiting').map((e) => e.id), 'cancelled', now)
  } catch (err) {
    logger.error('Waitlist not closed on cancel', { classId, error: String(err) })
    return 0
  }
}

/** The live site's address, for links in emails sent outside a request (the sweep). */
export function siteOrigin(): string {
  const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  const url = env.URL || (typeof process !== 'undefined' ? process.env.URL : '') || 'https://ourhometownstudio.com'
  return String(url).replace(/\/$/, '')
}

export { whenOf as waitlistWhen, seatsWords as waitlistSeatsWords }

// ── What /admin shows ────────────────────────────────────────────────────────

export interface WaitlistRow {
  id: string
  /** 1-based place among those still waiting; null once off the list. */
  position: number | null
  name: string
  email: string
  phone: string
  seats: number
  seatsLabel: string
  sessionIds: string[]
  joinedAt: string
  state: WaitlistEntry['state']
  /** One plain line of where they are: "Waiting", "Added · $21.80 charged", "Card didn't go through", … */
  stateWords: string
  card: string
  maxCents: number
  bookingId: string | null
  /** What happened, oldest first (joined, tries, taken off). */
  history: { at: string; by: string | null; change: string }[]
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`
const BRAND: Record<string, string> = { VISA: 'Visa', MASTERCARD: 'Mastercard', AMERICAN_EXPRESS: 'Amex', DISCOVER: 'Discover' }

export function stateWords(e: WaitlistEntry): string {
  const last = e.attempts[e.attempts.length - 1]
  switch (e.state) {
    case 'waiting':
      if (last?.outcome === 'setup') return 'Waiting · Square refused the last try, nobody was charged'
      return 'Waiting'
    case 'charging':
      return last?.outcome === 'unknown' ? 'Adding them · Square hasn’t said whether the card was charged' : 'Adding them now'
    case 'added': return `Added${last?.amountCents ? ` · ${money(last.amountCents)} charged` : ''}`
    case 'declined': return 'Card didn’t go through · off the list'
    case 'skipped': return 'Price went up since they joined · not charged, off the list'
    case 'left': return 'Left the waitlist'
    case 'removed': return 'Taken off'
    case 'closed': return 'Waitlist closed · not charged'
  }
}

export function waitlistRows(cls: ScheduledClass, list: Waitlist): WaitlistRow[] {
  return [...list.entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((e) => ({
    id: e.id,
    position: isOnList(e) ? positionOf(list, e.id) : null,
    name: nameOfEntry(e),
    email: e.customer.email,
    phone: e.customer.phone,
    seats: e.seats,
    seatsLabel: seatsWords(cls, e),
    sessionIds: e.sessionIds,
    joinedAt: e.createdAt,
    state: e.state,
    stateWords: stateWords(e),
    card: `${BRAND[e.square.brand] ?? 'Card'} ending ${e.square.last4}`,
    maxCents: e.maxCents,
    bookingId: e.bookingId ?? null,
    history: e.history.map((h) => ({ at: h.at, by: h.by?.name ?? null, change: h.change })),
  }))
}
