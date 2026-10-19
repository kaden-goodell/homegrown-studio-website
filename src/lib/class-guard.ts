/**
 * Server side of "no class over a booked party" (spec F). Read-only: it reads
 * the party entries of the shared studio schedule (partyBusy) and reports; it never changes a booking.
 */
import { studioDate, studioDayUtcRange } from '@lib/studio-time'
import { partyBlocksClass, type PartySpan } from '@lib/conflicts'
import { partyBusy } from '@lib/classes/studio-schedule'

const MINUTE_MS = 60_000

/**
 * Parties a class running [classStartIso, +minutes) would overlap (within the
 * cleanup hour): our party book's held and booked parties and Square-booked
 * ones, with host names when we hold the party's record. Throws when the
 * schedule can't be read: callers refuse to schedule rather than guess.
 */
export async function findPartyClashes(classStartIso: string, minutes: number): Promise<PartySpan[]> {
  const classEndIso = new Date(Date.parse(classStartIso) + minutes * MINUTE_MS).toISOString()
  const from = studioDayUtcRange(studioDate(classStartIso)).startIso
  const to = studioDayUtcRange(studioDate(new Date(Date.parse(classEndIso) - 1).toISOString())).endIso
  const parties: PartySpan[] = (await partyBusy(from, to))
    .map((b) => ({ id: b.id, startIso: b.startIso, endIso: b.endIso, ...(b.hostName ? { hostName: b.hostName } : {}) }))
  return partyBlocksClass(classStartIso, classEndIso, parties)
}
