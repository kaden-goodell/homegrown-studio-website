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
import { changeRefundRequest, hashOf, isWaiting, listRefundRequests, type SavedRefundRequest } from './refund-requests'
import {
  bumpFlagRetries, decideRefundFlag, getRefundFlag, listPaidNotSeated, openPaidNotSeated, listPosNeedsDays, listRefundFlags, listUnmatchedPos, reopenRefundFlag, resolvePaidNotSeated, resolveUnmatchedPos,
  saveReplacementRefund, seatPaidOrder, setPosDays, splitCents, type RefundFlag,
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
import { LOOSE_PAYMENT_SCOPES, PAID_ELSEWHERE_SCOPE, PAID_NOT_SEATED_SCOPE, PARTY_SCOPE, retrySavedRequest } from '@lib/booking-core/refund-runner'
import { refundBookFor, claimSquareRefund } from '@lib/booking-core/refund-books'
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

/** Every kind of To decide item (a runtime list, so /admin › More › Help can be checked against it). */
export const TO_DECIDE_KINDS = [
  'pos-unmatched', 'refund-plain', 'refund-failed', 'refund-unfinished', 'refund-unconfirmed',
  'pos-needs-days', 'below-minimum', 'door-unpaid', 'counter-match-check', 'party-paid-unclear', 'paid-not-seated', 'party-not-told',
  'party-payment-unclear', 'party-no-confirmation', 'party-hold-orphan',
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

/** The party kinds: decided inside that party's lock. */
const PARTY_KINDS: ReadonlySet<ToDecideKind> = new Set(['party-paid-unclear', 'party-payment-unclear', 'party-no-confirmation', 'party-hold-orphan', 'party-not-told'])

export async function decide(id: string, action: string, body: any, by: By, now = new Date()): Promise<DecideResult> {
  noTestSite()
  const item = await openItem(id, now)
  if (!ACTIONS[item.kind].includes(action)) throw new DecideError(400, 'That isn’t one of the choices for this.')
  const partyId = typeof item.detail.partyId === 'string' ? item.detail.partyId : ''
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
      await asRefund(() => decideRefundFlag(str(d.flagId), 'dismissed', actor))
      const why = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 200) : ''
      return { decided: await record(item, why ? `Marked as handled: ${why}` : 'Marked as handled', by, action) }
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

export const PARTY_PAY_NOT_FOUND = 'Square shows no payment on this order yet, so nothing was recorded. If you can see it paid in Square, wait a few minutes and try again. If not, choose It didn’t go through.'
export const PARTY_PAY_FOUND = 'Square shows this payment went through. Choose It went through, so it’s recorded on the party.'
export const PARTY_PAY_NO_ORDER = 'We can’t tell which Square order this payment made, so it can’t be checked from here. Look for it in Square. If it was paid, it shows up on the party by itself once Square tells us. If not, this clears by itself within a day.'
export const PARTY_PAY_ASK_FAILED = 'Square couldn’t be asked just now. Try again in a minute.'
/** The same words as square-orders' PAYMENT_GOING_THROUGH (the new-party path). */
export const PARTY_PAY_GOING_THROUGH = 'Square shows a payment still going through. Try again in a few minutes. Nothing was changed.'

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
  const rec: PartyRecord | null = await getPartyRecord(partyId)
  if (!rec) throw new DecideError(404, 'That party isn’t there any more.')
  const p = rec.paying
  if (!p || p.attemptId !== attemptId) {
    if (rec.charges?.some((c) => c.attemptId === attemptId)) return 'It went through (already on the party)'
    throw new DecideError(404, 'This isn’t waiting any more.')
  }
  if (!p.orderId && !p.order) throw new DecideError(409, PARTY_PAY_NO_ORDER)
  const asked = await paidOnOrder(async () => {
    if (p.orderId) return { orderId: p.orderId, totalCents: p.quotedCents ?? 0 }
    const o = await providers.payment.createOrder(p.order!)
    return { orderId: o.id, totalCents: o.totalAmount }
  })
  if (asked.kind === 'unknown') throw new DecideError(503, PARTY_PAY_ASK_FAILED)
  // A payment Square shows as still going through (APPROVED / PENDING) is neither: the item stays.
  if (asked.kind === 'unpaid') {
    let inFlight = asked.pending === true
    if (!inFlight && providers.payment.orderPaymentInFlight) {
      // The order Square gave back (also when only the order request was saved, never its id: Minor C1).
      const orderId = asked.order?.orderId || p.orderId
      if (orderId) {
        try {
          inFlight = await providers.payment.orderPaymentInFlight(orderId)
        } catch {
          throw new DecideError(503, PARTY_PAY_ASK_FAILED)
        }
      }
    }
    if (inFlight) throw new DecideError(409, PARTY_PAY_GOING_THROUGH)
  }
  if (wentThrough) {
    if (asked.kind !== 'paid') throw new DecideError(409, PARTY_PAY_NOT_FOUND)
    const cents = asked.payment.amount || asked.order.totalCents
    await assertPartyLockHeld()
    const out = await recordLinkCharge(partyId, p, { orderId: asked.order.orderId, paymentId: asked.payment.id, cents, receiptUrl: asked.payment.receiptUrl ?? null }, now)
    if (!out.rec) throw new DecideError(503, 'The payment couldn’t be written on the party just now. Try again in a minute.')
    if (!out.created) return 'It went through (already on the party)'
    // The owner just decided it: the host is told once, the owners get no "Party paid" text about their own tap.
    await tellLinkPaid(out.rec, out.charge, undefined, { ownerDecided: true })
    return `It went through: ${money(cents)} recorded on the party`
  }
  if (asked.kind === 'paid') throw new DecideError(409, PARTY_PAY_FOUND)
  await assertPartyLockHeld()
  await updatePartyRecord(partyId, (r) => (r.paying?.attemptId === attemptId ? { ...r, paying: null } : null), 'Payment didn’t go through (checked in Square, To decide)', by)
  return 'It didn’t go through: nothing was charged, a new payment can start'
}

// ---------------------------------------------------------------- Ask Square (refunds)

/** What Square says about one of our refunds (To decide's "Ask Square"), with the buttons that fit. */
export interface AskAnswer {
  state: 'done' | 'pending' | 'failed' | 'none'
  cents: Cents
  /** Square's refund, when one matched */
  refundId: string | null
  at: string | null
  message: string
  /** the choices that fit what Square said (action names) */
  next: string[]
}

export const SQUARE_ASK_FAILED = 'Square couldn’t be asked just now. Try again in a minute. Nothing was changed.'
const NOT_WAITING_ON_SQUARE = 'This refund isn’t waiting on Square any more. Reload to see it.'
const shortDay = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? dayText(studioDate(iso)) : '')

