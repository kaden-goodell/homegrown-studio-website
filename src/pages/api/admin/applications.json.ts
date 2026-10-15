import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { listApplications, setApplicationStatus, STATUSES, type ApplicationStatus } from '@lib/artist-applications'

export const prerender = false
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** GET: every artist application, newest first. POST { id, status }: move one along. Owners only. */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  return json(200, { data: { applications: await listApplications() } })
}

export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => ({}))
  if (!STATUSES.includes(body?.status)) return json(400, { error: 'Unknown status.' })
  const app = await setApplicationStatus(String(body?.id ?? ''), body.status as ApplicationStatus)
  return app ? json(200, { data: { application: app } }) : json(404, { error: 'Application not found.' })
}
