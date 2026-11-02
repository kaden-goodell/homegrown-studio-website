/**
 * "Party payment to check" (paid elsewhere): Square shows one of our party
 * orders paid, with nothing here to record it from (square-orders flags it:
 * no checkout, an earlier try the customer changed, or a party already paid
 * by another order). The owners' two choices on /admin › To decide (DV12):
 *
 *   Refund it            refunds exactly that Square payment through the shared
 *                        refund runner (booking-core/refund-runner): the request
 *                        is saved before Square is called, a retry re-sends the
 *                        same key (never twice), the host gets the refund email
 *                        once, it is audited once. Saved requests use the scope
 *                        PAID_ELSEWHERE_SCOPE with the order id as the booking.
 *   Put it toward the    only for a party of ours that still owes at least that
 *   party                amount: the payment is recorded as a charge on the party
 *                        (no Square call), covering the unpaid items it pays for,
 *                        filed under the party (a later refund from the party's
 *                        Payments tab works as usual), audited.
 *
 * Both first READ the payment from Square (and every refund on it): money
 * Square already sent back is never credited to a party, and a payment fully
 * refunded already leaves only "It's already sorted". A choice settles the
 * payment: its entry becomes a settled marker (who, when, how), so Square's
 * next event or the nightly run never raises it again.
 *
 * Both run inside the party's lock (To decide's `decide`), so a double tap or
 * two owners at once see the first one's result. Server only.
 */
import { recordAudit } from '@lib/audit'
import { sendRefundEmail } from '@lib/email'
import { formatMoney } from '@lib/money'
import type { By } from '@lib/staff-auth'
import { getPartyRecord, isOurs, PartyNotFoundError, updatePartyRecord, type PartyCharge, type PartyItem, type PartyRecord } from '@lib/party-store'
import { hashOf, listRefundRequests, type SavedRefundRequest } from '@lib/classes/refund-requests'
import { PAID_ELSEWHERE_SCOPE, runRefund, type RefundBook } from '@lib/booking-core/refund-runner'
import { RefundError, refundKeyRaw } from '@lib/booking-core/refund-words'
import { idFor } from '@lib/booking-core/ids'
import { createLogger } from '@lib/logger'
import { alertOwners } from '@lib/owner-alert'
import { providers } from '@config/providers'
import { decidedKv, tokenOf } from '@lib/classes/decided'
import { changeRefundRequest } from '@lib/classes/refund-requests'
import { refundKey } from '@lib/booking-core/refund-words'
import { retrySavedRequest } from '@lib/booking-core/refund-runner'
import {
  isOrderEntry, listCheckouts, notePaidElsewhere, reopenPaidElsewhere, settlePaidElsewhere, type PartyCheckout,
} from './party-checkouts'
import { recordPartyPayment } from './party-payments'
import { assertPartyLockHeld } from './party-lock'
import { dueCents } from './money'
import type { Cents } from './types'

const logger = createLogger('parties:paid-elsewhere')

export const NOT_WAITING = 'This isn’t waiting any more.'
export const ON_THE_PARTY_NOW = 'This payment is on the party now. Refund it from the party’s Payments tab if it should go back.'
export const REFUND_STARTED = 'A refund of this payment was already started. Tap Refund it to finish it.'
export const REFUND_UNCONFIRMED = 'A refund of this payment was started and Square didn’t confirm it. Tap Refund it to finish it (it never refunds twice).'
export const SQUARE_UNREADABLE = 'Couldn’t reach Square to check that payment. Try again. Nothing was changed.'

/** Why a choice on a paid-elsewhere payment can't go ahead (status for the API). `reload`: the item changed, show it again. */
export class PaidElsewhereError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message) }
}

/** The To decide item id of a paid-elsewhere payment (the same form to-decide lists it under). */
export const paidElsewhereItemId = (orderId: string) => tokenOf(`ppe-${orderId.replace(/[^A-Za-z0-9_-]/g, '_')}`)

/** A saved refund of this payment that Square hasn't finished (no answer, or sent and not yet written here). */
export const unfinishedRefund = (saved: SavedRefundRequest[]) => saved.find((r) => r.status !== 'done' && r.status !== 'turned-down' && !r.retired) ?? null

