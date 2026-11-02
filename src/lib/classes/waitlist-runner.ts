/**
 * Stage 4 waitlist runner (Task 10): when a seat frees up, add the next
 * person whose group fits and charge the card Square saved for them, with
 * the consent they gave when joining.
 *
 * What starts a run (S4-R3): a refund or "free the seat" that frees seats
 * (onSeatFreed), a POS return that frees seats, an owner raising capacity,
 * an owner's "Run the waitlist now", a public booking refused because the
 * waitlist goes first, and the 10-minute sweep. A refund that keeps the seat
 * never does. Cancelling a class closes its waitlist without charging.
 *
 * One run per class at a time: a lock in the waitlist document (CAS). Another
 * live run → this one returns at once (the sweep picks up anything left).
 *
 * Each try at adding someone is attempt n of their entry, with idempotency
 * keys `wl:{entryId}:{n}:order` / `:pay`, its amount and note written down
 * BEFORE the charge, so a retry of that try sends exactly the same order and
 * charge and Square can never take the money twice. A new try (n + 1) is only
 * ever made after Square says the last one wasn't paid (or refused it).
 *
 *   paid     → seats confirmed, entry added, card off file (OWNER-S4-3),
 *              "You're in" text + email, owners told
 *   declined → hold let go, entry declined, card off file, family told
 *              kindly, owners alerted, next person (OWNER-S4-10)
 *   unknown  → seat kept held a day (R15), entry stays charging, owners
 *              alerted, the run STOPS; the next run asks Square first
 *   setup    → Square refused the request itself (our token, permission, a
 *              field): hold let go, entry back to waiting, card kept, nobody
 *              told but the owners (once a day), the run STOPS
 *
 * Never refunds, never removes anyone else, never releases a paid seat.
 *
 * Server only.
 */
import { randomUUID } from 'node:crypto'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { recordAudit } from '@lib/audit'
import { judgeDrift, tellOwnersOfDrift } from '@lib/booking-core/charge'
import { idFor } from '@lib/booking-core/ids'
import { chargeOutcomeOf, squareErrorCodes } from '@lib/checkout-attempt'
import { sendWaitlistMissedEmail } from '@lib/email'
import { createLogger } from '@lib/logger'
import { alertOwners } from '@lib/owner-alert'
import { sendQuoText } from '@lib/quo'
import { alertCardSetupOnce } from '@lib/saved-card-alerts'
import { cardTroubleOf, CHARGE_TROUBLE_WORDS, type CardTrouble } from '@lib/saved-cards'
import type { By } from '@lib/staff-auth'
import { formatSlotLabel } from '@lib/studio-time'
import type { Payment } from '@providers/interfaces/payment'
import { CLASS_TAX_PERCENT, HOLD_MINUTES, orderLinesFor, UNCLEAR_HOLD_HOURS } from './checkout'
import { getClass } from './class-store'
import { claimConfirmation, releaseConfirmation, sendClassConfirmation } from './confirmation'
import { quote, type Quote } from './pricing'
import { confirm, extendHold, getLedger, hold, release, type HoldInput } from './seat-ledger'
import { isLiveHold } from './seat-status'
import type { ScheduledClass } from './types'
import { closeEntries, nameOfEntry, siteOrigin, waitlistSeatsWords, waitlistWhen } from './waitlist'
import { fitsNow, waitlistOpen } from './waitlist-rules'
import {
  getWaitlist, lastAttempt, mutateWaitlist, updateEntry, type WaitlistAttempt, type WaitlistEntry,
} from './waitlist-store'

const logger = createLogger('classes:waitlist-runner')

/** How long one run's lock lasts; a lock past this can be taken over. */
export const RUN_LOCK_MS = 2 * 60_000
/** At most this many charge tries per run (the rest by the sweep). */
export const INLINE_BUDGET = 3
/** A try left mid-charge (no outcome written) is only picked up again after this long. */
export const STALE_CHARGE_MS = 10 * 60_000

