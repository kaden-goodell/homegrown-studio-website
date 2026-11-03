/**
 * /admin › To decide: things that happened in Square (or at the door)
 * without the owners, each waiting for one of them to pick what it means.
 * Nothing here ever cancels, refunds or charges anything on its own; each
 * decision is one owner's tap, recorded (who, when, what) in the audit log
 * and in a small "decided" store so the item reads "Done · …" afterwards.
 *
 *   pos-unmatched        a counter sale of a class item matched no class
 *                        → Match to a class (seats as a counter sale) · Not for a class
 *   refund-plain         a refund made in Square: → Keep their seat · Free a seat
 *   refund-failed        Square couldn't finish one of our refunds → Ask Square ·
 *                        Try the refund again (a new Square refund, its own key) ·
 *                        Mark as handled (with a reason) (class or party refunds
 *                        alike: a party one reads "the Justice party")
 *   refund-unfinished    "It went through" was saved but never finished → Finish it
 *   refund-unconfirmed   our refund got no answer from Square in 24 h → Ask Square
 *                        (reads the payment's refunds) · It went through (only
 *                        once Square shows it, recorded with Square's refund) ·
 *                        Try the refund again (the same saved key: never twice) ·
 *                        It didn't go through (only while Square shows none)
 *   pos-needs-days       a counter seat of a pick-your-days pass → pick the day(s)
 *   below-minimum        short of its minimum within 3 days of its decide-by
 *                        → Keep it running · Text the people booked
 *   door-unpaid          a pay-at-the-counter seat never rung up
 *                        → Mark paid at the counter · Free the seat
 *   counter-match-check  a counter sale matched one of several unpaid door seats
 *                        → Yes, it was them · it was someone else (the payment moves)
 *   party-paid-unclear   a party charge got no answer from Square (or was left
 *                        mid-charge) and nobody retried it; its time is held
 *                        → Confirm the party (once Square shows it paid) · It wasn't paid
 *                        Or Square shows a party order paid with nothing here
 *                        to record it from → Refund it · Put it toward the party ·
 *                        It's already sorted (parties/paid-elsewhere)
 *   party-payment-unclear a payment on a party already booked (its payment link,
 *                        or a card taken in /admin) got no answer from Square
 *                        → It went through (recorded from Square's payment on that
 *                        order, never a guess) · It didn't go through (only once
 *                        Square shows that order unpaid)
 *   party-no-confirmation a party recorded paid whose booking stopped before the
 *                        host's confirmation went out → Done (after Email the details)
 *   party-hold-orphan    a party time held (booked, or for a payment link) that no
 *                        party record is on → Free this time (only once the hold is
 *                        older than the checkout hold window and no payment of any
 *                        kind is attached to it; see parties/hold-actions)
 *   waitlist-unknown     the waitlist charged a saved card and Square never said
 *                        whether it went through; the seat is held. The sheet
 *                        asks Square (read only) and offers what fits (I5):
 *                        → Add them (paid) · Keep them waiting · Take them off
 *                          (no payment, after 30 minutes; never resent)
 *   waitlist-declined    a waitlist card didn't go through (or the price rose)
 *                        → Got it
 *   reader-waiting       a "Charge on the reader" sale never came back from the
 *                        Square app (15 minutes on) → Ask Square · Let the seat go
 *                        (Square is asked first; refused when it shows paid); or
 *                        Square showed a payment for it that didn't match (R1)
 *                        → Keep it, they paid $X · Refund it and let the seat go
 *   reader-extra         R2: a second reader payment for one sale (or one after
 *                        its seat was let go) → Refund it · It's already sorted
 *   reader-late          R3: a reader payment after the seat was let go or its
 *                        hold ran out → Keep them · Refund and free the seat
 *
 * Party decisions run inside that party's lock (withPartyLock) and re-check
 * "already decided" inside it, so a double tap records one decision. Each one
 * is fenced (assertPartyLockHeld) right before it writes the party record,
 * the party book or a checkout, so a server whose lease was taken over never
 * writes.
 *   paid-not-seated      Square shows one of our online bookings paid, but its
 *                        seats were let go before it could be confirmed (R42)
 *                        → Give them their seat (over capacity if need be) · Refund it
 *                        (classes/paid-not-seated-refund) · It's already sorted
 *   cancel-request       D2: a customer sent a note from their "Can't make it?"
 *                        page (inside 48 hours, a gift seat, paid at the studio…)
 *                        → Refund and free the seat · Free the seat, no refund ·
 *                          Keep their booking
 *   cancel-unclear       D2: a customer's own cancel whose refund Square didn't
 *                        answer (seats held) → Ask Square (the same request again,
 *                        never a second refund); or turned down → Try the refund
 *                        again · Got it
 *
 * The decisions reuse the setters the rest of the system uses: setPosDays,
 * decideRefundFlag, clearRefundRequest, freeSeatOnly, recordPos, setNames,
 * markCounterMatchChecked. Server only.
 */
import { recordAudit } from '@lib/audit'
import { decidedKv, minimumItemId, tokenOf } from './decided'
import type { By } from '@lib/staff-auth'
import { studioDate } from '@lib/studio-time'
import { getClass, listClasses } from './class-store'
import { listCounterMatchChecks, listDoorUnpaid } from './door-unpaid'
import { clearRefundRequest, freeSeatOnly, RefundError } from './refunds'
import { changeRefundRequest, hashOf, listRefundRequests } from './refund-requests'
import {
  bumpFlagRetries, decideRefundFlag, getRefundFlag, listPaidNotSeated, openPaidNotSeated, listPosNeedsDays, listRefundFlags, listUnmatchedPos, reopenRefundFlag, resolvePaidNotSeated, resolveUnmatchedPos,
  failedRefundOnBooks, fillPendingReplacement, savePendingReplacement, seatPaidOrder, setPosDays, splitCents, type RefundFlag,
} from './square-events'
import { squareFetch } from './square-api'
import {
  getLedger, markCounterMatchChecked, markDoorPaid, moveCounterPayment, recordPos, seatsTaken, setNames, unfreeSeats, unpaidDoorSeat, type LedgerLine,
} from './seat-ledger'
import { isComing } from './seat-status'
import { assertClassWritesAllowed, TestSiteStoreError } from './test-site-guard'
import { onStaffConsole } from './staff-view'
import { getPartyRecord, isOurs, listParties, PartyNotFoundError, updatePartyRecord, type PartyRecord } from '@lib/party-store'
import { clearPartyRefundRequest, partyLabel } from '@lib/parties/refunds'
import { LOOSE_PAYMENT_SCOPES, PAID_ELSEWHERE_SCOPE, PAID_NOT_SEATED_SCOPE, PARTY_SCOPE } from '@lib/booking-core/refund-runner'
import { actOnRequest, askAboutRequest, SQUARE_ASK_FAILED, type AskAnswer } from '@lib/booking-core/ask-square'
import { refundKey, SQUARE_REFUND_FINAL_CODES, SQUARE_ALREADY_REFUNDED } from '@lib/booking-core/refund-words'
import { squareErrorCodes } from '@lib/checkout-attempt'
import {
  applyPaidElsewhere, canTakePayment, PaidElsewhereError, paidElsewhereItemId, refundPaidElsewhere, sortPaidElsewhere, unfinishedRefund,
} from '@lib/parties/paid-elsewhere'
import { pnsCustomer, refundPaidNotSeated } from './paid-not-seated-refund'
import { dueCents } from '@lib/parties/money'
import { deleteCheckout, listCheckouts } from '@lib/parties/party-checkouts'
import { confirmUnclearParty, notPaidUnclearParty, paidElsewhereWhy, PartyUnclearError } from '@lib/parties/square-orders'
import { recordLinkCharge, tellLinkPaid } from '@lib/parties/pay-balance'
import { holdsBetween } from '@lib/parties/party-book'
import { freeOrphanHold, lastingHold, OrphanHoldError } from '@lib/parties/hold-actions'
import { assertPartyLockHeld, PartyBusyError, withPartyLock } from '@lib/parties/party-lock'
import { paidOnOrder } from '@lib/booking-core/charge'
import { providers } from '@config/providers'
import type { Cents, ScheduledClass } from './types'
import { waitlistItems } from './waitlist-items'
import { waitlistClassIds } from './waitlist-store'
import { decideUnclear, UnclearError } from './waitlist-runner'
import { checkReaderSale, letReaderSeatGo, ReaderError } from './reader-flow'
import {
  keepLateReader, keepReaderPayment, readerDecideItems, ReaderDecideError, refundExtraReader, refundLateReader, refundMismatchedReader, sortedExtraReader,
} from './reader-decide'
import { siteConfig } from '@config/site.config'
import { askSquareAboutCancel, cancelItems, CancelError, releaseSelfCancel, retrySelfCancel } from './self-cancel'
import { cancelSplit } from './self-cancel-rules'
import { refundClassBooking } from './refunds'
import { listPaidOnCancelled } from './paid-on-cancelled'

/** Every kind of To decide item (a runtime list, so /admin › More › Help can be checked against it). */
export const TO_DECIDE_KINDS = [
  'pos-unmatched', 'refund-plain', 'refund-failed', 'refund-unfinished', 'refund-unconfirmed',
  'pos-needs-days', 'below-minimum', 'door-unpaid', 'counter-match-check', 'party-paid-unclear', 'paid-not-seated', 'party-not-told',
  'party-payment-unclear', 'party-no-confirmation', 'party-hold-orphan',
  'waitlist-unknown', 'waitlist-declined', 'waitlist-refund', 'reader-waiting', 'reader-extra', 'reader-late',
  'cancel-request', 'cancel-unclear', 'paid-on-cancelled',
] as const
export type ToDecideKind = (typeof TO_DECIDE_KINDS)[number]

/** One thing waiting for an owner (or decided lately). */
export interface ToDecideItem {
  id: string
  kind: ToDecideKind
  /** "Counter sale to match", "Refund done in Square", "Short of its minimum" */
  title: string
  /** One line of what happened. */
  head: string
  /** What to do next ("Match it to a class"). */
  hint: string
  /** When it happened (ISO), for ordering. */
  at: string
  classId?: string
  className?: string
  /** What the sheet needs to show it (per kind). */
  detail: Record<string, unknown>
  /** Once decided: what was done, by whom, when. */
  done?: string
  doneBy?: string
  doneAt?: string
}

export interface Decided {
  id: string; kind: ToDecideKind; title: string; head: string; classId?: string; className?: string; what: string; by: By; at: string
  /** A freed seat can be taken back for a while (the toast's Undo). */
  undo?: { classId: string; entries: { lineId: string; entryId: string }[]; flagId?: string }
}

export class DecideError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message) }
}

/** R41: a test site with no store of its own decides nothing (every decision writes the live records). */
function noTestSite(): void {
  try {
    assertClassWritesAllowed()
  } catch (e) {
    if (e instanceof TestSiteStoreError) throw new DecideError(503, e.message)
    throw e
  }
}

/** How long a decided item still shows as "Done". */
export const DONE_SHOWN_DAYS = 14
/** Below-minimum shows from this long before its decide-by. */
export const MINIMUM_AHEAD_MS = 3 * 86_400_000

const money = (c: Cents) => `$${(c / 100).toFixed(2).replace(/\.00$/, '')}`
const dayText = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')
const whenText = (iso: string) => {
  const day = dayText(studioDate(iso))
  const time = new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).replace(':00', '')
  return `${day} ${time === '12 AM' ? 'midnight' : time === '12 PM' ? 'noon' : time}`
}
const seatsText = (n: number) => (n === 1 ? '1 seat' : `${n} seats`)
const safeKey = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_')
const personName = (c: LedgerLine['customer']) => (c ? `${c.givenName} ${c.familyName}`.trim() : '')

export { tokenOf }

// ---------------------------------------------------------------- decided store

