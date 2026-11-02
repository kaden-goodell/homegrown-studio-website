/**
 * Staffing lines for the owners' daily warnings (stage 3). Owners only: the
 * /staff panel hides these codes (OWNER_ONLY_CODES).
 *
 *   unstaffed           a class or party in the next 14 studio days (OWNER-6)
 *                       with fewer people on than it needs (needed 0 never)
 *   assigned-cant       someone is on a class or party in the warning window
 *                       at a time they marked as Can't
 *   assigned-cancelled  someone is still on a class or party that was
 *                       cancelled or is gone (undated: stays until they're
 *                       taken off; one item per event)
 *   staffing-unreadable the staffing records or the team couldn't be read:
 *                       one line, never a quiet all clear
 *
 * Read-only: nothing here changes who is on anything. Server only.
 */
import { createLogger } from '@lib/logger'
import { addDays } from '@lib/kit-dates'
import { studioDayUtcRange } from '@lib/studio-time'
import type { Warning } from '@lib/warnings'
import { orphanEntries, staffingRows, type StaffingRow } from './events'
import { shiftClock } from './notify'
import type { StaffableEvent } from './types'

const logger = createLogger('staffing-warnings')

/** OWNER-6: how many studio days ahead (today included) an event with nobody on is flagged. */
export const UNSTAFFED_HORIZON_DAYS = 14

export const ASSIGN_IN_ADMIN = 'Assign someone in /admin › More › Staff.'
export const STAFFING_UNREADABLE = "Couldn't check staffing."

/** "Potholder Looms" / "The party for Stefanie" / "A party". Owners only (host first name, OWNER-4). */
function eventName(ev: StaffableEvent): string {
  if (ev.kind !== 'party') return ev.title
  return ev.detail.hostFirst ? `The party for ${ev.detail.hostFirst}` : 'A party'
}

const kindOf = (ev: Pick<StaffableEvent, 'kind'>): Warning['eventKind'] => (ev.kind === 'party' ? 'party' : 'workshop')

/** What the panel would open: the class id, the party id or the Square schedule id. */
function eventIdOf(ev: StaffableEvent): string {
  if (ev.kind === 'class') return ev.openHref.startsWith('#class-') ? ev.openHref.slice('#class-'.length) : ''
  return ev.key.slice(ev.key.indexOf(':') + 1)
}

/** "Jessica", "Jessica and Sam", "Jessica, Sam and Kaden". */
const names = (list: string[]) => (list.length <= 1 ? list[0] ?? '' : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`)

function unstaffedLine(r: StaffingRow): Warning {
  const on = (r.entry?.assigned ?? []).filter((a) => r.people.some((p) => p.staffId === a.staffId)).length
  const what = `${eventName(r.event)} at ${shiftClock(r.event.startIso)}`
  return {
    code: 'unstaffed', eventKind: kindOf(r.event), eventId: eventIdOf(r.event), when: r.event.startIso, title: r.event.title,
    detail: on === 0 ? `${what} has no one on yet.` : `${what} has ${on} of ${r.needed} on.`,
    action: ASSIGN_IN_ADMIN,
  }
}

function cantLines(r: StaffingRow): Warning[] {
  return r.people
    .filter((p) => p.assigned && p.verdict === 'cant')
    .map((p) => ({
      code: 'assigned-cant' as const, eventKind: kindOf(r.event), eventId: eventIdOf(r.event), when: r.event.startIso, title: r.event.title,
      detail: `${p.name} is on ${eventName(r.event)} at ${shiftClock(r.event.startIso)} but marked that time as Can't.`,
      action: `Check with ${p.name}.`,
    }))
}

/**
 * The staffing lines for the window [from, to] (studio days). Never throws:
 * a failure is the one "Couldn't check staffing." line.
 */
export async function staffingWarnings(from: string, to: string, now: Date): Promise<Warning[]> {
  try {
    const startIso = studioDayUtcRange(from).startIso
    const endIso = studioDayUtcRange(to).endIso
    const horizonEnd = Date.parse(studioDayUtcRange(addDays(from, UNSTAFFED_HORIZON_DAYS - 1)).endIso)
    const [rows, orphans] = await Promise.all([staffingRows(startIso, endIso), orphanEntries(now)])
    const out: Warning[] = []
    for (const r of rows) {
      if (r.event.status !== 'on' || Date.parse(r.event.endIso) <= now.getTime()) continue
      const start = Date.parse(r.event.startIso)
      if (start <= horizonEnd && r.needed > 0 && r.state !== 'staffed') out.push(unstaffedLine(r))
      out.push(...cantLines(r))
    }
    for (const o of orphans) {
      const who = names(o.entry.assigned.map((a) => a.name))
      const isParty = o.key.startsWith('party:')
      const title = o.title ?? (isParty ? 'a party' : 'a class')
      const what = isParty ? 'a party' : title
      const one = o.entry.assigned.length === 1
      out.push({
        code: 'assigned-cancelled', eventKind: isParty ? 'party' : 'workshop', eventId: '', when: o.startIso ?? '', // never seen: no date rather than today's (M7)
        title, itemId: o.key,
        detail: o.status === 'cancelled'
          ? `${who} ${one ? 'is' : 'are'} still on ${what}, which was cancelled.`
          : `${who} ${one ? 'is' : 'are'} still on ${what}, which is no longer on the schedule.`,
        action: one ? `Tell ${who}, then take ${who} off in /admin.` : 'Tell them, then take them off in /admin.',
      })
    }
    return out
  } catch (err) {
    logger.error('Staffing check failed', { error: err instanceof Error ? err.message : String(err) })
    return [{
      code: 'staffing-unreadable', eventKind: 'workshop', eventId: '', when: now.toISOString(), title: 'Staffing',
      detail: STAFFING_UNREADABLE, action: 'Open /admin › More › Staff to check.',
    }]
  }
}
