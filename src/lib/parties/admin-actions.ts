/**
 * What owners do to a party from /admin: move it, cancel it, add or remove
 * an extra, change its details, send the payment link, take a card for what
 * is due. The routes (src/pages/api/admin/parties/*) read the request; the
 * rules live here.
 *
 * - Only our own parties: one booked in Square is read only here ("Change it
 *   there."), every write refused (S2-R9).
 * - Nothing is written on a test site that shares the live stores (R41).
 * - Move and Cancel are refused while a payment is going through (S2-R26).
 * - Move only to a time the shared schedule allows (a party time, or another
 *   free time, OWNER-3), never past (R37), never past midnight. Money is
 *   untouched. The host is not told automatically (S2-R7): the reply names
 *   them so the owner can call, text or email.
 * - Cancel never refunds and sends nothing: the time is let go, the themed
 *   table released, every charge stays refundable on the Payments tab.
 * - Extras: priced from Parties setup (`quoteAddOn`, per-guest top-ups for
 *   guests who joined later, S2-R4a); extra time is checked against the
 *   shared schedule before the hold grows; only unpaid extras come off.
 * - Every change: the owner in the party's history and in the audit log.
 *
 * Server only.
 */
import { kitThemes } from '@config/kit-content'
import { partyConfig } from '@config/party.config'
import { recordAudit } from '@lib/audit'
import { idFor, CREATE_KEY_RE } from '@lib/booking-core/ids'
import { PARTY_SCOPE } from '@lib/booking-core/refund-runner'
import { listRefundRequests } from '@lib/classes/refund-requests'
import { findPartyCraft } from '@lib/craft-catalog'
import { weekKeyFor } from '@lib/kit-dates'
import { releaseWeekClaim } from '@lib/kit-store'
import { createLogger } from '@lib/logger'
import { alertOwners } from '@lib/owner-alert'
import { formatSlotLabel } from '@lib/studio-time'
import { formatMoney } from '@lib/money'
import type { By } from '@lib/staff-auth'
import {
  getPartyRecord, isOurs, PartyNotFoundError, updatePartyRecord,
  type PartyItem, type PartyRecord,
} from '@lib/party-store'
import { dueCents, paidCents, paymentState } from './money'
import { sendPartyBookedEmail } from './checkout'
import { checkStart, PARTY_TIMES_UNREADABLE } from './open-times'
import { holdsBetween, moveTime, releaseTime, resizeTime } from './party-book'
import { localDate, startsOn } from './party-times'
import { PaymentLinkError, partyWhenLabel, payLinkUrl, sendPaymentLink, whatIsDue } from './payment-link'
import { quoteAddOn } from './pricing'
import { describePartyRequest, partyLabel } from './refunds'
import { getPartySettings } from './settings-store'
import { partyWritesRefusal } from './test-site'
import { PartyBusyError, withPartyLock } from './party-lock'
import type { PartyTimes } from './types'

const logger = createLogger('parties:admin')
const MINUTE = 60_000

export const LEGACY_PARTY = 'This party was booked in Square. Change it there.'
export const NO_SUCH_PARTY = 'That party does not exist.'
export const PARTY_CANCELLED = 'This party was cancelled.'
export const NOTHING_REFUNDED = 'Nothing was refunded.'
export const PAID_EXTRA = 'That extra is paid. Use Refund on the Payments tab if they should get money back.'
export const UNREACHABLE = "The party couldn't be reached. Try again."
export const SAME_TIME = "That's already this party's time."
export const STARTED = 'This party has already started, so its time can’t change.'
export const STARTED_NO_MOVE = 'This party has already started, so it can’t be moved.'
export const CHANGED_MEANWHILE = 'Someone else changed this party at the same moment. Check it and try again.'

/** A refusal the owner reads: an HTTP status, a sentence, and anything extra for the sheet. */
export class PartyActionError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message)
  }
}

/** Who to tell after a move or a cancel (the owner does, S2-R7). */
export interface HostToTell { name: string; phone: string; email: string }
const hostOf = (r: PartyRecord): HostToTell => ({ name: r.hostName, phone: r.hostPhone ?? '', email: r.hostEmail })
const firstOf = (r: PartyRecord) => r.hostName.split(' ')[0] || 'the host'

/** What the owner reads after a move: where it went, and that the host still has to be told. */
export const movedMessage = (r: PartyRecord) => `Moved to ${partyWhenLabel(r.startIso)}. Nothing was sent to ${firstOf(r)}, so let them know.`
/** After a cancel: nothing refunded, nothing sent. Refunds are mentioned only when money is still with us. */
export function cancelledMessage(r: PartyRecord): string {
  const tell = `Nothing was sent to ${firstOf(r)}, so let them know.`
  if (paidCents(r) > 0) return `Cancelled. ${NOTHING_REFUNDED} ${tell} To give money back, use Refund on the Payments tab.`
  if ((r.charges ?? []).length > 0) return `Cancelled. Everything paid was already refunded. ${tell}`
  return `Cancelled. Nothing had been paid. ${tell}`
}
/** After the link went out (or didn't). */
export function linkMessage(r: PartyRecord, dueCents: number, email: boolean, text: boolean): string {
  const how = email && text ? 'by email and text' : email ? 'by email' : text ? 'by text' : null
  if (!how) return `The payment link didn’t go out. Copy it and send it to ${firstOf(r)} yourself.`
  return `The payment link for ${whatIsDue(r)} (${formatMoney(dueCents)}) went to ${firstOf(r)} ${how}.`
}

/** The party's length now: start to end (extra time included). */
export function partyMinutesOf(r: PartyRecord): number {
  if (r.endIso) return Math.round((Date.parse(r.endIso) - Date.parse(r.startIso)) / MINUTE)
  return r.durationMinutes ?? partyConfig.durationMinutes
}
const endOf = (r: PartyRecord) => r.endIso ?? new Date(Date.parse(r.startIso) + partyMinutesOf(r) * MINUTE).toISOString()
const plus = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * MINUTE).toISOString()

/** A payment claimed on the party and still inside its time (link or owner card). */
export function paymentGoingThrough(r: PartyRecord, now: Date): boolean {
  return !!r.paying && Date.parse(r.paying.until) > now.getTime()
}

