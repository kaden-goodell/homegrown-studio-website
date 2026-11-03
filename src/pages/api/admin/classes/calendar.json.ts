import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { toIso } from '@lib/classes/validate'
import { json } from '@lib/classes/admin-actions'
import { listClasses } from '@lib/classes/class-store'
import { getLedger, seatsTaken } from '@lib/classes/seat-ledger'
import { busyBetween, type Busy } from '@lib/classes/studio-schedule'
import type { ClassStatus } from '@lib/classes/types'
import { getPartyRecord } from '@lib/party-store'
import { listBlocked } from '@lib/classes/blocked-time'
import { paymentState } from '@lib/parties/money'
import { hereNowCount } from '@lib/open-studio-store'
import { localDate } from '@lib/party-slots'

export const prerender = false

export type CalendarItem = Busy & {
  status?: ClassStatus
  /** Our classes: seats taken on this session and how many it has. */
  booked?: number
  capacity?: number
  /** Parties: the guest count the host booked for, when we have their record. */
  guests?: number
  /** Parties: waiting on payment, part paid, paid, or booked in Square (legacy, read only here). */
  pay?: 'paid' | 'waiting' | 'partly' | 'legacy' | 'cancelled'
  /** Blocked time: the owners' note (only on /admin). */
  note?: string
  /** Craft Café, today or before: people the crew checked in ("12 at Craft Café"). */
  visits?: number
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
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const from = toIso(url.searchParams.get('from')), to = toIso(url.searchParams.get('to'))
  if (!from || !to || Date.parse(to) <= Date.parse(from)) return json(400, { error: 'Pick a start and an end for the range.' })
  if (Date.parse(to) - Date.parse(from) > 45 * 86_400_000) return json(400, { error: 'Pick a range of six weeks or less.' })
  try {
    const [busy, classes] = await Promise.all([busyBetween(from, to), listClasses({ fromIso: from, toIso: to })])
    const byId = new Map(classes.map((c) => [c.id, c]))
    // The owners' notes on blocked time (an extra: none when they can't be read).
    const notes = busy.some((b) => b.kind === 'blocked')
      ? listBlocked({ fromIso: from, toIso: to }).then((l) => Object.fromEntries(l.filter((x) => x.note).map((x) => [x.id, x.note!])), () => ({} as Record<string, string>))
      : Promise.resolve({} as Record<string, string>)
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
      if (b.kind === 'cafe') {
        // Check-ins only exist for today and before: a day still to come is never read.
        const day = localDate(b.startIso)
        if (day > localDate(now.toISOString())) return b
        const visits = await hereNowCount(day).catch(() => 0)
        return visits > 0 ? { ...b, visits } : b
      }
      if (b.kind === 'blocked') {
        const note = (await notes)[b.id]
        return note ? { ...b, note } : b
      }
      if (b.kind === 'party') {
        const record = await getPartyRecord(b.id).catch(() => null)
        if (record) return { ...b, guests: record.guestCount, pay: paymentState(record) }
        // No record here: only a party booked in Square (ours always have one; an unreadable one shows plain).
        return b.id.startsWith('pty_') ? b : { ...b, pay: 'legacy' }
      }
      return b
    }))
    return json(200, { data: { items } })
  } catch (e) {
    console.error(`[admin/classes/calendar] ${e instanceof Error ? e.message : e}`)
    return json(503, { error: "The calendar couldn't be loaded. Try again." })
  }
}
