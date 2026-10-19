import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { groupBookings, json, type BookingView } from '@lib/classes/admin-actions'
import { getClass } from '@lib/classes/class-store'
import { getLedger } from '@lib/classes/seat-ledger'
import { takesSeat } from '@lib/classes/seat-status'
import { busyBetween, type Busy } from '@lib/classes/studio-schedule'
import type { ClassContent } from '@lib/classes/types'
import { localToUtcISO } from '@lib/party-slots'
import { listWaiversByEvent, type EventKind } from '@lib/waiver-store'

export const prerender = false

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export interface SignedWaiver { name: string; email: string; kids: number }
export interface DayClass {
  id: string
  sessionId: string
  name: string
  startIso: string
  endIso: string
  capacity: number
  content: Pick<ClassContent, 'ticketTypes' | 'questions' | 'addOns' | 'passes'>
  bookings: BookingView[]
  /** null when the waivers couldn't be read. */
  waivers: SignedWaiver[] | null
}
export interface DayEvent extends Busy { waivers: SignedWaiver[] | null }

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1, 12)).toISOString().slice(0, 10)
}

async function waiversFor(kind: EventKind, id: string): Promise<SignedWaiver[] | null> {
  try {
    return (await listWaiversByEvent(kind, id)).map((w) => ({
      name: `${w.adult.firstName} ${w.adult.lastName}`.trim(),
      email: w.adult.email,
      kids: w.minors.length,
    }))
  } catch {
    return null
  }
}

/**
 * GET ?day=YYYY-MM-DD: the print-day sheet. Our class sessions that day with
 * the bookings on them and the waivers signed for the class; parties and
 * legacy classes with their signed waivers; everything else (Craft Café,
 * blocked time, closed) as plain lines. Owners only. Read only.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const day = url.searchParams.get('day') ?? ''
  if (!DAY_RE.test(day)) return json(400, { error: 'Pick a day.' })
  try {
    const busy = await busyBetween(localToUtcISO(day, '00:00'), localToUtcISO(nextDay(day), '00:00'))
    const now = new Date()
    const classes: DayClass[] = []
    const events: DayEvent[] = []
    const other: Busy[] = []
    for (const b of busy) {
      if (b.kind === 'class' && b.sessionId) {
        const cls = await getClass(b.id)
        if (!cls) continue
        const session = cls.sessions.find((s) => s.id === b.sessionId)
        // Who is coming, seat by seat (R43): a refund that kept the seat is on the sheet, a freed seat is not.
        const ledger = await getLedger(cls.id)
        const onSession = { ...ledger, lines: ledger.lines.filter((l) => l.sessionIds.includes(b.sessionId!) && takesSeat(l, now)) }
        const bookings = groupBookings(onSession, now)
        classes.push({
          id: cls.id, sessionId: b.sessionId, name: cls.content.name, startIso: b.startIso, endIso: b.endIso,
          capacity: session?.capacity ?? 0,
          content: { ticketTypes: cls.content.ticketTypes, questions: cls.content.questions, addOns: cls.content.addOns, passes: cls.content.passes },
          bookings,
          waivers: await waiversFor('workshop', cls.id),
        })
      } else if (b.kind === 'party' || b.kind === 'legacy-class') {
        events.push({ ...b, waivers: await waiversFor(b.kind === 'party' ? 'party' : 'workshop', b.id) })
      } else {
        other.push(b)
      }
    }
    return json(200, { data: { day, classes, events, other } })
  } catch (e) {
    console.error(`[admin/classes/day] ${e instanceof Error ? e.message : e}`)
    return json(503, { error: "The day couldn't be loaded. Try again." })
  }
}