/**
 * Why Move, Cancel or a new payment has to wait, said plainly: whose payment,
 * how much, how, and what to do. A charge Square never answered keeps the
 * party's payment slot for up to 24 hours (UNCLEAR_HOLD_HOURS): it settles by
 * itself when Square's payment event lands, or when that time runs out and
 * the next payment first asks Square about it.
 */
export function paymentWaitMessage(r: PartyRecord, now: Date): string {
  const p = r.paying
  const first = firstOf(r)
  if (!p) return `A payment on ${first}’s party is going through. Check Payments on this party, then try again.`
  const cents = p.quotedCents ?? 0
  const what = `${first}’s ${cents > 0 ? `${formatMoney(cents)} ` : ''}${p.via === 'admin-card' ? 'card payment' : 'payment by link'}`
  if (p.state === 'unclear') {
    return `Square didn’t give a clear answer on ${what}. Move, Cancel and new payments on this party wait until that’s settled. Look in Square under Payments for it. If Square shows it paid, it shows up on this party by itself. If Square shows no payment, this clears on ${partyWhenLabel(p.until)}.`
  }
  const mins = Math.max(1, Math.ceil((Date.parse(p.until) - now.getTime()) / MINUTE))
  return `${what[0].toUpperCase()}${what.slice(1)} is going through right now. Wait ${mins === 1 ? 'a minute' : `${mins} minutes`}, then check Payments on this party and try again.`
}

/** The owner-tapped "Email Stefanie the new details" offer (never sent automatically, S2-R7). */
export interface SendDetailsOffer { action: 'send-details'; label: string }
export const sendDetailsOffer = (r: PartyRecord, changed: boolean): SendDetailsOffer =>
  ({ action: 'send-details', label: `Email ${firstOf(r)} the ${changed ? 'new ' : ''}details` })

/** After an extra goes on: what it costs and the next step (it is due until paid). */
const addedMessage = (it: PartyItem) => (it.cents > 0
  ? `Added ${it.label} (${formatMoney(it.cents)}). It’s due: send the payment link or take a card on the Payments tab.`
  : `Added ${it.label}.`)

const audit = (by: By, action: string, r: PartyRecord, details?: Record<string, string | number | boolean | null>) =>
  recordAudit({ by: { ...by, role: 'owner' }, action, target: { kind: 'party', id: r.bookingId, label: partyLabel(r) }, ...(details ? { details } : {}) })

/** Thrown inside an update to stop it with the owner's answer. */
class Stop extends Error {
  constructor(public err: PartyActionError) { super(err.message) }
}
const stop = (status: number, message: string, extra: Record<string, unknown> = {}): never => {
  throw new Stop(new PartyActionError(status, message, extra))
}

/** updatePartyRecord, turning a Stop into its PartyActionError and a missing party into 404. */
async function update(id: string, fn: (r: PartyRecord) => PartyRecord | null, change: string, by: By): Promise<PartyRecord> {
  try {
    return await updatePartyRecord(id, fn, change, by)
  } catch (e) {
    if (e instanceof Stop) throw e.err
    if (e instanceof PartyNotFoundError) throw new PartyActionError(404, NO_SUCH_PARTY)
    throw e
  }
}

/** Our own party, ready for a write; refusals for anything else. */
async function writable(id: unknown, request: Request): Promise<PartyRecord> {
  const refusal = partyWritesRefusal(request)
  if (refusal) throw new PartyActionError(503, refusal)
  if (typeof id !== 'string' || !id) throw new PartyActionError(400, 'Pick a party.')
  const r = await getPartyRecord(id)
  if (!r) throw new PartyActionError(404, NO_SUCH_PARTY)
  if (!isOurs(r)) throw new PartyActionError(409, LEGACY_PARTY)
  return r
}
/**
 * Runs a time-changing action (move, cancel, extras) as the only one on this
 * party (withPartyLock), after the cheap refusals. Its record is read inside.
 */
async function locked<T>(id: unknown, request: Request, fn: () => Promise<T>): Promise<T> {
  const refusal = partyWritesRefusal(request)
  if (refusal) throw new PartyActionError(503, refusal)
  if (typeof id !== 'string' || !id) throw new PartyActionError(400, 'Pick a party.')
  try {
    return await withPartyLock(id, fn)
  } catch (e) {
    if (e instanceof PartyBusyError) throw new PartyActionError(409, e.message)
    throw e
  }
}
const notCancelled = (r: PartyRecord) => {
  if (r.status === 'cancelled') throw new PartyActionError(409, PARTY_CANCELLED)
}

// ── The party as /admin shows it ───────────────────────────────────────────

export interface AdminPartyView {
  bookingId: string
  hostName: string
  hostEmail: string
  hostPhone: string
  guestCount: number
  craftName: string
  title: string | null
  startIso: string
  durationMinutes: number | null
  themeName: string | null
  createdAt: string
  // stage 2
  status: 'booked' | 'cancelled'
  /** booked in Square: read only here */
  legacy: boolean
  endIso: string | null
  packageId: string | null
  craftId: string | null
  items: PartyItem[]
  charges: NonNullable<PartyRecord['charges']>
  refunds: NonNullable<PartyRecord['refunds']>
  dueCents: number
  paymentState: ReturnType<typeof paymentState>
  linkSent: NonNullable<PartyRecord['linkSent']>
  overlap: boolean
  /** a payment claimed and still inside its time (Move and Cancel wait) */
  paymentGoingThrough: boolean
  /** that payment, for the sheet to explain: charging now, or Square never answered (kept up to 24 h) */
  paymentInFlight: { state: 'charging' | 'unclear'; via: 'link' | 'admin-card'; cents: number; until: string; message: string } | null
  cancelled: PartyRecord['cancelled'] | null
  /** "Email Stefanie the details" (re-sends the confirmation with the current time); null when it can't be sent */
  sendDetails: SendDetailsOffer | null
}

