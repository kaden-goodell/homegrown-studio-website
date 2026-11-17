/**
 * The deposit on a private-event quote (spec §5 "Pay"): the customer's
 * payment turns the quote into a booked party of ours, through the same
 * pay-link core every party payment uses.
 *
 *   1. by token, re-read in the quote's lock; guard table; price key; tier
 *   2. the party record: a paid deposit → that party again; a payment in
 *      flight → busy; otherwise reused, or made (one deposit item, unpaid);
 *      the quote → paying
 *   3. studio: the time held for at least 15 more minutes; taken → no record
 *      left, quote back to picked
 *   4. payBalance with the record's pay key: charges exactly the deposit,
 *      one payment at a time, unclear answers and replays handled there
 *   5. paid → the time booked under the same id, the balance item added,
 *      quote paid, request booked, the owners told once
 *   6. declined → no record left, quote back to picked
 *   7. unclear → everything kept, quote stays paying ("checking")
 *
 * Never refunds or cancels anything. Runs inside withQuoteLock (the party's
 * lock); payBalance does not take that lock, its own claim keeps it single.
 * Server only.
 */
import { createLogger } from '@lib/logger'
import { formatMoney } from '@lib/money'
import { alertOwners } from '@lib/owner-alert'
import { emailsFor } from '@lib/notify-settings'
import { sendEmail } from '@lib/email'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { idFor } from '@lib/booking-core/ids'
import { getRequest, setRequestStatus, type EventRequest } from '@lib/event-requests'
import {
  createPartyRecord, deletePartyRecord, getPartyRecord, newHostToken, updatePartyRecord,
  type PartyItem, type PartyRecord,
} from '@lib/party-store'
import { confirmTime, extendHold, holdTime, releaseTime } from '@lib/parties/party-book'
import { busyBetween } from '@lib/classes/studio-schedule'
import { payBalance, type LinkPay } from '@lib/parties/pay-balance'
import { partyWhenLabel } from '@lib/parties/payment-link'
import { quoteDepositCents, quoteTotalCents } from '@lib/parties/quote-party'
import { depositCents, totalCents } from './money'
import { getQuote, getQuoteByToken, updateQuote, withQuoteLock } from './quote-store'
import { isExpired, type Quote, type Tier } from './types'

const logger = createLogger('quotes:pay')
const MINUTE = 60_000
const DAY_MS = 86_400_000
/** The studio time is held at least this long while the deposit is charged. */
export const PAY_HOLD_MINUTES = 15

// DRAFT copy (new, for Kaden).
export const QUOTE_CLOSED_MESSAGE = 'This quote is no longer available. Text us at (256) 464-1710.'
export const QUOTE_TIER_MESSAGE = 'That package isn’t on this quote anymore. Reload to see it.'
export const QUOTE_PRICE_CHANGED_MESSAGE = 'This quote just changed. Reload to see it.'
export const QUOTE_TIME_TAKEN_MESSAGE = 'That time was just taken, so nothing was charged. Text us at (256) 464-1710 and we’ll find another.'
export const QUOTE_BUSY_MESSAGE = 'A payment for this quote is already going through. Check back in a few minutes.'
export const QUOTE_CHECKING_MESSAGE = 'We’re checking your payment. We’ll text you.'
export const QUOTE_OUT_OF_DATE_MESSAGE = 'This page is out of date. Refresh it and try again. Nothing was charged.'

/** What the customer page sends (pay.json's `pay`). */
export interface QuotePayBody { paymentToken?: unknown; verificationToken?: unknown; sourceKind?: unknown }

export interface PayQuoteInput {
  token: string
  tierId: string
  priceKey: string
  attemptId: string
  pay: QuotePayBody
  requestUrl: string
  now?: Date
}

export type PayQuoteWhy = 'closed' | 'tier_unavailable' | 'price_changed' | 'time_taken' | 'busy' | 'declined' | 'checking' | 'unavailable'
export type PayQuoteResult = { ok: true; partyId: string } | { ok: false; why: PayQuoteWhy; message: string }

const no = (why: PayQuoteWhy, message: string): PayQuoteResult => ({ ok: false, why, message })
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const CLOSED = (): PayQuoteResult => no('closed', QUOTE_CLOSED_MESSAGE)

