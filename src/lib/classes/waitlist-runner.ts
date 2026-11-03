/**
 * Stage 4 waitlist runner (Task 10): when a seat frees up, add the next
 * person whose group fits and charge the card Square saved for them, with
 * the consent they gave when joining.
 *
 * What starts a run (S4-R3): a refund or "free the seat" that frees seats
 * (onSeatFreed), a POS return that frees seats, an owner raising capacity,
 * an owner's "Run the waitlist now", a public booking refused because the
 * waitlist goes first, a leave asked mid-charge, a class cancel, and the
 * 10-minute sweep. A refund that keeps the seat never does.
 *
 * One run per class at a time: a lock in the waitlist document (CAS). Another
 * live run → this one returns at once (the sweep picks up anything left).
 *
 * Each try at adding someone is attempt n of their entry, with idempotency
 * keys `wl:{entryId}:{n}:order` / `:pay`, its order, amount and note written
 * down BEFORE the charge, so a resend of that try sends exactly the same
 * order and charge and Square can never take the money twice.
 *
 * MONEY RULES (waitlist fix round, C1 / I1 / I4). This charges cards without
 * the customer present, so:
 *  - A new try (n + 1, new keys, new order) is made ONLY after a final "not
 *    charged": a 4xx refusal, a FAILED or CANCELED payment, or a charge that
 *    was never sent. Anything else keeps the SAME order, amount and keys.
 *  - An unclear try is RESENT (same keys, order, amount, note) only while the
 *    waitlist for their dates is open, the class is open and they haven't
 *    asked to leave. Otherwise it is READ ONLY: Square is asked, and
 *      paid                → they're added (and told; a cancelled class tells
 *                            the owners to refund instead)
 *      not paid (final)    → nothing is sent, the seat is let go, the card
 *                            comes off, they come off the list
 *      still going through → the seat stays held; asked again next run
 *  - The seat is held WAITLIST_HOLD_MINUTES before the charge, longer than
 *    STALE_CHARGE_MS, so a try that crashed still holds its seat when it is
 *    picked up. An unclear hold never runs past the class's start.
 *
 *   paid     → seats confirmed, entry added, card off file (OWNER-S4-3),
 *              "You're in" text + email, owners told
 *   declined → hold let go, entry declined, card off file, family told
 *              kindly, owners alerted, next person (OWNER-S4-10)
 *   unknown  → seat kept held (R15, capped at the start), entry stays
 *              charging, owners alerted once, the run STOPS
 *   setup    → Square refused the request itself (our token, permission, a
 *              field): hold let go, entry back to waiting, card kept, nobody
 *              told but the owners (once a day), the run STOPS (I3: the
 *              public may book the seat meanwhile)
 *
 * Never refunds, never removes anyone else, never releases a paid seat.
 *
 * Server only.
 */
import { QUIET_NOTE, waitlistQuietNow } from './waitlist-quiet'
import { randomUUID } from 'node:crypto'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { recordAudit } from '@lib/audit'
import { waitlistChargesAllowedNow } from '@lib/bookings-gate'
import { judgeDrift, tellOwnersOfDrift } from '@lib/booking-core/charge'
import { idFor } from '@lib/booking-core/ids'
import { chargeOutcomeOf, squareErrorCodes } from '@lib/checkout-attempt'
import { sendWaitlistMissedEmail, sendWaitlistOffEmail } from '@lib/email'
import { createLogger } from '@lib/logger'
import { alertOwners } from '@lib/owner-alert'
import { sendQuoText } from '@lib/quo'
import { alertCardSetupOnce } from '@lib/saved-card-alerts'
import { cardTroubleOf, CHARGE_TROUBLE_WORDS, type CardTrouble } from '@lib/saved-cards'
import type { By } from '@lib/staff-auth'
import { formatSlotLabel } from '@lib/studio-time'
import type { OrderPaymentStatus, Payment } from '@providers/interfaces/payment'
import { CLASS_TAX_PERCENT, orderLinesFor, UNCLEAR_HOLD_HOURS } from './checkout'
import { getClass } from './class-store'
import { claimConfirmation, releaseConfirmation, sendClassConfirmation } from './confirmation'
import { agreedLinesOf, atAgreedPrices, quote, type AgreedLine, type Quote } from './pricing'
import { confirm, extendHold, getLedger, hold, release, type HoldInput } from './seat-ledger'
import { isLiveHold } from './seat-status'
import type { ScheduledClass } from './types'
import { cardOffAndNote, closeEntries, nameOfEntry, siteOrigin, waitlistSeatsWords, waitlistWhen } from './waitlist'
import { fitsNow, waitlistOpen } from './waitlist-rules'
import {
  cardStillOn, getWaitlist, lastAttempt, mutateWaitlist, updateEntry, type WaitlistAttempt, type WaitlistEntry,
} from './waitlist-store'

const logger = createLogger('classes:waitlist-runner')

/** How long one run's lock lasts; a lock past this can be taken over. */
export const RUN_LOCK_MS = 2 * 60_000
/** At most this many charge tries per run (the rest by the sweep). */
export const INLINE_BUDGET = 3
/** A try left mid-charge (no outcome written) is only picked up again after this long. */
export const STALE_CHARGE_MS = 10 * 60_000
/** I1: the seat is held this long before the charge: longer than STALE_CHARGE_MS, so a crashed try still has its seat. */
export const WAITLIST_HOLD_MINUTES = 30
/**
 * An unclear charge Square shows no payment for is only settled as "not
 * paid" (read only, or by an owner) once it was last sent this long ago, so a
 * payment still on its way has time to show.
 */
export const UNCLEAR_SETTLE_MS = 30 * 60_000