export function adminPartyView(r: PartyRecord, now: Date = new Date()): AdminPartyView {
  const legacy = !isOurs(r)
  return {
    bookingId: r.bookingId,
    hostName: r.hostName,
    hostEmail: r.hostEmail,
    hostPhone: r.hostPhone ?? '',
    guestCount: r.guestCount,
    craftName: r.craftName,
    title: r.title,
    startIso: r.startIso,
    durationMinutes: r.durationMinutes,
    themeName: r.theme?.displayName ?? null,
    createdAt: r.createdAt,
    status: r.status === 'cancelled' ? 'cancelled' : 'booked',
    legacy,
    endIso: legacy ? (r.durationMinutes ? plus(r.startIso, r.durationMinutes) : null) : endOf(r),
    packageId: r.packageId ?? null,
    craftId: r.craftId ?? null,
    items: r.items ?? [],
    charges: r.charges ?? [],
    refunds: r.refunds ?? [],
    dueCents: legacy ? 0 : dueCents(r),
    paymentState: paymentState(r),
    linkSent: r.linkSent ?? [],
    overlap: r.overlap === true,
    paymentGoingThrough: paymentGoingThrough(r, now),
    paymentInFlight: !legacy && r.paying && paymentGoingThrough(r, now)
      ? {
          state: r.paying.state === 'unclear' ? 'unclear' : 'charging', via: r.paying.via ?? 'link', cents: r.paying.quotedCents ?? 0,
          until: r.paying.until, message: paymentWaitMessage(r, now),
        }
      : null,
    cancelled: r.cancelled ?? null,
    sendDetails: !legacy && r.status !== 'cancelled' ? sendDetailsOffer(r, false) : null,
  }
}

/** The party's saved refund requests as the sheet shows them; null when they can't be read. */
export async function partyRefundRequests(id: string): Promise<ReturnType<typeof describePartyRequest>[] | null> {
  // Only our own parties are refunded here: a Square-booked one has none.
  if (!id.startsWith('pty_')) return []
  try {
    return (await listRefundRequests(PARTY_SCOPE, id)).map(describePartyRequest)
  } catch (e) {
    logger.warn('Party refund requests unreadable', { partyId: id, error: String(e) })
    return null
  }
}

// ── Move ────────────────────────────────────────────────────────────────────

export interface MoveResult {
  party: AdminPartyView; hostToTell: HostToTell; from: string | null; to: string; message: string
  /** the owner may tap it to email the host the new time and a fresh calendar file (S2-R7: never automatic) */
  sendDetails: SendDetailsOffer
  replay?: true; warning?: string
}

/** The party as it is saved now; null when it can't be read (the caller then keeps both times held). */
async function reread(id: string): Promise<PartyRecord | null> {
  try {
    return await getPartyRecord(id)
  } catch (e) {
    logger.error('Party unreadable while finishing a move', { partyId: id, error: String(e) })
    return null
  }
}
const sameStart = (a: string, b: string) => Date.parse(a) === Date.parse(b)

/** Lets a time of this party's go; false when the party book couldn't be written. Idempotent. */
const letGo = (id: string, iso: string) => releaseTime(id, iso).then(() => true, (err) => {
  logger.error('Party time not let go', { partyId: id, startIso: iso, error: String(err) })
  return false
})

/**
 * Moves a party of ours to `startIso` (its length kept). Order: the new time
 * is written in the party book (locked, checked), then the record (only if
 * it still has the old start and no payment is going through), then the old
 * time is let go.
 *
 * The whole move runs inside the party's lock (withPartyLock): no other move,
 * cancel or extra-time change of this party runs meanwhile, on this server or
 * another. So once the record is re-read inside the lock, a time the record
 * isn't on is never one another request still needs (re-review N1).
 *
 * Safe to tap twice or retry: a party already on the new time is the same
 * successful answer (`replay`). The new time is let go after a failure only
 * when this request wrote it and the re-read record isn't on it. When the
 * record can't be re-read, both times stay held (nobody can book either),
 * the owners get a text, and the reply says how to finish it. `fromIso` (the
 * start the sheet showed): a retry of a move that already landed lets that
 * old time go; a party someone else moved meanwhile is refused plainly.
 */
export async function moveParty(body: { id?: unknown; startIso?: unknown; fromIso?: unknown }, by: By, request: Request, now: Date = new Date()): Promise<MoveResult> {
  return locked(body.id, request, () => moveLocked(body, by, request, now))
}