/** The body's payment, exactly as /api/party/pay.json reads it (bypass → simulated). Null: nothing usable. */
function linkPayOf(body: QuotePayBody | null | undefined, requestUrl: string): LinkPay | null {
  if (paymentBypassEnabled(new Request(requestUrl))) return { kind: 'simulated' }
  const token = body?.paymentToken
  if (typeof token !== 'string' || !token || token.length > 4000) return null
  return { kind: 'card', paymentToken: token, sourceKind: body?.sourceKind === 'gift_card' ? 'gift_card' : 'card' }
}

const quoteItemsOf = (r: PartyRecord) => (r.items ?? []).filter((it) => it.kind === 'quote')
const depositPaid = (r: PartyRecord) => quoteItemsOf(r)[0]?.chargeId != null
const payingLive = (r: PartyRecord, now: Date) => !!r.paying && Date.parse(r.paying.until) > now.getTime()

function item(partyId: string, which: 'deposit' | 'balance', tierName: string, cents: number, at: string): PartyItem {
  return {
    id: idFor('itm', `${partyId}:${which}`), kind: 'quote', refId: which,
    label: `${which === 'deposit' ? 'Deposit' : 'Balance'}: ${tierName}`,
    qty: 1, count: 1, unitCents: cents, cents, extraMinutes: 0, chargeId: null, addedAt: at, by: null,
  }
}

/** The party the quote becomes, before any payment (spec §4). */
function draftRecord(q: Quote & { startIso: string; endIso: string }, tier: Tier, req: EventRequest, deposit: number, simulated: boolean, now: Date): PartyRecord {
  const at = now.toISOString()
  const first = req.about.name.trim().split(/\s+/)[0] ?? ''
  return {
    bookingId: q.partyId,
    hostToken: newHostToken(),
    payToken: newHostToken(),
    craftName: tier.name,
    startIso: q.startIso,
    endIso: q.endIso,
    durationMinutes: Math.round((Date.parse(q.endIso) - Date.parse(q.startIso)) / MINUTE),
    hostName: req.about.name.trim(),
    hostEmail: req.about.email.trim(),
    ...(req.about.phone ? { hostPhone: req.about.phone } : {}),
    guestCount: q.guests,
    title: first ? `${first}’s private event` : 'Private event',
    dropOff: false,
    ...(simulated ? { simulated: true as const } : {}),
    createdAt: at,
    source: 'ours',
    status: 'booked',
    items: [item(q.partyId, 'deposit', tier.name, deposit, at)],
    charges: [],
    refunds: [],
    origin: 'quote',
    quote: { quoteId: q.id, tierName: tier.name, lines: tier.lines.map((l) => l.label), guests: q.guests, pricePerPersonCents: tier.priceCents },
    place: q.place,
    ...(q.address ? { address: q.address } : {}),
    history: [{ at, by: null, change: 'Made from a private event quote (deposit due)' }],
  }
}

/** The quote's status, history noted. Never touches version or updatedAt (not an owner edit). */
async function setQuote(id: string, what: string, now: Date, fn: (q: Quote) => Partial<Quote> | null): Promise<{ q: Quote; changed: boolean }> {
  let changed = false
  const q = await updateQuote(id, (cur) => {
    const patch = fn(cur)
    if (!patch) return null
    changed = true
    return { ...cur, ...patch, history: [...cur.history, { at: now.toISOString(), by: 'customer', what }] }
  })
  return { q, changed }
}

const backToPicked = (q: Quote, tierId: string, why: string, now: Date) =>
  setQuote(q.id, why, now, (cur) => (cur.status === 'paid' ? null : { status: 'picked', pickedTierId: tierId, paying: undefined }))

/** No money on it: the record goes. Never throws (a record left behind is harmless; it is still unpaid). */
async function removeUnpaid(partyId: string): Promise<void> {
  try {
    await deletePartyRecord(partyId)
  } catch (err) {
    logger.warn('Unpaid quote party not removed', { partyId, error: String(err) })
  }
}

export async function payQuote(input: PayQuoteInput): Promise<PayQuoteResult> {
  const now = input.now ?? new Date()
  if (typeof input.token !== 'string') return CLOSED()
  const pay = linkPayOf(input.pay, input.requestUrl)
  if (!pay) return no('declined', QUOTE_OUT_OF_DATE_MESSAGE)
  const found = await getQuoteByToken(input.token)
  if (!found) return CLOSED()
  return withQuoteLock(found, () => payLocked(found.id, input, pay, now))
}