/** What Square shows on the payment now. `backCents`: completed and pending refunds (money gone or going back). */
export interface SquareSays { status: string; amountCents: Cents; backCents: Cents; createdAt: string | null; refundIds: string[] }

/** Reads the payment and its refunds from Square (read only). Throws PaidElsewhereError(503) when Square can't be read. */
export async function squareSays(paymentId: string): Promise<SquareSays> {
  if (!providers.payment.readPayment) throw new PaidElsewhereError(503, SQUARE_UNREADABLE)
  try {
    const p = await providers.payment.readPayment(paymentId)
    const live = p.refunds.filter((r) => r.status === 'COMPLETED' || r.status === 'PENDING')
    const back = p.refunds.length ? live.reduce((t, r) => t + r.amountCents, 0) : p.refundedCents
    return { status: p.status, amountCents: p.amountCents, backCents: back, createdAt: p.createdAt, refundIds: live.map((r) => r.id) }
  } catch (e) {
    logger.warn('Square payment read failed', { paymentId, error: e instanceof Error ? e.message : String(e) })
    throw new PaidElsewhereError(503, SQUARE_UNREADABLE)
  }
}

/** What Square shows already refunded, as the item keeps it: always written (a $0 answer clears an old note, I-2). */
export { backText }
export const refundedNote = (sq: SquareSays, at: string) => (sq.backCents > 0 ? { cents: sq.backCents, at, ids: sq.refundIds } : null)

/** "Square shows $300 of this $300 payment already refunded" (owners' words). */
const backText = (back: Cents, total: Cents) => (back >= total
  ? `Square shows this ${formatMoney(total)} payment already refunded`
  : back <= 0 ? `Square shows nothing refunded on this ${formatMoney(total)} payment now`
    : `Square shows ${formatMoney(back)} of this ${formatMoney(total)} payment already refunded`)

type Entry = PartyCheckout & { orderId: string; paymentId: string; squareCents: Cents }

/** The paid-elsewhere entry for this order, or null when it was settled. Throws when the store can't be read. */
export async function paidElsewhereEntry(orderId: string): Promise<Entry | null> {
  const c = (await listCheckouts()).find((x) => x.state === 'paid-elsewhere' && x.orderId === orderId)
  if (!c || !c.orderId || !c.paymentId || !c.squareCents || c.squareCents <= 0) return null
  return c as Entry
}

/** A party of ours, booked, that owes at least `cents`: the payment can go toward it. */
export function canTakePayment(r: PartyRecord | null, cents: Cents): r is PartyRecord {
  return !!r && isOurs(r) && r.status !== 'cancelled' && cents > 0 && dueCents(r) >= cents
}

const firstOf = (e: Entry, r: PartyRecord | null) => (e.host.firstName || r?.hostName || '').trim().split(/\s+/)[0] || ''

// ── Refund it ────────────────────────────────────────────────────────────────

/** What a finished paid-elsewhere refund shows (the entry is gone once it is written). */
export interface ElsewhereRefunded { orderId: string; partyId: string; firstName: string; email: string; startIso: string; keptBooking: boolean; why: PartyCheckout['why'] | null }

const inputHashOf = (orderId: string, paymentId: string, cents: Cents) => hashOf('party-elsewhere-refund', orderId, paymentId, cents)

/**
 * The paid-elsewhere side of the shared refund runner. Built for an ask
 * (`entry` given) it plans from the entry; resolved from its scope alone
 * (refund-books) it only writes, emails and audits a request already saved.
 */