/** Every decision on file (each item once), and their ids: a decided item never shows as waiting again. */
async function listDecided(): Promise<{ all: Decided[]; ids: Set<string> }> {
  const keys = (await decidedKv.list()).filter((k) => k.startsWith('done-'))
  // An undone decision is an empty record: the item waits again.
  const all = (await Promise.all(keys.map((k) => decidedKv.get(k)))).filter((j): j is string => !!j).map((j) => JSON.parse(j) as Decided)
  return { all, ids: new Set(all.map((d) => d.id)) }
}

// ---------------------------------------------------------------- reading

type ClassCache = Map<string, ScheduledClass | null>
async function classOf(cache: ClassCache, id: string): Promise<ScheduledClass | null> {
  if (!cache.has(id)) cache.set(id, await getClass(id).catch(() => null))
  return cache.get(id) ?? null
}

/**
 * Where to start the owner's match: the class and seat the sold item's variation
 * is (a class whose POS item has it), else the one class whose name is in the
 * item's name, with the way to book whose label is in the variation's name
 * ("One day"). No guess at the seat when nothing says which.
 */
export function guessMatch(u: { name: string; variationId?: string; variationName?: string }, classes: ScheduledClass[]): { classId: string | null; key: string | null } {
  const live = classes.filter((c) => c.status !== 'cancelled')
  if (u.variationId) {
    for (const c of live) {
      const hit = Object.entries(c.square?.variations ?? {}).find(([k, v]) => v === u.variationId && !k.startsWith('addon:'))
      if (hit) return { classId: c.id, key: hit[0] }
    }
  }
  const n = u.name.toLowerCase()
  const hits = live.filter((c) => n.includes(c.content.name.toLowerCase()))
  if (hits.length !== 1) return { classId: null, key: null }
  const cls = hits[0]
  const words = (u.variationName ?? u.name).toLowerCase()
  const passes = cls.content.passes.filter((p) => words.includes(p.label.toLowerCase()))
  const pass = passes.length === 1 ? passes[0] : cls.content.passes.length === 1 ? cls.content.passes[0] : null
  const ticket = cls.content.ticketTypes.length === 1 ? cls.content.ticketTypes[0] : cls.content.ticketTypes.find((t) => words.includes(t.label.toLowerCase())) ?? null
  return { classId: cls.id, key: pass && ticket ? `${pass.id}:${ticket.id}` : null }
}

async function unmatchedItems(skip: Set<string>, now: Date): Promise<ToDecideItem[]> {
  const list = await listUnmatchedPos()
  if (!list.length) return []
  const classes = await listClasses({ fromIso: new Date(now.getTime() - 60 * 86_400_000).toISOString(), toIso: new Date(now.getTime() + 400 * 86_400_000).toISOString() })
  return list
    .map((u): ToDecideItem => {
      const guess = guessMatch(u, classes)
      return {
        id: tokenOf(`pos-${safeKey(u.orderId)}-${safeKey(u.lineUid)}`),
        kind: 'pos-unmatched',
        title: 'Counter sale to match',
        head: `${u.qty} × ${u.name} rung up at the counter, ${whenText(u.at)}`,
        hint: 'Match it to a class',
        at: u.at,
        detail: { orderId: u.orderId, lineUid: u.lineUid, name: u.name, qty: u.qty, at: u.at, guessClassId: guess.classId, guessKey: guess.key },
      }
    })
    .filter((i) => !skip.has(i.id))
}

const REFUND_KIND: Record<RefundFlag['kind'], ToDecideKind> = {
  'plain-refund': 'refund-plain', 'refund-failed': 'refund-failed', 'refund-unfinished': 'refund-unfinished', 'refund-unconfirmed': 'refund-unconfirmed',
}

/** A refund flag on a party (scope 'party'): reads "the Justice party" and opens #party-<day>-<id>. */
async function partyRefundItem(f: RefundFlag, id: string): Promise<ToDecideItem | null> {
  const rec = await getPartyRecord(f.bookingId).catch((e) => {
    console.error(`[to-decide] party ${f.bookingId}: ${e instanceof Error ? e.message : String(e)}`)
    return null
  })
  const label = rec ? partyLabel(rec) : 'a party'
  const amount = money(f.refundCents ?? f.cents)
  const base = {
    id, kind: REFUND_KIND[f.kind], at: f.at, className: label,
    detail: {
      flagId: f.id, bookingId: f.bookingId, partyId: f.bookingId, partyDay: rec ? studioDate(rec.startIso) : null,
      name: rec?.hostName || 'The host', cents: f.cents, refundCents: f.refundCents ?? f.cents, requestId: f.requestId ?? null,
      seats: [], firstStartIso: rec?.startIso ?? null,
    },
  }
  switch (f.kind) {
    case 'refund-failed':
      return { ...base, title: 'Refund didn’t go through', head: `Square couldn’t finish a ${amount} refund on ${label}.`, hint: 'Ask Square, then try it again or mark it handled' }
    case 'refund-unfinished':
      return { ...base, title: 'Refund half finished', head: `A ${amount} refund on ${label} was checked in Square but never finished here.`, hint: 'Finish it' }
    case 'refund-unconfirmed':
      return { ...base, title: 'Refund with no answer', head: `A ${amount} refund on ${label} got no answer from Square for a day.`, hint: 'Ask Square what happened' }
    default:
      // Refunds made in Square on a party are recorded as money, with no seat to decide (S2-R24): never flagged.
      return null
  }
}

async function refundItems(cache: ClassCache, skip: Set<string>): Promise<ToDecideItem[]> {
  const out: ToDecideItem[] = []
  for (const f of await listRefundFlags()) {
    const id = tokenOf(f.id)
    if (skip.has(id)) continue
    // A refund of a payment on no booking: its own "Party payment to check" / "Paid, no seat" item covers it (never "A class").
    if (LOOSE_PAYMENT_SCOPES.has(f.classId)) continue
    if (f.classId === PARTY_SCOPE) {
      const item = await partyRefundItem(f, id)
      if (item) out.push(item)
      continue
    }
    const cls = await classOf(cache, f.classId)
    const className = cls?.content.name ?? 'A class'
    const lines = (await getLedger(f.classId)).lines.filter((l) => l.bookingId === f.bookingId)
    const name = personName(lines.find((l) => l.customer)?.customer ?? null) || 'Someone'
    const held = lines.filter(isComing)
    const ticket = (tid: string) => cls?.content.ticketTypes.find((t) => t.id === tid)?.label ?? 'Seat'
    const first = cls ? [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))[0] : undefined
    const amount = money(f.refundCents ?? f.cents)
    const kind = REFUND_KIND[f.kind]
    const base = {
      id, kind, at: f.at, classId: f.classId, className,
      detail: {
        flagId: f.id, bookingId: f.bookingId, name, cents: f.cents, refundCents: f.refundCents ?? f.cents, requestId: f.requestId ?? null,
        seats: held.map((l) => ({ lineId: l.id, seat: l.seat, label: ticket(l.ticketTypeId) })), firstStartIso: first?.startIso ?? null,
      },
    }
    switch (f.kind) {
      case 'plain-refund':
        out.push({ ...base, title: 'Refund done in Square', head: `${amount} refunded in Square on ${name}’s booking (${className}). Free a seat?`, hint: 'Free a seat or keep it' })
        break
      case 'refund-failed':
        out.push({ ...base, title: 'Refund didn’t go through', head: `Square couldn’t finish a ${amount} refund for ${name} (${className}).`, hint: 'Ask Square, then try it again or mark it handled' })
        break
      case 'refund-unfinished':
        out.push({ ...base, title: 'Refund half finished', head: `A ${amount} refund for ${name} (${className}) was checked in Square but never finished here.`, hint: 'Finish it' })
        break
      case 'refund-unconfirmed':
        out.push({ ...base, title: 'Refund with no answer', head: `A ${amount} refund for ${name} (${className}) got no answer from Square for a day.`, hint: 'Ask Square what happened' })
        break
    }
  }
  return out
}

async function needsDaysItems(cache: ClassCache, skip: Set<string>): Promise<ToDecideItem[]> {
  const out: ToDecideItem[] = []
  for (const d of await listPosNeedsDays()) {
    const id = tokenOf(d.id)
    if (skip.has(id)) continue
    const cls = await classOf(cache, d.classId)
    if (!cls) continue
    const pass = cls.content.passes.find((p) => p.id === d.passId)
    const count = pass?.covers.kind === 'choose' ? pass.covers.count : null
    out.push({
      id, kind: 'pos-needs-days', title: 'Counter seat needs its day', at: d.at, classId: cls.id, className: cls.content.name,
      head: `${seatsText(d.lineIds.length)} of ${cls.content.name} rung up ${whenText(d.at)}: which ${count && count > 1 ? `${count} days` : 'day'}?`,
      hint: count && count > 1 ? `Pick ${count} days` : 'Pick the day',
      detail: {
        needsId: d.id, lineIds: d.lineIds, count, passLabel: pass?.label ?? '', current: d.sessionIds,
        sessions: [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso)).map((s) => ({ id: s.id, startIso: s.startIso, endIso: s.endIso })),
      },
    })
  }
  return out
}

async function minimumItems(skip: Set<string>, now: Date): Promise<ToDecideItem[]> {
  const classes = (await listClasses({ fromIso: now.toISOString(), toIso: new Date(now.getTime() + 400 * 86_400_000).toISOString() }))
    .filter((c) => c.content.rules.minimumToRun && onStaffConsole(c))
  const out: ToDecideItem[] = []
  for (const cls of classes) {
    const min = cls.content.rules.minimumToRun!
    const first = [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))[0]
    if (!first || Date.parse(first.startIso) <= now.getTime()) continue
    if (now.getTime() < Date.parse(min.decideByIso) - MINIMUM_AHEAD_MS) continue
    const booked = seatsTaken(await getLedger(cls.id), first.id, now)
    if (booked >= min.count) continue
    const id = minimumItemId(cls.id)
    if (skip.has(id)) continue
    out.push({
      id, kind: 'below-minimum', title: 'Short of its minimum', at: min.decideByIso, classId: cls.id, className: cls.content.name,
      head: `${cls.content.name}: ${booked} of ${min.count} needed by ${whenText(min.decideByIso)}`,
      hint: 'Keep it running, or text the people booked',
      detail: { booked, count: min.count, decideByIso: min.decideByIso, firstStartIso: first.startIso },
    })
  }
  return out
}

async function doorItems(skip: Set<string>, now: Date): Promise<ToDecideItem[]> {
  const [unpaid, checks] = await Promise.all([listDoorUnpaid(now), listCounterMatchChecks(now)])
  return unpaid
    .map((u): ToDecideItem => {
      // The same story told twice: a counter sale that day went to someone else, and it may have been this person.
      const check = checks.find((m) => m.classId === u.classId && m.day === u.day && m.bookingId !== u.bookingId)
      return {
        id: tokenOf(u.id), kind: 'door-unpaid', title: 'Not paid at the counter', at: u.sessionStartIso, classId: u.classId, className: u.className,
        head: `${u.name || 'A door seat'} · ${seatsText(u.seats)} · ${u.className} · ${dayText(u.day)}: never rung up`,
        hint: 'Mark it paid, or free the seat',
        detail: {
          bookingId: u.bookingId, lineIds: u.lineIds, name: u.name, day: u.day, seats: u.seats,
          ...(check ? { related: `A counter sale that day was matched to ${check.name}. It may have been ${u.name || 'this person'}: see “Check a counter sale”.` } : {}),
        },
      }
    })
    .filter((i) => !skip.has(i.id))
}