export type RunReason = 'seat-freed' | 'capacity' | 'sweep' | 'owner' | 'booking'
export interface RunResult {
  ran: boolean
  added: number
  declined: number
  skipped: number
  closed: number
  unknown: number
  /** Why the run stopped early, if it did. */
  stopped: null | 'busy' | 'unknown' | 'setup' | 'error' | 'register'
  /** One plain line for the owner who pressed "Run the waitlist now". */
  note: string
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`

// ── The saved-card charge, three answers plus setup ──────────────────────────

export type SavedChargeResult =
  | { kind: 'paid'; payment: Payment; recovered?: true }
  | { kind: 'declined'; trouble: CardTrouble; codes: string[] }
  | { kind: 'setup'; codes: string[] }
  | { kind: 'unknown'; error: unknown }

/**
 * Charge a saved card for one order (the waitlist's twin of booking-core
 * chargeOrder). A 4xx is "not charged": a card problem is declined, a refusal
 * of our request is setup. No answer → ask Square whether the order is paid
 * before saying unknown. A payment marked failed is declined.
 */
export async function chargeSaved(input: {
  orderId: string; cardId: string; customerId: string; amount: number; idempotencyKey: string; email: string; note: string
}): Promise<SavedChargeResult> {
  let payment: Payment
  try {
    payment = await providers.payment.chargeSavedCard({
      orderId: input.orderId, cardId: input.cardId, customerId: input.customerId, amount: input.amount,
      idempotencyKey: input.idempotencyKey, buyerEmailAddress: input.email, note: input.note,
    })
  } catch (err) {
    if (chargeOutcomeOf(err) === 'not_charged') {
      const trouble = cardTroubleOf(err)
      if (trouble === 'setup') return { kind: 'setup', codes: squareErrorCodes(err) }
      return { kind: 'declined', trouble, codes: squareErrorCodes(err) }
    }
    let found: Payment | null = null
    try {
      found = await providers.payment.findOrderPayment(input.orderId)
    } catch { /* still unknown */ }
    if (found?.status === 'completed') return { kind: 'paid', payment: found, recovered: true }
    return { kind: 'unknown', error: err }
  }
  if (payment.status === 'failed') return { kind: 'declined', trouble: 'declined', codes: [] }
  if (payment.status !== 'completed') return { kind: 'unknown', error: new Error(`payment ${payment.status}`) }
  return { kind: 'paid', payment }
}

// ── The run ──────────────────────────────────────────────────────────────────

interface Ctx {
  cls: ScheduledClass
  now: Date
  origin: string
  result: RunResult
  by: By | null
}

const blank = (): RunResult => ({ ran: false, added: 0, declined: 0, skipped: 0, closed: 0, unknown: 0, stopped: null, note: '' })

/** Claims the class's run lock. True when this run holds it. */
async function claimLock(classId: string, id: string, now: Date): Promise<boolean> {
  return mutateWaitlist(classId, (cur) => {
    const live = cur.runner && cur.runner.id !== id && Date.parse(cur.runner.until) > now.getTime()
    if (live) return { next: null, result: false }
    return { next: { ...cur, runner: { id, until: new Date(now.getTime() + RUN_LOCK_MS).toISOString() } }, result: true }
  })
}

async function releaseLock(classId: string, id: string): Promise<void> {
  await mutateWaitlist(classId, (cur) => (cur.runner?.id === id ? { next: { ...cur, runner: null }, result: undefined } : { next: null, result: undefined }))
    .catch((err) => logger.error('Waitlist run lock not released (it runs out by itself)', { classId, error: String(err) }))
}

/**
 * Runs the class's waitlist: settles anything left mid-charge (asking Square),
 * closes entries whose cutoff passed, then adds the next people who fit, at
 * most INLINE_BUDGET charge tries. Never throws.
 */
export async function runWaitlist(classId: string, opts: { reason: RunReason; origin?: string; by?: By | null } = { reason: 'sweep' }, now = new Date()): Promise<RunResult> {
  const result = blank()
  const lockId = randomUUID()
  try {
    // Nothing on the list: nothing to lock or do.
    const before = await getWaitlist(classId)
    if (!before.entries.some((e) => e.state === 'waiting' || e.state === 'charging')) {
      result.note = 'Nobody is waiting.'
      return result
    }
    if (!(await claimLock(classId, lockId, now))) {
      result.stopped = 'busy'
      result.note = 'The waitlist is already running for this class. Check again in a minute.'
      return result
    }
  } catch (err) {
    logger.error('Waitlist run not started', { classId, reason: opts.reason, error: String(err) })
    result.stopped = 'error'
    result.note = 'The waitlist couldn’t be reached. Try again.'
    return result
  }
  result.ran = true
  try {
    const cls = await getClass(classId)
    if (!cls) return result
    const ctx: Ctx = { cls, now, origin: opts.origin ?? siteOrigin(), result, by: opts.by ?? null }
    await run(ctx, opts.reason)
  } catch (err) {
    logger.error('Waitlist run failed partway', { classId, reason: opts.reason, error: err instanceof Error ? err.message : String(err) })
    result.stopped = result.stopped ?? 'error'
  } finally {
    await releaseLock(classId, lockId)
  }
  result.note = noteOf(result)
  logger.info('Waitlist run', { classId, reason: opts.reason, ...result })
  return result
}

function noteOf(r: RunResult): string {
  const bits: string[] = []
  if (r.added) bits.push(`Added ${r.added} ${r.added === 1 ? 'person' : 'people'} and charged their saved card.`)
  if (r.declined) bits.push(`${r.declined} ${r.declined === 1 ? 'card' : 'cards'} didn’t go through; they came off the list.`)
  if (r.skipped) bits.push(`${r.skipped} skipped because the price is now higher than they agreed to.`)
  if (r.closed) bits.push(`${r.closed} came off because the waitlist closed.`)
  if (r.stopped === 'unknown') bits.push('Square didn’t say whether a card was charged, so the seat is held and it stopped there. It shows in To decide.')
  if (r.stopped === 'setup') bits.push('Square refused the request, so nobody was charged. Take waitlisted people by phone meanwhile.')
  if (r.stopped === 'register') bits.push('The register’s price for this class doesn’t match, so nobody was charged. Open the class and tap Save, then run it again.')
  if (r.stopped === 'error') bits.push('Square couldn’t be reached, so nobody was charged. Try again in a few minutes.')
  if (!bits.length) bits.push('Nobody on the waitlist fits the free seats right now.')
  return bits.join(' ')
}

async function run(ctx: Ctx, reason: RunReason): Promise<void> {
  const { cls, now, result } = ctx
  let list = await getWaitlist(cls.id)

  // A cancelled class: the list closes, nobody is charged.
  if (cls.status === 'cancelled') {
    result.closed += await closeEntries(cls, list.entries.filter((e) => e.state === 'waiting').map((e) => e.id), 'cancelled', now, ctx.origin)
    return
  }

  // 1. Anything left mid-charge or unanswered: ask Square before anything else (never a second payment).
  for (const e of list.entries.filter((x) => x.state === 'charging')) {
    const go = await settleCharging(ctx, e)
    if (go === 'stop') return
  }

  // 2. Entries whose waitlist closed: off the list, cards off, a kind email. A seat freed after the cutoff stays open.
  list = await getWaitlist(cls.id)
  const passed = list.entries.filter((e) => e.state === 'waiting' && timeIsUp(cls, e, now))
  if (passed.length) result.closed += await closeEntries(cls, passed.map((e) => e.id), 'cutoff', now, ctx.origin)

  // 3. Add the next people who fit (OWNER-S4-1: the first whose whole group fits; earlier ones keep their place).
  if (cls.status !== 'open') return
  let tries = 0
  while (tries < INLINE_BUDGET) {
    list = await getWaitlist(cls.id)
    const ledger = await getLedger(cls.id)
    const next = [...list.entries]
      .filter((e) => e.state === 'waiting' && waitlistOpen(cls, e.sessionIds, now))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .find((e) => fitsNow(cls, ledger, e.sessionIds, e.seats, now))
    if (!next) return
    tries++
    const go = await tryToAdd(ctx, next, reason)
    if (go === 'stop') return
  }
}

/** The waitlist for this entry's dates has closed (its time passed), whatever the class's status. */
function timeIsUp(cls: ScheduledClass, e: WaitlistEntry, now: Date): boolean {
  return !waitlistOpen({ ...cls, status: 'open' }, e.sessionIds, now)
}

type Go = 'next' | 'stop'

/** A new try for an entry that is waiting and fits. */
async function tryToAdd(ctx: Ctx, entry: WaitlistEntry, reason: RunReason): Promise<Go> {
  const { cls, now, result } = ctx
  const priced = quote(cls, { ...entry.request, promoCode: undefined }, now, CLASS_TAX_PERCENT)

  // Not sold any more (the option was removed), or today's price is above what they agreed to: skipped, never charged.
  if (!priced.ok || priced.value.totalCents > entry.maxCents) {
    const why = priced.ok ? 'price' : 'gone'
    const n = entry.attempts.length + 1
    const changed = await updateEntry(cls.id, entry.id, (e) => (e.state === 'waiting' ? {
      ...e, state: 'skipped',
      attempts: [...e.attempts, { n, at: now.toISOString(), attemptId: `wl:${e.id}:${n}`, bookingId: '', orderId: null, amountCents: priced.ok ? priced.value.totalCents : null, note: null, outcome: 'price-rose' }],
    } : null), { by: null, change: why === 'price' ? `A seat opened, but the price is now ${money(priced.ok ? priced.value.totalCents : 0)}, above the ${money(entry.maxCents)} they agreed to. Not charged.` : 'A seat opened, but what they asked for isn’t sold any more. Not charged.' }, now)
    if (changed?.state !== 'skipped') return 'next'
    result.skipped++
    await cardOff(cls.id, changed)
    await sendWaitlistMissedEmail({
      to: entry.customer.email, givenName: entry.customer.givenName, className: cls.content.name, whenLabel: waitlistWhen(cls, entry.sessionIds),
      why: 'price', last4: entry.square.last4, classUrl: `${ctx.origin}/classes/${cls.id}`,
    }).catch(() => undefined)
    await alertOwners(why === 'price'
      ? `Waitlist skipped ${nameOfEntry(entry)} for ${cls.content.name}: the price is now ${money(priced.ok ? priced.value.totalCents : 0)}, above the ${money(entry.maxCents)} they agreed to. Not charged; they were told. The seat goes to the next person.`
      : `Waitlist skipped ${nameOfEntry(entry)} for ${cls.content.name}: what they asked for isn't sold any more. Not charged; they were told.`).catch(() => undefined)
    return 'next'
  }
  const q = priced.value
  const lines = orderLinesFor(cls, q, entry.request.seats)
  if (!lines.ok) {
    await alertOwners(`${cls.content.name} isn't on the register yet, so the waitlist can't add anyone. Open the class in /admin and tap Put it on the register.`).catch(() => undefined)
    ctx.result.stopped = 'register'
    return 'stop'
  }

  const n = entry.attempts.length + 1
  const attemptId = `wl:${entry.id}:${n}`
  const bookingId = idFor('bkg', attemptId)
  const note = `Hometown waitlist ${bookingId} · ${cls.content.name} ${waitlistWhen(cls, entry.sessionIds)}`.slice(0, 500)
  const attempt: WaitlistAttempt = { n, at: now.toISOString(), attemptId, bookingId, orderId: null, amountCents: null, note, outcome: null }
  const marked = await updateEntry(cls.id, entry.id, (e) => (e.state === 'waiting' && e.attempts.length === n - 1 ? { ...e, state: 'charging', attempts: [...e.attempts, attempt] } : null),
    { by: ctx.by, change: `A seat opened: adding them (try ${n}${reason === 'owner' ? ', run by an owner' : ''})` }, now)
  if (!marked || marked.state !== 'charging' || lastAttempt(marked)?.n !== n) return 'next'
  return proceed(ctx, marked, attempt, q)
}

