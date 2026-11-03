/**
 * Final review C2 (parties): the same host (by email), a few minutes apart,
 * with a different attempt. Usually the panel was closed, the page reloaded
 * or the phone swiped back while the first payment was going through. The new
 * attempt is a new party id, so without this check it would either find the
 * time "taken" by their own party ("Nothing was charged", which was untrue for
 * them) or book a second time and charge twice.
 *
 *   - a checkout of theirs still charging or unclear      → still going through
 *   - a party of theirs booked in the last few minutes    → the same time: you're
 *     booked; another time: ask first (`confirmRepeat` lets it through)
 *
 * A store that can't be read never blocks a booking (the hold and Square's
 * idempotency still stand). Server only.
 */
import { isOurs, listParties } from '@lib/party-store'
import { formatSlotLabel } from '@lib/studio-time'
import { listCheckouts } from './party-checkouts'

export const RECENT_PARTY_MINUTES = 10
/** A checkout older than this is To decide's to settle, not a reason to stop a booking. */
const CHARGING_WINDOW_MINUTES = 30

export const PARTY_STILL_GOING_THROUGH =
  'Your last payment for a party is still going through. Give it a minute, then check your email before trying again. Nothing was charged this time.'
export const PARTY_ALREADY_BOOKED =
  'You just booked this party. Check your email for your confirmation. Nothing was charged this time.'
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
    const charging = (await listCheckouts()).some((c) =>
      c.partyId !== partyId && (c.state === 'charging' || c.state === 'unclear') &&
      c.host?.email?.trim().toLowerCase() === who &&
      now.getTime() - Date.parse(c.updatedAt) < CHARGING_WINDOW_MINUTES * 60_000)
    if (charging) return { kind: 'charging' }
    const since = now.getTime() - RECENT_PARTY_MINUTES * 60_000
    const startMs = Date.parse(startIso)
    const recent = (await listParties())
      .filter((r) => r.bookingId !== partyId && isOurs(r) && r.status !== 'cancelled' && r.hostEmail?.trim().toLowerCase() === who && Date.parse(r.createdAt) >= since)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (!recent.length) return null
    const same = recent.find((r) => Date.parse(r.startIso) === startMs)
    const r = same ?? recent[0]
    return { kind: 'booked', sameTime: !!same, whenLabel: formatSlotLabel(r.startIso) }
  } catch (err) {
    console.error('[parties:same-person] unreadable — not blocking', err instanceof Error ? err.message : String(err))
    return null
  }
}
