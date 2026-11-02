import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { adminConfigured, checkAdminPasscode, adminSignInCookie, clearAdminCookie } from '@lib/admin-auth'
import { ownerNames } from '@lib/admin-owners'
import { ADMIN_PASSCODE_BUCKET, ADMIN_PASSCODE_MAX_TRIES, ADMIN_PASSCODE_WINDOW_MS, TOO_MANY_TRIES } from '@lib/admin-passcode'

export const prerender = false
const json = (status: number, body: unknown, cookie?: string) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } })

/**
 * POST { passcode } signs the owner in to /admin → { ok, owners } (the
 * owners' names, for "Who's using this?"). DELETE signs out.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(ADMIN_PASSCODE_BUCKET(clientAddress), ADMIN_PASSCODE_MAX_TRIES, ADMIN_PASSCODE_WINDOW_MS)) return json(429, { error: TOO_MANY_TRIES })
  if (!(await adminConfigured())) return json(503, { error: 'The admin passcode isn’t set up yet.' })
  const body = await request.json().catch(() => ({}))
  if (!(await checkAdminPasscode(String(body?.passcode ?? '')))) return json(401, { error: 'That passcode isn’t right.' })
  const cookie = await adminSignInCookie()
  return json(200, { data: { ok: true, owners: await ownerNames() } }, cookie)
}

export const DELETE: APIRoute = async () => json(200, { data: { ok: true } }, clearAdminCookie())