async function matchItems(skip: Set<string>, now: Date): Promise<ToDecideItem[]> {
  const out: ToDecideItem[] = []
  for (const m of await listCounterMatchChecks(now)) {
    const id = tokenOf(m.id)
    if (skip.has(id)) continue
    const ledger = await getLedger(m.classId)
    const line = ledger.lines.find((l) => l.id === m.lineId)
    // The other unpaid door seats that day, same way to book and ticket: who else it could have been.
    const others = line ? ledger.lines.filter((l) => unpaidDoorSeat(l) && l.id !== line.id && l.bookingId !== line.bookingId
      && l.passId === line.passId && l.ticketTypeId === line.ticketTypeId && studioDate(l.at) === m.day) : []
    out.push({
      id, kind: 'counter-match-check', title: 'Check a counter sale', at: m.at, classId: m.classId, className: m.className,
      head: `A counter sale of ${m.className} on ${dayText(m.day)} was matched to ${m.name}. Was it them?`,
      hint: 'Say who it was',
      detail: {
        lineId: m.lineId, name: m.name, day: m.day,
        others: others.map((l) => ({ lineId: l.id, name: personName(l.customer) || 'A door seat', seat: l.seat })),
      },
    })
  }
  return out
}

/** A party charge left mid-way this long is an owner's to sort out. */
export const PARTY_CHARGING_STALE_MS = 15 * 60_000

async function partyItems(skip: Set<string>, now: Date): Promise<ToDecideItem[]> {
  const out: ToDecideItem[] = []
  for (const c of await listCheckouts()) {
    const stale = c.state === 'charging' && now.getTime() - Date.parse(c.updatedAt) >= PARTY_CHARGING_STALE_MS
    if (c.state !== 'unclear' && c.state !== 'paid-elsewhere' && !stale) continue
    const elsewhere = c.state === 'paid-elsewhere'
    const who = `${c.host.firstName} ${c.host.lastName}`.trim() || 'Someone'
    const when = c.startIso ? whenText(c.startIso) : 'a party'
    // Sorted out since (a retry, Square's payment event or an owner recorded it paid): not waiting any more.
    if (!elsewhere) {
      // A failed read shows the item (Confirm is safe on a recorded party) rather than hiding the rest.
      const rec = await getPartyRecord(c.partyId).catch((e) => {
        console.error(`[to-decide] party ${c.partyId}: ${e instanceof Error ? e.message : String(e)}`)
        return null
      })
      if (rec && (rec.charges?.length ?? 0) > 0) {
        // Recorded paid, but the booking stopped before the host's confirmation went out (Task 7 M1).
        if (rec.confirmation?.sent || rec.status === 'cancelled') continue
        const id = tokenOf(`pnc-${c.partyId}`)
        if (skip.has(id)) continue
        out.push({
          id, kind: 'party-no-confirmation', title: 'Party booked, no confirmation', at: c.updatedAt,
          head: `${rec.hostName || who}’s party on ${whenText(rec.startIso)} is paid and booked, but the booking stopped before their confirmation email went out.`,
          hint: `Open the party and tap Email ${firstWord(rec.hostName || who)} the details`,
          detail: { partyId: c.partyId, partyDay: studioDate(rec.startIso), email: rec.hostEmail, phone: rec.hostPhone ?? '' },
        })
        continue
      }
    }
    const id = elsewhere ? paidElsewhereItemId(c.orderId ?? '') : tokenOf(`ppu-${c.partyId}`)
    if (skip.has(id)) continue
    const cents = c.squareCents ?? c.quotedCents
    if (!elsewhere) {
      out.push({
        id, kind: 'party-paid-unclear', title: 'Party payment unclear', at: c.updatedAt,
        head: `${who}’s ${money(cents)} party payment for ${when} got no answer from Square. The time is held, not confirmed.`,
        hint: 'Confirm the party (it asks Square first), or say it wasn’t paid',
        detail: { partyId: c.partyId, orderId: c.orderId, cents, elsewhere, why: c.why ?? null, startIso: c.startIso, email: c.host.email, phone: c.host.phone },
      })
      continue
    }
    // Paid elsewhere: what is in flight or already back in Square decides what can still be done.
    const started = unfinishedRefund(await listRefundRequests(PAID_ELSEWHERE_SCOPE, c.orderId ?? ''))
    const back = Math.min(cents, c.squareRefunded?.cents ?? 0)
    const left = cents - back
    // On a party of ours that still owes at least this much, nothing back and nothing started: it can go toward that party (DV12).
    const party = c.why === 'other-payment' ? await getPartyRecord(c.partyId).catch(() => null) : null
    const canApply = !started && back === 0 && c.why === 'other-payment' && canTakePayment(party, cents)
    const name = `${c.host.firstName} ${c.host.lastName}`.trim() || party?.hostName || ''
    const paid = `Square shows ${money(cents)} paid for a party (${who}, ${when})`
    const head = started
      ? `A refund of ${money(started.totalCents)} was started (${who}, ${when}), but Square didn’t confirm it. Tap Refund it to finish it (it never refunds twice).`
      : left <= 0
        ? `${paid}, and Square already refunded it. Nothing more is owed back. Tap It’s already sorted to clear this.`
        : back > 0
          ? `${paid}. ${money(back)} of it was already refunded in Square, so ${money(left)} is left.`
          : c.refundFailed
            ? `${paid}, but ${paidElsewhereWhy(c.why)}. A ${money(c.refundFailed.cents)} refund of it didn’t go through in Square, so nothing was refunded.`
            : canApply
              ? `${paid} from another order, so it isn’t on the party yet. Nothing was refunded.`
              : `${paid}, but ${paidElsewhereWhy(c.why)}. Nothing was refunded.`
    out.push({
      id, kind: 'party-paid-unclear', title: 'Party payment to check', at: c.updatedAt,
      head,
      hint: started ? 'Refund it to finish the refund'
        : left <= 0 ? 'It’s already sorted'
          : back > 0 ? 'Refund the rest, or say it’s already sorted'
            : canApply ? 'Refund it, or put it toward the party' : 'Refund it',
      detail: {
        partyId: c.partyId, orderId: c.orderId, cents, elsewhere, why: c.why ?? null, startIso: c.startIso, email: c.host.email, phone: c.host.phone,
        paymentId: c.paymentId ?? null, canApply, name,
        refundStarted: !!started, startedCents: started?.totalCents ?? null, backCents: back, leftCents: left,
        canRefund: !!started || left > 0, canSort: !started,
        ...(party ? { partyDay: studioDate(party.startIso), dueCents: dueCents(party) } : {}),
      },
    })
  }
  return out
}

/**
 * Parties whose host hasn't been told about an owner's change (DV8): moved,
 * cancelled, details or length changed, and no "Email the details" or "I told
 * them" since. Only parties still to come. One item per change (a later
 * change makes a new one); it goes by itself once the host is told.
 */
/** "I told them" on a party that is no longer here. */
export const PARTY_GONE = 'That party isn’t on the books any more, so there’s nothing to tell the host. Reload to clear this.'

async function partyNotToldItems(skip: Set<string>, now: Date, parties: () => Promise<PartyRecord[]>): Promise<ToDecideItem[]> {
  const out: ToDecideItem[] = []
  for (const r of await parties()) {
    const n = r.notTold
    if (!n || !isOurs(r) || Date.parse(r.startIso) <= now.getTime()) continue
    const id = tokenOf(`pnt-${r.bookingId}-${Date.parse(n.at)}`)
    if (skip.has(id)) continue
    const first = r.hostName.split(' ')[0] || 'The host'
    const what = n.what.includes('cancelled') ? `the party on ${whenText(r.startIso)} is cancelled`
      : [n.what.includes('time') ? `the new time (${whenText(r.startIso)})` : null, n.what.includes('details') ? 'the changed details' : null].filter(Boolean).join(' and ')
    out.push({
      id, kind: 'party-not-told', title: 'Host not told yet', at: n.at, className: partyLabel(r),
      head: `${first} hasn’t been told ${n.what.includes('cancelled') ? '' : 'about '}${what}. Nothing is sent to them on its own.`,
      hint: 'Email them the details from the party, or say you told them',
      detail: { partyId: r.bookingId, partyDay: studioDate(r.startIso), notToldAt: n.at, cancelled: n.what.includes('cancelled'), host: r.hostName, phone: r.hostPhone ?? '' },
    })
  }
  return out
}

const firstWord = (name: string) => name.trim().split(/\s+/)[0] || 'them'

/**
 * A payment on a party already booked (its payment link, or a card an owner
 * took in /admin) that Square never answered: the party's `paying` is
 * 'unclear' and still inside its 24 hours. After that the next payment asks
 * Square first, so it leaves the list.
 */
async function partyPaymentItems(skip: Set<string>, now: Date, parties: () => Promise<PartyRecord[]>): Promise<ToDecideItem[]> {
  const out: ToDecideItem[] = []
  for (const r of await parties()) {
    const p = r.paying
    if (!isOurs(r) || !p || p.state !== 'unclear' || Date.parse(p.until) <= now.getTime()) continue
    const id = tokenOf(`ppx-${r.bookingId}-${p.attemptId}`)
    if (skip.has(id)) continue
    const via = p.via === 'admin-card' ? `card taken in /admin${p.by?.name ? ` by ${p.by.name}` : ''}` : 'payment link'
    const cents = p.quotedCents ?? 0
    out.push({
      id, kind: 'party-payment-unclear', title: 'Party payment unclear', at: p.at ?? p.until,
      head: `${r.hostName}’s ${money(cents)} payment (${via}) for their party on ${whenText(r.startIso)} got no answer from Square.`,
      hint: 'Say whether it went through (it asks Square first)',
      detail: { partyId: r.bookingId, partyDay: studioDate(r.startIso), attemptId: p.attemptId, orderId: p.orderId ?? null, cents, via: p.via ?? 'link', until: p.until },
    })
  }
  return out
}

/** How far ahead held party times with no party are looked for (past the warnings' 60 days and the usual 90-day booking window). */
export const ORPHAN_LOOK_AHEAD_DAYS = 120

/**
 * A party time held (booked, or for a payment link) that no party record is
 * on: nothing to open, so it waits here with "Free this time". A short hold
 * (someone paying right now) and a hold with a checkout of any kind attached
 * (To decide has that payment as its own item) are left out.
 */
async function partyHoldItems(skip: Set<string>, now: Date, parties: () => Promise<PartyRecord[]>): Promise<ToDecideItem[]> {
  const [holds, records, checkouts] = await Promise.all([
    holdsBetween(now.toISOString(), new Date(now.getTime() + ORPHAN_LOOK_AHEAD_DAYS * 86_400_000).toISOString(), now),
    parties(),
    listCheckouts(),
  ])
  const known = new Set(records.map((r) => r.bookingId))
  const paying = new Set(checkouts.filter((c) => c.state !== 'retired' && c.state !== 'settled').map((c) => c.partyId))
  const out: ToDecideItem[] = []
  for (const h of holds) {
    if (!lastingHold(h) || known.has(h.partyId) || paying.has(h.partyId) || Date.parse(h.endIso) <= now.getTime()) continue
    const id = tokenOf(`pho-${h.partyId}-${Date.parse(h.startIso)}`)
    if (skip.has(id)) continue
    out.push({
      id, kind: 'party-hold-orphan', title: 'Party time held, no party', at: h.at,
      head: `${whenText(h.startIso)} is held for a party that isn’t on the books, so nobody can book that time.`,
      hint: 'Free this time, so others can book it',
      detail: { partyId: h.partyId, startIso: h.startIso, endIso: h.endIso, heldAt: h.at },
    })
  }
  return out
}

/** The money said plainly, for a paid booking with no seat. */
const dollars = (c: Cents) => `$${(c / 100).toFixed(2)}`

