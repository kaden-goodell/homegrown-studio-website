import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { listRequests, setRequestStatus, STATUSES, type RequestStatus } from '@lib/event-requests'

export const prerender = false
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** GET: every private event request, newest first. POST { id, status }: move one along. Owners only. */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  return json(200, { data: { requests: await listRequests() } })
}

export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => ({}))
  if (!STATUSES.includes(body?.status)) return json(400, { error: 'Unknown status.' })
  const updated = await setRequestStatus(String(body?.id ?? ''), body.status as RequestStatus)
  return updated ? json(200, { data: { request: updated } }) : json(404, { error: 'Request not found.' })
}
