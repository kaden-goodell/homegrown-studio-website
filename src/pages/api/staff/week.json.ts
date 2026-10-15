import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { listEvents } from '@lib/events'
import { prepForEvent } from '@lib/event-prep'
import { studioDate } from '@lib/studio-time'
import { addDays } from '@lib/kit-dates'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:staff:week')
export const WEEK_DAYS = 7

/**
 * Staff-only: today and the next six days, every class and party, with what
 * to prep for classes with seat questions (Kaden, 15 Oct 2026: "what's today
 * and what's coming up that needs prep over the next week"). The staff
 * console's This week tab, its landing page.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!staffAuthorized(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  const from = studioDate(new Date().toISOString())
  const to = addDays(from, WEEK_DAYS - 1)
  try {
    const { events, sources } = await listEvents({ from, to })
    if (sources.parties === 'error' && sources.workshops === 'error') {
      return new Response(JSON.stringify({ error: 'Couldn’t reach storage — check wifi and try again.' }), { status: 503 })
    }
    const rows = await Promise.all(events.map(async (e) => ({
      kind: e.kind,
      id: e.id,
      title: e.title,
      startIso: e.startIso,
      days: e.days,
      dropOff: e.dropOff,
      ...(typeof e.capacity === 'number' && typeof e.seats === 'number' ? { sold: e.capacity - e.seats } : {}),
      ...(typeof e.guests === 'number' ? { guests: e.guests } : {}),
      ...(await prepForEvent(e)),
    })))
    rows.sort((a, b) => a.startIso.localeCompare(b.startIso))
    return new Response(JSON.stringify({ data: { from, to, events: rows, sources } }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  } catch (err) {
    logger.error('Week load failed', { error: err instanceof Error ? err.message : String(err) })
    return new Response(JSON.stringify({ error: 'Couldn’t reach storage — check wifi and try again.' }), { status: 503 })
  }
}
