import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { listWarnings, OWNER_ONLY_CODES, warningLine, WARNING_WINDOW_DAYS } from '@lib/warnings'
import { addDays } from '@lib/kit-dates'
import { studioDate } from '@lib/studio-time'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff:warnings')

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Staff-only: everything on the schedule that needs a person, today and the
 * next 59 days (spec G). Read-only. A scan that can't run is a 503 so the
 * panel says so instead of looking all clear. Staffing lines (who is on,
 * who marked Can't) are for the owners' email only: the crew read this panel.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!staffAuthorized(request)) return json({ error: 'Unauthorized' }, 401)
  const from = studioDate(new Date().toISOString())
  const to = addDays(from, WARNING_WINDOW_DAYS - 1)
  try {
    // The staffing scan is skipped here (owners get it by email and on /admin); the filter below is a second guard.
    const warnings = await listWarnings({ from, to }, { staffing: false })
    const shown = warnings.filter((w) => !OWNER_ONLY_CODES.has(w.code))
    return json({ data: { from, to, warnings: shown.map((w) => ({ ...w, line: warningLine(w) })) } })
  } catch (err) {
    logger.error('Warnings scan failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'Couldn’t check the schedule for conflicts. Refresh to try again.' }, 503)
  }
}
