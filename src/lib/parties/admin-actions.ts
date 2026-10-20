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
import { formatSlotLabel } from '@lib/studio-time'
import type { By } from '@lib/staff-auth'
import {
  getPartyRecord, isOurs, PartyNotFoundError, updatePartyRecord,
  type PartyItem, type PartyRecord,
} from '@lib/party-store'
import { dueCents, paymentState } from './money'
import { checkStart, PARTY_TIMES_UNREADABLE } from './open-times'
import { holdsBetween, moveTime, releaseTime, resizeTime } from './party-book'
import { localDate, startsOn } from './party-times'
import { PaymentLinkError, sendPaymentLink } from './payment-link'
import { quoteAddOn } from './pricing'
import { describePartyRequest, partyLabel } from './refunds'
import { getPartySettings } from './settings-store'
import { partyWritesRefusal } from './test-site'
import type { PartyTimes } from './types'

const logger = createLogger('parties:admin')
const MINUTE = 60_000

export const LEGACY_PARTY = 'This party was booked in Square. Change it there.'
export const NO_SUCH_PARTY = 'That party does not exist.'
export const PAYMENT_GOING_THROUGH = 'A payment is going through. Try again in a few minutes.'
export const PARTY_CANCELLED = 'This party was cancelled.'
export const NOTHING_REFUNDED = 'Nothing was refunded.'
export const PAID_EXTRA = 'That extra is paid. Use Refund on the Payments tab if they should get money back.'
export const UNREACHABLE = "The party couldn't be reached. Try again."
export const SAME_TIME = "That's already this party's time."
export const STARTED = 'This party has already started, so its time can’t change.'
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
  cancelled: PartyRecord['cancelled'] | null
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
    cancelled: r.cancelled ?? null,
  }
}

/** The party's saved refund requests as the sheet shows them; null when they can't be read. */
export async function partyRefundRequests(id: string): Promise<ReturnType<typeof describePartyRequest>[] | null> {
  try {
    return (await listRefundRequests(PARTY_SCOPE, id)).map(describePartyRequest)
  } catch (e) {
    logger.warn('Party refund requests unreadable', { partyId: id, error: String(e) })
    return null
  }
}

// ── Move ────────────────────────────────────────────────────────────────────

export interface MoveResult { party: AdminPartyView; hostToTell: HostToTell; from: string; to: string; warning?: string }

/**
 * Moves a party of ours to `startIso` (its length kept). Order: the new time
 * is written in the party book (locked, checked), then the record (only if
 * it still has the old start and no payment is going through), then the old
 * time is let go. A record that refuses lets the new time go again.
 */
