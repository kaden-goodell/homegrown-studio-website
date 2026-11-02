/**
 * Puts a booked party's time back in the party book when it is missing or
 * shorter than the party (its extra time not held). The daily warning
 * "isn't held on the calendar" tells the owners to move the party to the
 * same time again; that Move runs this. Checked like any hold (classes,
 * other parties, the café, blocked time, closed days): a time someone else
 * has taken since is refused with the clash named, never written over.
 *
 * Holds only grow (holdTime): a hold already long enough is left as is.
 * Server only; the caller holds the party's lock.
 */
import { busyBetween } from '@lib/classes/studio-schedule'
import { partyEndIso, type PartyRecord } from '@lib/party-store'
import { confirmTime, holdTime, holdsBetween } from './party-book'

const PAD_MS = 3 * 60 * 60_000

export type HoldAgain = { ok: true; changed: boolean } | { ok: false; message: string }

export async function holdAgain(r: PartyRecord, now: Date = new Date()): Promise<HoldAgain> {
  const startIso = r.startIso
  const endIso = partyEndIso(r)
  if (!endIso) return { ok: true, changed: false }
  const start = Date.parse(startIso), end = Date.parse(endIso)
  const holds = await holdsBetween(startIso, endIso, now)
  const mine = holds.find((h) => h.partyId === r.bookingId && Date.parse(h.startIso) === start)
  if (mine && Date.parse(mine.endIso) >= end) return { ok: true, changed: false }
  const others = await busyBetween(new Date(start - PAD_MS).toISOString(), new Date(end + PAD_MS).toISOString(), undefined, { legacyClasses: 'ignore-failure', partyLabels: true })
  const held = await holdTime({ partyId: r.bookingId, startIso, endIso, ttlMinutes: null }, others, now)
  if (!held.ok) return { ok: false, message: held.message }
  // Paid parties are booked in the book; a party waiting on its payment link stays held (no expiry).
  if ((r.charges ?? []).length > 0 || mine?.state === 'booked') await confirmTime(r.bookingId, startIso, endIso, now)
  return { ok: true, changed: true }
}