async function paidNotSeatedItems(cache: ClassCache, skip: Set<string>): Promise<ToDecideItem[]> {
  const out: ToDecideItem[] = []
  const customers = new Map<string, Awaited<ReturnType<typeof pnsCustomer>>>()
  // Sorted out since (the customer's retry recorded the seats, or an owner gave them) are left out.
  for (const p of await openPaidNotSeated()) {
    const id = tokenOf(p.id)
    if (skip.has(id)) continue
    const cls = await classOf(cache, p.classId)
    const className = cls?.content.name ?? 'A class'
    const seats = p.lines.reduce((n, l) => n + l.qty, 0)
    const first = cls ? [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))[0] : undefined
    // Who paid (read once from Square, for the refund confirm and email). Unreadable: no name, still refundable.
    const key = p.customerId ?? ''
    if (key && !customers.has(key)) customers.set(key, await pnsCustomer(key))
    const customer = key ? customers.get(key) ?? null : null
    const name = customer ? `${customer.givenName} ${customer.familyName}`.trim() : ''
    const started = unfinishedRefund(await listRefundRequests(PAID_NOT_SEATED_SCOPE, p.id))
    const back = Math.min(p.chargedCents, p.squareRefunded?.cents ?? 0)
    const left = p.chargedCents - back
    const paid = p.why === 'no-seats'
      ? `Square shows ${dollars(p.chargedCents)} paid for ${seatsText(seats)} of ${className}, but the seats were let go before the booking finished`
      : `Square shows a second payment of ${dollars(p.chargedCents)} for a ${className} booking that was already paid`
    const head = started
      ? `A refund of ${dollars(started.totalCents)} for ${name || 'this payment'} (${className}) was started, but Square didn’t confirm it. Tap Refund it to finish it (it never refunds twice).`
      : left <= 0 ? `${paid}, and Square already refunded it. Tap It’s already sorted to clear this.`
        : back > 0 ? `${paid}. ${dollars(back)} of it was already refunded in Square, so ${dollars(left)} is left.`
          : p.refundFailed ? `${paid}. A ${dollars(p.refundFailed.cents)} refund of it didn’t go through in Square, so nothing was refunded.`
            : `${paid}. Nothing was refunded.`
    const canSeat = p.why === 'no-seats' && !!cls && cls.status !== 'cancelled' && !started && back === 0
    const canRefund = !!p.paymentId && (!!started || left > 0)
    out.push({
      id, kind: 'paid-not-seated', title: 'Paid, no seat', at: p.at, classId: p.classId, className,
      head,
      hint: started ? 'Refund it to finish the refund'
        : left <= 0 ? 'It’s already sorted'
          : canSeat ? 'Give them their seat, or refund it' : 'Refund it',
      detail: {
        paidId: p.id, orderId: p.orderId, bookingId: p.bookingId, why: p.why, cents: p.chargedCents, seats,
        canSeat, canRefund, canSort: !started, refundStarted: !!started, startedCents: started?.totalCents ?? null, backCents: back, leftCents: left,
        name, email: customer?.email ?? '', firstStartIso: first?.startIso ?? null,
      },
    })
  }
  return out
}

/** Stage 4: the waitlist's unclear charges and declined cards, across every class with a waitlist. */
async function waitlistDecideItems(cache: ClassCache, skip: Set<string>, now: Date): Promise<ToDecideItem[]> {
  const out: ToDecideItem[] = []
  for (const classId of await waitlistClassIds()) {
    const cls = await classOf(cache, classId)
    if (!cls) continue
    for (const w of await waitlistItems(cls, skip, now)) {
      const e = w.entry
      out.push({
        id: w.id, kind: w.kind, at: w.at, classId: cls.id, className: cls.content.name,
        title: w.kind === 'waitlist-refund' ? 'Waitlist charge on a cancelled class' : w.kind === 'waitlist-unknown' ? 'Waitlist charge unclear' : e.state === 'skipped' ? (e.attempts[e.attempts.length - 1]?.skipWhy === 'gone' ? 'Waitlist choice not sold any more' : 'Waitlist price went up') : 'Waitlist card didn’t go through',
        head: w.head,
        hint: w.kind === 'waitlist-refund' ? 'Refund them' : w.kind === 'waitlist-unknown' ? 'Ask Square what happened, then decide here' : 'Call them if you like',
        detail: {
          entryId: e.id, name: `${e.customer.givenName} ${e.customer.familyName}`.trim(), phone: e.customer.phone, email: e.customer.email,
          cents: e.attempts[e.attempts.length - 1]?.amountCents ?? null, last4: e.square.last4, state: e.state, bookingId: e.bookingId ?? null,
        },
      })
    }
  }
  return out
}

/** Stage 4: reader sales the Square app never answered, payments that didn't match, second and late payments. */
async function readerItems(skip: Set<string>, now: Date): Promise<ToDecideItem[]> {
  return (await readerDecideItems(skip, now)).map((r) => ({
    id: r.id, kind: r.kind, title: r.title, head: r.head, hint: r.hint, at: r.at, classId: r.classId, className: r.className, detail: r.detail,
  }))
}

/** I-5: a booking paid just as its class was cancelled (the cancel's booked list was read before it landed). */
async function paidOnCancelledItems(skip: Set<string>): Promise<ToDecideItem[]> {
  return (await listPaidOnCancelled()).filter((p) => !skip.has(p.id)).map((p) => ({
    id: p.id, kind: 'paid-on-cancelled' as const, at: p.at, classId: p.classId, className: p.className,
    title: 'Paid just as the class was cancelled',
    head: `${`${p.customer.givenName} ${p.customer.familyName}`.trim()} paid ${money(p.chargedCents)} for ${p.className} just as you cancelled it. They’re on its booked list. Nothing was refunded.`,
    hint: 'Refund them',
    detail: {
      bookingId: p.bookingId, orderId: p.orderId, name: `${p.customer.givenName} ${p.customer.familyName}`.trim(),
      email: p.customer.email, phone: p.customer.phone, cents: p.chargedCents, last4: p.last4,
    },
  }))
}

/** D2: customers' notes asking to cancel, and their own cancels Square didn't answer (or turned down). */
async function cancelDecideItems(cache: ClassCache, skip: Set<string>, now: Date): Promise<ToDecideItem[]> {
  return (await cancelItems(skip, now, (id) => classOf(cache, id))).map((c) => ({
    id: c.id, kind: c.kind, title: c.title, head: c.head, hint: c.hint, at: c.at, classId: c.classId, className: c.className, detail: c.detail,
  }))
}

/**
 * Everything waiting, newest first, then what was decided in the last two
 * weeks. Each source is read on its own: one that fails is named in
 * `failed` and the rest still show.
 */
export async function listToDecide(now = new Date()): Promise<{ items: ToDecideItem[]; failed: string[] }> {
  const cache: ClassCache = new Map()
  const { all: decided, ids: skip } = await listDecided()
  // Every party record, read once for this build and shared by the party item builders.
  let partiesOnce: Promise<PartyRecord[]> | null = null
  const parties = () => (partiesOnce ??= listParties())
  const failed: string[] = []
  const safe = async (what: string, fn: () => Promise<ToDecideItem[]>) => fn().catch((e) => {
    failed.push(what)
    console.error(`[to-decide] ${what}: ${e instanceof Error ? e.message : String(e)}`)
    return [] as ToDecideItem[]
  })
  const groups = await Promise.all([
    safe('counter sales', () => unmatchedItems(skip, now)),
    safe('refunds', () => refundItems(cache, skip)),
    safe('counter days', () => needsDaysItems(cache, skip)),
    safe('minimums', () => minimumItems(skip, now)),
    safe('door seats', () => doorItems(skip, now)),
    safe('counter checks', () => matchItems(skip, now)),
    safe('party payments', () => partyItems(skip, now)),
    safe('party payments in flight', () => partyPaymentItems(skip, now, parties)),
    safe('held party times', () => partyHoldItems(skip, now, parties)),
    safe('paid bookings', () => paidNotSeatedItems(cache, skip)),
    safe('hosts to tell', () => partyNotToldItems(skip, now, parties)),
    safe('waitlist', () => waitlistDecideItems(cache, skip, now)),
    safe('reader sales', () => readerItems(skip, now)),
    safe('cancels', () => cancelDecideItems(cache, skip, now)),
    safe('paid on cancelled classes', () => paidOnCancelledItems(skip)),
  ])
  const open = groups.flat().sort((a, b) => b.at.localeCompare(a.at))
  // Notes on waiting items (R40: "Texted the people booked"), shown on the item.
  const noteKeys = (await decidedKv.list().catch(() => [] as string[])).filter((k) => k.startsWith('note-'))
  if (noteKeys.length) {
    const notes = new Map((await Promise.all(noteKeys.map((k) => decidedKv.get(k).catch(() => null))))
      .filter((j): j is string => !!j).map((j) => JSON.parse(j) as Decided).map((n) => [n.id, n]))
    for (const i of open) {
      const n = notes.get(i.id)
      if (n) i.detail = { ...i.detail, note: { what: n.what, by: n.by.name, at: n.at } }
    }
  }
  const done = decided
    .filter((d) => Date.parse(d.at) >= now.getTime() - DONE_SHOWN_DAYS * 86_400_000)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((d): ToDecideItem => ({
      id: d.id, kind: d.kind, title: d.title, head: d.head, hint: '', at: d.at, classId: d.classId, className: d.className,
      detail: {}, done: d.what, doneBy: d.by.name, doneAt: d.at,
    }))
  return { items: [...open, ...done], failed }
}

// ---------------------------------------------------------------- deciding

const ACTIONS: Record<ToDecideKind, string[]> = {
  'pos-unmatched': ['match', 'dismiss'],
  'refund-plain': ['keep', 'free'],
  'refund-failed': ['handled', 'retry'],
  'refund-unfinished': ['finish'],
  'refund-unconfirmed': ['went-through', 'did-not-go-through', 'retry'],
  'pos-needs-days': ['set-days'],
  'below-minimum': ['keep-running', 'texted'],
  'door-unpaid': ['paid', 'free'],
  'counter-match-check': ['confirm', 'move'],
  'party-paid-unclear': ['confirm', 'not-paid', 'sorted', 'refund', 'apply'],
  'paid-not-seated': ['seat', 'sorted', 'refund'],
  'party-not-told': ['told'],
  'party-payment-unclear': ['went-through', 'did-not-go-through'],
  'party-no-confirmation': ['sorted'],
  'party-hold-orphan': ['free'],
  'waitlist-unknown': ['add', 'keep', 'off'],
  'waitlist-declined': ['seen'],
  'waitlist-refund': ['refund', 'sorted'],
  'reader-waiting': ['check', 'let-go', 'keep', 'refund'],
  'reader-extra': ['refund', 'sorted'],
  'reader-late': ['keep', 'refund'],
  'cancel-request': ['refund', 'free', 'keep'],
  'cancel-unclear': ['ask', 'seen', 'retry', 'release'],
  'paid-on-cancelled': ['refund', 'sorted'],
}

async function record(item: ToDecideItem, what: string, by: By, action: string, undo?: Decided['undo']): Promise<Decided> {
  const d: Decided = { id: item.id, kind: item.kind, title: item.title, head: item.head, classId: item.classId, className: item.className, what, by, at: new Date().toISOString(), ...(undo ? { undo } : {}) }
  await decidedKv.set(`done-${item.id}`, JSON.stringify(d))
  await recordAudit({
    by: { ...by, role: 'owner' }, action: `to-decide-${action}`,
    target: item.kind === 'party-paid-unclear' || item.kind === 'party-payment-unclear' || item.kind === 'party-no-confirmation' || item.kind === 'party-hold-orphan' || item.kind === 'party-not-told' || typeof item.detail.partyId === 'string'
      ? { kind: 'party', id: String(item.detail.partyId ?? item.id), label: item.className ?? item.title }
      : { kind: item.classId ? 'class' : 'counter-sale', id: item.classId ?? String(item.detail.orderId ?? item.id), label: item.className ?? item.title },
    details: { item: item.id, kind: item.kind, what },
  })
  return d
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const asRefund = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof RefundError) throw new DecideError(e.status, e.message, e.extra?.reload ? { reload: true } : {})
    if (e instanceof PaidElsewhereError) throw new DecideError(e.status, e.message, e.extra)
    throw e
  }
}

/** "Refunded $300 to Alice (emailed)" / "(no email on file)" / "(the email didn't go out)": what a refund did, plainly. */
function refundedWhat(cents: Cents, who: string, email: string, emailed: boolean): string {
  const to = who ? ` to ${who}` : ''
  return `Refunded ${money(cents)}${to}${emailed ? ' (emailed)' : email ? ' (the email didn’t go out)' : ' (no email on file)'}`
}