/**
 * A `charging` entry from an earlier run: if its try has no outcome yet and is
 * recent, another run may still be charging it: leave it. Otherwise ask
 * Square whether its order is paid; paid → finish adding them; not paid →
 * carry on with the SAME try (same keys, same amount and note).
 */
async function settleCharging(ctx: Ctx, entry: WaitlistEntry): Promise<Go> {
  const { cls, now } = ctx
  const a = lastAttempt(entry)
  if (!a) {
    await updateEntry(cls.id, entry.id, (e) => (e.state === 'charging' ? { ...e, state: 'waiting' } : null), { by: null, change: 'Back to waiting' }, now)
    return 'next'
  }
  if (a.outcome === null && now.getTime() - Date.parse(a.at) < STALE_CHARGE_MS) return 'next'
  const priced = quote(cls, { ...entry.request, promoCode: undefined }, new Date(a.at), CLASS_TAX_PERCENT)
  if (a.orderId) {
    let found: Payment | null
    try {
      found = await providers.payment.findOrderPayment(a.orderId)
    } catch (err) {
      logger.error('Could not ask Square about a waitlist charge — still held', { entryId: entry.id, n: a.n, error: String(err) })
      ctx.result.unknown++
      ctx.result.stopped = 'unknown'
      return 'stop'
    }
    if (found?.status === 'completed') {
      return finishPaid(ctx, entry, a, priced.ok ? priced.value : null, found, a.orderId, undefined)
    }
  }
  if (!priced.ok) {
    // What they asked for can't be priced any more and Square shows no payment: stays held for a person.
    ctx.result.unknown++
    ctx.result.stopped = 'unknown'
    return 'stop'
  }
  return proceed(ctx, entry, a, priced.value)
}

