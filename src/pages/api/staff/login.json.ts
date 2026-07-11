import type { APIRoute } from 'astro'
import { checkPasscode, passcodeConfigured, staffCookie, clearStaffCookie } from '@lib/staff-auth'
import { rateLimited } from '@lib/rate-limit'

export const prerender = false

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`staff-login:${clientAddress}`, 5, 5 * 60_000)) {
    return new Response(JSON.stringify({ error: 'Too many attempts — wait a few minutes.' }), { status: 429 })
  }
  if (!passcodeConfigured()) {
    return new Response(JSON.stringify({ error: 'Staff access is not configured (set STAFF_PASSCODE).' }), { status: 503 })
  }
  const body = await request.json().catch(() => null)
  const passcode = typeof body?.passcode === 'string' ? body.passcode : ''
  if (!checkPasscode(passcode)) {
    return new Response(JSON.stringify({ error: 'Incorrect passcode.' }), { status: 401 })
  }
  return new Response(JSON.stringify({ data: { ok: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': staffCookie() },
  })
}

/** Log out. */
export const DELETE: APIRoute = async () => {
  return new Response(JSON.stringify({ data: { ok: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearStaffCookie() },
  })
}