export type RunReason = 'seat-freed' | 'capacity' | 'sweep' | 'owner' | 'booking' | 'leave' | 'cancel'
export interface RunResult {
  ran: boolean
  added: number
  declined: number
  skipped: number
  closed: number
  unknown: number
  /** Why the run stopped early, if it did. */
  stopped: null | 'busy' | 'unknown' | 'setup' | 'error' | 'register' | 'paused' | 'quiet'
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
 * before saying unknown. A payment marked failed (FAILED or CANCELED) is
 * declined. APPROVED or PENDING is still going through: unknown.
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

// ── Small rules ──────────────────────────────────────────────────────────────

/** C1: an unclear try may be RESENT only while the waitlist is open, the class is open, and they haven't asked to leave. */
export function mayResend(cls: ScheduledClass, e: WaitlistEntry, now: Date): boolean {
  return cls.status === 'open' && waitlistOpen(cls, e.sessionIds, now) && !e.leaveAskedAt
}

const firstStart = (cls: ScheduledClass, sessionIds: string[]) =>
  cls.sessions.filter((s) => sessionIds.includes(s.id)).sort((a, b) => a.startIso.localeCompare(b.startIso))[0]?.startIso ?? cls.sessions[0]?.startIso ?? ''

/** C1: an unclear hold lasts UNCLEAR_HOLD_HOURS, never past the start of their first date. */
function unclearHoldUntil(cls: ScheduledClass, e: WaitlistEntry, now: Date): string {
  const day = now.getTime() + UNCLEAR_HOLD_HOURS * 3_600_000
  const start = Date.parse(firstStart(cls, e.sessionIds))
  return new Date(Number.isFinite(start) ? Math.max(now.getTime(), Math.min(day, start)) : day).toISOString()
}

/** When this try's charge was last sent (or the try began, for an older record). */
const lastSent = (a: WaitlistAttempt) => Date.parse(a.sentAt ?? a.at)

/** Asks Square about one try's order (read only). Throws when Square can't be asked. */
async function askOrder(a: WaitlistAttempt, e: WaitlistEntry): Promise<OrderPaymentStatus> {
  if (!a.orderId) return { state: 'none' }
  return providers.payment.orderPaymentStatus({ orderId: a.orderId, since: new Date(Date.parse(a.at) - 60_000).toISOString(), last4: e.square.last4 })
}

/** One attempt patched in place. */
const patchAttempt = (e: WaitlistEntry, n: number, patch: Partial<WaitlistAttempt>): WaitlistEntry =>
  ({ ...e, attempts: e.attempts.map((x) => (x.n === n ? { ...x, ...patch } : x)) })

// ── The run ──────────────────────────────────────────────────────────────────

interface Ctx {
  cls: ScheduledClass
  now: Date
  origin: string
  result: RunResult
  by: By | null
  /** Audit A I2 (owner decision): false while classes & workshops are paused online — no card is charged this run. */
  chargesAllowed: boolean
  /** I12: outside 8 AM–8 PM Chicago; nothing is charged or texted now (chargesAllowed is false too). */
  quiet?: boolean
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

/** Something on this list for a run to do: people waiting or being charged, or a card still to take off (I6). */
const hasWork = (entries: WaitlistEntry[]) => entries.some((e) => e.state === 'waiting' || e.state === 'charging' || cardStillOn(e))

/**
 * Runs the class's waitlist: takes off cards still on file, settles anything
 * left mid-charge (asking Square), closes entries whose cutoff passed, then
 * adds the next people who fit, at most INLINE_BUDGET charge tries. Never
 * throws.
 */
export async function runWaitlist(classId: string, opts: { reason: RunReason; origin?: string; by?: By | null } = { reason: 'sweep' }, now = new Date()): Promise<RunResult> {
  const result = blank()
  const lockId = randomUUID()
  try {
    const before = await getWaitlist(classId)
    if (!hasWork(before.entries)) {
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
    // Paused online (More › Online booking) → no saved card is charged; the run is left for later.
    // I12: and only between 8 AM and 8 PM Chicago (a seat freed at night waits for the morning sweep).
    const quiet = waitlistQuietNow(now)
    const chargesAllowed = !quiet && await waitlistChargesAllowedNow().catch(() => false)
    const ctx: Ctx = { cls, now, origin: opts.origin ?? siteOrigin(), result, by: opts.by ?? null, chargesAllowed, quiet }
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
  if (r.skipped) bits.push(`${r.skipped} skipped because the price went up or what they picked isn’t sold any more.`)
  if (r.closed) bits.push(`${r.closed} came off because the waitlist closed.`)
  if (r.stopped === 'unknown') bits.push('Square didn’t say whether a card was charged, so the seat is held and it stopped there. It shows in To decide.')
  if (r.stopped === 'setup') bits.push('Square refused the request, so nobody was charged. People can book the free seat normally meanwhile.')
  if (r.stopped === 'register') bits.push('The register’s price for this class doesn’t match, so nobody was charged. Tap Update the register on this class, then run it again.')
  if (r.stopped === 'error') bits.push('Square couldn’t be reached, so nobody was charged. Try again in a few minutes.')
  if (r.stopped === 'quiet') bits.push(QUIET_NOTE)
  if (r.stopped === 'paused') bits.push('Classes & workshops are paused online, so nobody was charged. The waitlist picks up again once you open them in More › Online booking.')
  if (!bits.length) bits.push('Nobody on the waitlist fits the free seats right now.')
  return bits.join(' ')
}

async function run(ctx: Ctx, reason: RunReason): Promise<void> {
  const { cls, now, result } = ctx
  let list = await getWaitlist(cls.id)

  // 0. I6: cards that didn't come off file before come off now.
  for (const e of list.entries.filter(cardStillOn)) await cardOffAndNote(cls.id, e, now)

  // 1. Anything left mid-charge or unanswered: ask Square before anything else (never a second payment).
  //    I4: a cancelled class still settles these, read only.
  for (const e of list.entries.filter((x) => x.state === 'charging')) {
    const go = await settleCharging(ctx, e)
    if (go === 'stop') return
  }

  // A cancelled class: the list closes, nobody is charged.
  if (cls.status === 'cancelled') {
    list = await getWaitlist(cls.id)
    result.closed += await closeEntries(cls, list.entries.filter((e) => e.state === 'waiting').map((e) => e.id), 'cancelled', now, ctx.origin)
    return
  }

  // 2. Entries whose waitlist closed: off the list, cards off, a kind email. A seat freed after the cutoff stays open.
  list = await getWaitlist(cls.id)
  const passed = list.entries.filter((e) => e.state === 'waiting' && timeIsUp(cls, e, now))
  if (passed.length) {
    // N6: a seat that fits them is free right now (it opened after 8 PM, or while charges were paused): not "No spot opened".
    const ledger = await getLedger(cls.id).catch(() => null)
    const spotWasOpen = new Set(ledger ? passed.filter((e) => fitsNow(cls, ledger, e.sessionIds, e.seats, now)).map((e) => e.id) : [])
    result.closed += await closeEntries(cls, passed.map((e) => e.id), 'cutoff', now, ctx.origin, spotWasOpen)
  }

  // 3. Add the next people who fit (OWNER-S4-1: the first whose whole group fits; earlier ones keep their place).
  if (cls.status !== 'open') return
  // Audit A I2: paused online → nobody is charged; the next run (once reopened) carries on.
  if (!ctx.chargesAllowed) {
    result.stopped = ctx.quiet ? 'quiet' : 'paused'
    return
  }
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

/**
 * What this entry is charged at `at` (D6, Kaden 2 Nov): today's price, but
 * each line no more than they agreed to at join (early-bird included), with
 * tax on what is charged. The waitlist never takes a code (OWNER-S4-4), so no
 * code use is counted. An older entry without `agreedLines` gets them from the
 * class priced as of when they joined, used only when that still adds up to
 * the amount they agreed to.
 */
export function waitlistQuote(cls: ScheduledClass, entry: WaitlistEntry, at: Date): ReturnType<typeof quote> {
  const priced = quote(cls, { ...entry.request, promoCode: undefined }, at, CLASS_TAX_PERCENT)
  if (!priced.ok) return priced
  return { ok: true, value: atAgreedPrices(cls, priced.value, agreedOf(cls, entry), CLASS_TAX_PERCENT) }
}

function agreedOf(cls: ScheduledClass, entry: WaitlistEntry): AgreedLine[] | null {
  if (entry.agreedLines?.length) return entry.agreedLines
  const then = quote(cls, { ...entry.request, promoCode: undefined }, new Date(entry.createdAt), CLASS_TAX_PERCENT)
  return then.ok && then.value.totalCents === entry.maxCents ? agreedLinesOf(then.value) : null
}

const holdInputFor = (entry: WaitlistEntry, a: WaitlistAttempt): HoldInput => ({
  bookingId: a.bookingId, passId: entry.request.passId, source: 'online', customer: { ...entry.customer },
  ttlMinutes: WAITLIST_HOLD_MINUTES, ...(entry.request.seats ? { seats: entry.request.seats } : {}), waitlistEntryId: entry.id,
})

/** A new try for an entry that is waiting and fits. */
async function tryToAdd(ctx: Ctx, entry: WaitlistEntry, reason: RunReason): Promise<Go> {
  const { cls, now, result } = ctx

  // I1 belt and braces: a try an owner settled as "no payment" is asked about once more before any new try.
  const prev = lastAttempt(entry)
  if (prev && prev.orderId && prev.amountCents !== null && (prev.outcome === 'no-payment' || prev.outcome === 'unpaid')) {
    let st: OrderPaymentStatus
    try {
      st = await askOrder(prev, entry)
    } catch (err) {
      logger.error('Could not ask Square about an earlier waitlist try — nobody charged', { entryId: entry.id, n: prev.n, error: String(err) })
      result.stopped = 'error'
      return 'stop'
    }
    if (st.state === 'paid' && st.payment) {
      const priced = waitlistQuote(cls, entry, new Date(prev.at))
      return finishPaid(ctx, entry, prev, priced.ok ? priced.value : null, st.payment, prev.orderId, undefined)
    }
    if (st.state === 'going-through') {
      result.unknown++
      result.stopped = 'unknown'
      return 'stop'
    }
  }

  const priced = waitlistQuote(cls, entry, now)

  // Not sold any more (the option was removed), or (D6: only when their agreed prices can't be matched line by line,
  // e.g. the class became taxable) the total is still above what they agreed to: skipped, never charged.
  if (!priced.ok || priced.value.totalCents > entry.maxCents) {
    const why: 'price' | 'gone' = priced.ok ? 'price' : 'gone'
    const n = entry.attempts.length + 1
    const changed = await updateEntry(cls.id, entry.id, (e) => (e.state === 'waiting' ? {
      ...e, state: 'skipped',
      attempts: [...e.attempts, { n, at: now.toISOString(), attemptId: `wl:${e.id}:${n}`, bookingId: '', orderId: null, amountCents: priced.ok ? priced.value.totalCents : null, note: null, outcome: 'price-rose', skipWhy: why }],
    } : null), { by: null, change: why === 'price' ? `A seat opened, but the price is now ${money(priced.ok ? priced.value.totalCents : 0)}, above the ${money(entry.maxCents)} they agreed to. Not charged.` : 'A seat opened, but what they asked for isn’t sold any more. Not charged.' }, now)
    if (changed?.state !== 'skipped') return 'next'
    result.skipped++
    const off = await cardOffAndNote(cls.id, changed, now)
    const emailed = (await sendWaitlistMissedEmail({
      to: entry.customer.email, givenName: entry.customer.givenName, className: cls.content.name, whenLabel: waitlistWhen(cls, entry.sessionIds),
      why, last4: entry.square.last4, classUrl: `${ctx.origin}/classes/${cls.id}`, cardOff: off,
    }).catch(() => ({ sent: false }))).sent
    await updateEntry(cls.id, entry.id, (e) => patchAttempt(e, n, { told: { text: false, email: emailed } }), null, now).catch(() => undefined)
    await alertOwners(why === 'price'
      ? `Waitlist skipped ${nameOfEntry(entry)} for ${cls.content.name}: the price is now ${money(priced.ok ? priced.value.totalCents : 0)}, above the ${money(entry.maxCents)} they agreed to. Not charged${emailed ? '; they were emailed' : ''}. The seat goes to the next person.`
      : `Waitlist skipped ${nameOfEntry(entry)} for ${cls.content.name}: what they asked for isn't sold any more. Not charged${emailed ? '; they were emailed' : ''}.`).catch(() => undefined)
    return 'next'
  }
  const q = priced.value
  const lines = orderLinesFor(cls, q, entry.request.seats)
  if (!lines.ok) {
    // I3: written down on the entry (nothing sent), so the public isn't refused while the waitlist can't take the seat.
    const n = entry.attempts.length + 1
    await updateEntry(cls.id, entry.id, (e) => (e.state === 'waiting' && e.attempts.length === n - 1 ? {
      ...e, attempts: [...e.attempts, { n, at: now.toISOString(), attemptId: `wl:${e.id}:${n}`, bookingId: '', orderId: null, amountCents: null, note: null, outcome: 'register' }],
    } : null), { by: null, change: 'A seat opened, but the class isn’t on the register, so nobody was charged.' }, now)
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
 * A `charging` entry from an earlier run (or one an owner asked about). If
 * its try has no outcome yet and is recent, another run may still be
 * charging it: leave it. Otherwise (C1 / I1 / I4):
 *  - never sent → nothing can be paid: carry on (resend allowed) or let go
 *  - Square shows it paid → finish adding them, whatever else changed
 *  - still going through → keep the seat, ask again next time
 *  - failed (final) → declined (resend allowed) or off the list (read only)
 *  - no payment → resend the SAME try while allowed; read only, it is settled
 *    as not paid once it was last sent UNCLEAR_SETTLE_MS ago
 */
async function settleCharging(ctx: Ctx, entry: WaitlistEntry): Promise<Go> {
  const { cls, now } = ctx
  const a = lastAttempt(entry)
  if (!a) {
    await updateEntry(cls.id, entry.id, (e) => (e.state === 'charging' ? { ...e, state: 'waiting' } : null), { by: null, change: 'Back to waiting' }, now)
    return 'next'
  }
  if (a.outcome === null && now.getTime() - lastSent(a) < STALE_CHARGE_MS) return 'next'
  const allowed = mayResend(cls, entry, now)
  const priced = waitlistQuote(cls, entry, new Date(a.at))

  // The charge was never sent: Square can't have this money.
  if (a.amountCents === null) {
    if (!allowed) return settleNotPaid(ctx, entry, a, 'never-sent')
    if (!priced.ok) {
      await letGoOf(cls.id, a.bookingId)
      await backToWaiting(ctx, entry, a, 'error', 'What they asked for can’t be priced any more. Still waiting; nothing was sent.')
      return 'next'
    }
    if (!ctx.chargesAllowed) {
      // Paused online: the charge is never sent now. Their seat is freed and they wait their turn again.
      await letGoOf(cls.id, a.bookingId)
      await backToWaiting(ctx, entry, a, 'error', ctx.quiet ? 'Outside 8 AM to 8 PM. Still waiting; nothing was sent.' : 'Classes & workshops are paused online. Still waiting; nothing was sent.')
      ctx.result.stopped = ctx.quiet ? 'quiet' : 'paused'
      return 'next'
    }
    return proceed(ctx, entry, a, priced.value)
  }

  let st: OrderPaymentStatus
  try {
    st = await askOrder(a, entry)
  } catch (err) {
    logger.error('Could not ask Square about a waitlist charge — still held', { entryId: entry.id, n: a.n, error: String(err) })
    await keepHeld(ctx, entry, a)
    ctx.result.unknown++
    ctx.result.stopped = 'unknown'
    return 'stop'
  }

  if (st.state === 'paid' && st.payment) {
    return finishPaid(ctx, entry, a, priced.ok ? priced.value : null, st.payment, a.orderId!, undefined)
  }
  if (st.state === 'going-through') {
    // Not final yet: never resend, never let go.
    await keepHeld(ctx, entry, a)
    if (a.outcome !== 'unknown') await markUnknown(ctx, entry, a, 'Square shows the payment is still going through. Seat held; we ask again on the next run.')
    ctx.result.unknown++
    ctx.result.stopped = 'unknown'
    return 'stop'
  }
  if (st.state === 'failed') {
    if (!allowed) return settleNotPaid(ctx, entry, a, 'failed')
    await letGoOf(cls.id, a.bookingId)
    return declined(ctx, entry, a, 'declined')
  }

  // No payment on Square for this try.
  if (allowed) {
    if (!priced.ok) {
      // What they asked for can't be priced any more: the seat stays held for a person (To decide).
      await keepHeld(ctx, entry, a)
      ctx.result.unknown++
      ctx.result.stopped = 'unknown'
      return 'stop'
    }
    if (!ctx.chargesAllowed) {
      // Paused online: no resend now. The seat stays held and the same try is resent once classes reopen.
      await keepHeld(ctx, entry, a)
      ctx.result.stopped = ctx.quiet ? 'quiet' : 'paused'
      return 'next'
    }
    return proceed(ctx, entry, a, priced.value)
  }
  if (now.getTime() - lastSent(a) >= UNCLEAR_SETTLE_MS) return settleNotPaid(ctx, entry, a, 'no-payment')
  // Read only and too soon to call it: the seat stays held, asked again next run.
  await keepHeld(ctx, entry, a)
  return 'next'
}

/** Hold → order → R14 → amount written down → charge → outcome. Shared by a new try and a resumed one. */
async function proceed(ctx: Ctx, entry: WaitlistEntry, a: WaitlistAttempt, q: Quote): Promise<Go> {
  const { cls, now } = ctx
  const holdInput = holdInputFor(entry, a)
  const sentBefore = a.amountCents !== null

  // The seat: this try's hold if it is still running, else a new hold under the same booking.
  const ledger = await getLedger(cls.id)
  const held = ledger.lines.some((l) => l.bookingId === a.bookingId && isLiveHold(l, now))
  if (held) {
    // M-c: a resumed try's hold may be nearly out: it runs a full 30 minutes from this charge.
    await extendHold(cls.id, a.bookingId, new Date(now.getTime() + WAITLIST_HOLD_MINUTES * 60_000).toISOString())
      .catch((e) => logger.error('Could not extend the waitlist hold before the charge', { bookingId: a.bookingId, error: String(e) }))
  } else {
    let ok = false
    try {
      ok = (await hold(cls, q, holdInput, now)).ok
    } catch (err) {
      logger.error('Waitlist hold failed', { entryId: entry.id, error: String(err) })
    }
    if (!ok) {
      if (!sentBefore) {
        await backToWaiting(ctx, entry, a, 'no-seat', 'The seat was taken before it could be held. Still waiting; not charged.')
        return 'next'
      }
      // I1: this try's charge may have gone out. Keep the SAME try (never n + 1); ask Square again next run.
      if (a.outcome !== 'unknown') await markUnknown(ctx, entry, a, 'The seat was taken meanwhile. Still asking Square about the charge; nothing new is sent.')
      ctx.result.unknown++
      return 'next'
    }
  }

  // The order (same key every time for this try: Square hands back the same order).
  const lines = orderLinesFor(cls, q, entry.request.seats)
  if (!lines.ok && !sentBefore) {
    await letGoOf(cls.id, a.bookingId)
    await backToWaiting(ctx, entry, a, 'register', 'The class isn’t on the register, so nobody was charged.')
    ctx.result.stopped = 'register'
    return 'stop'
  }
  let order: { orderId: string; totalCents: number; lineTotals?: { totalCents: number; taxCents: number }[] }
  if (a.orderId && a.amountCents !== null) {
    // A resumed try: the order and amount written down before its charge are reused exactly.
    order = { orderId: a.orderId, totalCents: a.amountCents }
  } else try {
    if (!lines.ok) throw new Error('not on the register')
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
    await letGoOf(cls.id, a.bookingId)
    await backToWaiting(ctx, entry, a, 'error', 'Square couldn’t make the order. Still waiting; not charged.')
    ctx.result.stopped = 'error'
    return 'stop'
  }

  // R14 and OWNER-S4-2: Square's total is charged, never above what they agreed to, never far above our quote.
  let amount = a.amountCents
  if (amount === null) {
    const verdict = judgeDrift(q.totalCents, order.totalCents, { tellBelowCents: q.lines.length })
    if (verdict.kind === 'refuse' || order.totalCents > entry.maxCents) {
      await letGoOf(cls.id, a.bookingId)
      await backToWaiting(ctx, entry, { ...a, orderId: order.orderId }, 'register', `The register asked ${money(order.totalCents)}, more than the website price. Not charged.`)
      await alertOwners(`Waitlist didn't charge ${nameOfEntry(entry)} for ${cls.content.name}: the register asked ${money(order.totalCents)}, the website ${money(q.totalCents)} (they agreed to ${money(entry.maxCents)}). Open the class in /admin and tap Update the register, then run the waitlist. Nothing was charged.`).catch(() => undefined)
      ctx.result.stopped = 'register'
      return 'stop'
    }
    if (verdict.kind === 'charge-and-tell') {
      await tellOwnersOfDrift(`Waitlist price differed — ${cls.content.name}`, `booking ${a.bookingId}`, q.totalCents, order.totalCents, '')
    }
    amount = order.totalCents
  }

  // R4: the class as it is right now (it may have been cancelled, or its waitlist closed, while this run worked).
  // Not allowed any more → nothing is sent: a try never sent settles at once; one sent before is asked about read only.
  let live: ScheduledClass | null
  try {
    live = await getClass(cls.id)
  } catch (err) {
    logger.error('Could not re-read the class before a waitlist charge — nothing sent', { classId: cls.id, error: String(err) })
    if (!sentBefore) {
      await letGoOf(cls.id, a.bookingId)
      await backToWaiting(ctx, entry, a, 'error', 'The class couldn’t be read just before the charge, so nothing was sent. Still waiting; not charged.')
    }
    ctx.result.stopped = 'error'
    return 'stop'
  }
  const now2 = new Date(Math.max(now.getTime(), Date.now()))
  const fresh: ScheduledClass = live ?? { ...cls, status: 'cancelled' }
  if (!mayResend(fresh, entry, now2)) {
    const settleCtx: Ctx = { ...ctx, cls: fresh }
    if (!sentBefore) return settleNotPaid(settleCtx, entry, a, 'never-sent')
    return settleCharging(settleCtx, entry)
  }

  // Written down before the charge: every resend of this try sends exactly this (order, amount, note, key).
  // C1: written only while this is still their live try and they haven't asked to leave; otherwise nothing is sent.
  const sentAt = new Date().toISOString()
  const saved = await updateEntry(cls.id, entry.id, (e) => (e.state === 'charging' && !e.leaveAskedAt && lastAttempt(e)?.n === a.n
    ? patchAttempt(e, a.n, { orderId: order.orderId, amountCents: amount, sentAt }) : null), null, now)
  if (!saved) throw new Error('waitlist entry vanished')
  if (saved.leaveAskedAt || saved.state !== 'charging' || lastAttempt(saved)?.sentAt !== sentAt) {
    // They asked to leave (or the try changed) just now: never send it; settle read only.
    return saved.state === 'charging' ? settleCharging(ctx, saved) : 'next'
  }

  const charged = await chargeSaved({
    orderId: order.orderId, cardId: entry.square.cardId, customerId: entry.square.customerId, amount: amount!,
    idempotencyKey: `${a.attemptId}:pay`, email: entry.customer.email, note: a.note ?? `Hometown waitlist ${a.bookingId}`,
  })
  const withOrder: WaitlistAttempt = { ...a, orderId: order.orderId, amountCents: amount, sentAt }
  switch (charged.kind) {
    case 'paid':
      return finishPaid(ctx, entry, withOrder, q, charged.payment, order.orderId, order.lineTotals, holdInput)
    case 'declined':
      await letGoOf(cls.id, a.bookingId)
      return declined(ctx, entry, withOrder, charged.trouble)
    case 'setup':
      await letGoOf(cls.id, a.bookingId)
      await backToWaiting(ctx, entry, withOrder, 'setup', 'Square refused the request (a setup problem). Still waiting; not charged; card kept.')
      await alertCardSetupOnce('charge', now)
      ctx.result.stopped = 'setup'
      return 'stop'
    case 'unknown':
      return unknownOutcome(ctx, entry, withOrder, charged.error)
  }
}

async function letGoOf(classId: string, bookingId: string): Promise<void> {
  await release(classId, bookingId).catch((err) => logger.error('Waitlist hold not released (it runs out by itself)', { bookingId, error: String(err) }))
}

/** A FINAL "not charged" (I1): back to waiting; the next try is n + 1 with new keys. */
async function backToWaiting(ctx: Ctx, entry: WaitlistEntry, a: WaitlistAttempt, outcome: WaitlistAttempt['outcome'], change: string): Promise<void> {
  await updateEntry(ctx.cls.id, entry.id, (e) => (e.state === 'charging' ? {
    ...patchAttempt(e, a.n, { outcome, ...(a.orderId ? { orderId: a.orderId } : {}) }), state: 'waiting',
  } : null), { by: null, change }, ctx.now)
}

/** The unclear try's seat stays held, never past the class's start (C1). */
async function keepHeld(ctx: Ctx, entry: WaitlistEntry, a: WaitlistAttempt): Promise<void> {
  await extendHold(ctx.cls.id, a.bookingId, unclearHoldUntil(ctx.cls, entry, ctx.now))
    .catch((e) => logger.error('Could not extend the hold on an unclear waitlist charge', { bookingId: a.bookingId, error: String(e) }))
}

async function markUnknown(ctx: Ctx, entry: WaitlistEntry, a: WaitlistAttempt, change: string): Promise<void> {
  await updateEntry(ctx.cls.id, entry.id, (e) => (e.state === 'charging' ? patchAttempt(e, a.n, { outcome: 'unknown' }) : null), { by: null, change }, ctx.now)
}

async function text(to: string, content: string): Promise<boolean> {
  if (!to) return false
  try {
    await sendQuoText({ to, content })
    return true
  } catch (err) {
    logger.warn('Waitlist text not sent', { error: String(err) })
    return false
  }
}

/** "Sat, Oct 24 at 10 AM" */
const whenWords = (iso: string) => formatSlotLabel(iso).replace(' CT', '').replace(' · ', ' at ').replace(':00 ', ' ')

/**
 * Paid: confirm the seats (never refuses a paid booking), entry added, card
 * off, "You're in", owners told. I4: on a cancelled class nobody is told
 * they're in; the owners are told to refund them from the class sheet.
 */
async function finishPaid(
  ctx: Ctx, entry: WaitlistEntry, a: WaitlistAttempt, q: Quote | null, payment: Payment, orderId: string,
  lineTotals: { totalCents: number; taxCents: number }[] | undefined, input?: HoldInput,
): Promise<Go> {
  const { cls, now, result } = ctx
  const chargedCents = payment.amount || a.amountCents || q?.totalCents || 0
  const holdInput: HoldInput = input ?? holdInputFor(entry, a)
  // R4: cancelled meanwhile (by an owner while this run charged)? Read it again before telling anyone they're in.
  const reread = await getClass(cls.id).then((c) => ({ c }), () => null)
  const cancelled = cls.status === 'cancelled' || (reread !== null && (reread.c === null || reread.c.status === 'cancelled'))
  // The entry first: once Square has the money, nobody may ever charge this person again.
  const added = await updateEntry(cls.id, entry.id, (e) => ({
    ...patchAttempt(e, a.n, { orderId, amountCents: chargedCents, outcome: 'paid', paymentId: payment.id, ...(cancelled ? { cancelledPaid: true } : {}) }), state: 'added', bookingId: a.bookingId,
  }), { by: ctx.by, change: `Added and charged ${money(chargedCents)} to the card ending ${entry.square.last4}` }, now)
  if (!added) logger.error('WAITLIST PAID BUT ENTRY NOT MARKED ADDED', { entryId: entry.id, orderId })
  result.added++

  let recorded = true
  let overCapacity = false
  try {
    if (!q) throw new Error('no quote to record the seats from')
    const lines = await confirm(cls.id, a.bookingId, { orderId, paymentId: payment.id, chargedCents, ...(lineTotals ? { lineTotals } : {}) }, { cls, quote: q, input: holdInput }, now)
    overCapacity = lines.some((l) => l.overCapacity)
  } catch (err) {
    recorded = false
    logger.error('WAITLIST PAID, SEATS NOT RECORDED', { entryId: entry.id, bookingId: a.bookingId, orderId, error: String(err) })
    await extendHold(cls.id, a.bookingId, new Date(now.getTime() + UNCLEAR_HOLD_HOURS * 3_600_000).toISOString()).catch(() => undefined)
  }
  await cardOffAndNote(cls.id, added ?? entry, now)

  const name = nameOfEntry(entry)
  if (cancelled) {
    await alertOwners(`${name} was charged ${money(chargedCents)} by the waitlist just before ${cls.content.name} was cancelled. They weren't told they're in. Open /admin › To decide › Waitlist charge on a cancelled class to refund them.`).catch(() => undefined)
  } else {
    const start = firstStart(cls, entry.sessionIds)
    const seatsLabel = waitlistSeatsWords(cls, entry)
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
    await alertOwners(`Waitlist added ${name} to ${cls.content.name} (${money(chargedCents)}).${overCapacity ? ' Their seat ran over capacity (the hold ran out while Square answered).' : ''}${entry.leaveAskedAt ? ' They had asked to leave, but Square shows the charge went through, so they’re in.' : ''}${recorded ? '' : ' Their seats aren\'t recorded yet. Square\'s payment notice books them; if it can\'t, it shows in /admin › To decide › Paid, no seat with Give them their seat.'}`).catch(() => undefined)
  }
  await recordAudit({
    by: ctx.by ? { ...ctx.by, role: 'owner' } : { id: 'waitlist', name: 'Waitlist', role: 'owner' },
    action: 'waitlist-added', target: { kind: 'class', id: cls.id, label: cls.content.name },
    details: { entryId: entry.id, bookingId: a.bookingId, orderId, paymentId: payment.id, cents: chargedCents, n: a.n, name, recovered: a.outcome === 'unknown', cancelled, ...(overCapacity ? { overCapacity } : {}) },
  }).catch(() => undefined)
  return 'next'
}

/** The card didn't go through: off the list, card off, family told kindly, owners alerted, the next person. */
async function declined(ctx: Ctx, entry: WaitlistEntry, a: WaitlistAttempt, trouble: CardTrouble): Promise<Go> {
  const { cls, now, result } = ctx
  const changed = await updateEntry(cls.id, entry.id, (e) => ({
    ...patchAttempt(e, a.n, { orderId: a.orderId, amountCents: a.amountCents, outcome: 'declined', trouble }), state: 'declined',
  }), { by: null, change: `The card ending ${entry.square.last4} didn’t go through (${CHARGE_TROUBLE_WORDS[trouble]}). Off the list; not charged.` }, now)
  result.declined++
  const off = await cardOffAndNote(cls.id, changed ?? entry, now)
  const start = firstStart(cls, entry.sessionIds)
  const emailed = (await sendWaitlistMissedEmail({
    to: entry.customer.email, givenName: entry.customer.givenName, className: cls.content.name, whenLabel: waitlistWhen(cls, entry.sessionIds),
    why: 'declined', last4: entry.square.last4, classUrl: `${ctx.origin}/classes/${cls.id}`, cardOff: off,
  }).catch(() => ({ sent: false }))).sent
  const texted = await text(entry.customer.phone, `Hometown Studio here. A spot opened in ${cls.content.name} but your card ending ${entry.square.last4} didn't go through, so it went to the next person. You can join the waitlist again on our site.`)
  // M5: what was actually sent, for To decide.
  await updateEntry(cls.id, entry.id, (e) => patchAttempt(e, a.n, { told: { text: texted, email: emailed } }), null, now).catch(() => undefined)
  const told = texted && emailed ? 'they were texted and emailed' : texted ? 'they were texted' : emailed ? 'they were emailed' : 'we couldn’t text or email them'
  await alertOwners(`Waitlist: ${nameOfEntry(entry)}'s card ending ${entry.square.last4} didn't go through for ${cls.content.name} ${whenWords(start)} (${CHARGE_TROUBLE_WORDS[trouble]}). Nothing was charged; ${told}, and the seat goes to the next person.`).catch(() => undefined)
  await recordAudit({
    by: { id: 'waitlist', name: 'Waitlist', role: 'owner' },
    action: 'waitlist-declined', target: { kind: 'class', id: cls.id, label: cls.content.name },
    details: { entryId: entry.id, n: a.n, trouble, name: nameOfEntry(entry) },
  }).catch(() => undefined)
  return 'next'
}

/**
 * C1 / I4, read only: the try can't be resent (the waitlist closed, the class
 * was cancelled or isn't open, or they asked to leave) and Square shows it
 * wasn't paid (or it was never sent). Nothing is sent; the seat is let go,
 * the card comes off, they come off the list and are told.
 */
async function settleNotPaid(ctx: Ctx, entry: WaitlistEntry, a: WaitlistAttempt, why: 'never-sent' | 'failed' | 'no-payment'): Promise<Go> {
  const { cls, now, result } = ctx
  const left = !!entry.leaveAskedAt
  const state: WaitlistEntry['state'] = left ? 'left' : 'closed'
  const reasonWords = left ? 'they asked to leave' : cls.status === 'cancelled' ? 'the class was cancelled' : 'the waitlist closed'
  const square = why === 'failed' ? 'Square shows the card didn’t go through' : why === 'never-sent' ? 'The charge was never sent' : 'Square shows no payment for the charge'
  const changed = await updateEntry(cls.id, entry.id, (e) => (e.state === 'charging' ? {
    ...patchAttempt(e, a.n, { outcome: why === 'failed' ? 'declined' : 'no-payment' }), state,
  } : null), { by: null, change: `${square}, and ${reasonWords}. Nothing more is sent; seat let go.` }, now)
  if (!changed || changed.state !== state) return 'next'
  await letGoOf(cls.id, a.bookingId)
  result.closed++
  const off = await cardOffAndNote(cls.id, changed, now)
  const whenLabel = waitlistWhen(cls, entry.sessionIds)
  if (left) {
    await sendWaitlistOffEmail({ to: entry.customer.email, givenName: entry.customer.givenName, className: cls.content.name, whenLabel, byStudio: false, cardOff: off }).catch(() => undefined)
  } else if (cls.status !== 'cancelled') {
    await sendWaitlistMissedEmail({
      to: entry.customer.email, givenName: entry.customer.givenName, className: cls.content.name, whenLabel,
      why: 'closed', last4: entry.square.last4, classUrl: `${ctx.origin}/workshops`, cardOff: off,
    }).catch(() => undefined)
  }
  if (a.amountCents !== null) {
    await alertOwners(`Waitlist settled ${nameOfEntry(entry)}'s unclear charge for ${cls.content.name}. ${square}, and ${reasonWords}. Nothing more was sent, their seat was let go and their card is coming off.`).catch(() => undefined)
  }
  return 'next'
}

/** No answer from Square: the seat stays held (R15, never past the start), the entry stays charging, owners alerted once, the run stops. */
async function unknownOutcome(ctx: Ctx, entry: WaitlistEntry, a: WaitlistAttempt, err: unknown): Promise<Go> {
  const { cls, now, result } = ctx
  logger.error('WAITLIST CHARGE OUTCOME UNKNOWN — seat kept, run stopped', { entryId: entry.id, n: a.n, orderId: a.orderId, codes: squareErrorCodes(err), error: err instanceof Error ? err.message : String(err) })
  await keepHeld(ctx, entry, a)
  const first = a.outcome !== 'unknown'
  await updateEntry(cls.id, entry.id, (e) => patchAttempt(e, a.n, { orderId: a.orderId, amountCents: a.amountCents, outcome: 'unknown' }),
    first ? { by: null, change: 'Square didn’t say whether the card was charged. Seat held; we ask Square again on the next run.' } : null, now)
  result.unknown++
  result.stopped = 'unknown'
  if (first) {
    await alertOwners(`Waitlist charge unclear: ${nameOfEntry(entry)}, ${cls.content.name}${a.amountCents ? `, ${money(a.amountCents)}` : ''}. Their seat is held and we ask Square again every 10 minutes. If Square shows it paid they're added and texted. Square never takes the same charge twice. See /admin › To decide.`).catch(() => undefined)
  }
  return 'stop'
}

// ── The sweep ────────────────────────────────────────────────────────────────

/** I-6: start at a different class each 10-minute run, so a slow run never leaves the same tail out every time. */
export function sweepOrder(ids: string[], now: Date): string[] {
  const offset = ids.length ? Math.floor(now.getTime() / 600_000) % ids.length : 0
  return [...ids.slice(offset), ...ids.slice(0, offset)]
}

/** fn over every item, at most `limit` at a time; results in `items` order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** Every class with someone on its list (or a card still to take off): settle, close passed cutoffs, add who fits. Stops starting classes after `budgetMs`. */
export async function sweepWaitlists(now = new Date(), opts: { budgetMs?: number; ids?: string[] } = {}): Promise<{ classes: number; added: number; declined: number; closed: number; unknown: number; left: number }> {
  const { waitlistClassIds, inactiveWaitlists, markWaitlistsInactive } = await import('./waitlist-store')
  const started = Date.now()
  const out = { classes: 0, added: 0, declined: 0, closed: 0, unknown: 0, left: 0 }
  // I-6: finished waitlists are skipped for good; the rest are read in parallel (a few at a time).
  let ids = opts.ids ?? (await waitlistClassIds())
  if (!opts.ids) {
    const done = await inactiveWaitlists().catch(() => new Set<string>())
    ids = ids.filter((id) => !done.has(id))
  }
  const lists = await mapLimit(ids, 8, (id) => getWaitlist(id).catch(() => null))
  const working = ids.filter((_, i) => lists[i] && hasWork(lists[i]!.entries))
  // Lists with no work whose class is over (every date passed) never have work again: off the sweep.
  if (!opts.ids) {
    const idle = ids.filter((_, i) => lists[i] && !hasWork(lists[i]!.entries))
    const over = await mapLimit(idle, 8, async (id) => {
      const c = await getClass(id).catch(() => undefined)
      if (c === undefined) return false
      return c === null || c.sessions.every((s) => Date.parse(s.startIso) < now.getTime())
    })
    await markWaitlistsInactive(idle.filter((_, i) => over[i])).catch(() => undefined)
  }
  for (const id of sweepOrder(working, now)) {
    if (Date.now() - started > (opts.budgetMs ?? 6_000)) { out.left++; continue }
    const r = await runWaitlist(id, { reason: 'sweep' }, now)
    out.classes++
    out.added += r.added
    out.declined += r.declined
    out.closed += r.closed
    out.unknown += r.unknown
  }
  return out
}

// ── I5: an unclear charge, answered in the app (no Square dashboard) ────────

/**
 * What Square shows for an entry's unclear charge, in words, and which
 * choices fit:
 *   paid            → [Add them]
 *   going-through   → [Check again] (seat stays held)
 *   failed          → [Keep them waiting] [Take them off] (a final no)
 *   no-payment      → the same two, once the charge was last sent
 *                     UNCLEAR_SETTLE_MS ago (`decideFrom`); before that only
 *                     [Check again]
 *   unreachable     → [Check again] (seat stays held)
 *   not-unclear     → nothing to decide any more
 * Read only: asking never charges or changes anything.
 */
export interface UnclearAnswer {
  state: 'paid' | 'going-through' | 'failed' | 'no-payment' | 'unreachable' | 'not-unclear'
  words: string
  cents: number | null
  paidAt: string | null
  /** No payment: when Keep them waiting / Take them off become possible. */
  decideFrom: string | null
  /** The choices that fit now. */
  choices: ('add' | 'keep' | 'off')[]
  /** Keep them waiting fits only while the waitlist is still open for them. */
  canKeep: boolean
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })

function unclearOf(list: WaitlistEntry[], entryId: string): { e: WaitlistEntry; a: WaitlistAttempt } | null {
  const e = list.find((x) => x.id === entryId)
  const a = e ? lastAttempt(e) : undefined
  return e && a && e.state === 'charging' && a.outcome === 'unknown' ? { e, a } : null
}

/** Asks Square about one unclear entry (read only) and says what it shows. Never throws. */
export async function askAboutEntry(classId: string, entryId: string, now = new Date()): Promise<UnclearAnswer> {
  const none = (state: UnclearAnswer['state'], words: string): UnclearAnswer => ({ state, words, cents: null, paidAt: null, decideFrom: null, choices: [], canKeep: false })
  let found: { e: WaitlistEntry; a: WaitlistAttempt } | null
  let cls: ScheduledClass | null
  try {
    found = unclearOf((await getWaitlist(classId)).entries, entryId)
    cls = await getClass(classId)
  } catch {
    return none('unreachable', 'The waitlist couldn’t be read just now. Their seat stays held. Check again in a minute.')
  }
  if (!found || !cls) return none('not-unclear', 'This isn’t waiting on Square any more.')
  const { e, a } = found
  const canKeep = cls.status === 'open' && waitlistOpen(cls, e.sessionIds, now)
  let st: OrderPaymentStatus
  try {
    st = await askOrder(a, e)
  } catch {
    return { ...none('unreachable', 'Square isn’t answering right now. Their seat stays held. Check again in a few minutes.'), cents: a.amountCents }
  }
  if (st.state === 'paid' && st.payment) {
    const at = st.payment.createdAt ?? null
    const cents = st.payment.amount || a.amountCents
    return { state: 'paid', words: `Square shows it paid (${cents ? money(cents) : 'the charge'}${at ? `, ${clock(at)}` : ''}).`, cents, paidAt: at, decideFrom: null, choices: ['add'], canKeep }
  }
  if (st.state === 'going-through') {
    return { ...none('going-through', 'Square shows the payment is still going through. Their seat stays held. Check again in a few minutes.'), cents: a.amountCents }
  }
  const choices: UnclearAnswer['choices'] = canKeep ? ['keep', 'off'] : ['off']
  if (st.state === 'failed' || a.amountCents === null) {
    return { state: 'failed', words: a.amountCents === null ? 'The charge was never sent, so nothing was charged.' : 'Square shows the card didn’t go through, so nothing was charged.', cents: a.amountCents, paidAt: null, decideFrom: null, choices, canKeep }
  }
  const from = new Date(lastSent(a) + UNCLEAR_SETTLE_MS).toISOString()
  if (now.getTime() < Date.parse(from)) {
    return { state: 'no-payment', words: `Square shows no payment for this charge yet. A payment can take a little while to show, so give it until ${clock(from)}. Their seat stays held until then.`, cents: a.amountCents, paidAt: null, decideFrom: from, choices: [], canKeep }
  }
  return { state: 'no-payment', words: 'Square shows no payment for this charge.', cents: a.amountCents, paidAt: null, decideFrom: from, choices, canKeep }
}

export class UnclearError extends Error {
  constructor(message: string, public answer?: UnclearAnswer) { super(message) }
}

/**
 * To decide › an unclear waitlist charge, decided in the app after asking
 * Square again (never on a guess):
 *   add   Square shows it paid → they're added (seats confirmed, told)
 *   keep  no payment (or a final no) → the seat is let go, they go back to
 *         waiting; that charge is NEVER sent again (a later try is a new one)
 *   off   no payment (or a final no) → the seat is let go, they come off the
 *         list, the card comes off, they're emailed
 * Refused (with Square's current answer) when the choice doesn't fit it.
 * Audited. Holds the class's run lock so it never races a run.
 */
export async function decideUnclear(classId: string, entryId: string, choice: 'add' | 'keep' | 'off', by: By, now = new Date()): Promise<WaitlistEntry> {
  const answer = await askAboutEntry(classId, entryId, now)
  if (answer.state === 'not-unclear') throw new UnclearError('This isn’t waiting on Square any more.', answer)
  if (!answer.choices.includes(choice)) {
    throw new UnclearError(choice === 'add'
      ? `That doesn’t match what Square shows now. ${answer.words}`
      : choice === 'keep' && !answer.canKeep && answer.choices.includes('off')
        ? 'The waitlist for this class has closed, so they can’t wait any more. Take them off instead.'
        : `That doesn’t match what Square shows now. ${answer.words}`, answer)
  }
  const lockId = randomUUID()
  if (!(await claimLock(classId, lockId, now))) throw new UnclearError('The waitlist is running for this class right now. Try again in a minute.')
  try {
    const cls = await getClass(classId)
    const found = unclearOf((await getWaitlist(classId)).entries, entryId)
    if (!cls || !found) throw new UnclearError('This isn’t waiting on Square any more.')
    const { e, a } = found
    const ctx: Ctx = { cls, now, origin: siteOrigin(), result: blank(), by, chargesAllowed: false } // never charges here
    if (choice === 'add') {
      const st = await askOrder(a, e)
      if (st.state !== 'paid' || !st.payment) throw new UnclearError('Square no longer shows it paid. Check again.')
      const priced = waitlistQuote(cls, e, new Date(a.at))
      await finishPaid(ctx, e, a, priced.ok ? priced.value : null, st.payment, a.orderId!, undefined)
    } else {
      // Asked again under the lock: a payment that showed up meanwhile is never let go.
      const st = await askOrder(a, e)
      if (st.state === 'paid' || st.state === 'going-through') throw new UnclearError('Square shows a payment for this charge now. Check again.')
      const words = choice === 'keep'
        ? `${by.name} kept them waiting: Square showed no payment for this charge. Seat let go; that charge is never sent again.`
        : `${by.name} took them off: Square showed no payment for this charge. Seat let go; nothing was charged.`
      const changed = await updateEntry(classId, e.id, (x) => (x.state === 'charging' && lastAttempt(x)?.n === a.n ? {
        ...patchAttempt(x, a.n, { outcome: answer.state === 'failed' && a.amountCents !== null ? 'declined' : 'no-payment' }), state: choice === 'keep' ? 'waiting' : 'removed',
      } : null), { by, change: words }, now)
      if (!changed || changed.state === 'charging') throw new UnclearError('This isn’t waiting on Square any more.')
      await letGoOf(classId, a.bookingId)
      if (choice === 'off') {
        const off = await cardOffAndNote(classId, changed, now)
        await sendWaitlistOffEmail({ to: e.customer.email, givenName: e.customer.givenName, className: cls.content.name, whenLabel: waitlistWhen(cls, e.sessionIds), byStudio: true, cardOff: off }).catch(() => undefined)
      }
    }
    await recordAudit({
      by: { ...by, role: 'owner' }, action: `waitlist-unclear-${choice}`, target: { kind: 'class', id: classId, label: cls.content.name },
      details: { entryId: e.id, n: a.n, orderId: a.orderId, square: answer.state, cents: a.amountCents, name: nameOfEntry(e) },
    }).catch(() => undefined)
    return (await getWaitlist(classId)).entries.find((x) => x.id === entryId) ?? e
  } finally {
    await releaseLock(classId, lockId)
  }
}