/** Hold → order → R14 → amount written down → charge → outcome. Shared by a new try and a resumed one. */
async function proceed(ctx: Ctx, entry: WaitlistEntry, a: WaitlistAttempt, q: Quote): Promise<Go> {
  const { cls, now } = ctx
  const holdInput: HoldInput = {
    bookingId: a.bookingId, passId: entry.request.passId, source: 'online', customer: { ...entry.customer },
    ttlMinutes: HOLD_MINUTES, ...(entry.request.seats ? { seats: entry.request.seats } : {}), waitlistEntryId: entry.id,
  }

  // The seat: this try's hold if it is still running, else a new hold under the same booking.
  const ledger = await getLedger(cls.id)
  const held = ledger.lines.some((l) => l.bookingId === a.bookingId && isLiveHold(l, now))
  if (!held) {
    let ok = false
    try {
      ok = (await hold(cls, q, holdInput, now)).ok
    } catch (err) {
      logger.error('Waitlist hold failed', { entryId: entry.id, error: String(err) })
    }
    if (!ok) {
      await backToWaiting(ctx, entry, a, a.amountCents === null ? 'no-seat' : 'unpaid', 'The seat was taken before it could be held. Still waiting; not charged.')
      return 'next'
    }
  }
  const letGo = async () => {
    await release(cls.id, a.bookingId).catch((err) => logger.error('Waitlist hold not released (it runs out by itself)', { bookingId: a.bookingId, error: String(err) }))
  }

  // The order (same key every time for this try: Square hands back the same order).
  const lines = orderLinesFor(cls, q, entry.request.seats)
  if (!lines.ok) {
    await letGo()
    await backToWaiting(ctx, entry, a, 'error', 'The class isn’t on the register, so nobody was charged.')
    ctx.result.stopped = 'register'
    return 'stop'
  }
  let order: { orderId: string; totalCents: number; lineTotals?: { totalCents: number; taxCents: number }[] }
  if (a.orderId && a.amountCents !== null) {
    // A resumed try: the order and amount written down before its charge are reused exactly.
    order = { orderId: a.orderId, totalCents: a.amountCents }
  } else try {
    order = await providers.payment.createClassOrder({
      locationId: siteConfig.providers.booking.config.locationId,
      customerId: entry.square.customerId,
      idempotencyKey: `${a.attemptId}:order`,
      lines: lines.lines,
      ...(lines.discounts.length ? { lineDiscounts: lines.discounts } : {}),
      referenceId: a.bookingId,
    })
  } catch (err) {
    if (a.amountCents !== null || squareErrorCodes(err).includes('IDEMPOTENCY_KEY_REUSED')) {
      // This try may already have charged (an earlier run sent the charge). Keep the seat and ask again later.
      return unknownOutcome(ctx, entry, a, err)
    }
    logger.error('Waitlist order failed — nobody charged', { entryId: entry.id, error: err instanceof Error ? err.message : String(err) })
    await letGo()
    await backToWaiting(ctx, entry, a, 'error', 'Square couldn’t make the order. Still waiting; not charged.')
    ctx.result.stopped = 'error'
    return 'stop'
  }

  // R14 and OWNER-S4-2: Square's total is charged, never above what they agreed to, never far above our quote.
  let amount = a.amountCents
  if (amount === null) {
    const verdict = judgeDrift(q.totalCents, order.totalCents, { tellBelowCents: q.lines.length })
    if (verdict.kind === 'refuse' || order.totalCents > entry.maxCents) {
      await letGo()
      await backToWaiting(ctx, entry, a, 'error', `The register asked ${money(order.totalCents)}, more than the website price. Not charged.`)
      await alertOwners(`Waitlist didn't charge ${nameOfEntry(entry)} for ${cls.content.name}: the register asked ${money(order.totalCents)}, the website ${money(q.totalCents)} (they agreed to ${money(entry.maxCents)}). Open the class in /admin and tap Save so the register gets its prices, then run the waitlist. Nothing was charged.`).catch(() => undefined)
      ctx.result.stopped = 'register'
      return 'stop'
    }
    if (verdict.kind === 'charge-and-tell') {
      await tellOwnersOfDrift(`Waitlist price differed — ${cls.content.name}`, `booking ${a.bookingId}`, q.totalCents, order.totalCents, '')
    }
    amount = order.totalCents
    // Written down before the charge: every retry of this try sends exactly this.
    const saved = await updateEntry(cls.id, entry.id, (e) => ({
      ...e, attempts: e.attempts.map((x) => (x.n === a.n ? { ...x, orderId: order.orderId, amountCents: amount } : x)),
    }), null, now)
    if (!saved) throw new Error('waitlist entry vanished')
  }

  const charged = await chargeSaved({
    orderId: order.orderId, cardId: entry.square.cardId, customerId: entry.square.customerId, amount: amount!,
    idempotencyKey: `${a.attemptId}:pay`, email: entry.customer.email, note: a.note ?? `Hometown waitlist ${a.bookingId}`,
  })
  const withOrder = { ...a, orderId: order.orderId, amountCents: amount }
  switch (charged.kind) {
    case 'paid':
      return finishPaid(ctx, entry, withOrder, q, charged.payment, order.orderId, order.lineTotals, holdInput)
    case 'declined':
      await letGo()
      return declined(ctx, entry, withOrder, charged.trouble)
    case 'setup':
      await letGo()
      await backToWaiting(ctx, entry, withOrder, 'setup', 'Square refused the request (a setup problem). Still waiting; not charged; card kept.')
      await alertCardSetupOnce('charge', now)
      ctx.result.stopped = 'setup'
      return 'stop'
    case 'unknown':
      return unknownOutcome(ctx, entry, withOrder, charged.error)
  }
}

