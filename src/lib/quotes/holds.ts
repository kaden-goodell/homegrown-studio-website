/**
 * A sent studio quote holds its time in the party book, under the party id it
 * becomes, always with a finite expiry (the quote's own). Spec §5 "Hold".
 *
 *   applyHold(prev, next, now)  moves the book from what `prev` held to what
 *                               `next` needs, and says whether `next` is held.
 *   releaseQuoteHold(q)         lets a held quote's time go.
 *
 * `prev.held` is the truth about what was held before. A quote wants a hold
 * when it is sent or picked, at the studio, has a time, and has not expired.
 * Paying and paid quotes are the pay flow's (it extends and confirms the hold
 * itself): left as they are. A send without a hold (`noHold`) doesn't call
 * this. The CALLER holds the quote's party lock.
 */
import {
  extendHold, holdTime, moveTime, NO_HOLD, releaseTime, resizeTime,
} from '@lib/parties/party-book'
import { busyBetween, clashes, type Busy } from '@lib/classes/studio-schedule'
import { isExpired, type Quote } from './types'

export interface HoldOutcome { held: boolean; clash?: { label: string; startIso: string } }

const DAY_MS = 86_400_000
const same = (a: string | null, b: string | null) => a !== null && b !== null && Date.parse(a) === Date.parse(b)

function wantsHold(q: Quote, now: Date): q is Quote & { startIso: string; endIso: string } {
  return (q.status === 'sent' || q.status === 'picked') && q.place === 'studio'
    && q.startIso !== null && q.endIso !== null && !isExpired(q, now)
}

const wasHeld = (q: Quote | null): q is Quote & { startIso: string } => !!q && q.held && q.startIso !== null

const ttlMinutes = (q: Quote, now: Date) => Math.max(1, Math.ceil((Date.parse(q.expiresAt) - now.getTime()) / 60_000))

/** Everything else in the room around this time (the book's own parties are rechecked inside its lock). */
const othersAround = (startIso: string, endIso: string): Promise<Busy[]> =>
  busyBetween(new Date(Date.parse(startIso) - DAY_MS).toISOString(), new Date(Date.parse(endIso) + DAY_MS).toISOString())

/** What the refused time clashes with, by name and start, for the owner. */
function clashOf(q: Quote & { startIso: string; endIso: string }, others: Busy[], message: string): HoldOutcome {
  const hit = clashes({ kind: 'party', startIso: q.startIso, endIso: q.endIso, ignoreIds: [q.partyId] }, others)[0]
  return { held: false, clash: hit ? { label: hit.label, startIso: hit.startIso } : { label: message, startIso: q.startIso } }
}

async function freshHold(q: Quote & { startIso: string; endIso: string }, others: Busy[], now: Date): Promise<HoldOutcome> {
  const r = await holdTime({ partyId: q.partyId, startIso: q.startIso, endIso: q.endIso, ttlMinutes: ttlMinutes(q, now) }, others, now)
  return r.ok ? { held: true } : clashOf(q, others, r.message)
}

export async function applyHold(prev: Quote | null, next: Quote, now: Date): Promise<HoldOutcome> {
  if (next.status === 'paying' || next.status === 'paid') return { held: next.held }
  if (!wantsHold(next, now)) {
    // Withdrawn, away, a draft again: let the old time go. Expired: nothing (expired holds stop counting).
    if (wasHeld(prev) && !isExpired(next, now)) await releaseTime(prev.partyId, prev.startIso)
    return { held: false }
  }
  // A hold that has run out holds nothing: start again.
  if (!wasHeld(prev) || !prev.endIso || isExpired(prev, now)) {
    return freshHold(next, await othersAround(next.startIso, next.endIso), now)
  }

  const others = await othersAround(next.startIso, next.endIso)
  if (!same(prev.startIso, next.startIso)) {
    const r = await moveTime(next.partyId, { startIso: prev.startIso }, { startIso: next.startIso, endIso: next.endIso }, others, now)
    if (!r.ok) {
      // The old hold has gone (swept, or lapsed): hold the new time afresh.
      if (r.message === NO_HOLD) return freshHold(next, others, now)
      return clashOf(next, others, r.message)
    }
    await releaseTime(next.partyId, prev.startIso)
  } else if (!same(prev.endIso, next.endIso)) {
    const r = await resizeTime(next.partyId, next.startIso, next.endIso, others, now)
    if (!r.ok) return clashOf(next, others, r.message)
  }

  // The moved or resized hold keeps the old expiry: bring it to the new one.
  const before = Date.parse(prev.expiresAt), after = Date.parse(next.expiresAt)
  if (after > before) {
    const r = await extendHold(next.partyId, next.startIso, next.expiresAt, next.endIso, now)
    return r.held ? { held: true } : clashOf(next, others, r.clash ?? 'That time is no longer free.')
  }
  if (after < before) {
    // Holds only grow: let it go, then hold again with the shorter TTL.
    await releaseTime(next.partyId, next.startIso)
    return freshHold(next, others, now)
  }
  return { held: true }
}

/** Lets a held quote's time go (withdrawn, deleted). Nothing when it held none; never a paying or paid one's (a booked party). */
export async function releaseQuoteHold(q: Quote): Promise<void> {
  if (q.status === 'paying' || q.status === 'paid') return
  if (q.startIso) await releaseTime(q.partyId, q.startIso)
}
