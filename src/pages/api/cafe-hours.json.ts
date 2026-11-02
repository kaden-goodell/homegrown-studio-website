import type { APIRoute } from 'astro'
import { cafeHoursEntries, formatCafeHours, formatCafeRange } from '@config/hours'
import { closureOn } from '@config/closures'
import { getStudioDays } from '@lib/studio-settings'
import { studioDate } from '@lib/studio-time'
import { publicListHeaders } from '@lib/cache-headers'

export const prerender = false

/** How far ahead special days are listed. */
const SPECIAL_AHEAD_DAYS = 60

/**
 * GET: Craft Café's walk-in hours as the owners set them on /admin (the
 * config until they first save). The prerendered /craft-cafe and home pages
 * ship the config's hours and swap these in when they load, so a change on
 * /admin shows without a deploy.
 *   weekly:  [{ days: 'Saturday', time: '9 AM – 12 PM' }]
 *   special: the coming special days (not on a closed day), soonest first
 */
export const GET: APIRoute = async ({ request }) => {
  const studio = await getStudioDays()
  const today = studioDate(new Date().toISOString())
  const until = new Date(Date.parse(`${today}T12:00:00Z`) + SPECIAL_AHEAD_DAYS * 86_400_000).toISOString().slice(0, 10)
  const special = studio.cafe.special
    .filter((d) => d.date >= today && d.date <= until && !closureOn(d.date, studio.closures))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, name: d.name, time: formatCafeRange(d.opens, d.closes) }))
  return new Response(JSON.stringify({ data: { weekly: formatCafeHours(cafeHoursEntries(studio.cafe)), special } }), {
    status: 200,
    headers: publicListHeaders(request),
  })
}
