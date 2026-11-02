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
import { deletePaidElsewhere, listCheckouts, type PartyCheckout } from './party-checkouts'
import { recordPartyPayment } from './party-payments'
import { assertPartyLockHeld } from './party-lock'
import { dueCents } from './money'
import type { Cents } from './types'

const logger = createLogger('parties:paid-elsewhere')

export const NOT_WAITING = 'This isn’t waiting any more.'
export const ON_THE_PARTY_NOW = 'This payment is on the party now. Refund it from the party’s Payments tab if it should go back.'
export const REFUND_STARTED = 'A refund of this payment was already started. Tap Refund it to finish it.'

/** Why a choice on a paid-elsewhere payment can't go ahead (status for the API). */
export class PaidElsewhereError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

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
export interface ElsewhereRefunded { orderId: string; partyId: string; firstName: string; email: string; startIso: string; keptBooking: boolean }

const inputHashOf = (orderId: string, paymentId: string, cents: Cents) => hashOf('party-elsewhere-refund', orderId, paymentId, cents)

/**
 * The paid-elsewhere side of the shared refund runner. Built for an ask
 * (`entry` given) it plans from the entry; resolved from its scope alone
 * (refund-books) it only writes, emails and audits a request already saved.
 */
export async function paidElsewhereRefundBook(orderId: string, opts: { entry?: Entry | null; rec?: PartyRecord | null } = {}): Promise<RefundBook<ElsewhereRefunded>> {
  const entry = opts.entry !== undefined ? opts.entry : await paidElsewhereEntry(orderId).catch(() => null)
  const rec = opts.rec !== undefined ? opts.rec : (entry ? await getPartyRecord(entry.partyId).catch(() => null) : null)
  const shown: ElsewhereRefunded = {
    orderId, partyId: entry?.partyId ?? '', firstName: entry ? firstOf(entry, rec) : '', email: entry?.host.email || rec?.hostEmail || '',
    startIso: rec?.startIso || entry?.startIso || '',
    // The host keeps a party only when this was a second payment on a booked party of ours.
    keptBooking: entry?.why === 'other-payment' && !!rec && isOurs(rec) && rec.status !== 'cancelled',
  }
  const label = shown.firstName ? `${shown.firstName}’s payment` : 'a party payment'
  return {
    scope: { classId: PAID_ELSEWHERE_SCOPE, bookingId: orderId },
    label,
    kind: 'paid-elsewhere',
    logTag: 'parties/paid-elsewhere-refund',
    unreachable: 'The party payments couldn’t be reached. Try again.',
    inputHash: entry ? inputHashOf(orderId, entry.paymentId, entry.squareCents) : '',
    async plan() {
      const now = await paidElsewhereEntry(orderId)
      if (!now || !entry || now.paymentId !== entry.paymentId) throw new RefundError(404, NOT_WAITING)
      const party = await getPartyRecord(now.partyId).catch(() => null)
      if (party?.charges?.some((c) => c.paymentId === now.paymentId)) throw new RefundError(409, ON_THE_PARTY_NOW)
      const saved = await listRefundRequests(PAID_ELSEWHERE_SCOPE, orderId)
      const rawKey = refundKeyRaw(`pe:${orderId}`, [now.paymentId], now.squareCents, 0)
      const failures = saved.filter((s) => s.rawKey === rawKey).reduce((m, s) => Math.max(m, s.failures), 0)
      return { lines: [{ id: now.paymentId, cents: now.squareCents }], totalCents: now.squareCents, paymentId: now.paymentId, freeSeat: false, prior: 0, failures, rawKey }
    },
    // A turned-down refund is sent again only while the payment is still waiting here.
    stillFits: async () => !!(await paidElsewhereEntry(orderId)),
    noteFailed: async () => undefined,
    // Refunded: the payment is settled, so it leaves To decide. Idempotent.
    async write() {
      await deletePaidElsewhere(orderId)
      return shown
    },
    current: async () => shown,
    describe: async (r: SavedRefundRequest) => ({ requestId: r.id, status: r.status, cents: r.totalCents, at: r.createdAt, by: r.by }),
    canEmail: (_r, w) => !!w.email,
    async email(r, w) {
      return (await sendRefundEmail({
        to: w.email, givenName: w.firstName, className: 'your party', cents: r.totalCents, keptSeat: w.keptBooking, party: { startIso: w.startIso || null },
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
 * "Refund it": exactly that Square payment, all of it. Throws RefundError
 * (Square gave no answer: tapping again re-sends the same saved request and
 * key, so it can never refund twice; Square turned it down: nothing moved).
 */
export async function refundPaidElsewhere(orderId: string, reason: string, by: By): Promise<{ cents: Cents; emailed: boolean; firstName: string; already: boolean }> {
  const entry = await paidElsewhereEntry(orderId)
  const saved = await listRefundRequests(PAID_ELSEWHERE_SCOPE, orderId)
  if (!entry) {
    // Already refunded (a double tap after the first one finished): the same answer, nothing sent.
    const done = saved.find((r) => r.status === 'done')
    if (done) return { cents: done.totalCents, emailed: !!done.emailedAt, firstName: '', already: true }
    throw new RefundError(404, NOT_WAITING)
  }
  const book = await paidElsewhereRefundBook(orderId, { entry })
  const out = await runRefund(book, { reason }, { by, role: 'owner' })
  return { cents: out.cents, emailed: out.emailed, firstName: out.written.firstName, already: !!out.already }
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
  const chargeId = idFor('chg', entry.paymentId)
  const at = now.toISOString()
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
  await deletePaidElsewhere(orderId)
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
