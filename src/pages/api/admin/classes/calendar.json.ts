import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { toIso } from '@lib/classes/validate'
import { json } from '@lib/classes/admin-actions'
import { listClasses } from '@lib/classes/class-store'
import { getLedger, seatsTaken } from '@lib/classes/seat-ledger'
import { busyBetween, type Busy } from '@lib/classes/studio-schedule'
import type { ClassStatus } from '@lib/classes/types'
import { getPartyRecord } from '@lib/party-store'

export const prerender = false

export type CalendarItem = Busy & {
  status?: ClassStatus
  /** Our classes: seats taken on this session and how many it has. */
  booked?: number
  capacity?: number
  /** Parties: the guest count the host booked for, when we have their record. */
  guests?: number
}

/**
 * GET ?from=&to= (ISO): everything holding the room in that range (our
 * classes with their status and seats taken, legacy Square classes, parties
 * with their guest count, Craft Café, blocked time, closed days), sorted by
 * start. Owners only. The range is capped at about six weeks: a month view
 * and its edges. Seats and guests are extras: when they can't be read the
 * item still comes back without them.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const from = toIso(url.searchParams.get('from')), to = toIso(url.searchParams.get('to'))
  if (!from || !to || Date.parse(to) <= Date.parse(from)) return json(400, { error: 'Pick a start and an end for the range.' })
  if (Date.parse(to) - Date.parse(from) > 45 * 86_400_000) return json(400, { error: 'Pick a range of six weeks or less.' })
  try {
    const [busy, classes] = await Promise.all([busyBetween(from, to), listClasses({ fromIso: from, toIso: to })])
    const byId = new Map(classes.map((c) => [c.id, c]))
    const now = new Date()
    const ledgers = new Map(await Promise.all(
      [...new Set(busy.filter((b) => b.kind === 'class').map((b) => b.id))].map(async (id) => [id, await getLedger(id).catch(() => null)] as const),
    ))
    const items: CalendarItem[] = await Promise.all(busy.map(async (b): Promise<CalendarItem> => {
      if (b.kind === 'class') {
        const cls = byId.get(b.id)
        const session = cls?.sessions.find((s) => s.id === b.sessionId)
        const ledger = ledgers.get(b.id)
        return {
          ...b,
          status: cls?.status,
          ...(session ? { capacity: session.capacity } : {}),
          ...(ledger && b.sessionId ? { booked: seatsTaken(ledger, b.sessionId, now) } : {}),
        }
      }
      if (b.kind === 'party') {
        const record = await getPartyRecord(b.id).catch(() => null)
        return record ? { ...b, guests: record.guestCount } : b
      }
      return b
    }))
    return json(200, { data: { items } })
  } catch (e) {
    console.error(`[admin/classes/calendar] ${e instanceof Error ? e.message : e}`)
    return json(503, { error: "The calendar couldn't be loaded. Try again." })
  }
}
