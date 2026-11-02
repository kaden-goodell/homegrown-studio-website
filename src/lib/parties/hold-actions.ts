/**
 * The owners' buttons for the party book's warnings (stage 2 Task 13 fix
 * round). Each one is a plain, safe repair that Catherine can press herself:
 *
 *   partyHoldState(r)    what the party sheet offers: "Hold this time again"
 *                        (a booked party whose time, or extra time, isn't
 *                        held), "Free this time" (a cancelled party still
 *                        holding a time), "Free the old time" (a leftover hold
 *                        after a move). Read only.
 *   holdPartyAgain       re-holds the party's CURRENT time only (never another
 *                        time), checked like any hold: a time someone else has
 *                        taken since is refused with the clash named. No host
 *                        message (nothing changed for them).
 *   freePartyTime        lets go of one held time of this party that it isn't
 *                        on: a cancelled party's, or a booked party's old time.
 *                        Never the time a booked party is on. Refused while a
 *                        payment is going through (a late payment could rebuild
 *                        the hold). No host message, no money.
 *   freeOrphanHold       To decide's "Free this time" for a held time with no
 *                        party record at all: only once the hold is older than
 *                        the checkout hold window plus a margin (so it can't be
 *                        a payment in progress) and no checkout of any kind is
 *                        attached to it. The CALLER holds the party lock.
 *
 * All of them run inside the party's lock (withPartyLock, via `locked`), are
 * refused on a test site sharing the live stores (R41: partyWritesRefusal and
 * the party book's own guard), are idempotent, and are audited.
 *
 * MERGE NOTE (kaden/admin-d b33d7d6): call `await assertPartyLockHeld()`
 * right before every party-book write here (holdAgain in holdPartyAgain,
 * releaseTime in freePartyTime and freeOrphanHold).
 *
 * Server only.
 */
import { recordAudit } from '@lib/audit'
import { HOLD_MINUTES } from '@lib/booking-core/charge'
import { createLogger } from '@lib/logger'
import { getPartyRecord, isOurs, partyEndIso, type PartyRecord } from '@lib/party-store'
import type { By } from '@lib/staff-auth'
import {
  adminPartyView, audit, locked, notCancelled, PartyActionError, paymentGoingThrough, paymentWaitMessage, writable,
  type AdminPartyView,
} from './admin-actions'
import { holdAgain } from './hold-again'
import { holdsBetween, releaseTime, type PartyHold } from './party-book'
import { listCheckouts } from './party-checkouts'
import { partyWhenLabel } from './payment-link'

const logger = createLogger('parties:hold-actions')
const DAY_MS = 86_400_000
/** How far either side of a party's time its other holds are looked for (a move goes at most this far). */
const AROUND_DAYS = 60
/** A held time with no party: freeable only once it is older than the checkout hold window plus this margin. */
export const ORPHAN_MIN_AGE_MS = (HOLD_MINUTES + 5) * 60_000

const same = (a: string, b: string) => Date.parse(a) === Date.parse(b)
const firstOf = (name: string) => name.trim().split(/\s+/)[0] || 'the host'
/** Held for a booking or a payment link, not a short hold while someone is paying. */
export const lastingHold = (h: PartyHold) => h.state === 'booked' || h.holdExpiresAt === null

export const CALENDAR_UNREADABLE = 'The calendar couldn’t be checked just now. Try again in a minute. Nothing was changed.'
export const ALREADY_FREE = 'That time is already free.'

// ── What the sheet offers ───────────────────────────────────────────────────

export interface FreeableHold {
  startIso: string
  /** cancelled: a cancelled party's time; leftover: a booked party's old time after a move */
  why: 'cancelled' | 'leftover'
}
export interface PartyHoldState {
  /** a booked party of ours, still to come, whose time isn't held ('missing') or whose extra time isn't ('short') */
  notHeld: 'missing' | 'short' | null
  /** held times of this party it isn't on (still to come) */
  freeable: FreeableHold[]
}

