import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { cafeDayVisits, cafeMonth } from '@lib/cafe-visits'
import { localDate } from '@lib/party-slots'

export const prerender = false

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET ?month=YYYY-MM → that month's Craft Café visits (each day with
 * check-ins, and the month's families, people, adults and kids), for
 * /admin › More › Reports. GET ?date=YYYY-MM-DD → who came that day (the
 * Calendar's Craft Café sheet). From the crew's check-ins on /staff. Owners only.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const params = (url ?? new URL(request.url)).searchParams
  const month = params.get('month')
  const date = params.get('date')
  const today = localDate(new Date().toISOString())
  if (month !== null && !MONTH_RE.test(month)) return json(400, { error: 'Pick a month.' })
  if (date !== null && !DATE_RE.test(date)) return json(400, { error: 'Pick a day.' })
  if (!month && !date) return json(400, { error: 'Pick a month or a day.' })
  try {
    if (date) return json(200, { data: date > today ? { date, totals: { households: 0, people: 0, adults: 0, kids: 0 }, entries: [] } : await cafeDayVisits(date) })
    return json(200, { data: await cafeMonth(month!, today) })
  } catch (e) {
    console.error(`[admin/cafe-visits] ${e instanceof Error ? e.message : e}`)
    return json(503, { error: "Craft Café visits couldn't be loaded. Try again." })
  }
}
