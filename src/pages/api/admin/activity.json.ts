import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { listAudit } from '@lib/audit'
import { ACTIVITY_AREAS, toActivityRow, type ActivityArea } from '@lib/activity'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:admin:activity')
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** How far back the screen can look, in days. */
export const ACTIVITY_DAYS = [1, 7, 30, 90] as const
const MAX_ROWS = 300

/**
 * Owners only (DV19): who did what, newest first, in plain words.
 * GET ?by=<staffId>&area=money|door|staffing|setup&days=1|7|30|90&crew=1
 * → `{ data: { rows, people, truncated } }`. `people` is everyone in the
 * period (for the person filter). Read only.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const daysRaw = Number(url.searchParams.get('days'))
  const days = (ACTIVITY_DAYS as readonly number[]).includes(daysRaw) ? daysRaw : 7
  const areaRaw = url.searchParams.get('area') ?? ''
  const area = (ACTIVITY_AREAS as readonly string[]).includes(areaRaw) ? (areaRaw as ActivityArea) : null
  const byId = url.searchParams.get('by')?.trim() || ''
  const crewOnly = url.searchParams.get('crew') === '1'
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)
  try {
    const all = (await listAudit({ since, limit: 2000 })).map(toActivityRow)
    const people = [...new Map(all.filter((r) => r.byId).map((r) => [r.byId, { id: r.byId, name: r.who, role: r.role }])).values()]
      .sort((a, b) => a.name.localeCompare(b.name))
    const rows = all.filter((r) => (!area || r.area === area) && (!byId || r.byId === byId) && (!crewOnly || r.role === 'crew'))
    return json(200, { data: { rows: rows.slice(0, MAX_ROWS), people, truncated: rows.length > MAX_ROWS, days } })
  } catch (err) {
    logger.error('Activity list failed', { error: err instanceof Error ? err.message : String(err) })
    return json(503, { error: 'The activity log couldn’t be reached. Try again in a minute.' })
  }
}