export async function moveParty(body: { id?: unknown; startIso?: unknown }, by: By, request: Request, now: Date = new Date()): Promise<MoveResult> {
  const r = await writable(body.id, request)
  notCancelled(r)
  if (paymentGoingThrough(r, now)) throw new PartyActionError(409, PAYMENT_GOING_THROUGH)
  const toMs = typeof body.startIso === 'string' ? Date.parse(body.startIso) : NaN
  if (!Number.isFinite(toMs)) throw new PartyActionError(400, 'Pick the new time.', { field: 'startIso' })
  const from = r.startIso
  const to = new Date(toMs).toISOString()
  if (toMs === Date.parse(from)) throw new PartyActionError(400, SAME_TIME, { field: 'startIso' })
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

  let moved: Awaited<ReturnType<typeof moveTime>>
  try {
    moved = await moveTime(r.bookingId, { startIso: from }, { startIso: to, endIso: toEnd }, open.busy, now)
  } catch (e) {
    // It may or may not have been written: try to let the new time go. A retry finishes the move either way.
    logger.error('Party move did not finish in the party book', { partyId: r.bookingId, error: String(e) })
    const freed = await releaseTime(r.bookingId, to).then(() => true, () => false)
    throw new PartyActionError(503, freed
      ? `The move didn’t finish. The party is still on ${formatSlotLabel(from)}. Try Move again.`
      : `The move didn’t finish. The party is still on ${formatSlotLabel(from)}, but ${formatSlotLabel(to)} may show as held for it. Try Move again to finish it.`)
  }
  if (!moved.ok) throw new PartyActionError(409, moved.message, { field: 'startIso' })

  let saved: PartyRecord
  try {
    saved = await update(r.bookingId, (cur) => {
      if (cur.status === 'cancelled') stop(409, PARTY_CANCELLED)
      if (paymentGoingThrough(cur, now)) stop(409, PAYMENT_GOING_THROUGH)
      if (Date.parse(cur.startIso) !== Date.parse(from)) stop(409, CHANGED_MEANWHILE)
      return { ...cur, startIso: to, endIso: toEnd }
    }, `Moved from ${formatSlotLabel(from)} to ${formatSlotLabel(to)}`, by)
  } catch (e) {
    // The party stays where it was: let the new time go.
    await releaseTime(r.bookingId, to).catch((err) => logger.error('PARTY MOVE: new time not let go after the record refused', { partyId: r.bookingId, error: String(err) }))
    throw e
  }
  let warning: string | undefined
  try {
    await releaseTime(r.bookingId, from)
  } catch (e) {
    logger.error('PARTY MOVE: old time not let go', { partyId: r.bookingId, error: String(e) })
    warning = `Moved. ${formatSlotLabel(from)} still shows as held for this party; the daily warnings will list it.`
  }
  await audit(by, 'party-move', saved, { from, to })
  return { party: adminPartyView(saved, now), hostToTell: hostOf(saved), from, to, ...(warning ? { warning } : {}) }
}

// ── Cancel ──────────────────────────────────────────────────────────────────

export interface CancelResult { party: AdminPartyView; hostToTell: HostToTell; message: string; replay?: true; warning?: string }

/**
 * Cancels a party of ours: status cancelled, its time let go, its themed
 * table released. Never refunds, never messages anyone. Its charges stay
 * refundable (Refund on the Payments tab).
 */
export async function cancelParty(body: { id?: unknown; note?: unknown }, by: By, request: Request, now: Date = new Date()): Promise<CancelResult> {
  const r = await writable(body.id, request)
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''
  if (r.status === 'cancelled') {
    return { party: adminPartyView(r, now), hostToTell: hostOf(r), message: `Already cancelled. ${NOTHING_REFUNDED}`, replay: true }
  }
  if (paymentGoingThrough(r, now)) throw new PartyActionError(409, PAYMENT_GOING_THROUGH)
  const saved = await update(r.bookingId, (cur) => {
    if (cur.status === 'cancelled') return null
    if (paymentGoingThrough(cur, now)) stop(409, PAYMENT_GOING_THROUGH)
    return { ...cur, status: 'cancelled', cancelled: { at: now.toISOString(), by, note } }
  }, `Cancelled${note ? `: ${note}` : ''}. Nothing was refunded`, by)
  const warnings: string[] = []
  try {
    await releaseTime(saved.bookingId, saved.startIso)
  } catch (e) {
    logger.error('PARTY CANCEL: time not let go', { partyId: saved.bookingId, error: String(e) })
    warnings.push(`${formatSlotLabel(saved.startIso)} still shows as held; the daily warnings will list it.`)
  }
  if (saved.theme) {
    const t = kitThemes.find((k) => k.id === saved.theme!.themeId)
    try {
      await releaseWeekClaim(t?.ledgerThemeId ?? saved.theme.themeId, weekKeyFor(localDate(saved.startIso)), saved.theme.claimRef)
    } catch (e) {
      logger.error('PARTY CANCEL: themed table not released', { partyId: saved.bookingId, error: String(e) })
      warnings.push('The themed table is still reserved for that week.')
    }
  }
  await audit(by, 'party-cancel', saved, { note: note || null, refunded: false })
  return {
    party: adminPartyView(saved, now), hostToTell: hostOf(saved), message: `Cancelled. ${NOTHING_REFUNDED}`,
    ...(warnings.length ? { warning: `Cancelled. ${NOTHING_REFUNDED} ${warnings.join(' ')}` } : {}),
  }
}