async function backToWaiting(ctx: Ctx, entry: WaitlistEntry, a: WaitlistAttempt, outcome: WaitlistAttempt['outcome'], change: string): Promise<void> {
  await updateEntry(ctx.cls.id, entry.id, (e) => (e.state === 'charging' ? {
    ...e, state: 'waiting', attempts: e.attempts.map((x) => (x.n === a.n ? { ...x, outcome } : x)),
  } : null), { by: null, change }, ctx.now)
}

/** Takes the saved card off file (OWNER-S4-3) and notes it. Never throws. */
async function cardOff(classId: string, entry: WaitlistEntry): Promise<void> {
  try {
    await providers.payment.disableCard(entry.square.cardId)
    await updateEntry(classId, entry.id, (e) => ({ ...e, cardOffAt: new Date().toISOString() }), null).catch(() => undefined)
  } catch (err) {
    logger.error('Saved card not taken off file', { entryId: entry.id, error: err instanceof Error ? err.message : String(err) })
  }
}

async function text(to: string, content: string): Promise<void> {
  if (!to) return
  await sendQuoText({ to, content }).catch((err) => logger.warn('Waitlist text not sent', { error: String(err) }))
}

const firstStart = (cls: ScheduledClass, sessionIds: string[]) =>
  cls.sessions.filter((s) => sessionIds.includes(s.id)).sort((a, b) => a.startIso.localeCompare(b.startIso))[0]?.startIso ?? cls.sessions[0]?.startIso ?? ''