async function moveLocked(body: { id?: unknown; startIso?: unknown; fromIso?: unknown }, by: By, request: Request, now: Date): Promise<MoveResult> {
  const r = await writable(body.id, request)
  notCancelled(r)
  const toMs = typeof body.startIso === 'string' ? Date.parse(body.startIso) : NaN
  if (!Number.isFinite(toMs)) throw new PartyActionError(400, 'Pick the new time.', { field: 'startIso' })
  const to = new Date(toMs).toISOString()
  const shown = typeof body.fromIso === 'string' && Number.isFinite(Date.parse(body.fromIso)) ? new Date(Date.parse(body.fromIso)).toISOString() : null
  const reply = (saved: PartyRecord, from: string | null, extra: { replay?: true; warning?: string } = {}): MoveResult => ({
    party: adminPartyView(saved, now), hostToTell: hostOf(saved), from, to, message: movedMessage(saved), sendDetails: sendDetailsOffer(saved, true), ...extra,
  })

  // Already on that time: a double tap or a retry of a move that went through. The same answer.
  if (sameStart(r.startIso, to)) {
    let warning: string | undefined
    // Inside the lock and with the record on `to`, a hold at the old time is only a leftover.
    if (shown && !sameStart(shown, to) && !(await letGo(r.bookingId, shown))) {
      warning = `${movedMessage(r)} ${partyWhenLabel(shown)} still shows as held for this party. The daily warnings will list it.`
    }
    return reply(r, shown, { replay: true, ...(warning ? { warning } : {}) })
  }
  // The sheet showed another time: someone else moved it meanwhile (M-f). Never moved again on a stale screen.
  if (shown && !sameStart(shown, r.startIso)) {
    throw new PartyActionError(409, movedMeanwhile(r), { startIso: r.startIso })
  }
  if (paymentGoingThrough(r, now)) throw new PartyActionError(409, paymentWaitMessage(r, now))
  if (Date.parse(r.startIso) <= now.getTime()) throw new PartyActionError(409, STARTED_NO_MOVE)
  const from = r.startIso
  const minutes = partyMinutesOf(r)
  const toEnd = plus(to, minutes)
  // A themed table is reserved for its week: moving it to another week would need a new table.
  if (r.theme && weekKeyFor(localDate(to)) !== weekKeyFor(localDate(from))) {
    throw new PartyActionError(409, 'This party has a themed table for its week. Pick a time in the same week.', { field: 'startIso' })
  }

  let open: Awaited<ReturnType<typeof checkStart>>
  try {
    open = await checkStart(to, minutes, { admin: true, ignorePartyId: r.bookingId }, now)
  } catch (e) {
    logger.error('Party times unreadable before a move', { partyId: r.bookingId, error: String(e) })
    throw new PartyActionError(503, PARTY_TIMES_UNREADABLE)
  }
  if (!open.ok) throw new PartyActionError(409, open.message, { field: 'startIso' })

  /** Both times stay held: the record couldn't be checked, so neither may be let go. */
  const bothHeld = async (): Promise<never> => {
    await alertOwners(
      `Party move unclear: ${r.hostName}'s party ${r.bookingId} was being moved from ${partyWhenLabel(from)} to ${partyWhenLabel(to)}, and the party couldn't be checked. Both times are held for it. Open it on /admin. If it still shows ${partyWhenLabel(from)}, move it to ${partyWhenLabel(to)} again. If it shows ${partyWhenLabel(to)}, the move went through.`,
    ).catch(() => undefined)
    throw new PartyActionError(503, bothHeldMessage(from, to), { both: { from, to } })
  }
  /** The record refused or failed: if the party is now on the new time anyway, the move happened. */
  const afterFailure = async (): Promise<PartyRecord | 'not-moved'> => {
    const cur = await reread(r.bookingId)
    if (!cur) return bothHeld()
    if (sameStart(cur.startIso, to)) return cur
    return 'not-moved'
  }

  let moved: Awaited<ReturnType<typeof moveTime>>
  try {
    moved = await moveTime(r.bookingId, { startIso: from }, { startIso: to, endIso: toEnd }, open.busy, now)
  } catch (e) {
    logger.error('Party move did not finish in the party book', { partyId: r.bookingId, error: String(e) })
    const cur = await afterFailure()
    if (cur !== 'not-moved') return finishMove(cur, true)
    // The write may have landed (this request's own), and the record isn't on it: let it go.
    const freed = await letGo(r.bookingId, to)
    throw new PartyActionError(503, freed
      ? `The move didn’t finish. The party is still on ${partyWhenLabel(from)}. Try Move again.`
      : `The move didn’t finish. The party is still on ${partyWhenLabel(from)}, but ${partyWhenLabel(to)} may show as held for it. Try Move again to finish it.`)
  }
  if (!moved.ok) throw new PartyActionError(409, moved.message, { field: 'startIso' })
  const wrote = moved.wrote

  let saved: PartyRecord
  let replayed = false
  try {
    saved = await update(r.bookingId, (cur) => {
      replayed = false // a compare-and-set retry runs this again
      if (sameStart(cur.startIso, to)) { replayed = true; return null }
      if (cur.status === 'cancelled') stop(409, PARTY_CANCELLED)
      if (paymentGoingThrough(cur, now)) stop(409, paymentWaitMessage(cur, now))
      if (!sameStart(cur.startIso, from)) stop(409, CHANGED_MEANWHILE)
      return { ...cur, startIso: to, endIso: toEnd, calendarSeq: (cur.calendarSeq ?? 0) + 1 }
    }, `Moved from ${formatSlotLabel(from)} to ${formatSlotLabel(to)}`, by)
  } catch (e) {
    // Re-read before letting the new time go: the write may have landed.
    const cur = await afterFailure()
    // This request's own write landed (nobody else changes the party inside the lock): audited as its move (M-e).
    if (cur !== 'not-moved') return finishMove(cur, false)
    // Only a time this request wrote is let go; one the party already held stays (a leftover, the daily warnings name it).
    if (wrote) await letGo(r.bookingId, to)
    throw e
  }
  return finishMove(saved, replayed)

  /** The party is on the new time: the old time goes (idempotent), audited once. */
  async function finishMove(cur: PartyRecord, replay: boolean): Promise<MoveResult> {
    let warning: string | undefined
    if (!(await letGo(cur.bookingId, from))) {
      logger.error('PARTY MOVE: old time not let go', { partyId: cur.bookingId })
      warning = `${movedMessage(cur)} ${partyWhenLabel(from)} still shows as held for this party. The daily warnings will list it.`
    }
    if (!replay) await audit(by, 'party-move', cur, { from, to })
    return reply(cur, from, { ...(replay ? { replay: true as const } : {}), ...(warning ? { warning } : {}) })
  }
}

/** Someone else moved the party after the sheet loaded (M-f). */
export const movedMeanwhile = (r: PartyRecord) =>
  `Someone else moved this party to ${partyWhenLabel(r.startIso)} just now. Nothing else changed. Check it, then move it again if it still needs a new time.`

/** The record couldn't be re-read after a move: both times are held. The sheet then offers the move again. */
export const bothHeldMessage = (from: string, to: string) =>
  `The move may not have finished, and the party couldn’t be checked just now. For now both ${partyWhenLabel(from)} and ${partyWhenLabel(to)} are held for it, so nobody else can book either. In a minute, tap Finish the move. That finishes it either way.`

// ── Cancel ──────────────────────────────────────────────────────────────────

export interface CancelResult { party: AdminPartyView; hostToTell: HostToTell; message: string; replay?: true; warning?: string }

