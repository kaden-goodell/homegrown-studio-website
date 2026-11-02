import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { listMuted, messagesMuted } from '@lib/preview-outbound'

export const prerender = false
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * GET (owners only): `{ data: { muted, messages } }`. `muted` is true only on
 * the sandbox preview, where no email or text is sent (preview-outbound.ts);
 * `messages` are the ones it would have sent, newest first (empty elsewhere).
 * The sandbox end-to-end suite refuses to run unless `muted` is true.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const muted = messagesMuted()
  return json(200, { data: { muted, messages: muted ? await listMuted() : [] } })
}
