/**
 * Remembers the host's most recent party booking in localStorage so they can
 * return to their invitation after closing the confirmation (the invite link
 * otherwise lives only on that screen). Same-device only — the durable
 * cross-device answer is a confirmation email, tracked separately.
 */
import { partyInviteUrl } from '@lib/party-share'

export interface RecentParty {
  bookingId: string
  hostToken?: string
  craftName: string
  slotLabel: string
  startIso: string
  title?: string
  savedAt: string // ISO
}

const KEY = 'hg:recent-party'

/** Sent on the window whenever the saved party changes, so the banner can follow without a reload. */
export const RECENT_PARTY_EVENT = 'hometown:recent-party'

function announce(): void {
  try {
    window.dispatchEvent(new CustomEvent(RECENT_PARTY_EVENT))
  } catch {
    /* no window (server) — nothing to tell */
  }
}

export function saveRecentParty(p: RecentParty): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
    announce()
  } catch {
    /* storage unavailable (private mode / disabled) — non-fatal */
  }
}

export function loadRecentParty(): RecentParty | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as RecentParty
    // Expire the pointer a week after the party's date so /book doesn't nag forever.
    const cutoff = new Date(p.startIso).getTime() + 7 * 24 * 60 * 60 * 1000
    if (Date.now() > cutoff) {
      clearRecentParty()
      return null
    }
    return p
  } catch {
    return null
  }
}

export function clearRecentParty(): void {
  try {
    localStorage.removeItem(KEY)
    announce()
  } catch {
    /* non-fatal */
  }
}

/** Rebuild the shareable invitation URL from a saved record. */
export function recentPartyInviteUrl(p: RecentParty, origin: string): string {
  return partyInviteUrl(
    { bookingId: p.bookingId, craftName: p.craftName, slotLabel: p.slotLabel, startIso: p.startIso, title: p.title },
    origin
  )
}

/** The host's own management view (details + who's RSVP'd). Token-gated. */
export function hostPartyUrl(p: RecentParty, origin: string): string {
  const key = p.hostToken ? `?key=${encodeURIComponent(p.hostToken)}` : ''
  return `${origin}/party/${encodeURIComponent(p.bookingId)}${key}`
}