/** A cancelled party's time and themed table go (idempotent: safe again on a retry). What didn't, said plainly. */
async function letCancelledGo(rec: PartyRecord): Promise<string[]> {
  const warnings: string[] = []
  if (!(await letGo(rec.bookingId, rec.startIso))) {
    warnings.push(`${partyWhenLabel(rec.startIso)} still shows as held. Tap Cancel again to let it go, or the daily warnings will list it.`)
  }
  if (rec.theme) {
    const t = kitThemes.find((k) => k.id === rec.theme!.themeId)
    try {
      await releaseWeekClaim(t?.ledgerThemeId ?? rec.theme.themeId, weekKeyFor(localDate(rec.startIso)), rec.theme.claimRef)
    } catch (e) {
      logger.error('PARTY CANCEL: themed table not released', { partyId: rec.bookingId, error: String(e) })
      warnings.push('The themed table is still reserved for that week. Tap Cancel again to let it go.')
    }
  }
  return warnings
}

/**
 * Cancels a party of ours: status cancelled, its time let go, its themed
 * table released. Never refunds, never messages anyone. Its charges stay
 * refundable (Refund on the Payments tab). Cancelling again (a retry after a
 * reply that never came) lets the time and table go again, so nothing stays
 * held for a cancelled party.
 */
export async function cancelParty(body: { id?: unknown; note?: unknown }, by: By, request: Request, now: Date = new Date()): Promise<CancelResult> {
  return locked(body.id, request, () => cancelLocked(body, by, request, now))
}

async function cancelLocked(body: { id?: unknown; note?: unknown }, by: By, request: Request, now: Date): Promise<CancelResult> {
  const r = await writable(body.id, request)
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''
  if (r.status === 'cancelled') {
    const warnings = await letCancelledGo(r)
    const message = `Already cancelled. ${paidCents(r) > 0 ? NOTHING_REFUNDED : 'Nothing had been paid.'}`
    return {
      party: adminPartyView(r, now), hostToTell: hostOf(r), message, replay: true,
      ...(warnings.length ? { warning: `${message} ${warnings.join(' ')}` } : {}),
    }
  }
  if (paymentGoingThrough(r, now)) throw new PartyActionError(409, paymentWaitMessage(r, now))
  const saved = await update(r.bookingId, (cur) => {
    if (cur.status === 'cancelled') return null
    if (paymentGoingThrough(cur, now)) stop(409, paymentWaitMessage(cur, now))
    return { ...cur, status: 'cancelled', cancelled: { at: now.toISOString(), by, note } }
  }, `Cancelled${note ? `: ${note}` : ''}. Nothing was refunded`, by)
  const warnings = await letCancelledGo(saved)
  await audit(by, 'party-cancel', saved, { note: note || null, refunded: false })
  return {
    party: adminPartyView(saved, now), hostToTell: hostOf(saved), message: cancelledMessage(saved),
    ...(warnings.length ? { warning: `${cancelledMessage(saved)} ${warnings.join(' ')}` } : {}),
  }
}

// ── Extras ──────────────────────────────────────────────────────────────────

export interface ExtraResult { party: AdminPartyView; item: PartyItem; message: string; replay?: true; warning?: string }

/**
 * Adds an extra (due until paid). `createKey` (minted by the sheet) makes a
 * retry find the first try's item. Extra time grows the hold first, checked
 * against the shared schedule; a record that then refuses shrinks it back.
 */
export async function addPartyExtra(
  body: { id?: unknown; addOnId?: unknown; count?: unknown; forGuests?: unknown; createKey?: unknown }, by: By, request: Request, now: Date = new Date(),
): Promise<ExtraResult> {
  return locked(body.id, request, () => addExtraLocked(body, by, request, now))
}

async function addExtraLocked(
  body: { id?: unknown; addOnId?: unknown; count?: unknown; forGuests?: unknown; createKey?: unknown }, by: By, request: Request, now: Date,
): Promise<ExtraResult> {
  const r = await writable(body.id, request)
  notCancelled(r)
  if (typeof body.createKey !== 'string' || !CREATE_KEY_RE.test(body.createKey)) throw new PartyActionError(400, 'Reload the page and try again.')
  const itemId = idFor('itm', `${r.bookingId}:${body.createKey}`)
  const already = r.items?.find((it) => it.id === itemId)
  if (already) return { party: adminPartyView(r, now), item: already, message: addedMessage(already), replay: true }
  if (typeof body.addOnId !== 'string' || !body.addOnId) throw new PartyActionError(400, 'Pick an extra.', { field: 'addOnId' })
  const addOnId = body.addOnId
  const count = typeof body.count === 'number' ? body.count : Number.NaN
  const forGuests = body.forGuests === undefined || body.forGuests === null ? undefined : (typeof body.forGuests === 'number' ? body.forGuests : Number.NaN)

  let settings: Awaited<ReturnType<typeof getPartySettings>>
  try {
    settings = await getPartySettings({ strict: true })
  } catch {
    throw new PartyActionError(503, UNREACHABLE)
  }
  const q = quoteAddOn(settings, r, addOnId, count, forGuests)
  if (!q.ok) throw new PartyActionError(400, q.error, { field: q.field })
  const extra = q.value.extraMinutes
  const oldEnd = endOf(r)
  const newEnd = plus(oldEnd, extra)

  if (extra > 0) {
    if (Date.parse(r.startIso) <= now.getTime()) throw new PartyActionError(409, STARTED)
    let open: Awaited<ReturnType<typeof checkStart>>
    try {
      open = await checkStart(r.startIso, partyMinutesOf(r) + extra, { admin: true, ignorePartyId: r.bookingId }, now)
    } catch (e) {
      logger.error('Party times unreadable before adding extra time', { partyId: r.bookingId, error: String(e) })
      throw new PartyActionError(503, PARTY_TIMES_UNREADABLE)
    }
    if (!open.ok) throw new PartyActionError(409, open.message, { field: `addOns.${addOnId}` })
    let grown: Awaited<ReturnType<typeof resizeTime>>
    try {
      grown = await resizeTime(r.bookingId, r.startIso, newEnd, open.busy, now)
    } catch (e) {
      logger.error('Party extra time not written in the party book', { partyId: r.bookingId, error: String(e) })
      throw new PartyActionError(503, 'The extra time didn’t go on. Nothing changed. Try again.')
    }
    if (!grown.ok) throw new PartyActionError(409, grown.message, { field: `addOns.${addOnId}` })
  }

  const at = now.toISOString()
  let item!: PartyItem
  let replay = false
  let saved: PartyRecord
  try {
    saved = await update(r.bookingId, (cur) => {
      const found = cur.items?.find((it) => it.id === itemId)
      if (found) { item = found; replay = true; return null }
      if (cur.status === 'cancelled') stop(409, PARTY_CANCELLED)
      if (endOf(cur) !== oldEnd || cur.startIso !== r.startIso) stop(409, CHANGED_MEANWHILE)
      // Priced again on the party as it is now (another extra may have landed meanwhile).
      const again = quoteAddOn(settings, cur, addOnId, count, forGuests)
      if (!again.ok) stop(400, again.error, { field: again.field })
      const value = (again as Extract<typeof again, { ok: true }>).value
      item = { ...value, id: itemId, chargeId: null, addedAt: at, by }
      return {
        ...cur,
        items: [...(cur.items ?? []), item],
        endIso: newEnd,
        durationMinutes: (cur.durationMinutes ?? partyMinutesOf(cur)) + extra,
        ...(extra > 0 ? { calendarSeq: (cur.calendarSeq ?? 0) + 1 } : {}),
      }
    }, `Added ${q.value.label}${q.value.topUp ? ` for ${q.value.forGuests} more guests` : ''}`, by)
  } catch (e) {
    if (extra > 0) {
      // Back to the party's end as saved now (another extra may have grown it meanwhile); unreadable → leave it longer (safe).
      try {
        const cur = await getPartyRecord(r.bookingId)
        if (cur && cur.startIso === r.startIso) await resizeTime(r.bookingId, r.startIso, endOf(cur), [], now)
      } catch (err) {
        logger.error('PARTY EXTRA: hold not shrunk back after the record refused', { partyId: r.bookingId, error: String(err) })
      }
    }
    throw e
  }
  if (replay) return { party: adminPartyView(saved, now), item, message: addedMessage(item), replay: true }
  await audit(by, 'party-extra', saved, { added: item.label, cents: item.cents, extraMinutes: extra })
  return { party: adminPartyView(saved, now), item, message: addedMessage(item) }
}