/** "Sat, Oct 24 at 10 AM" */
const whenWords = (iso: string) => formatSlotLabel(iso).replace(' CT', '').replace(' · ', ' at ').replace(':00 ', ' ')

/** Paid: confirm the seats (never refuses a paid booking), entry added, card off, "You're in", owners told. */
async function finishPaid(
  ctx: Ctx, entry: WaitlistEntry, a: WaitlistAttempt, q: Quote | null, payment: Payment, orderId: string,
  lineTotals: { totalCents: number; taxCents: number }[] | undefined, input?: HoldInput,
): Promise<Go> {
  const { cls, now, result } = ctx
  const chargedCents = payment.amount || a.amountCents || q?.totalCents || 0
  const holdInput: HoldInput = input ?? {
    bookingId: a.bookingId, passId: entry.request.passId, source: 'online', customer: { ...entry.customer },
    ttlMinutes: HOLD_MINUTES, ...(entry.request.seats ? { seats: entry.request.seats } : {}), waitlistEntryId: entry.id,
  }
  // The entry first: once Square has the money, nobody may ever charge this person again.
  const added = await updateEntry(cls.id, entry.id, (e) => ({
    ...e, state: 'added', bookingId: a.bookingId,
    attempts: e.attempts.map((x) => (x.n === a.n ? { ...x, orderId, amountCents: chargedCents, outcome: 'paid', paymentId: payment.id } : x)),
  }), { by: null, change: `Added and charged ${money(chargedCents)} to the card ending ${entry.square.last4}` }, now)
  if (!added) logger.error('WAITLIST PAID BUT ENTRY NOT MARKED ADDED', { entryId: entry.id, orderId })
  result.added++

  let recorded = true
  try {
    if (!q) throw new Error('no quote to record the seats from')
    await confirm(cls.id, a.bookingId, { orderId, paymentId: payment.id, chargedCents, ...(lineTotals ? { lineTotals } : {}) }, { cls, quote: q, input: holdInput }, now)
  } catch (err) {
    recorded = false
    logger.error('WAITLIST PAID, SEATS NOT RECORDED', { entryId: entry.id, bookingId: a.bookingId, orderId, error: String(err) })
    await extendHold(cls.id, a.bookingId, new Date(now.getTime() + UNCLEAR_HOLD_HOURS * 3_600_000).toISOString()).catch(() => undefined)
  }
  await cardOff(cls.id, entry)

  const start = firstStart(cls, entry.sessionIds)
  const seatsLabel = waitlistSeatsWords(cls, entry)
  const name = nameOfEntry(entry)
  // One confirmation per booking (Square's payment notice may race us): whoever claims it sends it.
  if (await claimConfirmation(a.bookingId)) {
    const sent = await sendClassConfirmation({
      origin: ctx.origin, bookingId: a.bookingId, cls, sessionIds: q?.sessionIds ?? entry.sessionIds, seats: entry.seats, seatsLabel,
      email: entry.customer.email, givenName: entry.customer.givenName, receiptUrl: payment.receiptUrl ?? null, totalChargedCents: chargedCents,
      lead: `A spot opened and you’re in! We charged ${money(chargedCents)} to your card ending ${entry.square.last4}.`,
    }).catch(() => false)
    if (!sent) await releaseConfirmation(a.bookingId)
  }
  await text(entry.customer.phone, `Hometown Studio here. A spot opened in ${cls.content.name} on ${whenWords(start)} and you're in! We charged ${money(chargedCents)} to your card ending ${entry.square.last4}. See you there.`)
  await alertOwners(`Waitlist added ${name} to ${cls.content.name} (${money(chargedCents)}).${recorded ? '' : ` Their seats aren't recorded yet; Square's payment notice books them, or it shows in /admin › To decide. Order ${orderId}.`}`).catch(() => undefined)
  await recordAudit({
    by: { id: 'waitlist', name: 'Waitlist', role: 'owner' },
    action: 'waitlist-added', target: { kind: 'class', id: cls.id, label: cls.content.name },
    details: { entryId: entry.id, bookingId: a.bookingId, orderId, paymentId: payment.id, cents: chargedCents, n: a.n, name, recovered: a.outcome === 'unknown' },
  }).catch(() => undefined)
  return 'next'
}

