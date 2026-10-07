import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { findPartyClashes } from '@lib/class-guard'
import { partyClashMessage } from '@lib/conflicts'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff:conflicts')
const MAX_MINUTES = 12 * 60

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Staff-only. `GET ?kind=workshop&start=<ISO>&minutes=<n>`: would a class at
 * that time overlap a booked party? The in-tab Square step
 * (scripts/square-tab-schedule.js) asks this before it creates or moves a
 * class, so the rule lives in one place. Read-only. A lookup failure is a
 * 503: the caller must not schedule on a guess.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) return json({ error: 'Unauthorized' }, 401)

  const kind = url.searchParams.get('kind')
  const start = url.searchParams.get('start') ?? ''
  const minutes = Number(url.searchParams.get('minutes'))
  if (kind !== 'workshop') return json({ error: 'Only kind=workshop is checked here.' }, 400)
  if (!start || Number.isNaN(Date.parse(start))) return json({ error: 'start must be an ISO time.' }, 400)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    return json({ error: `minutes must be a whole number from 1 to ${MAX_MINUTES}.` }, 400)
  }

  try {
    const clashes = await findPartyClashes(new Date(start).toISOString(), minutes)
    return json({
      data: {
        ok: clashes.length === 0,
        clashes,
        message: clashes.length === 0 ? 'No booked party in the way.' : partyClashMessage(clashes),
      },
    })
  } catch (err) {
    logger.error('Conflict check failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'Couldn’t read party bookings. Don’t schedule until this check passes.' }, 503)
  }
}