async function payLocked(quoteId: string, input: PayQuoteInput, pay: LinkPay, now: Date): Promise<PayQuoteResult> {
  // ── 1. The quote as it is now ─────────────────────────────────────────────
  const q = await getQuote(quoteId)
  if (!q || q.token !== input.token) return CLOSED()
  if (q.status === 'paid') return { ok: true, partyId: q.partyId }
  const open = (q.status === 'sent' || q.status === 'picked') && !isExpired(q, now)
  if (!open && q.status !== 'paying') return CLOSED()

  let rec = await getPartyRecord(q.partyId)
  // Paid meanwhile (Square's payment event, an earlier attempt): finish booking it.
  if (rec && depositPaid(rec)) {
    await finishPaid(q, rec, now)
    return { ok: true, partyId: q.partyId }
  }
  const sameAttempt = rec?.paying?.attemptId === input.attemptId
  if (rec && payingLive(rec, now) && !sameAttempt) return no('busy', QUOTE_BUSY_MESSAGE)

  if (input.priceKey !== q.priceKey) return no('price_changed', QUOTE_PRICE_CHANGED_MESSAGE)
  const tier = q.tiers.find((t) => t.id === input.tierId && !t.hidden)
  if (!tier) return no('tier_unavailable', QUOTE_TIER_MESSAGE)
  if (!q.startIso || !q.endIso) return CLOSED()
  const timed = q as Quote & { startIso: string; endIso: string }
  const deposit = depositCents(totalCents(tier.priceCents, q.guests), q.depositPct)

  const req = await getRequest(q.requestId)
  if (!req) {
    logger.error('Quote request missing — refusing the payment', { quoteId: q.id, requestId: q.requestId })
    return CLOSED()
  }

  // ── 2. The party record, then the quote → paying ─────────────────────────
  const fresh = draftRecord(timed, tier, req, deposit, pay.kind === 'simulated', now)
  if (!rec) {
    rec = (await createPartyRecord(fresh)).rec
  } else if (!rec.paying && !(rec.charges?.length)) {
    // Left from an attempt that ended unpaid: brought up to what is being paid now (its keys kept).
    rec = await updatePartyRecord(rec.bookingId, (r) => ({
      ...r, craftName: fresh.craftName, title: fresh.title, startIso: fresh.startIso, endIso: fresh.endIso, durationMinutes: fresh.durationMinutes,
      guestCount: fresh.guestCount, items: fresh.items, quote: fresh.quote, place: fresh.place, address: fresh.address, status: 'booked',
    }), 'Quote payment started again', null)
  }
  const wasStatus = q.status
  await setQuote(q.id, `paying (${tier.name})`, now, () => ({ status: 'paying', pickedTierId: tier.id, paying: { attemptId: input.attemptId, at: now.toISOString() } }))

  // ── 3. The studio time, held for the charge ──────────────────────────────
  let freshHold = false
  if (q.place === 'studio') {
    const until = new Date(now.getTime() + PAY_HOLD_MINUTES * MINUTE).toISOString()
    let held: boolean
    if (q.held) {
      held = (await extendHold(q.partyId, timed.startIso, until, timed.endIso, now)).held
    } else {
      const others = await busyBetween(new Date(Date.parse(timed.startIso) - DAY_MS).toISOString(), new Date(Date.parse(timed.endIso) + DAY_MS).toISOString())
      const r = await holdTime({ partyId: q.partyId, startIso: timed.startIso, endIso: timed.endIso, ttlMinutes: PAY_HOLD_MINUTES }, others, now)
      held = r.ok
      freshHold = r.ok && !r.replay
    }
    if (!held) {
      await removeUnpaid(q.partyId)
      await setQuote(q.id, 'time taken at payment', now, () => ({ status: 'picked', pickedTierId: tier.id, paying: undefined, held: false }))
      return no('time_taken', QUOTE_TIME_TAKEN_MESSAGE)
    }
  }

  // ── 4. The charge, through the pay-link core ─────────────────────────────
  const out = await payBalance({ partyId: q.partyId, key: rec.payToken ?? '', attemptId: input.attemptId, expectedCents: deposit, pay, requestUrl: input.requestUrl }, now)

  if (out.kind === 'paid') {
    await finishPaid(q, out.rec, now)
    return { ok: true, partyId: q.partyId }
  }
  if (out.kind === 'unknown') return no('checking', QUOTE_CHECKING_MESSAGE)

  // Refused: nothing was charged.
  if (out.code === 'in_progress') return no('busy', QUOTE_BUSY_MESSAGE)
  await removeUnpaid(q.partyId)
  if (freshHold) await releaseTime(q.partyId, timed.startIso).catch(() => false)
  if (out.status === 402 || out.code === 'card_declined' || out.code === 'gift_card_short' || out.code === 'invalid') {
    await backToPicked(q, tier.id, 'payment declined', now)
    return no('declined', out.message)
  }
  if (out.code === 'amount_changed') {
    await backToPicked(q, tier.id, 'payment refused, amount changed', now)
    return no('price_changed', QUOTE_PRICE_CHANGED_MESSAGE)
  }
  // Store down, a test site, the order couldn't start: as it was before this attempt.
  await setQuote(q.id, 'payment not started', now, (cur) => (cur.status === 'paying' ? { status: wasStatus === 'paying' ? 'picked' : wasStatus, paying: undefined } : null))
  return no('unavailable', out.message)
}

