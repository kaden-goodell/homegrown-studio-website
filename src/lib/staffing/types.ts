/**
 * Staffing types (stage 3): who can work when, who asked to work something,
 * who an owner put on it. Client-safe: types only.
 *
 * The staffing unit is an EVENT KEY, never a time:
 *   ses:<sessionId>     one session of one of our classes
 *   party:<partyId>     a party (stage 2 `pty_…`, or a Square booking id)
 *   legacy:<scheduleId> a Square class still running out
 * Times are read from the shared schedule every time, so a moved class or
 * party takes its staff with it.
 *
 * People are ids on our own staff list (D5; people brought in from Square
 * keep their Square team member id), never the fallback ids 'kaden' /
 * 'catherine'); `name` is kept as last seen so owner screens can show it.
 */
import type { By } from '@lib/staff-auth'

export type EventKey = `ses:${string}` | `party:${string}` | `legacy:${string}`
export type StaffableKind = 'class' | 'party' | 'legacy-class'

/** 'HH:MM' studio-local (America/Chicago); `to` may be '24:00' (midnight at the end of the day). */
export interface TimeRange { from: string; to: string }
/** One "can" or "can't" mark. `range` null = all day. */
export interface DayMark { kind: 'can' | 'cant'; range: TimeRange | null; note: string }

export interface Availability {
  staffId: string
  /** as last seen, for owner screens */
  name: string
  /** '0'..'6' (Sun..Sat): the usual week. null = not said. */
  weekly: Record<string, DayMark | null>
  /** 'YYYY-MM-DD' → marks that replace the weekly mark for that whole day (≤ 4 a day, sorted by start). */
  dates: Record<string, DayMark[]>
  updatedAt: string | null
  /** newest first, capped at AVAILABILITY_HISTORY_CAP */
  history: { at: string; by: By; change: string }[]
}

/** Someone an owner put on an event. `notified` = whether they were told (null = not told). */
export interface Assignment { staffId: string; name: string; by: By; at: string; notified: { email: boolean; text: boolean } | null }
/** "I'd like to work this", from a crew member. */
export interface Ask { staffId: string; name: string; at: string; note: string }

export interface StaffingEntry {
  key: EventKey
  /** null = the usual number for its kind (OWNER-3); 0 = nobody needed (no warning) */
  needed: number | null
  assigned: Assignment[]
  asks: Ask[]
  /** the event's times and title when an owner screen or a feed last saw it, to spot a move */
  seen: { startIso: string; endIso: string; title: string; cancelled?: boolean } | null
  /** ICS SEQUENCE, bumped when the seen times change or the event is cancelled (or back on) */
  sequence: number
  updatedAt: string | null
  /** newest first, capped at ENTRY_HISTORY_CAP */
  history: { at: string; by: By; change: string }[]
}

export interface StaffableEvent {
  key: EventKey
  kind: StaffableKind
  /** "Needlepoint 101" / "Party · 14 guests". Never a customer's name. */
  title: string
  startIso: string
  endIso: string
  /** gone = the event no longer exists anywhere */
  status: 'on' | 'cancelled' | 'gone'
  /** /admin hash that opens it */
  openHref: string
  /** What /staff opens for it: the roster (`/api/staff/roster.json?kind&id&day`). Ids only, safe for crew. */
  roster: { kind: 'workshop' | 'party'; id: string; day: string }
  /** hostFirst: owners' views only (never sent to crew) */
  detail: { seats?: string; guests?: number; hostFirst?: string | null }
}

/** outside = they gave hours for that day ("Can, only 4–9 PM") and the event is outside them: not Can't, not Not said. */
export type Verdict = 'can' | 'cant' | 'partly' | 'outside' | 'unknown'
export type StaffedState = 'staffed' | 'short' | 'none'