/** Takes an unpaid extra off (never a paid one, nor one a payment going through is paying for); extra time shrinks the hold. */
export async function removePartyExtra(body: { id?: unknown; itemId?: unknown }, by: By, request: Request, now: Date = new Date()): Promise<ExtraResult> {
  return locked(body.id, request, () => removeExtraLocked(body, by, request, now))
}

async function removeExtraLocked(body: { id?: unknown; itemId?: unknown }, by: By, request: Request, now: Date): Promise<ExtraResult> {
  const r = await writable(body.id, request)
  notCancelled(r)
  if (typeof body.itemId !== 'string' || !body.itemId) throw new PartyActionError(400, 'Pick the extra to take off.')
  const itemId = body.itemId
  let removed!: PartyItem
  const saved = await update(r.bookingId, (cur) => {
    if (cur.status === 'cancelled') stop(409, PARTY_CANCELLED)
    const it = cur.items?.find((x) => x.id === itemId)
    if (!it || it.kind !== 'addon') stop(404, 'That extra isn’t on this party.')
    if (it!.chargeId !== null) stop(409, PAID_EXTRA)
    if (paymentGoingThrough(cur, now) && cur.paying?.itemIds?.includes(itemId)) stop(409, paymentWaitMessage(cur, now))
    removed = it!
    const extra = it!.extraMinutes
    return {
      ...cur,
      items: (cur.items ?? []).filter((x) => x.id !== itemId),
      endIso: plus(endOf(cur), -extra),
      durationMinutes: Math.max(0, (cur.durationMinutes ?? partyMinutesOf(cur)) - extra),
      ...(extra > 0 ? { calendarSeq: (cur.calendarSeq ?? 0) + 1 } : {}),
    }
  }, 'Took off an extra', by)
  let warning: string | undefined
  if (removed.extraMinutes > 0) {
    try {
      const shrunk = await resizeTime(saved.bookingId, saved.startIso, endOf(saved), [], now)
      if (!shrunk.ok) throw new Error(shrunk.message)
    } catch (e) {
      logger.error('PARTY EXTRA: hold not shrunk after taking extra time off', { partyId: saved.bookingId, error: String(e) })
      warning = 'Taken off. The party’s time still shows the extra time on the calendar; the daily warnings will list it.'
    }
  }
  await audit(by, 'party-extra', saved, { removed: removed.label, cents: removed.cents, extraMinutes: -removed.extraMinutes })
  return { party: adminPartyView(saved, now), item: removed, message: `Took off ${removed.label}. Nothing was charged for it.`, ...(warning ? { warning } : {}) }
}

// ── Details ─────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Host name, phone and email; guests (within the package's range; the prices
 * of what was bought don't change); the craft (from the catalog). Only what
 * is sent changes.
 */
