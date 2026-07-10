import type { APIRoute } from 'astro'
import { checkPasscode, passcodeConfigured, staffCookie, clearStaffCookie } from '@lib/staff-auth'

export const prerender = false

export const POST: APIRoute = async ({ request }) => {
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