/** The party book's view of this party, for its sheet. Null for a Square-booked party or when the book can't be read. */
export async function partyHoldState(r: PartyRecord, now: Date = new Date()): Promise<PartyHoldState | null> {
  if (!isOurs(r)) return null
  const t = Date.parse(r.startIso)
  let holds: PartyHold[]
  try {
    holds = (await holdsBetween(new Date(t - AROUND_DAYS * DAY_MS).toISOString(), new Date(t + AROUND_DAYS * DAY_MS).toISOString(), now))
      .filter((h) => h.partyId === r.bookingId && Date.parse(h.endIso) > now.getTime())
  } catch (e) {
    logger.warn('Party book unreadable for the sheet', { partyId: r.bookingId, error: String(e) })
    return null
  }
  const cancelled = r.status === 'cancelled'
  let notHeld: PartyHoldState['notHeld'] = null
  if (!cancelled && t > now.getTime()) {
    const mine = holds.find((h) => same(h.startIso, r.startIso))
    const end = partyEndIso(r)
    if (!mine) notHeld = 'missing'
    else if (end && Date.parse(mine.endIso) < Date.parse(end)) notHeld = 'short'
  }
  const freeable = holds
    .filter((h) => cancelled || !same(h.startIso, r.startIso))
    .map((h): FreeableHold => ({ startIso: h.startIso, why: cancelled ? 'cancelled' : 'leftover' }))
    .sort((a, b) => a.startIso.localeCompare(b.startIso))
  return { notHeld, freeable }
}

// ── Hold this time again ────────────────────────────────────────────────────

export interface HoldActionResult { party: AdminPartyView; message: string; replay?: true }

/** "Hold this time again": the party's current time back in the party book, checked; never a move. */
export async function holdPartyAgain(body: { id?: unknown }, by: By, request: Request, now: Date = new Date()): Promise<HoldActionResult> {
  return locked(body.id, request, async () => {
    const r = await writable(body.id, request)
    notCancelled(r)
    if (Date.parse(r.startIso) <= now.getTime()) throw new PartyActionError(409, 'This party has already started, so its time doesn’t need holding.')
    const when = partyWhenLabel(r.startIso)
    const first = firstOf(r.hostName)
    // MERGE NOTE: `await assertPartyLockHeld()` here, before holdAgain writes the party book.
    let again: Awaited<ReturnType<typeof holdAgain>>
    try {
      again = await holdAgain(r, now)
    } catch (e) {
      logger.error('Party time not held again', { partyId: r.bookingId, error: String(e) })
      throw new PartyActionError(503, CALENDAR_UNREADABLE)
    }
    if (!again.ok) {
      throw new PartyActionError(409, `${when} couldn’t be held for ${first}’s party: something else is on the calendar then. ${again.message} Move that booking, or move ${first}’s party to a free time.`)
    }
    if (!again.changed) return { party: adminPartyView(r, now), message: `${when} is already held for ${first}’s party. Nothing changed.`, replay: true }
    await audit(by, 'party-hold-again', r, { startIso: r.startIso, endIso: partyEndIso(r) ?? null })
    return { party: adminPartyView(r, now), message: `${when} is held for ${first}’s party again. Nothing was sent to ${first}.` }
  })
}

// ── Free this time / Free the old time ──────────────────────────────────────

/** This party's hold at exactly `startIso`, if the book still has one. */
async function holdAt(partyId: string, startIso: string, now: Date): Promise<PartyHold | null> {
  const t = Date.parse(startIso)
  const list = await holdsBetween(startIso, new Date(t + 60_000).toISOString(), now)
  return list.find((h) => h.partyId === partyId && same(h.startIso, startIso)) ?? null
}

/**
 * "Free this time" (a cancelled party) or "Free the old time" (a booked
 * party's leftover after a move). `startIso`: the held time the sheet showed.
 */
