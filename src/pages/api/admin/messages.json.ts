import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { listMessages, setMessageStatus, STATUSES, type MessageStatus } from '@lib/contact-messages'

export const prerender = false
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** GET: every contact message, newest first. POST { id, status }: mark one replied. Owners only. */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  return json(200, { data: { messages: await listMessages() } })
}

export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => ({}))
  if (!STATUSES.includes(body?.status)) return json(400, { error: 'Unknown status.' })
  const updated = await setMessageStatus(String(body?.id ?? ''), body.status as MessageStatus)
  return updated ? json(200, { data: { message: updated } }) : json(404, { error: 'Message not found.' })
}
