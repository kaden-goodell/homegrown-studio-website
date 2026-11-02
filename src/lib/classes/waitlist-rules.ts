/**
 * When a class's waitlist is open, and whether a group fits now. Server only
 * (reads checkout.ts), no network.
 */
import { classCutoffHours } from './checkout'
import { seatsTaken, type Ledger } from './seat-ledger'
import type { ScheduledClass } from './types'
import { isOnList, type Waitlist } from './waitlist-store'

/** Hours before the start that the waitlist closes: its own cutoff, never later than sign-ups close. */
export function waitlistCutoffHours(cls: ScheduledClass): number {
  return Math.max(cls.content.rules.waitlistCutoffHours ?? 2, classCutoffHours(cls))
}

/**
 * When the waitlist for these sessions closes (ISO). A class that doesn't take
 * people partway counts from its first session, as sign-ups do (R28).
 */
export function waitlistClosesIso(cls: ScheduledClass, sessionIds: string[]): string | null {
  const asked = cls.sessions.filter((s) => sessionIds.includes(s.id))
  const counted = asked.length && !cls.content.rules.joinPartway ? cls.sessions : asked
  if (!counted.length) return null
  const first = Math.min(...counted.map((s) => Date.parse(s.startIso)))
  return new Date(first - waitlistCutoffHours(cls) * 3_600_000).toISOString()
}

/** Before (first picked session start − cutoff), class open. */
export function waitlistOpen(cls: ScheduledClass, sessionIds: string[], now: Date): boolean {
  if (cls.status !== 'open') return false
  const closes = waitlistClosesIso(cls, sessionIds)
  return !!closes && now.getTime() < Date.parse(closes)
}

/** The group fits now: every one of these sessions has `seats` free. */
export function fitsNow(cls: ScheduledClass, ledger: Ledger, sessionIds: string[], seats: number, now: Date): boolean {
  if (!sessionIds.length) return false
  return sessionIds.every((id) => {
    const s = cls.sessions.find((x) => x.id === id)
    return !!s && s.capacity - seatsTaken(ledger, id, now) >= seats
  })
}

/** People waiting (or being added right now) for a session, for the public view and the roster. */
export function waitingOn(list: Waitlist | null, sessionId: string): number {
  return (list?.entries ?? []).filter((e) => isOnList(e) && e.sessionIds.includes(sessionId)).length
}

