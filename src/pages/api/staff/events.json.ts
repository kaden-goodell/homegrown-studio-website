import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { listEvents, eventKey } from '@lib/events'
import { listRsvpsByEvent } from '@lib/rsvp-store'
import { getCheckin, presenceOn } from '@lib/checkin-store'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff:events')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Staff-only: events for one studio-local day, with RSVP + here-now counts
 *  (HOM-208 §6). Wraps `listEvents` — one day's `from`/`to`. */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  const date = url.searchParams.get('date') ?? ''
  if (!DATE_RE.test(date)) return new Response(JSON.stringify({ error: 'Missing/invalid date' }), { status: 400 })

  try {
    const { events, sources } = await listEvents({ from: date, to: date })
    // Both source systems down is a real outage — say so. One down still
    // returns the other's events, with `sources` telling the console which
    // half of the list it's missing (F2): a Square hiccup must not blank
    // today's parties off the door screen.
    if (sources.parties === 'error' && sources.workshops === 'error') {
      logger.error('Events load failed — both sources unavailable', { date })
      return new Response(JSON.stringify({ error: 'Couldn’t reach storage — check wifi and try again.' }), { status: 503 })
    }
    const withCounts = await Promise.all(
      events.map(async (e) => {
        const rsvps = await listRsvpsByEvent(e.kind, e.id)
        const checkins = await Promise.all(rsvps.map((r) => getCheckin(eventKey(e.kind, e.id), r.waiverId)))
        // "Here now" is counted on THIS day — hereNow for a multi-day camp
        // shouldn't include attendance from a different day (HOM-213).
        const hereNow = checkins.reduce((n, c) => n + Object.values(presenceOn(c, date)).filter((p) => !p.outAt).length, 0)
        // `rsvpWaiverIds` lets the door screen highlight the event a household already RSVP'd to.
        return { ...e, rsvpCount: rsvps.length, hereNow, rsvpWaiverIds: rsvps.map((r) => r.waiverId) }
      }),
    )
    return new Response(JSON.stringify({ data: { events: withCounts, sources } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    logger.error('Events load failed', { date, error: err instanceof Error ? err.message : String(err) })
    return new Response(JSON.stringify({ error: 'Couldn’t reach storage — check wifi and try again.' }), { status: 503 })
  }
}