// ── Extras ──────────────────────────────────────────────────────────────────

export interface ExtraResult { party: AdminPartyView; item: PartyItem; replay?: true; warning?: string }

/**
 * Adds an extra (due until paid). `createKey` (minted by the sheet) makes a
 * retry find the first try's item. Extra time grows the hold first, checked
 * against the shared schedule; a record that then refuses shrinks it back.
 */
export async function addPartyExtra(
  body: { id?: unknown; addOnId?: unknown; count?: unknown; forGuests?: unknown; createKey?: unknown }, by: By, request: Request, now: Date = new Date(),
): Promise<ExtraResult> {
  const r = await writable(body.id, request)
  notCancelled(r)
  if (typeof body.createKey !== 'string' || !CREATE_KEY_RE.test(body.createKey)) throw new PartyActionError(400, 'Reload the page and try again.')
  const itemId = idFor('itm', `${r.bookingId}:${body.createKey}`)
  const already = r.items?.find((it) => it.id === itemId)
  if (already) return { party: adminPartyView(r, now), item: already, replay: true }
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
      }
    }, `Added ${q.value.label}${q.value.topUp ? ` for ${q.value.forGuests} more guests` : ''}`, by)
  } catch (e) {
    if (extra > 0) {
      await resizeTime(r.bookingId, r.startIso, oldEnd, [], now)
        .catch((err) => logger.error('PARTY EXTRA: hold not shrunk back after the record refused', { partyId: r.bookingId, error: String(err) }))
    }
    throw e
  }
  if (replay) return { party: adminPartyView(saved, now), item, replay: true }
  await audit(by, 'party-extra', saved, { added: item.label, cents: item.cents, extraMinutes: extra })
  return { party: adminPartyView(saved, now), item }
}

/** Takes an unpaid extra off (never a paid one, nor one a payment going through is paying for); extra time shrinks the hold. */
export async function removePartyExtra(body: { id?: unknown; itemId?: unknown }, by: By, request: Request, now: Date = new Date()): Promise<ExtraResult> {
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
    if (paymentGoingThrough(cur, now) && cur.paying?.itemIds?.includes(itemId)) stop(409, PAYMENT_GOING_THROUGH)
    removed = it!
    const extra = it!.extraMinutes
    return {
      ...cur,
      items: (cur.items ?? []).filter((x) => x.id !== itemId),
      endIso: plus(endOf(cur), -extra),
      durationMinutes: Math.max(0, (cur.durationMinutes ?? partyMinutesOf(cur)) - extra),
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
  return { party: adminPartyView(saved, now), item: removed, ...(warning ? { warning } : {}) }
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
): Promise<{ party: AdminPartyView }> {
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
  if (said.length === 0) return { party: adminPartyView(r, now) }
  const saved = await update(r.bookingId, (cur) => {
    if (cur.status === 'cancelled') stop(409, PARTY_CANCELLED)
    return { ...cur, ...patch }
  }, `Changed ${said.join(', ')}`, by)
  await audit(by, 'party-edit', saved, { changed: said.join('; ').slice(0, 300) })
  return { party: adminPartyView(saved, now) }
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
  return {
    party: adminPartyView(sent.rec, now), url: sent.url, email: sent.email, text: sent.text,
    ...(!sent.email && !sent.text ? { warning: 'The link didn’t go out by email or text. Copy it and send it yourself.' } : {}),
  }
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
    if (rec?.status === 'cancelled') continue
    out.push({ partyId: h.partyId, hostName: rec?.hostName ?? '', startIso: h.startIso, label: formatSlotLabel(h.startIso) })
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
