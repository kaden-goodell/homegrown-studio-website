/**
 * Final review C2 (parties): the same host (by email), a few minutes apart,
 * with a different attempt. Usually the panel was closed, the page reloaded
 * or the phone swiped back while the first payment was going through. The new
 * attempt is a new party id, so without this check it would either find the
 * time "taken" by their own party ("Nothing was charged", which was untrue for
 * them) or book a second time and charge twice.
 *
 *   - a checkout of theirs still charging or unclear      → still going through
 *   - a party of theirs at the same time (any time since it was booked, N7)
 *                                                         → you're booked
 *   - a party of theirs booked in the last few minutes, another time
 *                                                         → ask first (`confirmRepeat` lets it through)
 *
 * Reads only that host's parties, through the host index (host-index.ts, N8).
 *
 * A store that can't be read never blocks a booking (the hold and Square's
 * idempotency still stand). Server only.
 */
import { getPartyRecord, isOurs, type PartyRecord } from '@lib/party-store'
import { partiesOfHost } from './host-index'
import { formatSlotLabel } from '@lib/studio-time'
import { listCheckouts } from './party-checkouts'

export const RECENT_PARTY_MINUTES = 10
/** At most this many of a host's newest parties are read per check. */
const HOST_LOOKUP_MAX = 12
/** A checkout older than this is To decide's to settle, not a reason to stop a booking. */
const CHARGING_WINDOW_MINUTES = 30

export const PARTY_STILL_GOING_THROUGH =
  'Your last payment for a party is still going through. Give it a minute, then check your email before trying again. Nothing was charged this time.'
export const PARTY_ALREADY_BOOKED =
  'You already booked a party at this time. Check your email for your confirmation. Nothing was charged this time.'
export function recentPartyMessage(whenLabel: string): string {
  return `You booked a party for ${whenLabel} a few minutes ago. Check your email for the confirmation. Nothing was charged this time. Book this one too only if you meant to.`
}

export type SamePerson =
  | { kind: 'charging' }
  | { kind: 'booked'; sameTime: boolean; whenLabel: string }
  | null

export async function recentPartyBySamePerson(email: string, partyId: string, startIso: string, now: Date = new Date()): Promise<SamePerson> {
  const who = email.trim().toLowerCase()
  if (!who) return null
  try {
    // One small record (the checkouts in flight), not a scan of the party store.
    const charging = (await listCheckouts()).some((c) =>
      c.partyId !== partyId && (c.state === 'charging' || c.state === 'unclear') &&
      c.host?.email?.trim().toLowerCase() === who &&
      now.getTime() - Date.parse(c.updatedAt) < CHARGING_WINDOW_MINUTES * 60_000)
    if (charging) return { kind: 'charging' }
    // N8: only this host's parties, from the host index, each read again and checked (never every party).
    const startMs = Date.parse(startIso)
    const since = now.getTime() - RECENT_PARTY_MINUTES * 60_000
    const entries = (await partiesOfHost(who)).filter((e) => e.id !== partyId)
    const mine = (await Promise.all(entries.slice(-HOST_LOOKUP_MAX).map((e) => getPartyRecord(e.id).catch(() => null))))
      .filter((r): r is PartyRecord => !!r && isOurs(r) && r.status !== 'cancelled' && r.hostEmail?.trim().toLowerCase() === who)
    // N7: their own party at this very time is theirs for its whole life, not only for 10 minutes.
    const same = mine.find((r) => Date.parse(r.startIso) === startMs)
    if (same) return { kind: 'booked', sameTime: true, whenLabel: formatSlotLabel(same.startIso) }
    const recent = mine.filter((r) => Date.parse(r.createdAt) >= since).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (!recent.length) return null
    return { kind: 'booked', sameTime: false, whenLabel: formatSlotLabel(recent[0].startIso) }
  } catch (err) {
    console.error('[parties:same-person] unreadable — not blocking', err instanceof Error ? err.message : String(err))
    return null
  }
}
