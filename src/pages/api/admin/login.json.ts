import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { adminConfigured, checkAdminPasscode, adminCookie, clearAdminCookie } from '@lib/admin-auth'

export const prerender = false
const json = (status: number, body: unknown, cookie?: string) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } })

/** POST { passcode } signs the owner in to /admin; DELETE signs out. */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`admin-login:${clientAddress}`, 8, 15 * 60_000)) return json(429, { error: 'Too many tries. Wait a few minutes.' })
  if (!adminConfigured()) return json(503, { error: 'The admin passcode isn’t set up yet.' })
  const body = await request.json().catch(() => ({}))
  if (!checkAdminPasscode(String(body?.passcode ?? ''))) return json(401, { error: 'That passcode isn’t right.' })
  return json(200, { data: { ok: true } }, adminCookie())
}

export const DELETE: APIRoute = async () => json(200, { data: { ok: true } }, clearAdminCookie())