export async function editPartyDetails(
  body: { id?: unknown; hostName?: unknown; hostPhone?: unknown; hostEmail?: unknown; guests?: unknown; craftId?: unknown }, by: By, request: Request, now: Date = new Date(),
): Promise<{ party: AdminPartyView; message: string; sendDetails?: SendDetailsOffer; warning?: string }> {
  const r = await writable(body.id, request)
  notCancelled(r)
  const patch: Partial<PartyRecord> = {}
  const said: string[] = []
  if (body.hostName !== undefined) {
    const name = typeof body.hostName === 'string' ? body.hostName.trim().replace(/\s+/g, ' ') : ''
    if (!name || name.length > 100) throw new PartyActionError(400, 'Add the host’s name.', { field: 'hostName' })
    if (name !== r.hostName) { patch.hostName = name; said.push('host name') }
  }
  if (body.hostEmail !== undefined) {
    const email = typeof body.hostEmail === 'string' ? body.hostEmail.trim() : ''
    if (!EMAIL_RE.test(email) || email.length > 200) throw new PartyActionError(400, 'Check the email address.', { field: 'hostEmail' })
    if (email !== r.hostEmail) { patch.hostEmail = email; said.push('email') }
  }
  if (body.hostPhone !== undefined) {
    const phone = typeof body.hostPhone === 'string' ? body.hostPhone.trim() : ''
    if (phone.replace(/\D/g, '').length < 10 || phone.length > 40) throw new PartyActionError(400, 'Add a phone number with the area code.', { field: 'hostPhone' })
    if (phone !== (r.hostPhone ?? '')) { patch.hostPhone = phone; said.push('phone') }
  }
  if (body.guests !== undefined) {
    let settings: Awaited<ReturnType<typeof getPartySettings>>
    try {
      settings = await getPartySettings({ strict: true })
    } catch {
      throw new PartyActionError(503, UNREACHABLE)
    }
    const pkg = settings.packages.find((p) => p.id === r.packageId)
    const lo = pkg?.minGuests ?? 1
    const hi = pkg?.maxGuests ?? 60
    const g = body.guests
    if (typeof g !== 'number' || !Number.isInteger(g) || g < lo || g > hi) {
      throw new PartyActionError(400, `Parties are for ${lo} to ${hi} guests.`, { field: 'guests' })
    }
    if (g !== r.guestCount) { patch.guestCount = g; said.push(`guests ${r.guestCount} → ${g}`) }
  }
  if (body.craftId !== undefined) {
    if (typeof body.craftId !== 'string' || !body.craftId) throw new PartyActionError(400, 'Pick a craft.', { field: 'craftId' })
    let craft: Awaited<ReturnType<typeof findPartyCraft>>
    try {
      craft = await findPartyCraft(body.craftId)
    } catch {
      throw new PartyActionError(503, 'The crafts couldn’t be loaded. Try again.')
    }
    if (!craft) throw new PartyActionError(404, 'That craft isn’t available any more. Pick another craft.', { field: 'craftId' })
    if (craft.id !== r.craftId || craft.name !== r.craftName) { patch.craftId = craft.id; patch.craftName = craft.name; said.push(`craft ${craft.name}`) }
  }
  if (said.length === 0) return { party: adminPartyView(r, now), message: 'Nothing changed.' }
  const saved = await update(r.bookingId, (cur) => {
    if (cur.status === 'cancelled') stop(409, PARTY_CANCELLED)
    // The calendar file's SEQUENCE: a re-sent invite replaces the old one in Apple and Outlook (N3).
    return { ...cur, ...patch, calendarSeq: (cur.calendarSeq ?? 0) + 1 }
  }, `Changed ${said.join(', ')}`, by)
  await audit(by, 'party-edit', saved, { changed: said.join('; ').slice(0, 300) })
  // More guests than a per-guest extra covers: the new guests don't have it until it's added for them (S2-R4a).
  const added = (patch.guestCount ?? r.guestCount) - r.guestCount
  const perGuest = added > 0 ? [...new Set((saved.items ?? []).filter((it) => it.kind === 'addon' && it.forGuests !== undefined).map((it) => it.label))] : []
  const warning = perGuest.length
    ? `Saved. ${perGuest.join(' and ')} ${perGuest.length === 1 ? 'is' : 'are'} paid for ${r.guestCount} guests. To cover the ${added} new ${added === 1 ? 'guest' : 'guests'}, use + Add an extra.`
    : undefined
  // The host's confirmation still shows the old details: the owner may email the new ones (never automatic, S2-R7).
  return { party: adminPartyView(saved, now), message: 'Saved.', sendDetails: sendDetailsOffer(saved, true), ...(warning ? { warning } : {}) }
}

// ── Payment link ────────────────────────────────────────────────────────────

/** Emails and texts the host the payment link (again, when asked). */
export async function sendPartyLink(body: { id?: unknown }, by: By, request: Request, now: Date = new Date()) {
  const r = await writable(body.id, request)
  notCancelled(r)
  let sent: Awaited<ReturnType<typeof sendPaymentLink>>
  try {
    sent = await sendPaymentLink(r, new URL(request.url).origin, by)
  } catch (e) {
    if (e instanceof PaymentLinkError) throw new PartyActionError(409, e.message)
    throw e
  }
  await audit(by, 'party-link', sent.rec, { email: sent.email, text: sent.text, dueCents: dueCents(sent.rec) })
  const message = linkMessage(sent.rec, dueCents(sent.rec), sent.email, sent.text)
  return {
    party: adminPartyView(sent.rec, now), url: sent.url, email: sent.email, text: sent.text, message,
    ...(!sent.email && !sent.text ? { warning: message } : {}),
  }
}

// ── Email the host the details ──────────────────────────────────────────────

/**
 * What the re-sent confirmation says about money (D1: studio fee and extras;
 * crafts at the studio). Something still to pay always comes with the
 * payment link (M-d); with no link there is no such line.
 */
export function detailsCostNote(r: PartyRecord, origin: string): { costNote: string; pay?: { url: string; label: string } } {
  const due = dueCents(r)
  if (due > 0) {
    if (!r.payToken) return { costNote: '' }
    return { costNote: `There’s ${formatMoney(due)} still to pay for ${whatIsDue(r)}.`, pay: { url: payLinkUrl(origin, r), label: `Pay ${formatMoney(due)}` } }
  }
  return { costNote: paidCents(r) > 0 ? 'Nothing is due before your party.' : '' }
}

/** The start the host was last told about: the last details email that went, else the first confirmation. */
export function lastToldStart(r: PartyRecord, exceptKey?: string): string | null {
  const sent = (r.detailsSent ?? []).filter((d) => d.sent === true && d.key !== exceptKey)
  if (sent.length) return sent[sent.length - 1].startIso
  return r.confirmation?.sent && r.confirmation.startIso ? r.confirmation.startIso : null
}

export interface SendDetailsResult { party: AdminPartyView; sent: boolean | null; message: string; replay?: true; warning?: string }

const detailsMessage = (r: PartyRecord, sent: boolean | null): string => (sent === true
  ? `Emailed ${firstOf(r)} the party details for ${partyWhenLabel(r.startIso)}, with a new calendar invite.`
  : sent === false
    ? `The email to ${firstOf(r)} didn’t go out. Check the email address on the party, then tap Email ${firstOf(r)} the details again.`
    : `That email may not have gone out. Tap Email ${firstOf(r)} the details again to send it.`)