export async function paidElsewhereRefundBook(orderId: string, opts: { entry?: Entry | null; rec?: PartyRecord | null; cents?: Cents } = {}): Promise<RefundBook<ElsewhereRefunded>> {
  const entry = opts.entry !== undefined ? opts.entry : await paidElsewhereEntry(orderId).catch(() => null)
  // What is refunded: what Square shows left on the payment (asked just before), else the whole payment.
  const cents = opts.cents ?? entry?.squareCents ?? 0
  const rec = opts.rec !== undefined ? opts.rec : (entry ? await getPartyRecord(entry.partyId).catch(() => null) : null)
  const shown: ElsewhereRefunded = {
    orderId, partyId: entry?.partyId ?? '', firstName: entry ? firstOf(entry, rec) : '', email: entry?.host.email || rec?.hostEmail || '',
    startIso: rec?.startIso || entry?.startIso || '',
    // The host keeps a party only when this was a second payment on a booked party of ours.
    keptBooking: entry?.why === 'other-payment' && !!rec && isOurs(rec) && rec.status !== 'cancelled',
    why: entry?.why ?? null,
  }
  const label = shown.firstName ? `${shown.firstName}’s payment` : 'a party payment'
  return {
    scope: { classId: PAID_ELSEWHERE_SCOPE, bookingId: orderId },
    label,
    kind: 'paid-elsewhere',
    logTag: 'parties/paid-elsewhere-refund',
    unreachable: 'The party payments couldn’t be reached. Try again.',
    inputHash: entry ? inputHashOf(orderId, entry.paymentId, cents) : '',
    async plan() {
      const now = await paidElsewhereEntry(orderId)
      if (!now || !entry || now.paymentId !== entry.paymentId) throw new RefundError(404, NOT_WAITING)
      if (cents <= 0 || cents > now.squareCents) throw new RefundError(409, NOT_WAITING)
      const party = await getPartyRecord(now.partyId).catch(() => null)
      if (party?.charges?.some((c) => c.paymentId === now.paymentId)) throw new RefundError(409, ON_THE_PARTY_NOW)
      const saved = await listRefundRequests(PAID_ELSEWHERE_SCOPE, orderId)
      const rawKey = refundKeyRaw(`pe:${orderId}`, [now.paymentId], cents, 0)
      const failures = saved.filter((s) => s.rawKey === rawKey).reduce((m, s) => Math.max(m, s.failures), 0)
      return { lines: [{ id: now.paymentId, cents }], totalCents: cents, paymentId: now.paymentId, freeSeat: false, prior: 0, failures, rawKey }
    },
    // A turned-down refund is sent again only while the payment is still waiting here.
    stillFits: async () => !!(await paidElsewhereEntry(orderId)),
    noteFailed: async () => undefined,
    // Refunded: the payment is settled (a marker, so it is never raised again) and leaves To decide. Idempotent.
    async write(r) {
      await settlePaidElsewhere(orderId, { how: 'refunded', by: r.by, at: new Date().toISOString(), cents: r.totalCents })
      // A second payment on a booked party: one line on the party, so a phone call finds the refund (no money fields).
      if (shown.keptBooking && shown.partyId) {
        const line = `Refunded a ${formatMoney(r.totalCents)} second payment that wasn’t on the party (To decide)`
        try {
          await assertPartyLockHeld()
          await updatePartyRecord(shown.partyId, (cur) => (cur.history?.some((h) => h.change === line) ? null : cur), line, r.by)
        } catch (e) {
          logger.warn('Party history line not written', { partyId: shown.partyId, error: e instanceof Error ? e.message : String(e) })
        }
      }
      return shown
    },
    current: async () => shown,
    describe: async (r: SavedRefundRequest) => ({ requestId: r.id, status: r.status, cents: r.totalCents, at: r.createdAt, by: r.by }),
    canEmail: (_r, w) => !!w.email,
    async email(r, w) {
      // An abandoned try or an unmatched payment: worded as a refund of a duplicate payment, never as a cancellation (no date).
      const duplicate = w.why === 'retired' ? 'changed-party' as const : w.why === 'no-checkout' ? 'unmatched-party' as const : undefined
      return (await sendRefundEmail({
        to: w.email, givenName: w.firstName, className: 'your party', cents: r.totalCents, keptSeat: w.keptBooking, party: { startIso: duplicate ? null : (w.startIso || null) },
        ...(duplicate ? { duplicate } : {}),
      })).sent
    },
    audit: (r, squareRefundId, how) => recordAudit({
      by: { ...r.by, role: r.role },
      action: 'party-paid-elsewhere-refund',
      target: { kind: 'party', id: shown.partyId || orderId, label },
      details: { orderId, paymentId: r.paymentId, cents: r.totalCents, reason: r.reason, requestId: r.id, squareRefundId, ...(how ? { via: how } : {}) },
    }),
    auditCheck: (r, cleared) => recordAudit({
      by: { ...cleared.by, role: cleared.role },
      action: 'party-paid-elsewhere-refund-checked',
      target: { kind: 'party', id: shown.partyId || orderId, label },
      details: { orderId, requestId: r.id, outcome: cleared.outcome, reason: cleared.reason, cents: r.totalCents },
    }),
  }
}

