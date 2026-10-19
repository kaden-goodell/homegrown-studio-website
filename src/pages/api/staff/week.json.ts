import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { listEvents } from '@lib/events'
import { prepForEvent } from '@lib/event-prep'
import { studioDate } from '@lib/studio-time'
import { addDays } from '@lib/kit-dates'
import { createLogger } from '@lib/logger'
import { cafeOn } from '@lib/cafe-days'
import { getStudioDays } from '@lib/studio-settings'

export const prerender = false
const logger = createLogger('api:staff:week')
export const WEEK_DAYS = 7

/**
 * Staff-only: today and the next six days, every class and party, with what
 * to prep for classes with seat questions (Kaden, 15 Oct 2026: "what's today
 * and what's coming up that needs prep over the next week"). The staff
 * console's This week tab, its landing page.
 *
 * Our own classes also carry `byDay`: for each of their days in the week,
 * that day's start, seats booked, capacity and prep, so a class that meets
 * three days shows each day as it is.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!staffAuthorized(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  const from = studioDate(new Date().toISOString())
  const to = addDays(from, WEEK_DAYS - 1)
  try {
    const { events, sources } = await listEvents({ from, to })
    if (sources.parties === 'error' && sources.workshops === 'error' && sources.classes === 'error') {
      return new Response(JSON.stringify({ error: 'Couldn’t reach storage — check wifi and try again.' }), { status: 503 })
    }
    const rows = await Promise.all(events.map(async (e) => {
      const byDay = e.sessions
        ? Object.fromEntries(await Promise.all(
            [...new Set(e.sessions.map((s) => s.day))].filter((d) => d >= from && d <= to).map(async (d) => {
              const onDay = e.sessions!.filter((s) => s.day === d)
              return [d, {
                startIso: onDay[0].startIso,
                sold: Math.max(...onDay.map((s) => s.sold)),
                capacity: onDay[0].capacity,
                ...(await prepForEvent(e, d)),
              }] as const
            }),
          ))
        : undefined
      return {
        kind: e.kind,
        id: e.id,
        title: e.title,
        startIso: e.startIso,
        days: e.days,
        dropOff: e.dropOff,
        ...(typeof e.capacity === 'number' && typeof e.seats === 'number' ? { sold: e.capacity - e.seats, capacity: e.capacity } : {}),
        ...(typeof e.guests === 'number' ? { guests: e.guests } : {}),
        ...(byDay ? { byDay } : await prepForEvent(e)),
      }
    }))
    rows.sort((a, b) => a.startIso.localeCompare(b.startIso))
    // Craft Café hours on each day it runs (the owners' hours and closed days).
    const days = await getStudioDays()
    const cafe: Record<string, { opens: string; closes: string }> = {}
    for (let i = 0; i < WEEK_DAYS; i++) {
      const d = addDays(from, i)
      const h = cafeOn(d, days)
      if (h) cafe[d] = h
    }
    return new Response(JSON.stringify({ data: { from, to, events: rows, sources, cafe } }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  } catch (err) {
    logger.error('Week load failed', { error: err instanceof Error ? err.message : String(err) })
    return new Response(JSON.stringify({ error: 'Couldn’t reach storage — check wifi and try again.' }), { status: 503 })
  }
}