/**
 * "Email Stefanie the new details": re-sends the party confirmation with the
 * party as it is now (time, craft, host page, invite link) and a fresh
 * calendar file. Only when an owner taps it (S2-R7: nothing is sent
 * automatically after a move or an edit). Also how a party booked by phone
 * and paid at the counter gets its confirmation.
 *
 * One email per tap: `createKey` (minted by the sheet for each tap) is noted
 * on the party before anything is sent, so a double tap or a retry of the
 * same tap answers the first one's result and never sends twice.
 */
export async function sendPartyDetails(body: { id?: unknown; createKey?: unknown }, by: By, request: Request, now: Date = new Date()): Promise<SendDetailsResult> {
  const r = await writable(body.id, request)
  notCancelled(r)
  if (typeof body.createKey !== 'string' || !CREATE_KEY_RE.test(body.createKey)) throw new PartyActionError(400, 'Reload the page and try again.')
  const key = body.createKey
  const answer = (rec: PartyRecord, sent: boolean | null, replay: boolean): SendDetailsResult => {
    const message = detailsMessage(rec, sent)
    return { party: adminPartyView(rec, now), sent, message, ...(replay ? { replay: true as const } : {}), ...(sent !== true ? { warning: message } : {}) }
  }
  const prior = r.detailsSent?.find((d) => d.key === key)
  if (prior) return answer(r, prior.sent, true)

  let mine = false
  const at = now.toISOString()
  const claimed = await update(r.bookingId, (cur) => {
    mine = false // a compare-and-set retry runs this again
    if (cur.detailsSent?.some((d) => d.key === key)) return null
    if (cur.status === 'cancelled') stop(409, PARTY_CANCELLED)
    mine = true
    return { ...cur, detailsSent: [...(cur.detailsSent ?? []), { key, at, by, startIso: cur.startIso, sent: null }].slice(-20) }
  }, 'Emailing the party details', by)
  if (!mine) return answer(claimed, claimed.detailsSent?.find((d) => d.key === key)?.sent ?? null, true)

  let minGuests: number | undefined
  try {
    minGuests = (await getPartySettings()).packages.find((p) => p.id === claimed.packageId)?.minGuests
  } catch { /* the config's minimum stands in */ }
  const last = claimed.charges?.length ? claimed.charges[claimed.charges.length - 1] : null
  const origin = new URL(request.url).origin
  // Moved since the host was last told: the email names the old time, and its subject says the time changed (N3).
  const told = lastToldStart(claimed, key)
  const sent = await sendPartyBookedEmail({
    partyId: claimed.bookingId, rec: claimed, draft: claimed, firstName: claimed.hostName.split(' ')[0] ?? '', email: claimed.hostEmail,
    origin, chargedCents: paidCents(claimed), receiptUrl: last?.receiptUrl ?? null,
    themeName: claimed.theme?.displayName, ...(minGuests ? { minGuests } : {}),
    updated: { ...detailsCostNote(claimed, origin), ...(told && !sameStart(told, claimed.startIso) ? { moved: { from: partyWhenLabel(told), to: partyWhenLabel(claimed.startIso) } } : {}) },
  })
  let saved = claimed
  try {
    saved = await updatePartyRecord(claimed.bookingId, (cur) => ({
      ...cur,
      detailsSent: (cur.detailsSent ?? []).map((d) => (d.key === key ? { ...d, sent } : d)),
      // A party that never had its confirmation (booked by phone) has it now: its first payment sends a plain receipt.
      ...(sent && !cur.confirmation ? { confirmation: { at, sent: true, startIso: claimed.startIso } } : {}),
    }), sent ? 'Party details emailed' : 'Party details email did not send', by)
  } catch (e) {
    logger.error('Party details email result not noted', { partyId: claimed.bookingId, error: String(e) })
  }
  await audit(by, 'party-details', saved, { sent, startIso: claimed.startIso })
  return answer(saved, sent, false)
}

// ── Parties setup: what a save takes away ───────────────────────────────────

/** Studio-local 'HH:MM' of a start. */
function localHhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: partyConfig.timezone, hour: '2-digit', minute: '2-digit', hour12: false })
}

export interface BookedOnRemoved { partyId: string; hostName: string; startIso: string; label: string }

/**
 * Parties of ours still to come whose start was a party time before the save
 * and isn't after it (a start or a whole day taken away). They stay booked.
 * Throws when the party book can't be read.
 */
export async function bookedOnRemovedStarts(before: PartyTimes, after: PartyTimes, now: Date = new Date()): Promise<BookedOnRemoved[]> {
  const to = new Date(now.getTime() + 400 * 86_400_000).toISOString()
  const holds = await holdsBetween(now.toISOString(), to, now)
  const out: BookedOnRemoved[] = []
  for (const h of holds) {
    if (Date.parse(h.startIso) <= now.getTime()) continue
    const ymd = localDate(h.startIso)
    const hhmm = localHhmm(h.startIso)
    if (!startsOn(before, ymd).includes(hhmm) || startsOn(after, ymd).includes(hhmm)) continue
    const rec = await getPartyRecord(h.partyId).catch(() => null)
    // Only parties really on the books: a cancelled one, or a time held for a checkout still running, isn't.
    if (!rec || rec.status === 'cancelled') continue
    out.push({ partyId: h.partyId, hostName: rec.hostName, startIso: h.startIso, label: partyWhenLabel(h.startIso) })
  }
  return out
}

// ── Route replies ───────────────────────────────────────────────────────────

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** `{ data, warning? }` on success; `{ error, ...extra }` with the action's status; 503 when storage fails. */
export async function partyReply(fn: () => Promise<object>): Promise<Response> {
  try {
    const { warning, ...data } = (await fn()) as { warning?: string } & Record<string, unknown>
    return json(200, { data, ...(warning ? { warning } : {}) })
  } catch (e) {
    if (e instanceof PartyActionError) return json(e.status, { error: e.message, ...e.extra })
    const msg = e instanceof Error ? e.message : String(e)
    if (/^Concurrent update/.test(msg)) return json(409, { error: 'Someone else saved at the same moment. Try again.' })
    logger.error('Party action failed', { error: msg })
    return json(503, { error: UNREACHABLE })
  }
}