/** The saved requests' scope an item's refund lives in. */
const scopeOf = (item: ToDecideItem) => (typeof item.detail.partyId === 'string' && item.detail.partyId
  ? { classId: PARTY_SCOPE, bookingId: str(item.detail.partyId) }
  : { classId: item.classId ?? '', bookingId: str(item.detail.bookingId) })

/** Square refund ids already recorded on this booking (never matched again as "ours"). */
async function knownRefundIds(scope: { classId: string; bookingId: string }): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const r of await listRefundRequests(scope.classId, scope.bookingId)) if (r.squareRefundId) ids.add(r.squareRefundId)
  if (scope.classId === PARTY_SCOPE) {
    for (const f of (await getPartyRecord(scope.bookingId).catch(() => null))?.refunds ?? []) if (f.squareRefundId) ids.add(f.squareRefundId)
  } else if (scope.classId) {
    for (const l of (await getLedger(scope.classId)).lines) for (const r of l.refunds) if (r.squareRefundId) ids.add(r.squareRefundId)
  }
  return ids
}

/** A refund with no answer: its saved request and what Square shows on the payment (a refund of that amount not on our records). */
async function unconfirmedState(item: ToDecideItem): Promise<{ req: SavedRefundRequest; scope: { classId: string; bookingId: string }; answer: AskAnswer }> {
  const scope = scopeOf(item)
  const req = (await listRefundRequests(scope.classId, scope.bookingId)).find((r) => r.id === str(item.detail.requestId))
  if (!req || !isWaiting(req)) throw new DecideError(404, NOT_WAITING_ON_SQUARE)
  if (!providers.payment.readPayment) throw new DecideError(503, SQUARE_ASK_FAILED)
  let pay
  try {
    pay = await providers.payment.readPayment(req.paymentId)
  } catch {
    throw new DecideError(503, SQUARE_ASK_FAILED)
  }
  const known = await knownRefundIds(scope)
  const cands = pay.refunds.filter((r) => r.amountCents === req.totalCents && !known.has(r.id))
  const amount = money(req.totalCents)
  const hit = cands.find((r) => r.status === 'COMPLETED') ?? cands.find((r) => r.status === 'PENDING') ?? cands.find((r) => /^(FAILED|REJECTED)$/.test(r.status)) ?? null
  const at = hit?.createdAt ?? null
  const answer: AskAnswer = !hit
    ? { state: 'none', cents: req.totalCents, refundId: null, at: null, next: ['retry', 'did-not-go-through'],
      message: `Square shows no ${amount} refund on this payment, so it didn’t go through. Try the refund again (it re-sends the same request, so it can never refund twice), or tap It didn’t go through to stop it here.` }
    : hit.status === 'COMPLETED'
      ? { state: 'done', cents: req.totalCents, refundId: hit.id, at, next: ['went-through'],
        message: `Square shows a ${amount} refund on this payment${shortDay(at) ? `, made ${shortDay(at)}` : ''}. Tap It went through to record it here (the customer gets their refund email once).` }
      : hit.status === 'PENDING'
        ? { state: 'pending', cents: req.totalCents, refundId: hit.id, at, next: [],
          message: `Square shows this ${amount} refund still going through. Ask again later. Nothing was changed.` }
        : { state: 'failed', cents: req.totalCents, refundId: hit.id, at, next: ['retry', 'did-not-go-through'],
          message: `Square shows this ${amount} refund failed, so nothing went back. Try the refund again, or tap It didn’t go through to stop it here.` }
  return { req, scope, answer }
}

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
 * "Ask Square" on a refund that got no answer or that Square failed: reads
 * the payment's refunds (or that refund) and says what Square shows, with
 * the next buttons. Read only: nothing is decided or sent.
 */