/** The card didn't go through: off the list, card off, family told kindly, owners alerted, the next person. */
async function declined(ctx: Ctx, entry: WaitlistEntry, a: WaitlistAttempt, trouble: CardTrouble): Promise<Go> {
  const { cls, now, result } = ctx
  const changed = await updateEntry(cls.id, entry.id, (e) => ({
    ...e, state: 'declined', attempts: e.attempts.map((x) => (x.n === a.n ? { ...x, orderId: a.orderId, amountCents: a.amountCents, outcome: 'declined', trouble } : x)),
  }), { by: null, change: `The card ending ${entry.square.last4} didn’t go through (${CHARGE_TROUBLE_WORDS[trouble]}). Off the list; not charged.` }, now)
  result.declined++
  await cardOff(cls.id, changed ?? entry)
  const start = firstStart(cls, entry.sessionIds)
  await sendWaitlistMissedEmail({
    to: entry.customer.email, givenName: entry.customer.givenName, className: cls.content.name, whenLabel: waitlistWhen(cls, entry.sessionIds),
    why: 'declined', last4: entry.square.last4, classUrl: `${ctx.origin}/classes/${cls.id}`,
  }).catch(() => undefined)
  await text(entry.customer.phone, `Hometown Studio here. A spot opened in ${cls.content.name} but your card ending ${entry.square.last4} didn't go through, so it went to the next person. You can join the waitlist again on our site.`)
  await alertOwners(`Waitlist: ${nameOfEntry(entry)}'s card ending ${entry.square.last4} didn't go through for ${cls.content.name} ${whenWords(start)} (${CHARGE_TROUBLE_WORDS[trouble]}). Nothing was charged; they were told, and the seat goes to the next person.`).catch(() => undefined)
  await recordAudit({
    by: { id: 'waitlist', name: 'Waitlist', role: 'owner' },
    action: 'waitlist-declined', target: { kind: 'class', id: cls.id, label: cls.content.name },
    details: { entryId: entry.id, n: a.n, trouble, name: nameOfEntry(entry) },
  }).catch(() => undefined)
  return 'next'
}

