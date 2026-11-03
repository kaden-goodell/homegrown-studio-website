import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { listWarnings, type Warning, type WarningCode } from '@lib/warnings'
import { addDays } from '@lib/kit-dates'
import { formatCalendarDay, studioDate } from '@lib/studio-time'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff:warnings')

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const OWNERS_SORT = 'Catherine or Kaden will sort this out.'

/**
 * The only lines the crew see (crew review I5): things at the door today or
 * tomorrow that a crew member can act on or should know about. Everything
 * else (promo limits, register setup, refund flags with customer names,
 * weeks-away conflicts) is owner work and lives on /admin and in the daily
 * email. Each line says what the crew do, never "in Square" or "on /admin".
 */
const CREW_ACTION: Partial<Record<WarningCode, string>> = {
  'reader-waiting': 'Open the class and tap Check again. Catherine or Kaden will sort out the rest.',
  'door-unpaid': 'If they’re here, take it at the register. Catherine or Kaden will sort out the rest.',
  oversold: OWNERS_SORT,
  'class-over-party': OWNERS_SORT,
  'class-over-class': OWNERS_SORT,
}

function crewLine(w: Warning): string {
  const action = CREW_ACTION[w.code] ?? OWNERS_SORT
  // door-unpaid already names its day and class
  if (w.code === 'door-unpaid') return `${w.detail.replace(/\.$/, '')}. ${action}`
  return `${formatCalendarDay(studioDate(w.when))} · ${w.detail} ${action}`
}

/**
 * Staff-only: what needs the crew today and tomorrow (spec G, narrowed by
 * crew review I5). Read-only. A scan that can't run is a 503 so the panel
 * says so instead of looking all clear. Staffing lines are never scanned here.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!(await staffAuthorized(request))) return json({ error: 'Unauthorized' }, 401)
  const from = studioDate(new Date().toISOString())
  const to = addDays(from, 1)
  try {
    const warnings = await listWarnings({ from, to }, { staffing: false })
    const shown = warnings.filter((w) => w.code in CREW_ACTION && !!w.when && studioDate(w.when) >= from && studioDate(w.when) <= to)
    // `detail`/`action` stay off the reply: the line is all the panel shows.
    return json({ data: { from, to, warnings: shown.map((w) => ({ code: w.code, eventKind: w.eventKind, eventId: w.eventId, when: w.when, title: w.title, line: crewLine(w) })) } })
  } catch (err) {
    logger.error('Warnings scan failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'Couldn’t check the schedule for conflicts. Refresh to try again.' }, 503)
  }
}