export async function freePartyTime(body: { id?: unknown; startIso?: unknown }, by: By, request: Request, now: Date = new Date()): Promise<HoldActionResult> {
  return locked(body.id, request, async () => {
    const r = await writable(body.id, request)
    const ms = typeof body.startIso === 'string' ? Date.parse(body.startIso) : NaN
    if (!Number.isFinite(ms)) throw new PartyActionError(400, 'Pick the time to free.')
    const startIso = new Date(ms).toISOString()
    const when = partyWhenLabel(startIso)
    const first = firstOf(r.hostName)
    const cancelled = r.status === 'cancelled'
    // Never the time a booked party is on (re-read inside the lock).
    if (!cancelled && same(r.startIso, startIso)) {
      throw new PartyActionError(409, `${first}’s party is on ${when}, so that time stays held.`)
    }
    // A payment going through could hold the time again when it lands: wait for it.
    if (paymentGoingThrough(r, now)) throw new PartyActionError(409, paymentWaitMessage(r, now))
    let hold: PartyHold | null
    try {
      hold = await holdAt(r.bookingId, startIso, now)
    } catch (e) {
      logger.error('Party book unreadable before freeing a time', { partyId: r.bookingId, error: String(e) })
      throw new PartyActionError(503, CALENDAR_UNREADABLE)
    }
    if (!hold) return { party: adminPartyView(r, now), message: ALREADY_FREE, replay: true }
    // MERGE NOTE: `await assertPartyLockHeld()` here, before releaseTime writes the party book.
    try {
      await releaseTime(r.bookingId, startIso)
    } catch (e) {
      logger.error('Party time not freed', { partyId: r.bookingId, startIso, error: String(e) })
      throw new PartyActionError(503, `${when} couldn’t be freed just now. Try again in a minute. Nothing else changed.`)
    }
    await audit(by, 'party-free-time', r, { startIso, leftover: !cancelled })
    return {
      party: adminPartyView(r, now),
      message: cancelled
        ? `${when} is free again, so others can book it. Nothing was sent to ${first} and no money moved.`
        : `${when} is free again. ${first}’s party stays on ${partyWhenLabel(r.startIso)}. Nothing was sent to ${first}.`,
    }
  })
}

// ── A held time with no party (To decide) ───────────────────────────────────

export class OrphanHoldError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/**
 * Lets go of a held time that no party record is on. The CALLER holds this
 * party id's lock and has refused a test site (R41). Refuses: a party record
 * exists now, a short hold (someone paying), a hold younger than
 * ORPHAN_MIN_AGE_MS, or any checkout attached to that party id (a payment
 * charging, unclear, or one Square shows paid). Returns what was done.
 */
export async function freeOrphanHold(partyId: string, startIso: string, by: By, now: Date = new Date()): Promise<string> {
  const when = partyWhenLabel(startIso)
  if (await getPartyRecord(partyId)) throw new OrphanHoldError(409, 'This time belongs to a party now. Open the party on the calendar instead. Nothing was changed.')
  const hold = await holdAt(partyId, startIso, now)
  if (!hold) return 'That time was already free'
  const age = now.getTime() - Date.parse(hold.at)
  if (!lastingHold(hold) || age < ORPHAN_MIN_AGE_MS) {
    const after = new Date(Date.parse(hold.at) + ORPHAN_MIN_AGE_MS).toISOString()
    throw new OrphanHoldError(409, `This time was held only a few minutes ago, so it may be a booking still being paid. Try again after ${partyWhenLabel(after)}. Nothing was changed.`)
  }
  const attached = (await listCheckouts()).filter((c) => c.partyId === partyId && c.state !== 'retired')
  if (attached.length > 0) {
    throw new OrphanHoldError(409, attached.some((c) => c.state === 'paid-elsewhere')
      ? 'Square shows a payment for this time, so it stays held. Sort out that payment first (it has its own item in To decide). Nothing was changed.'
      : 'A payment for this time is still being sorted out, so it stays held. Settle that payment first (it has its own item in To decide). Nothing was changed.')
  }
  // MERGE NOTE: `await assertPartyLockHeld()` here, before releaseTime writes the party book.
  await releaseTime(partyId, startIso)
  await recordAudit({
    by: { ...by, role: 'owner' }, action: 'party-free-time',
    target: { kind: 'party', id: partyId, label: `A held party time (${when})` },
    details: { startIso, orphan: true },
  })
  return `Freed ${when}: others can book it now`
}