/**
 * The deposit is paid: book the time (same id, so no overlap with its own
 * hold), add the balance, quote paid, request booked, the owners told. Each
 * step is safe to run again; only the call that marks the quote paid tells
 * the owners. Never throws for a paid party.
 */
async function finishPaid(q: Quote, rec: PartyRecord, now: Date): Promise<void> {
  const partyId = q.partyId
  if (rec.place !== 'away' && q.place === 'studio' && rec.endIso) {
    try {
      const { overlap } = await confirmTime(partyId, rec.startIso, rec.endIso, now)
      if (overlap && !rec.overlap) rec = await updatePartyRecord(partyId, (r) => ({ ...r, overlap: true }), 'Booked over another party (paid quote)', null)
    } catch (err) {
      logger.error('Paid quote party not written in the party book', { partyId, error: String(err) })
      await alertOwners(`Private event paid, but its time couldn't be booked in the calendar: ${rec.hostName}, ${partyWhenLabel(rec.startIso)}. Check it on /admin.`).catch(() => undefined)
    }
  }

  const balance = quoteTotalCents(rec) - quoteDepositCents(rec)
  if (balance > 0 && quoteItemsOf(rec).length < 2) {
    try {
      const tierName = rec.quote?.tierName ?? rec.craftName
      rec = await updatePartyRecord(partyId, (r) => {
        if (quoteItemsOf(r).length >= 2) return null
        return { ...r, items: [...(r.items ?? []), item(partyId, 'balance', tierName, balance, now.toISOString())] }
      }, `Balance due ${formatMoney(balance)}`, null)
    } catch (err) {
      logger.error('Paid quote party balance not added', { partyId, error: String(err) })
      await alertOwners(`Private event paid, but its balance (${formatMoney(balance)}) couldn't be added: ${rec.hostName}, ${partyWhenLabel(rec.startIso)}. Check it on /admin.`).catch(() => undefined)
    }
  }

  const { changed } = await setQuote(q.id, 'paid', now, (cur) => (cur.status === 'paid' ? null : { status: 'paid', paidAt: now.toISOString(), paying: undefined }))
  try {
    await setRequestStatus(q.requestId, 'booked', now)
  } catch (err) {
    logger.error('Quote request not marked booked', { requestId: q.requestId, error: String(err) })
  }
  if (!changed) return

  const deposit = quoteDepositCents(rec)
  const line = `Private event booked: ${rec.hostName}, ${partyWhenLabel(rec.startIso)}, deposit ${formatMoney(deposit)}`
  await alertOwners(line, 'booking-alerts').catch(() => undefined)
  try {
    const to = await emailsFor('booking-alerts')
    if (to) {
      const what = `${rec.quote?.tierName ?? rec.craftName}, ${rec.guestCount} guests${rec.place === 'away' && rec.address ? `, at ${rec.address}` : ''}.`
      const contact = [rec.hostEmail, rec.hostPhone].filter(Boolean).join(' · ')
      await sendEmail({
        to,
        subject: `Private event booked — ${rec.hostName}, ${partyWhenLabel(rec.startIso)}`,
        text: `${line}.\n\n${what}\n${contact}`,
        html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#2b2420;line-height:1.5;">
  <p style="margin:0 0 8px;">${esc(line)}.</p>
  <p style="margin:0 0 4px;">${esc(what)}</p>
  <p style="margin:8px 0 0;color:#6f635b;">${esc(contact)}</p>
</div>`,
      })
    }
  } catch (err) {
    logger.error('Private event booked email to the owners failed', { partyId, error: String(err) })
  }
}
