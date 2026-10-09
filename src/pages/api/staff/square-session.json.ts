import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { checkSession } from '@lib/square-dashboard'

export const prerender = false

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Staff-only, read-only: is the saved Square sign-in still good?
 * GET ?scheduleId=clssch_… reads that class from Square's dashboard API.
 * Never returns the session itself.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) return json({ error: 'Unauthorized' }, 401)
  const scheduleId = url.searchParams.get('scheduleId') ?? ''
  if (!/^clssch_[a-z0-9]+$/i.test(scheduleId)) return json({ error: 'scheduleId (clssch_…) is required' }, 400)
  return json({ data: await checkSession(scheduleId) })
}