/** What the owner's confirm showed (the amount): refused server side when Square now shows a different amount left. */
const confirmedCents = (body: any): Cents | undefined => (typeof body?.cents === 'number' && Number.isFinite(body.cents) ? Math.round(body.cents) : undefined)
const reasonOf = (body: any, fallback: string) => (typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : fallback)

/** Reads the counter sale's line from Square (read only): its money, payments and when it was rung up. */
async function readSale(orderId: string, lineUid: string): Promise<{ units: { priceCents: Cents; taxCents: Cents }[]; totalCents: Cents; paymentIds: string[]; saleIso: string }> {
  let order: any
  try {
    order = (await squareFetch(`/orders/${encodeURIComponent(orderId)}`, { method: 'GET' }))?.order
  } catch {
    throw new DecideError(503, 'Couldn’t reach Square to read that sale. Try again.')
  }
  const li = (order?.line_items ?? []).find((x: any) => x?.uid === lineUid)
  if (!li) throw new DecideError(404, 'That sale isn’t in Square any more.')
  const qty = Math.max(1, Math.floor(Number(li.quantity)) || 1)
  const total = Number(li.total_money?.amount) || 0
  const tax = Number(li.total_tax_money?.amount) || 0
  const prices = splitCents(total - tax, qty), taxes = splitCents(tax, qty)
  const paymentIds = [...new Set<string>((order.tenders ?? []).map((t: any) => t?.payment_id ?? t?.id).filter((x: unknown): x is string => typeof x === 'string' && !!x))]
  return {
    units: prices.map((p, i) => ({ priceCents: p, taxCents: taxes[i] })), totalCents: total, paymentIds,
    saleIso: order.closed_at ?? order.updated_at ?? order.created_at ?? new Date().toISOString(),
  }
}

/** The customer on a Square order, read only, for naming seats. Null when there's none or Square can't be read. */
async function squareCustomer(customerId: string | null): Promise<LedgerLine['customer']> {
  if (!customerId) return null
  try {
    const c = (await squareFetch(`/customers/${encodeURIComponent(customerId)}`, { method: 'GET' }))?.customer
    if (!c) return null
    return { givenName: String(c.given_name ?? ''), familyName: String(c.family_name ?? ''), email: String(c.email_address ?? ''), phone: String(c.phone_number ?? '') }
  } catch {
    return null
  }
}

/** The money on a counter sale's line, for the sheet. Null when Square can't be read. */
export async function saleAmount(item: ToDecideItem): Promise<Cents | null> {
  if (item.kind !== 'pos-unmatched') return null
  try {
    return (await readSale(str(item.detail.orderId), str(item.detail.lineUid))).totalCents
  } catch {
    return null
  }
}

export interface DecideResult {
  decided: Decided
  /** pos-unmatched › match: the counter seats made, to name next. */
  seats?: { lineId: string; seat: number; named: boolean }[]
  classId?: string
  /** a note on the item, which stays waiting (R40: Texted) */
  noted?: true
}

/** Ids of the refund entries on these seats now. */
async function entryIds(classId: string, lineIds: string[]): Promise<Set<string>> {
  const l = (await getLedger(classId)).lines.filter((x) => lineIds.includes(x.id))
  return new Set(l.flatMap((x) => x.refunds.map((r) => r.id ?? '')).filter(Boolean))
}

/** The no-money free-seat entries written on these seats since `before`. */
async function newFreeEntries(classId: string, lineIds: string[], before: Set<string>): Promise<{ lineId: string; entryId: string }[]> {
  const l = (await getLedger(classId)).lines.filter((x) => lineIds.includes(x.id))
  return l.flatMap((x) => x.refunds
    .filter((r) => r.id && !before.has(r.id) && r.freedSeat && r.cents === 0 && !r.squareRefundId)
    .map((r) => ({ lineId: x.id, entryId: r.id! })))
}

/** Finds an open item by id; refuses one already decided or gone. */
export async function openItem(id: string, now = new Date()): Promise<ToDecideItem> {
  const { items } = await listToDecide(now)
  const item = items.find((i) => i.id === id)
  if (!item) throw new DecideError(404, 'This isn’t waiting any more.')
  if (item.done) throw new DecideError(409, `Already done: ${item.done}.`)
  return item
}

export const PNS_BUSY = 'Someone else is deciding this payment right now. Wait a moment, then look at it again. Nothing was changed.'

/** The party kinds: decided inside that party's lock. */
const PARTY_KINDS: ReadonlySet<ToDecideKind> = new Set(['party-paid-unclear', 'party-payment-unclear', 'party-no-confirmation', 'party-hold-orphan', 'party-not-told'])

export async function decide(id: string, action: string, body: any, by: By, now = new Date()): Promise<DecideResult> {
  noTestSite()
  const item = await openItem(id, now)
  if (!ACTIONS[item.kind].includes(action)) throw new DecideError(400, 'That isn’t one of the choices for this.')
  const partyId = typeof item.detail.partyId === 'string' ? item.detail.partyId : ''
  if (item.kind === 'paid-not-seated') {
    // Give them their seat and Refund it never both go through (two owners, or the iPad and the phone, M-2).
    try {
      return await withPartyLock(`pns-${safeKey(str(item.detail.paidId))}`, async () => {
        const done = await decidedKv.get(`done-${item.id}`)
        if (done) throw new DecideError(409, `Already done: ${(JSON.parse(done) as Decided).what}.`)
        return decideItem(item, action, body, by, now)
      })
    } catch (e) {
      if (e instanceof PartyBusyError) throw new DecideError(409, PNS_BUSY)
      throw e
    }
  }
  if (!PARTY_KINDS.has(item.kind) || !partyId) return decideItem(item, action, body, by, now)
  // One decision per party at a time (a double tap, two owners): the second one, inside the lock, sees the first's.
  try {
    return await withPartyLock(partyId, async () => {
      const done = await decidedKv.get(`done-${item.id}`)
      if (done) throw new DecideError(409, `Already done: ${(JSON.parse(done) as Decided).what}.`)
      return decideItem(item, action, body, by, now)
    })
  } catch (e) {
    if (e instanceof PartyBusyError) throw new DecideError(409, e.message)
    throw e
  }
}