/**
 * "Refund it": exactly that Square payment, what Square shows left on it.
 * A refund already started (no answer from Square) is continued with its own
 * saved key, never re-planned. Otherwise Square is asked first: money it
 * already sent back is noted on the item (it then offers only what fits), and
 * a payment fully refunded is refused. `cents` = what the owner confirmed:
 * refused when Square now shows a different amount left. Throws RefundError
 * (no answer / turned down) or PaidElsewhereError.
 */
export async function refundPaidElsewhere(
  orderId: string, reason: string, by: By, opts: { cents?: Cents; now?: Date } = {},
): Promise<{ cents: Cents; emailed: boolean; firstName: string; email: string; already: boolean }> {
  const entry = await paidElsewhereEntry(orderId)
  const saved = await listRefundRequests(PAID_ELSEWHERE_SCOPE, orderId)
  if (!entry) {
    // Already refunded (a double tap after the first one finished): the same answer, nothing sent.
    const done = saved.find((r) => r.status === 'done')
    if (done) return { cents: done.totalCents, emailed: !!done.emailedAt, firstName: '', email: '', already: true }
    throw new RefundError(404, NOT_WAITING)
  }
  const actor = { by, role: 'owner' as const }
  const going = unfinishedRefund(saved)
  if (going) {
    // Our own refund may already show in Square: never read as "refunded elsewhere". The same key finishes it.
    const book = await paidElsewhereRefundBook(orderId, { entry, cents: going.totalCents })
    const out = await finalAnswer(orderId, entry, () => retrySavedRequest(book, going.id, actor), opts.now)
    return { cents: out.cents, emailed: out.emailed, firstName: out.written.firstName, email: out.written.email, already: false }
  }
  const sq = await squareSays(entry.paymentId)
  const total = sq.amountCents || entry.squareCents
  const left = Math.max(0, total - sq.backCents)
  const at = (opts.now ?? new Date()).toISOString()
  await notePaidElsewhere(orderId, { squareRefunded: refundedNote(sq, at) })
  if (left <= 0) throw new PaidElsewhereError(409, `${backText(sq.backCents, total)}, so nothing more was refunded. Tap It’s already sorted to clear this.`, { reload: true })
  const shown = opts.cents ?? (entry.squareCents - (entry.squareRefunded?.cents ?? 0))
  if (shown !== left) {
    throw new PaidElsewhereError(409, `${backText(sq.backCents, total)}, so ${formatMoney(left)} is left. Look at it again before refunding. Nothing was refunded.`, { reload: true })
  }
  const book = await paidElsewhereRefundBook(orderId, { entry, cents: left })
  const out = await finalAnswer(orderId, entry, () => runRefund(book, { reason }, actor), opts.now)
  return { cents: out.cents, emailed: out.emailed, firstName: out.written.firstName, email: out.written.email, already: !!out.already }
}

/** Square's final "already refunded" answer: the item learns what Square shows, and says so (not "no answer"). */
async function finalAnswer<T>(orderId: string, entry: Entry, fn: () => Promise<T>, now?: Date): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (!(e instanceof RefundError) || e.extra?.squareSaid !== 'already-refunded') throw e
    const sq = await squareSays(entry.paymentId).catch(() => null)
    if (sq) await notePaidElsewhere(orderId, { squareRefunded: refundedNote(sq, (now ?? new Date()).toISOString()) }).catch(() => undefined)
    throw new PaidElsewhereError(409, alreadyRefundedText(e.message, sq, entry.squareCents), { reload: true })
  }
}

/**
 * Square's "already refunded" answer, in words that fit what is left (M-1): money still owed back offers
 * Refund the rest; nothing left offers It's already sorted; Square unreadable says to look again.
 */
