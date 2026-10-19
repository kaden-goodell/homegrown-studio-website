import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { toIso } from '@lib/classes/validate'
import { json } from '@lib/classes/admin-actions'
import { listClasses } from '@lib/classes/class-store'
import { busyBetween, type Busy } from '@lib/classes/studio-schedule'
import type { ClassStatus } from '@lib/classes/types'

export const prerender = false

export type CalendarItem = Busy & { status?: ClassStatus }

/**
 * GET ?from=&to= (ISO): everything holding the room in that range (our
 * classes with their status, legacy Square classes, parties, Craft Café,
 * blocked time, closed days), sorted by start. Owners only. The range is
 * capped at about six weeks: a month view and its edges.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const from = toIso(url.searchParams.get('from')), to = toIso(url.searchParams.get('to'))
  if (!from || !to || Date.parse(to) <= Date.parse(from)) return json(400, { error: 'Pick a start and an end for the range.' })
  if (Date.parse(to) - Date.parse(from) > 45 * 86_400_000) return json(400, { error: 'Pick a range of six weeks or less.' })
  try {
    const [busy, classes] = await Promise.all([busyBetween(from, to), listClasses({ fromIso: from, toIso: to })])
    const status = new Map(classes.map((c) => [c.id, c.status]))
    const items: CalendarItem[] = busy.map((b) => (b.kind === 'class' ? { ...b, status: status.get(b.id) } : b))
    return json(200, { data: { items } })
  } catch (e) {
    console.error(`[admin/classes/calendar] ${e instanceof Error ? e.message : e}`)
    return json(503, { error: "The calendar couldn't be loaded. Try again." })
  }
}