export async function askSquare(id: string, now = new Date()): Promise<AskAnswer> {
  const item = await openItem(id, now)
  if (item.kind === 'refund-unconfirmed') return (await unconfirmedState(item)).answer
  if (item.kind === 'refund-failed') return (await failedState(item)).answer
  throw new DecideError(400, 'Square can’t be asked about this one.')
}

/** It went through / Try the refund again / It didn't go through on a refund with no answer: each acts only on what Square shows now. */
async function decideUnconfirmed(item: ToDecideItem, action: string, by: By): Promise<string> {
  const actor = { by, role: 'owner' as const }
  const { req, scope, answer } = await unconfirmedState(item)
  const flagId = str(item.detail.flagId)
  if (action === 'went-through') {
    if (answer.state !== 'done' || !answer.refundId) throw new DecideError(409, answer.message)
    const claimed = await claimSquareRefund({ id: answer.refundId, paymentId: req.paymentId, cents: req.totalCents }, [scope], { requestIds: [req.id] })
    if (!claimed) throw new DecideError(409, 'That refund couldn’t be matched here. Reload and ask Square again.')
    await decideRefundFlag(flagId, 'dismissed', actor).catch(() => undefined)
    return `It went through: ${money(req.totalCents)} recorded with Square’s refund`
  }
  if (action === 'did-not-go-through') {
    if (answer.state === 'done' || answer.state === 'pending') throw new DecideError(409, answer.message)
    const reason = 'Square shows no refund (To decide)'
    await asRefund<unknown>(() => (scope.classId === PARTY_SCOPE
      ? clearPartyRefundRequest({ partyId: scope.bookingId, requestId: req.id, outcome: 'did-not-go-through', reason }, actor)
      : clearRefundRequest({ classId: scope.classId, bookingId: scope.bookingId, requestId: req.id, outcome: 'did-not-go-through', reason }, actor)))
    await decideRefundFlag(flagId, 'dismissed', actor).catch(() => undefined)
    return 'It didn’t go through: Square shows no refund'
  }
  // Try the refund again.
  if (answer.state === 'done' || answer.state === 'pending') throw new DecideError(409, answer.message)
  if (answer.state === 'failed') {
    // Square failed that try: the next one is a new try (a new key), never the same failed answer again.
    await changeRefundRequest(scope.classId, scope.bookingId, req.id, (r) => (r.status !== 'pending' ? null : {
      ...r, status: 'turned-down', failures: r.failures + 1,
      idempotencyKey: refundKey(r.bookingId, r.lines.map((x) => x.id), r.totalCents, r.prior, r.failures + 1),
    }))
  }
  const book = await refundBookFor(scope)
  if (!book) throw new DecideError(404, 'That booking isn’t here any more.')
  const out = await asRefund(() => retrySavedRequest(book, req.id, actor))
  await decideRefundFlag(flagId, 'dismissed', actor).catch(() => undefined)
  return `Tried again: Square refunded ${money(out.cents)}${out.emailed ? ' (emailed)' : ''}`
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
  const cents = answer.cents
  const key = `rfx-${hashOf('refund-retry', flag.id, flag.retries ?? 0)}`
  let refund
  try {
    refund = await providers.payment.refundPayment({ paymentId: flag.paymentId, amountCents: cents, idempotencyKey: key, reason: 'Sent again (To decide)' })
  } catch (e) {
    if (squareErrorCodes(e).some((c) => SQUARE_REFUND_FINAL_CODES.includes(c))) throw new DecideError(409, `${SQUARE_ALREADY_REFUNDED} Tap Mark as handled.`)
    throw new DecideError(502, 'Square didn’t answer. Try again: it won’t refund twice.')
  }
  if (/^(FAILED|REJECTED)$/i.test(refund.status)) {
    await bumpFlagRetries(flag.id)
    throw new DecideError(502, 'Square turned it down again, so nothing was refunded. Try again later, or mark it handled.')
  }
  await saveReplacementRefund({
    refundId: refund.id, replaces: flag.squareRefundId, classId: flag.classId, bookingId: flag.bookingId, paymentId: flag.paymentId, cents, at: new Date().toISOString(),
  })
  await decideRefundFlag(flag.id, 'dismissed', { by, role: 'owner' }).catch(() => undefined)
  await recordAudit({
    by: { ...by, role: 'owner' }, action: 'refund-sent-again',
    target: flag.classId === PARTY_SCOPE ? { kind: 'party', id: flag.bookingId, label: item.className ?? item.title } : { kind: 'class', id: flag.classId, label: item.className ?? item.title },
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
