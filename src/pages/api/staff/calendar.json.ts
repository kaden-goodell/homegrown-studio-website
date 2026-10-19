import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { toIso } from '@lib/classes/validate'
import { json } from '@lib/classes/admin-actions'
import { listClasses } from '@lib/classes/class-store'
import { busyBetween } from '@lib/classes/studio-schedule'
import type { CalendarItem } from '@pages/api/admin/classes/calendar.json'

export const prerender = false

/**
 * Staff-only, read-only: the owners' calendar for the crew (spec decision
 * "Crew see the /admin calendar, read-only"). Same answer as
 * /api/admin/classes/calendar.json: everything holding the room in
 * ?from=&to= (our classes with their status, Square classes, parties, Craft
 * Café, blocked time, closed days). Drafts are left out: the crew only see
 * what is really on. Capped at about six weeks.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) return json(401, { error: 'Unauthorized' })
  const from = toIso(url.searchParams.get('from')), to = toIso(url.searchParams.get('to'))
  if (!from || !to || Date.parse(to) <= Date.parse(from)) return json(400, { error: 'Pick a start and an end for the range.' })
  if (Date.parse(to) - Date.parse(from) > 45 * 86_400_000) return json(400, { error: 'Pick a range of six weeks or less.' })
  try {
    const [busy, classes] = await Promise.all([busyBetween(from, to), listClasses({ fromIso: from, toIso: to })])
    const status = new Map(classes.map((c) => [c.id, c.status]))
    const items: CalendarItem[] = busy
      .map((b) => (b.kind === 'class' ? { ...b, status: status.get(b.id) } : b))
      .filter((b) => !(b.kind === 'class' && (b as CalendarItem).status === 'draft'))
    return json(200, { data: { items } })
  } catch (e) {
    console.error(`[staff/calendar] ${e instanceof Error ? e.message : e}`)
    return json(503, { error: 'Couldn’t load the calendar — check wifi and try again.' })
  }
}