export function alreadyRefundedText(said: string, sq: SquareSays | null, paidCents: Cents): string {
  if (!sq) return `${said} Look at it again before choosing.`
  const total = sq.amountCents || paidCents
  const left = Math.max(0, total - sq.backCents)
  if (left > 0 && sq.backCents > 0) return `${backText(sq.backCents, total)}, so ${formatMoney(left)} is left. Nothing more was refunded. Tap Refund the rest.`
  if (left > 0) return `${backText(0, total)}. Nothing was refunded. Look at it again, then tap Refund it.`
  return `${said} Tap It’s already sorted to clear this.`
}

// ── It's already sorted ───────────────────────────────────────────────────────

/**
 * "It's already sorted": the payment is settled with no money moving (a marker
 * names who and when). Refused while a refund of it waits on Square's answer:
 * that refund is finished with Refund it, never silently dropped.
 */
export async function sortPaidElsewhere(orderId: string, by: By, now: Date = new Date()): Promise<void> {
  const entry = await paidElsewhereEntry(orderId)
  if (!entry) throw new PaidElsewhereError(404, NOT_WAITING)
  if (unfinishedRefund(await listRefundRequests(PAID_ELSEWHERE_SCOPE, orderId))) throw new PaidElsewhereError(409, REFUND_UNCONFIRMED)
  await assertPartyLockHeld()
  await settlePaidElsewhere(orderId, { how: entry.squareRefunded ? 'refunded-in-square' : 'sorted', by, at: now.toISOString(), cents: entry.squareCents })
}

/**
 * Square turned down a refund of a paid-elsewhere payment after it was sent
 * and written here: the payment waits in To decide again (its decision
 * undone), the request may be sent again as a new try, and the owners are
 * told. Never refunds by itself. True when it was reopened now.
 */
export async function reopenAfterFailedRefund(orderId: string, req: SavedRefundRequest, now: Date): Promise<boolean> {
  await changeRefundRequest(PAID_ELSEWHERE_SCOPE, orderId, req.id, (r) => (r.status === 'turned-down' ? null : {
    ...r, status: 'turned-down', failures: r.failures + 1,
    idempotencyKey: refundKey(r.bookingId, r.lines.map((x) => x.id), r.totalCents, r.prior, r.failures + 1),
  }))
  const reopened = await reopenPaidElsewhere(orderId, { refundFailed: { cents: req.totalCents, at: now.toISOString() } })
  if (!reopened) return false
  await decidedKv.set(`done-${paidElsewhereItemId(orderId)}`, '').catch(() => undefined)
  await alertOwners(`A ${formatMoney(req.totalCents)} refund of a party payment didn't go through in Square, so nothing was refunded. It's back in /admin › To decide.`).catch(() => undefined)
  return true
}

/** The paid-elsewhere entry (waiting or settled) for a Square payment, or null. Throws when the store can't be read. */
export async function paidElsewhereForPayment(paymentId: string): Promise<PartyCheckout | null> {
  return (await listCheckouts()).find((c) => isOrderEntry(c) && c.paymentId === paymentId && !!c.orderId) ?? null
}

// ── Put it toward the party ──────────────────────────────────────────────────

/**
 * The unpaid items a payment of `cents` covers, in the order they were added:
 * each one whose price still fits in what is left. A payment for exactly what
 * is due covers everything.
 */
export function itemsCovered(items: PartyItem[], cents: Cents): PartyItem[] {
  let left = cents
  const out: PartyItem[] = []
  for (const it of items) {
    if (it.chargeId !== null || it.cents > left) continue
    out.push(it)
    left -= it.cents
  }
  return out
}

/**
 * "Put it toward the party": records the payment as a charge on the party
 * (no Square call), the unpaid items it covers marked paid. Only on a booked
 * party of ours that still owes at least that amount, with no payment going
 * through and no refund of it started. Idempotent by the payment id.
 */