/** No answer from Square: the seat stays held a day (R15), the entry stays charging, owners alerted once, the run stops. */
async function unknownOutcome(ctx: Ctx, entry: WaitlistEntry, a: WaitlistAttempt, err: unknown): Promise<Go> {
  const { cls, now, result } = ctx
  logger.error('WAITLIST CHARGE OUTCOME UNKNOWN — seat kept, run stopped', { entryId: entry.id, n: a.n, orderId: a.orderId, codes: squareErrorCodes(err), error: err instanceof Error ? err.message : String(err) })
  await extendHold(cls.id, a.bookingId, new Date(now.getTime() + UNCLEAR_HOLD_HOURS * 3_600_000).toISOString())
    .catch((e) => logger.error('Could not extend the hold on an unclear waitlist charge', { bookingId: a.bookingId, error: String(e) }))
  const first = a.outcome !== 'unknown'
  await updateEntry(cls.id, entry.id, (e) => ({
    ...e, attempts: e.attempts.map((x) => (x.n === a.n ? { ...x, orderId: a.orderId, amountCents: a.amountCents, outcome: 'unknown' } : x)),
  }), first ? { by: null, change: 'Square didn’t say whether the card was charged. Seat held; we ask Square again on the next run.' } : null, now)
  result.unknown++
  result.stopped = 'unknown'
  if (first) {
    await alertOwners(`Waitlist charge unclear: ${nameOfEntry(entry)}, ${cls.content.name}${a.amountCents ? `, ${money(a.amountCents)}` : ''}. Their seat is held a day and we ask Square again every 10 minutes; nobody is charged twice. If Square shows it paid they're added and texted. See /admin › To decide.`).catch(() => undefined)
  }
  return 'stop'
}

// ── The sweep ────────────────────────────────────────────────────────────────

/** Every class with someone on its list: settle, close passed cutoffs, add who fits. Stops starting classes after `budgetMs`. */
export async function sweepWaitlists(now = new Date(), opts: { budgetMs?: number; ids?: string[] } = {}): Promise<{ classes: number; added: number; declined: number; closed: number; unknown: number; left: number }> {
  const { waitlistClassIds } = await import('./waitlist-store')
  const ids = opts.ids ?? (await waitlistClassIds())
  const started = Date.now()
  const out = { classes: 0, added: 0, declined: 0, closed: 0, unknown: 0, left: 0 }
  for (const id of ids) {
    if (Date.now() - started > (opts.budgetMs ?? 6_000)) { out.left++; continue }
    const list = await getWaitlist(id).catch(() => null)
    if (!list?.entries.some((e) => e.state === 'waiting' || e.state === 'charging')) continue
    const r = await runWaitlist(id, { reason: 'sweep' }, now)
    out.classes++
    out.added += r.added
    out.declined += r.declined
    out.closed += r.closed
    out.unknown += r.unknown
  }
  return out
}

/** For To decide › "Check Square again" on one unclear entry: runs the class (which asks Square first). */
export async function checkEntryAgain(classId: string, entryId: string, by: By, now = new Date()): Promise<{ state: WaitlistEntry['state'] | null; result: RunResult }> {
  const result = await runWaitlist(classId, { reason: 'owner', by }, now)
  const e = (await getWaitlist(classId)).entries.find((x) => x.id === entryId)
  return { state: e?.state ?? null, result }
}

/**
 * To decide › "I sorted it out in Square" on an unclear waitlist charge: the
 * held seat is let go, the entry comes off (card off), nobody is told. Only an
 * entry still charging with an unknown outcome.
 */
export async function sortedInSquare(classId: string, entryId: string, by: By, now = new Date()): Promise<WaitlistEntry> {
  const list = await getWaitlist(classId)
  const e = list.entries.find((x) => x.id === entryId)
  const a = e ? lastAttempt(e) : undefined
  if (!e || e.state !== 'charging' || !a) throw new Error('This isn’t waiting on Square any more.')
  const changed = await updateEntry(classId, entryId, (x) => (x.state === 'charging' ? { ...x, state: 'removed' } : null), { by, change: `Sorted out in Square by ${by.name}. Seat let go.` }, now)
  if (!changed || changed.state !== 'removed') throw new Error('This isn’t waiting on Square any more.')
  await release(classId, a.bookingId).catch(() => undefined)
  await cardOff(classId, changed)
  return changed
}