async function decideItem(item: ToDecideItem, action: string, body: any, by: By, now: Date): Promise<DecideResult> {
  const actor = { by, role: 'owner' as const }
  const d = item.detail
  switch (item.kind) {
    case 'pos-unmatched': {
      if (action === 'dismiss') {
        await resolveUnmatchedPos(str(d.orderId), str(d.lineUid), by, 'not-a-class')
        return { decided: await record(item, 'Left as a counter sale', by, action) }
      }
      const cls = await getClass(str(body?.classId))
      if (!cls || cls.status === 'cancelled') throw new DecideError(400, 'Pick a class.')
      const pass = cls.content.passes.find((p) => p.id === str(body?.passId)) ?? (cls.content.passes.length === 1 ? cls.content.passes[0] : undefined)
      const ticket = cls.content.ticketTypes.find((t) => t.id === str(body?.ticketTypeId)) ?? (cls.content.ticketTypes.length === 1 ? cls.content.ticketTypes[0] : undefined)
      if (!pass || !ticket) throw new DecideError(400, 'Pick which seat it was.')
      const sorted = [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))
      let sessionIds: string[]
      if (pass.covers.kind === 'all') sessionIds = sorted.map((s) => s.id)
      else if (pass.covers.kind === 'fixed') sessionIds = pass.covers.sessionIds
      else {
        sessionIds = [...new Set(strs(body?.sessionIds))].filter((sid) => sorted.some((s) => s.id === sid))
        const need = pass.covers.kind === 'choose' ? pass.covers.count : null
        if (!sessionIds.length) throw new DecideError(400, 'Pick the date.')
        if (need && sessionIds.length !== need) throw new DecideError(400, need === 1 ? 'Pick 1 date.' : `Pick ${need} dates.`)
      }
      const orderId = str(d.orderId), lineUid = str(d.lineUid)
      const sale = await readSale(orderId, lineUid)
      const bookingId = `bkg_pos_${safeKey(orderId)}`
      const ledger = await getLedger(cls.id)
      const already = ledger.lines.find((l) => l.square.orderId === orderId && l.square.chargedCents !== undefined)
      const lines = await recordPos(cls, {
        bookingId, orderId, paymentId: sale.paymentIds[0] ?? null, paymentIds: sale.paymentIds,
        chargedCents: (already?.square.chargedCents ?? 0) + sale.totalCents,
        lines: [{ lineUid, passId: pass.id, ticketTypeId: ticket.id, sessionIds, units: sale.units }],
        saleIso: sale.saleIso,
      }, now)
      const day = sorted.find((s) => sessionIds.includes(s.id))
      const what = `Added ${seatsText(lines.length || sale.units.length)} to ${cls.content.name}${day ? ` · ${dayText(studioDate(day.startIso))}` : ''}`
      await resolveUnmatchedPos(orderId, lineUid, by, 'matched')
      const decided = await record(item, what, by, action)
      return { decided, classId: cls.id, seats: lines.map((l) => ({ lineId: l.id, seat: l.seat, named: !!l.customer })) }
    }
    case 'refund-plain': {
      if (action === 'keep') {
        await asRefund(() => decideRefundFlag(str(d.flagId), 'kept-seat', actor))
        return { decided: await record(item, 'Kept their seat', by, action) }
      }
      const lineIds = strs(body?.lineIds)
      const seats = (d.seats ?? []) as { lineId: string }[]
      const watch = lineIds.length ? lineIds : seats.map((x) => x.lineId)
      const before = await entryIds(item.classId!, watch)
      try {
        await asRefund(() => decideRefundFlag(str(d.flagId), 'freed-seat', actor, lineIds))
      } catch (e) {
        if (e instanceof Error && /Pick which seat/.test(e.message)) throw new DecideError(409, 'Pick which seat to free.', { needsPick: true })
        throw e
      }
      // Only what this decision wrote can be undone (a seat already freed by someone else isn't).
      const entries = await newFreeEntries(item.classId!, watch, before)
      return { decided: await record(item, `Freed ${seatsText(entries.length || 1)}. Back on sale`, by, action, entries.length ? { classId: item.classId!, entries, flagId: str(d.flagId) } : undefined) }
    }
    case 'refund-failed': {
      if (action === 'retry') return { decided: await record(item, await retryFailedRefund(item, by), by, action) }
      const why = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 200) : ''
      if (!why) throw new DecideError(400, 'Say what happened, for the record.')
      await asRefund(() => decideRefundFlag(str(d.flagId), 'dismissed', actor))
      return { decided: await record(item, `Marked as handled: ${why}`, by, action) }
    }
    case 'refund-unfinished': {
      const requestId = str(d.requestId)
      const partyId = str(d.partyId)
      const req = (await listRefundRequests(partyId ? PARTY_SCOPE : item.classId!, str(d.bookingId))).find((r) => r.id === requestId)
      if (!req) throw new DecideError(404, 'That refund isn’t on the booking any more.')
      await asRefund<unknown>(() => (partyId
        ? clearPartyRefundRequest({ partyId, requestId, outcome: 'went-through', reason: 'Finished (To decide)' }, actor)
        : clearRefundRequest({ classId: item.classId!, bookingId: str(d.bookingId), requestId, outcome: 'went-through', reason: 'Finished (To decide)' }, actor)))
      await decideRefundFlag(str(d.flagId), 'dismissed', actor).catch(() => undefined)
      return { decided: await record(item, 'Finished the refund', by, action) }
    }
    case 'refund-unconfirmed':
      return { decided: await record(item, await decideUnconfirmed(item, action, by), by, action) }
    case 'pos-needs-days': {
      const ids = strs(body?.sessionIds)
      try {
        await setPosDays(str(d.needsId), ids, actor, now)
      } catch (e) {
        throw new DecideError(400, e instanceof Error ? e.message : 'Pick the day.')
      }
      const sessions = (d.sessions as { id: string; startIso: string }[]).filter((s) => ids.includes(s.id))
      return { decided: await record(item, `Put on ${sessions.map((s) => dayText(studioDate(s.startIso))).join(', ')}`, by, action) }
    }
    case 'below-minimum': {
      if (action === 'keep-running') return { decided: await record(item, 'Keeping it running', by, action) }
      // R40: texting the people booked isn't deciding: the item stays waiting (and the alerts keep coming), with a note.
      const note: Decided = { id: item.id, kind: item.kind, title: item.title, head: item.head, classId: item.classId, className: item.className, what: 'Texted the people booked', by, at: new Date().toISOString() }
      await decidedKv.set(`note-${item.id}`, JSON.stringify(note))
      await recordAudit({
        by: { ...by, role: 'owner' }, action: 'to-decide-texted', target: { kind: 'class', id: item.classId ?? '', label: item.className ?? item.title },
        details: { item: item.id, kind: item.kind, what: note.what },
      })
      return { decided: note, noted: true }
    }
    case 'door-unpaid': {
      const lineIds = strs(d.lineIds)
      if (action === 'paid') {
        await markDoorPaid(item.classId!, lineIds, by, now)
        return { decided: await record(item, 'Marked paid at the counter', by, action) }
      }
      const before = await entryIds(item.classId!, lineIds)
      await asRefund(() => freeSeatOnly(item.classId!, str(d.bookingId), lineIds, actor, 'Not paid at the counter'))
      const entries = await newFreeEntries(item.classId!, lineIds, before)
      return { decided: await record(item, `Freed ${seatsText(lineIds.length)}`, by, action, entries.length ? { classId: item.classId!, entries } : undefined) }
    }
    case 'paid-not-seated': {
      const paidId = str(d.paidId)
      if (action === 'refund') {
        // Exactly that Square payment, through the shared refund runner (Square read first; saved first, never twice, emailed once, audited).
        const out = await asRefund(() => refundPaidNotSeated(paidId, reasonOf(body, 'Paid, no seat (To decide)'), by, { cents: confirmedCents(body), now }))
        return { decided: await record(item, refundedWhat(out.cents, out.firstName || firstWord(str(d.name)).replace(/^them$/, ''), out.email || str(d.email), out.emailed), by, action) }
      }
      if (action === 'sorted') {
        if (unfinishedRefund(await listRefundRequests(PAID_NOT_SEATED_SCOPE, paidId))) {
          throw new DecideError(409, 'A refund of this payment was started and Square didn’t confirm it. Tap Refund it to finish it (it never refunds twice).')
        }
        await resolvePaidNotSeated(paidId, by, 'sorted')
        return { decided: await record(item, 'Already sorted', by, action) }
      }
      if (d.canSeat !== true) throw new DecideError(409, 'This one can’t be seated. Refund it instead, or tap It’s already sorted if it was settled another way.')
      const entry = (await listPaidNotSeated()).find((p) => p.id === paidId)
      if (!entry) throw new DecideError(404, 'This isn’t waiting any more.')
      // A refund of this payment started (or done): the money is going back, so no seat (checked inside this item's lock).
      if ((await listRefundRequests(PAID_NOT_SEATED_SCOPE, paidId)).some((r) => r.status !== 'turned-down' && !r.retired)) {
        throw new DecideError(409, 'A refund of this payment was started, so it can’t be seated now. Look at it again.', { reload: true })
      }
      const customer = await squareCustomer(entry.customerId)
      let lines: LedgerLine[]
      try {
        lines = await seatPaidOrder(entry, customer, now)
      } catch (e) {
        throw new DecideError(409, e instanceof Error ? e.message : 'That didn’t work. Try again.')
      }
      await resolvePaidNotSeated(paidId, by, 'seated')
      const over = lines.some((l) => l.overCapacity)
      const decided = await record(item, `Gave them ${seatsText(lines.length)}${over ? ' (over capacity)' : ''}`, by, action)
      return { decided, classId: item.classId, seats: lines.map((l) => ({ lineId: l.id, seat: l.seat, named: !!l.customer })) }
    }
    case 'waitlist-unknown': {
      // I5: decided in the app after asking Square again (never the Square dashboard, never a resend).
      const entryId = str(d.entryId)
      const choice = action as 'add' | 'keep' | 'off'
      try {
        await decideUnclear(item.classId!, entryId, choice, by, now)
      } catch (e) {
        if (e instanceof UnclearError) throw new DecideError(409, e.message)
        throw new DecideError(409, 'That didn’t work. Try again.')
      }
      return {
        decided: await record(item, choice === 'add'
          ? 'Square showed it paid. They’re added'
          : choice === 'keep'
            ? 'Square showed no payment. They’re back on the waitlist, and that charge is never sent again'
            : 'Square showed no payment. They’re off the waitlist and their card is coming off', by, action),
      }
    }
    case 'waitlist-declined':
      return { decided: await record(item, 'Seen', by, action) }
    case 'waitlist-refund': {
      // R4: refunded through the class refund (the shared runner: Square never twice), freeing the seat.
      if (action === 'sorted') return { decided: await record(item, 'Already sorted. Nothing was refunded here', by, action) }
      const bookingId = str(d.bookingId)
      if (!bookingId) throw new DecideError(409, 'Their booking isn’t on the class, so it can’t be refunded from here. Tap It’s already sorted once it’s settled.')
      const r = await asRefund(() => refundClassBooking({
        classId: item.classId!, bookingId, kind: 'booking', freeSeat: true, reason: 'Waitlist charge on a cancelled class (To decide)',
        attempt: `wlr${item.id.replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 80),
      }, actor))
      return { decided: await record(item, r.already ? r.already.message : `Refunded ${money(r.cents)} and freed the seat`, by, action) }
    }
    case 'paid-on-cancelled': {
      // I-5: refunded through the class refund (the shared runner: Square never twice), freeing the seat.
      if (action === 'sorted') return { decided: await record(item, 'Already sorted. Nothing was refunded here', by, action) }
      const r = await asRefund(() => refundClassBooking({
        classId: item.classId!, bookingId: str(d.bookingId), kind: 'booking', freeSeat: true, reason: 'Paid just as the class was cancelled (To decide)',
        attempt: `poc${item.id.replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 80),
      }, actor))
      return { decided: await record(item, r.already ? r.already.message : `Refunded ${money(r.cents)} and freed the seat`, by, action) }
    }
    case 'reader-waiting': {
      const origin = siteConfig.url.replace(/\/$/, '')
      try {
        // R1: only the choices that fit what Square showed (the sheet shows the same list).
        if (!strs(d.choices).includes(action)) throw new DecideError(409, 'That isn’t one of the choices for this any more. Close it and open it again.')
        if (action === 'keep') {
          const k = await keepReaderPayment(str(d.bookingId), by, { origin, now, ...(Number.isInteger(body?.confirmPaidCents) ? { confirmPaidCents: Number(body.confirmPaidCents) } : {}) })
          return { decided: await record(item, `Kept. They paid ${money(k.paidCents)} and have their seat${k.overCapacity ? ' (over capacity)' : ''}`, by, action) }
        }
        if (action === 'refund') {
          const r = await refundMismatchedReader(str(d.bookingId), by, { origin, now })
          return { decided: await record(item, `Refunded ${money(r.cents)} and let the seat go`, by, action) }
        }
        if (action === 'let-go') {
          await letReaderSeatGo(str(d.bookingId), { ...by, role: 'owner' }, origin, now)
          return { decided: await record(item, 'Square showed no payment. The seat was let go', by, action) }
        }
        const r = await checkReaderSale(str(d.bookingId), origin, now)
        if (r.outcome === 'paid') return { decided: await record(item, 'Square showed it paid. They have their seat', by, action) }
        throw new DecideError(r.outcome === 'unknown' ? 503 : 409, r.outcome === 'not-found'
          ? 'Square doesn’t show this payment. Their seat stays held. If they paid another way, or didn’t pay, let the seat go.'
          : r.outcome === 'refused'
            // The crew's words say "Ask Catherine or Kaden": owners get their own buttons instead (R1).
            ? 'Square shows a payment for this sale that doesn’t match. Close this and open it again to keep it or refund it.'
            : r.message)
      } catch (e) {
        if (e instanceof ReaderError) throw new DecideError(e.status, e.message)
        if (e instanceof ReaderDecideError) throw new DecideError(e.status, e.message, e.extra)
        throw e
      }
    }
    case 'reader-extra': {
      try {
        if (action === 'refund') {
          const r = await refundExtraReader(str(d.bookingId), str(d.orderId), by, now)
          return { decided: await record(item, `Refunded ${money(r.cents)}`, by, action) }
        }
        await sortedExtraReader(str(d.bookingId), str(d.orderId), by, now)
        return { decided: await record(item, 'Already sorted. Nothing was refunded', by, action) }
      } catch (e) {
        if (e instanceof ReaderDecideError) throw new DecideError(e.status, e.message, e.extra)
        throw e
      }
    }
    case 'reader-late': {
      try {
        if (action === 'keep') {
          await keepLateReader(str(d.bookingId), by, now)
          return { decided: await record(item, 'Kept them in the class', by, action) }
        }
        const r = await refundLateReader(str(d.bookingId), by, now)
        return { decided: await record(item, r.already ?? `Refunded ${money(r.cents)} and freed the seat`, by, action) }
      } catch (e) {
        if (e instanceof ReaderDecideError) throw new DecideError(e.status, e.message, e.extra)
        throw e
      }
    }
    case 'cancel-request': {
      // D2: Catherine decides a customer's note. Each choice re-reads the booking; nothing is sent to the customer here but Square's refund email.
      const bookingId = str(d.bookingId)
      const ledger = await getLedger(item.classId!)
      const booking = ledger.lines.filter((l) => l.bookingId === bookingId)
      const lineIds = strs(d.lineIds).filter((id) => booking.some((l) => l.id === id && isComing(l)))
      if (action === 'keep') return { decided: await record(item, 'Kept their booking', by, action) }
      if (!lineIds.length) throw new DecideError(409, 'Those seats aren’t booked any more. Open the class to see the booking.')
      if (action === 'free') {
        const before = await entryIds(item.classId!, lineIds)
        await asRefund(() => freeSeatOnly(item.classId!, bookingId, lineIds, actor, 'Customer asked to cancel (To decide)'))
        const entries = await newFreeEntries(item.classId!, lineIds, before)
        return { decided: await record(item, `Freed ${seatsText(lineIds.length)}. No refund`, by, action, entries.length ? { classId: item.classId!, entries } : undefined) }
      }
      const cents = cancelSplit(booking, lineIds).reduce((s, x) => s + x.cents, 0)
      if (cents <= 0) throw new DecideError(409, 'There’s nothing to refund on those seats. Free the seat instead.')
      const r = await asRefund(() => refundClassBooking({
        classId: item.classId!, bookingId, kind: 'custom', lineIds, cents, freeSeat: true, reason: 'Customer asked to cancel (To decide)', attempt: `cxr${item.id.replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 80),
      }, actor))
      return { decided: await record(item, r.already ? r.already.message : `Refunded ${money(r.cents)} and freed ${seatsText(lineIds.length)}`, by, action) }
    }
    case 'cancel-unclear': {
      if (action === 'seen') {
        if (d.state !== 'turned-down') throw new DecideError(409, 'Ask Square first. Their seats stay held until we know about the refund.')
        return { decided: await record(item, 'Seen. They’re still booked', by, action) }
      }
      try {
        if (action === 'release') {
          // F3: only after Ask Square showed no refund (read again first); the cancel is called off, nothing refunded.
          await releaseSelfCancel(item.classId!, str(d.bookingId), str(d.attempt), by, now)
          return { decided: await record(item, 'Square showed no refund. Seats released; they’re still booked and nothing was refunded', by, action) }
        }
        if (action === 'retry' && d.noRefundSeen !== true) throw new DecideError(409, 'Ask Square first. Their seats stay held until we know about the refund.')
        if (action === 'ask' && d.state === 'unclear') {
          // F3: Square is read first; the same request is sent again only when Square shows the refund (never a second one).
          const a = await askSquareAboutCancel(item.classId!, str(d.bookingId), str(d.attempt), now)
          if (a.result === 'no-refund') {
            throw new DecideError(409, 'Square shows no refund on their payment. Try again sends the same refund once more (Square never makes it twice), or release the seats with no refund.', { noRefund: true })
          }
          if (a.result === 'cancelling') throw new DecideError(503, 'Square still hasn’t answered. Their seats stay held. Try again in a few minutes.')
          return { decided: await record(item, `Square showed the refund. They’re cancelled and got ${money(a.cents)} back`, by, action) }
        }
        // 'retry' (Square showed no refund) and a turned-down refund's "Try the refund again": the saved request again.
        const r = await retrySelfCancel(item.classId!, str(d.bookingId), str(d.attempt), now)
        if (r.result === 'cancelling') throw new DecideError(503, 'Square still hasn’t answered. Their seats stay held. Try again in a few minutes.')
        return { decided: await record(item, `The refund went through. They’re cancelled and got ${money(r.cents)} back`, by, action) }
      } catch (e) {
        if (e instanceof DecideError) throw e
        if (e instanceof CancelError) {
          throw new DecideError(e.status === 503 ? 503 : 409, e.code === 'square'
            ? 'Square turned the refund down, so nothing was refunded and they’re still booked. Call them if you like, then tap Got it.'
            : e.message)
        }
        throw e
      }
    }
    case 'counter-match-check': {
      if (action === 'confirm') {
        await markCounterMatchChecked(item.classId!, str(d.lineId), by, now)
        return { decided: await record(item, `Yes, it was ${str(d.name)}`, by, action) }
      }
      const to = (d.others as { lineId: string; name: string }[]).find((o) => o.lineId === str(body?.toLineId))
      if (!to) throw new DecideError(400, 'Pick who it was.')
      try {
        await moveCounterPayment(item.classId!, str(d.lineId), to.lineId, by, now)
      } catch (e) {
        throw new DecideError(409, e instanceof Error ? e.message : 'That didn’t work. Try again.')
      }
      return { decided: await record(item, `It was ${to.name}: the payment moved`, by, action) }
    }
    case 'party-no-confirmation': {
      await assertPartyLockHeld()
      await deleteCheckout(str(d.partyId))
      return { decided: await record(item, 'Done', by, action) }
    }
    case 'party-payment-unclear':
      return { decided: await record(item, await decidePartyPayment(str(d.partyId), str(d.attemptId), action === 'went-through', by, now), by, action) }
    case 'party-hold-orphan': {
      try {
        return { decided: await record(item, await freeOrphanHold(str(d.partyId), str(d.startIso), by, now), by, action) }
      } catch (e) {
        if (e instanceof OrphanHoldError) throw new DecideError(e.status, e.message)
        throw e
      }
    }
    case 'party-paid-unclear': {
      const partyId = str(d.partyId)
      if (d.elsewhere === true) {
        const orderId = str(d.orderId)
        if (action === 'refund') {
          // Exactly that Square payment, through the shared refund runner (Square read first; saved first, never twice, emailed once, audited).
          const out = await asRefund(() => refundPaidElsewhere(orderId, reasonOf(body, 'Paid twice (To decide)'), by, { cents: confirmedCents(body), now }))
          if (out.already) return { decided: await record(item, `Already refunded ${money(out.cents)}`, by, action) }
          const who = out.firstName || (str(d.name).trim() ? firstWord(str(d.name)) : '')
          return { decided: await record(item, refundedWhat(out.cents, who, out.email || str(d.email), out.emailed), by, action) }
        }
        if (action === 'apply') {
          const out = await asRefund(() => applyPaidElsewhere(orderId, by, now))
          const left = out.dueLeft > 0 ? `, ${money(out.dueLeft)} still to pay` : ''
          return { decided: await record(item, `Put ${money(out.cents)} toward ${out.firstName ? `${out.firstName}’s` : 'the'} party${left}`, by, action) }
        }
        if (action !== 'sorted') throw new DecideError(400, 'That isn’t one of the choices for this.')
        await asRefund(() => sortPaidElsewhere(orderId, by, now))
        return { decided: await record(item, Number(d.backCents) > 0 ? 'Already sorted (Square refunded it)' : 'Already sorted', by, action) }
      }
      if (action === 'sorted' || action === 'refund' || action === 'apply') throw new DecideError(400, 'That isn’t one of the choices for this.')
      try {
        await assertPartyLockHeld()
        if (action === 'confirm') {
          const done = await confirmUnclearParty(partyId, now)
          return { decided: await record(item, done.overlap ? 'Confirmed the party (its time clashes with another party)' : 'Confirmed the party', by, action) }
        }
        await notPaidUnclearParty(partyId)
        return { decided: await record(item, 'It wasn’t paid: the time was let go', by, action) }
      } catch (e) {
        if (e instanceof PartyUnclearError) throw new DecideError(e.status, e.message)
        throw e
      }
    }
    case 'party-not-told': {
      // "I told them": the same as the party sheet's button, for the change this item named.
      const partyId = str(d.partyId)
      const shown = str(d.notToldAt)
      const at = now.toISOString()
      try {
        await assertPartyLockHeld()
        await updatePartyRecord(partyId, (cur) => {
          if (!isOurs(cur)) throw new DecideError(409, PARTY_GONE)
          if (!cur.notTold) return null
          if (cur.notTold.at !== shown) throw new DecideError(409, 'Something else changed on this party since. Open the party to check it.')
          return { ...cur, notTold: null, told: { at, by, how: 'owner' } }
        }, `${by.name} told ${str(d.host).split(' ')[0] || 'the host'} about the changes`, by)
      } catch (e) {
        // The party was deleted meanwhile (or is hidden here): nothing left to tell, said plainly (not a 500).
        if (e instanceof PartyNotFoundError) throw new DecideError(404, PARTY_GONE)
        throw e
      }
      return { decided: await record(item, 'Told them', by, action) }
    }
  }
}

export const PARTY_PAY_NOT_FOUND = 'Square shows no payment on this order yet, so nothing was recorded. Ask Square again in a few minutes, or tap It didn’t go through.'
export const PARTY_PAY_FOUND = 'Square shows this payment went through. Tap It went through, so it’s recorded on the party.'
export const PARTY_PAY_NO_ORDER = 'Square has no order for this payment, so nothing was paid. It clears by itself within a day, or tap It didn’t go through.'
export const PARTY_PAY_ASK_FAILED = 'Square couldn’t be asked just now. Try again in a minute.'
/** The same words as square-orders' PAYMENT_GOING_THROUGH (the new-party path). */
export const PARTY_PAY_GOING_THROUGH = 'Square shows a payment still going through. Try again in a few minutes. Nothing was changed.'

type PartyPayState =
  | { kind: 'recorded' }
  | { kind: 'no-order'; rec: PartyRecord; p: NonNullable<PartyRecord['paying']> }
  | { kind: 'in-flight' }
  | { kind: 'unpaid'; rec: PartyRecord; p: NonNullable<PartyRecord['paying']> }
  | { kind: 'paid'; rec: PartyRecord; p: NonNullable<PartyRecord['paying']>; asked: Extract<Awaited<ReturnType<typeof paidOnOrder>>, { kind: 'paid' }> }

/**
 * What Square shows for a party payment it never answered: that payment's own
 * order (its id; its saved order request; or, when neither was kept, the order
 * carrying the party id for that amount around the attempt, M-4) and the
 * payment on it. Throws DecideError (404 not waiting, 503 Square unreadable).
 */
async function partyPaymentState(partyId: string, attemptId: string): Promise<PartyPayState> {
  const rec: PartyRecord | null = await getPartyRecord(partyId)
  if (!rec) throw new DecideError(404, 'That party isn’t there any more.')
  const p = rec.paying
  if (!p || p.attemptId !== attemptId) {
    if (rec.charges?.some((c) => c.attemptId === attemptId)) return { kind: 'recorded' }
    throw new DecideError(404, 'This isn’t waiting any more.')
  }
  let found = p.orderId ?? ''
  if (!found && !p.order) {
    if (!providers.payment.findOrderByReference) return { kind: 'no-order', rec, p }
    try {
      found = (await providers.payment.findOrderByReference(partyId, p.at ?? p.until, p.quotedCents ? { totalCents: p.quotedCents } : {}))?.orderId ?? ''
    } catch {
      throw new DecideError(503, PARTY_PAY_ASK_FAILED)
    }
    if (!found) return { kind: 'no-order', rec, p }
  }
  const asked = await paidOnOrder(async () => {
    if (found) return { orderId: found, totalCents: p.quotedCents ?? 0 }
    const o = await providers.payment.createOrder(p.order!)
    return { orderId: o.id, totalCents: o.totalAmount }
  })
  if (asked.kind === 'unknown') throw new DecideError(503, PARTY_PAY_ASK_FAILED)
  if (asked.kind === 'paid') return { kind: 'paid', rec, p, asked }
  // A payment Square shows as still going through (APPROVED / PENDING) is neither: the item stays.
  let inFlight = asked.pending === true
  if (!inFlight && providers.payment.orderPaymentInFlight) {
    // The order Square gave back (also when only the order request was saved, never its id: Minor C1).
    const orderId = asked.order?.orderId || found
    if (orderId) {
      try {
        inFlight = await providers.payment.orderPaymentInFlight(orderId)
      } catch {
        throw new DecideError(503, PARTY_PAY_ASK_FAILED)
      }
    }
  }
  return inFlight ? { kind: 'in-flight' } : { kind: 'unpaid', rec, p }
}

/** "Ask Square" on a party payment Square never answered: what Square shows, and only the buttons that fit. Read only. */
async function askPartyPayment(partyId: string, attemptId: string): Promise<AskAnswer> {
  const st = await partyPaymentState(partyId, attemptId)
  const base = { refundId: null, at: null }
  switch (st.kind) {
    case 'recorded': return { ...base, state: 'done', cents: 0, title: 'It’s on the party already', message: 'This payment is already recorded on the party. Reload to clear this.', next: [] }
    case 'paid': return { ...base, state: 'done', cents: st.asked.payment.amount || st.asked.order.totalCents, title: 'Square shows it paid', message: PARTY_PAY_FOUND, next: ['went-through'] }
    case 'in-flight': return { ...base, state: 'pending', cents: 0, title: 'Square shows it still going through', message: PARTY_PAY_GOING_THROUGH, next: [] }
    case 'unpaid': return { ...base, state: 'none', cents: 0, title: 'Square shows no payment', message: 'Square shows no payment on this order yet. Ask again in a few minutes, or tap It didn’t go through.', next: ['did-not-go-through'] }
    case 'no-order': return { ...base, state: 'none', cents: 0, title: 'Square has no order for it', message: PARTY_PAY_NO_ORDER, next: ['did-not-go-through'] }
  }
}

/**
 * "It went through" / "It didn't go through" on a party payment Square never
 * answered (Task 11 handoff). Both ask Square about that payment's own order
 * first, and act only on what Square says: went through → the charge is
 * recorded from Square's payment (recordLinkCharge, the host and owners told
 * once); didn't → refused while Square shows it paid, else the party's
 * payment slot is cleared so a new payment can start. Nothing is charged or
 * refunded here. Returns what was done, for the item's "Done · …".
 */
async function decidePartyPayment(partyId: string, attemptId: string, wentThrough: boolean, by: By, now: Date): Promise<string> {
  const st = await partyPaymentState(partyId, attemptId)
  if (st.kind === 'recorded') return 'It went through (already on the party)'
  if (st.kind === 'in-flight') throw new DecideError(409, PARTY_PAY_GOING_THROUGH)
  if (wentThrough) {
    if (st.kind === 'no-order') throw new DecideError(409, PARTY_PAY_NO_ORDER)
    if (st.kind !== 'paid') throw new DecideError(409, PARTY_PAY_NOT_FOUND)
    const { asked, p } = st
    const cents = asked.payment.amount || asked.order.totalCents
    await assertPartyLockHeld()
    const out = await recordLinkCharge(partyId, p, { orderId: asked.order.orderId, paymentId: asked.payment.id, cents, receiptUrl: asked.payment.receiptUrl ?? null }, now)
    if (!out.rec) throw new DecideError(503, 'The payment couldn’t be written on the party just now. Try again in a minute.')
    if (!out.created) return 'It went through (already on the party)'
    // The owner just decided it: the host is told once, the owners get no "Party paid" text about their own tap.
    await tellLinkPaid(out.rec, out.charge, undefined, { ownerDecided: true })
    return `It went through: ${money(cents)} recorded on the party`
  }
  if (st.kind === 'paid') throw new DecideError(409, PARTY_PAY_FOUND)
  await assertPartyLockHeld()
  await updatePartyRecord(partyId, (r) => (r.paying?.attemptId === attemptId ? { ...r, paying: null } : null), 'Payment didn’t go through (Square showed no payment, To decide)', by)
  return st.kind === 'no-order' ? 'It didn’t go through: Square has no order for it, a new payment can start' : 'It didn’t go through: nothing was charged, a new payment can start'
}

// ---------------------------------------------------------------- Ask Square (refunds)

export type { AskAnswer }
export { SQUARE_ASK_FAILED }

/** The saved requests' scope an item's refund lives in. */
const scopeOf = (item: ToDecideItem) => (typeof item.detail.partyId === 'string' && item.detail.partyId
  ? { classId: PARTY_SCOPE, bookingId: str(item.detail.partyId) }
  : { classId: item.classId ?? '', bookingId: str(item.detail.bookingId) })

/** A refund with no answer: what Square shows on the payment (the shared Ask Square flow, booking-core/ask-square). */
const unconfirmedAnswer = async (item: ToDecideItem): Promise<AskAnswer> => (await asRefund(() => askAboutRequest(scopeOf(item), str(item.detail.requestId)))).answer

/** A refund Square failed after we recorded it: the flag and what Square shows for that refund now. */
async function failedState(item: ToDecideItem): Promise<{ flag: RefundFlag; answer: AskAnswer }> {
  const flag = await getRefundFlag(str(item.detail.flagId))
  if (!flag || flag.resolved) throw new DecideError(404, 'This isn’t waiting any more.')
  if (!providers.payment.readRefund) throw new DecideError(503, SQUARE_ASK_FAILED)
  let r
  try {
    r = flag.squareRefundId ? await providers.payment.readRefund(flag.squareRefundId) : null
  } catch {
    throw new DecideError(503, SQUARE_ASK_FAILED)
  }
  const cents = flag.refundCents ?? flag.cents
  const amount = money(cents)
  const at = r?.createdAt ?? null
  const answer: AskAnswer = r?.status === 'COMPLETED'
    ? { state: 'done', cents, refundId: r.id, at, next: ['handled'], message: `Square now shows this ${amount} refund went through after all. Tap Mark as handled.` }
    : r?.status === 'PENDING'
      ? { state: 'pending', cents, refundId: r.id, at, next: [], message: `Square shows this ${amount} refund still going through. Ask again later. Nothing was changed.` }
      : { state: 'failed', cents, refundId: r?.id ?? null, at, next: ['retry', 'handled'],
        message: `Square shows this ${amount} refund failed, so the money didn’t go back. Try the refund again (Square is asked for a new ${amount} refund on the same payment), or mark it handled and say why.` }
  return { flag, answer }
}

/**
 * "Ask Square" on a refund that got no answer or that Square failed, or on a
 * party payment Square never answered: reads Square and says what it shows,
 * with the next buttons. Read only: nothing is decided or sent.
 */
/**
 * Kinds whose "Ask Square" is a decision, not a read: a customer's own cancel
 * (D2) asks Square by sending the very same saved refund request again, and
 * finishes the cancel when Square shows it. The route sends these to decide().
 */
const ASK_DECIDES: ReadonlySet<ToDecideKind> = new Set<ToDecideKind>(['cancel-unclear'])

/** True when this item's Ask Square goes through decide() (see ASK_DECIDES). An item that's gone or done is left to askSquare's own refusal. */
export async function askDecides(id: string, now = new Date()): Promise<boolean> {
  const item = await openItem(id, now).catch(() => null)
  return !!item && ASK_DECIDES.has(item.kind)
}

export async function askSquare(id: string, now = new Date()): Promise<AskAnswer> {
  const item = await openItem(id, now)
  if (item.kind === 'refund-unconfirmed') return unconfirmedAnswer(item)
  if (item.kind === 'refund-failed') return (await failedState(item)).answer
  if (item.kind === 'party-payment-unclear') return askPartyPayment(str(item.detail.partyId), str(item.detail.attemptId))
  throw new DecideError(400, 'Square can’t be asked about this one.')
}

/** It went through / Try the refund again / It didn't go through on a refund with no answer: each acts only on what Square shows now. */
async function decideUnconfirmed(item: ToDecideItem, action: string, by: By): Promise<string> {
  const actor = { by, role: 'owner' as const }
  const out = await asRefund(() => actOnRequest(scopeOf(item), str(item.detail.requestId), action, actor))
  await decideRefundFlag(str(item.detail.flagId), 'dismissed', actor).catch(() => undefined)
  return out.what
}

/**
 * "Try the refund again" on a refund Square failed after we recorded it: a new
 * Square refund of the same amount on the same payment (its own key, so a
 * double tap or a retry after no answer never refunds twice). Remembered as
 * standing in for the failed one, so Square's events on it are never recorded
 * as new money.
 */
async function retryFailedRefund(item: ToDecideItem, by: By): Promise<string> {
  const { flag, answer } = await failedState(item)
  if (answer.state !== 'failed') throw new DecideError(409, answer.message)
  const actor = { by, role: 'owner' as const }
  const party = flag.classId === PARTY_SCOPE
  if (!(await failedRefundOnBooks(flag))) {
    // Square failed it before it was written on the booking (M-3): there is nothing here for a new refund to stand in for.
    // The saved request is turned down, so the booking's own Refund sends a new one (never written with the failed id).
    const sent = (await listRefundRequests(flag.classId, flag.bookingId)).find((r) => r.squareRefundId === flag.squareRefundId && r.status === 'sent')
    if (sent) {
      await changeRefundRequest(flag.classId, flag.bookingId, sent.id, (r) => (r.status !== 'sent' ? null : {
        ...r, status: 'turned-down', failures: r.failures + 1,
        idempotencyKey: refundKey(r.bookingId, r.lines.map((x) => x.id), r.totalCents, r.prior, r.failures + 1),
      }))
    }
    await decideRefundFlag(flag.id, 'dismissed', actor).catch(() => undefined)
    await recordAudit({
      by: { ...by, role: 'owner' }, action: 'refund-not-sent-again',
      target: party ? { kind: 'party', id: flag.bookingId, label: item.className ?? item.title } : { kind: 'class', id: flag.classId, label: item.className ?? item.title },
      details: { flagId: flag.id, paymentId: flag.paymentId, failedRefundId: flag.squareRefundId, requestId: sent?.id ?? '' },
    }).catch(() => undefined)
    return `Not sent again: Square failed it before it was saved here, so nothing was refunded. Refund it again from the ${party ? 'party’s Payments' : 'class booking'}`
  }
  const cents = answer.cents
  const retries = flag.retries ?? 0
  const key = `rfx-${hashOf('refund-retry', flag.id, retries)}`
  // Written down BEFORE Square is called (I-1): a refund Square makes whose answer is lost is still known as this one.
  await savePendingReplacement({
    key, flagId: flag.id, retries, replaces: flag.squareRefundId, classId: flag.classId, bookingId: flag.bookingId, paymentId: flag.paymentId, cents,
    at: new Date().toISOString(), refundId: null,
  })
  let refund
  try {
    refund = await providers.payment.refundPayment({ paymentId: flag.paymentId, amountCents: cents, idempotencyKey: key, reason: 'Sent again (To decide)' })
  } catch (e) {
    if (squareErrorCodes(e).some((c) => SQUARE_REFUND_FINAL_CODES.includes(c))) throw new DecideError(409, `${SQUARE_ALREADY_REFUNDED} Tap Mark as handled.`)
    throw new DecideError(502, 'Square didn’t answer. Try again: it won’t refund twice.')
  }
  if (/^(FAILED|REJECTED)$/i.test(refund.status)) {
    await fillPendingReplacement(flag.id, retries, refund.id, true)
    await bumpFlagRetries(flag.id)
    throw new DecideError(502, 'Square turned it down again, so nothing was refunded. Try again later, or mark it handled.')
  }
  await fillPendingReplacement(flag.id, retries, refund.id, false)
  await decideRefundFlag(flag.id, 'dismissed', actor).catch(() => undefined)
  await recordAudit({
    by: { ...by, role: 'owner' }, action: 'refund-sent-again',
    target: party ? { kind: 'party', id: flag.bookingId, label: item.className ?? item.title } : { kind: 'class', id: flag.classId, label: item.className ?? item.title },
    details: { flagId: flag.id, paymentId: flag.paymentId, cents, failedRefundId: flag.squareRefundId, squareRefundId: refund.id },
  }).catch(() => undefined)
  return `Sent the refund again: Square ${/PENDING/i.test(refund.status) ? 'is refunding' : 'refunded'} ${money(cents)}`
}

/**
 * Names the seats of a counter sale after it was matched to a class ("Who
 * are the seats for?"). Only that sale's own counter seats, still unnamed.
 */
export async function nameCounterSeats(classId: string, names: { lineId: string; name: string }[], by: By): Promise<number> {
  noTestSite()
  const cls = await getClass(classId)
  if (!cls) throw new DecideError(404, 'That class no longer exists.')
  const ledger = await getLedger(cls.id)
  let named = 0
  for (const { lineId, name } of names) {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 80)
    if (!clean) continue
    const line = ledger.lines.find((l) => l.id === lineId)
    if (!line || (line.source !== 'pos' && line.source !== 'online') || line.customer) throw new DecideError(400, 'One of those seats can’t be named here.')
    const [given, ...rest] = clean.split(' ')
    await setNames(cls.id, [lineId], { givenName: given, familyName: rest.join(' '), email: '', phone: '' })
    named++
  }
  if (named) {
    await recordAudit({
      by: { ...by, role: 'owner' }, action: 'to-decide-names', target: { kind: 'class', id: cls.id, label: cls.content.name },
      details: { seats: named },
    })
  }
  return named
}

/** How long a freed seat can be taken back from the toast. */
export const UNDO_MS = 10 * 60_000

/**
 * The toast's Undo after freeing a seat: the seat holds again, the item waits
 * again (a refund flag is reopened), and it's audited. Only a free-the-seat
 * decision, only for a few minutes.
 */
export async function undoDecision(id: string, by: By, now = new Date()): Promise<void> {
  noTestSite()
  const raw = await decidedKv.get(`done-${id}`)
  const d = raw ? (JSON.parse(raw) as Decided) : null
  if (!d?.undo) throw new DecideError(409, 'That can’t be undone from here.')
  if (now.getTime() - Date.parse(d.at) > UNDO_MS) throw new DecideError(409, 'Too late to undo. Open the class to change it.')
  const cls = await getClass(d.undo.classId)
  if (!cls) throw new DecideError(404, 'That class no longer exists.')
  try {
    await unfreeSeats(cls, d.undo.entries ?? [], now)
  } catch (e) {
    throw new DecideError(409, e instanceof Error ? e.message : 'That can’t be undone from here.')
  }
  if (d.undo.flagId) await reopenRefundFlag(d.undo.flagId)
  await decidedKv.set(`done-${id}`, '')
  await recordAudit({
    by: { ...by, role: 'owner' }, action: 'to-decide-undo', target: { kind: 'class', id: d.undo.classId, label: d.className ?? d.title },
    details: { item: id, kind: d.kind, what: `Undid: ${d.what}` },
  })
}