export async function applyPaidElsewhere(orderId: string, by: By, now: Date = new Date()): Promise<{ cents: Cents; dueLeft: Cents; firstName: string; already: boolean }> {
  const entry = await paidElsewhereEntry(orderId)
  if (!entry) throw new PaidElsewhereError(404, NOT_WAITING)
  if (entry.why !== 'other-payment') throw new PaidElsewhereError(409, 'This payment isn’t for a party that’s booked here, so it can only be refunded.')
  const started = (await listRefundRequests(PAID_ELSEWHERE_SCOPE, orderId)).some((r) => r.status !== 'turned-down' && !r.retired)
  if (started) throw new PaidElsewhereError(409, REFUND_STARTED)
  const cents = entry.squareCents
  // Square first: money it already sent back (or is sending) is never credited to the party.
  const sq = await squareSays(entry.paymentId)
  await notePaidElsewhere(orderId, { squareRefunded: refundedNote(sq, now.toISOString()) })
  if (sq.backCents > 0) {
    throw new PaidElsewhereError(409, `${backText(sq.backCents, sq.amountCents || cents)}, so it can’t go toward the party. If that settles it, tap It’s already sorted.`, { reload: true })
  }
  if (sq.status !== 'COMPLETED') throw new PaidElsewhereError(409, 'Square doesn’t show this payment as complete, so it can’t go toward the party. Nothing was changed.')
  const chargeId = idFor('chg', entry.paymentId)
  // The month the money arrived (Reports), not the day it was put on the party.
  const at = sq.createdAt && Number.isFinite(Date.parse(sq.createdAt)) ? new Date(sq.createdAt).toISOString() : now.toISOString()
  let already = false
  let rec: PartyRecord
  try {
    await assertPartyLockHeld()
    rec = await updatePartyRecord(entry.partyId, (cur) => {
      already = false
      if (cur.charges?.some((c) => c.paymentId === entry.paymentId)) { already = true; return null }
      if (!isOurs(cur)) throw new PaidElsewhereError(409, 'That party was booked in Square, so this payment can only be refunded.')
      if (cur.status === 'cancelled') throw new PaidElsewhereError(409, 'That party was cancelled, so this payment can only be refunded.')
      if (cur.paying && Date.parse(cur.paying.until) > now.getTime()) {
        throw new PaidElsewhereError(409, 'Another payment on this party is going through right now. Try again in a few minutes. Nothing was changed.')
      }
      const due = dueCents(cur)
      if (due < cents) {
        throw new PaidElsewhereError(409, `The party only owes ${formatMoney(due)}, less than this ${formatMoney(cents)} payment, so it can’t go toward the party. Refund it instead.`)
      }
      const covered = new Set(itemsCovered(cur.items ?? [], cents).map((it) => it.id))
      const charge: PartyCharge = {
        id: chargeId, via: 'link', orderId, paymentId: entry.paymentId, cents,
        quotedCents: (cur.items ?? []).filter((it) => covered.has(it.id)).reduce((t, it) => t + it.cents, 0),
        itemIds: [...covered], receiptUrl: null, at, by,
      }
      return {
        ...cur,
        items: (cur.items ?? []).map((it) => (covered.has(it.id) ? { ...it, chargeId } : it)),
        charges: [...(cur.charges ?? []), charge],
      }
    }, `Put a ${formatMoney(cents)} payment from Square toward the party (To decide)`, by)
  } catch (e) {
    if (e instanceof PartyNotFoundError) throw new PaidElsewhereError(404, 'That party isn’t on the books any more, so this payment can only be refunded.')
    throw e
  }
  // Filed under the party, so a refund made later (here or in Square) finds it.
  try {
    await recordPartyPayment(entry.paymentId, entry.partyId, chargeId)
  } catch (err) {
    logger.error('Party payment index write failed', { partyId: entry.partyId, paymentId: entry.paymentId, error: String(err) })
    await alertOwners(`${rec.hostName}’s party has a ${formatMoney(cents)} payment that couldn't be filed under it. A refund made in Square on it won't be matched; refund it from /admin.`).catch(() => undefined)
  }
  await settlePaidElsewhere(orderId, { how: 'applied', by, at: now.toISOString(), cents })
  if (!already) {
    await recordAudit({
      by: { ...by, role: 'owner' },
      action: 'party-paid-elsewhere-applied',
      target: { kind: 'party', id: entry.partyId, label: rec.hostName || 'a party' },
      details: { orderId, paymentId: entry.paymentId, cents, chargeId },
    })
  }
  return { cents, dueLeft: dueCents(rec), firstName: firstOf(entry, rec), already }
}
