/**
 * Door seats the crew took "to pay at the counter" that were never rung up
 * (R32): still unpaid once their (first) session has ended. Shown on /staff
 * warnings and in /admin › To decide (kind 'door-unpaid'; an owner resolves
 * it). Read-only here: nothing is freed, charged or cancelled. Server only.
 */
import { studioDate } from '@lib/studio-time'
import { listClasses } from './class-store'
import { getLedger, type LedgerLine } from './seat-ledger'

export interface DoorUnpaid {
  /** stable: one per booking */
  id: string
  kind: 'door-unpaid'
  classId: string
  className: string
  bookingId: string
  lineIds: string[]
  /** "Dora Door", or '' when the seat has no name */
  name: string
  /** studio day (YYYY-MM-DD) of the session it was for */
  day: string
  sessionStartIso: string
  seats: number
}

/** How far back to look for seats never rung up. */
export const DOOR_UNPAID_LOOKBACK_DAYS = 60

const unpaidDoorSeat = (l: LedgerLine) => l.source === 'door-counter' && l.state === 'confirmed' && !l.square.orderId

export async function listDoorUnpaid(now: Date): Promise<DoorUnpaid[]> {
  const classes = await listClasses({ fromIso: new Date(now.getTime() - DOOR_UNPAID_LOOKBACK_DAYS * 86_400_000).toISOString(), toIso: now.toISOString() })
  const out: DoorUnpaid[] = []
  for (const cls of classes) {
    if (cls.status === 'draft') continue
    const ledger = await getLedger(cls.id)
    const byBooking = new Map<string, LedgerLine[]>()
    for (const l of ledger.lines.filter(unpaidDoorSeat)) byBooking.set(l.bookingId, [...(byBooking.get(l.bookingId) ?? []), l])
    for (const [bookingId, lines] of byBooking) {
      const sessions = cls.sessions.filter((s) => lines[0].sessionIds.includes(s.id)).sort((a, b) => a.startIso.localeCompare(b.startIso))
      const first = sessions[0]
      if (!first || Date.parse(first.endIso) > now.getTime()) continue
      const c = lines.find((l) => l.customer)?.customer
      out.push({
        id: `door-unpaid-${cls.id}-${bookingId}`, kind: 'door-unpaid', classId: cls.id, className: cls.content.name, bookingId,
        lineIds: lines.map((l) => l.id), name: c ? `${c.givenName} ${c.familyName}`.trim() : '', day: studioDate(first.startIso),
        sessionStartIso: first.startIso, seats: lines.length,
      })
    }
  }
  return out.sort((a, b) => a.sessionStartIso.localeCompare(b.sessionStartIso))
}
