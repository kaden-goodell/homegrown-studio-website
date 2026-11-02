import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { adminDoor, checkAdminPasscode, adminSignInCookie, clearAdminCookie } from '@lib/admin-auth'
import { ownerNames } from '@lib/admin-owners'
import { ADMIN_PASSCODE_BUCKET, ADMIN_PASSCODE_MAX_TRIES, ADMIN_PASSCODE_WINDOW_MS, TOO_MANY_TRIES } from '@lib/admin-passcode'
import { ADMIN_LOCKED_MESSAGE, adminSignInLocked, noteAdminFailedSignIn } from '@lib/admin-signin-failures'

export const prerender = false
const json = (status: number, body: unknown, cookie?: string) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } })

export const LOGIN_MESSAGES = {
  wrong: 'That passcode isn’t right.',
  /** L3: nothing is trimmed, so say so when the typed one has a space at an end. */
  wrongSpaces: 'That passcode isn’t right. It starts or ends with a space: check for that.',
  unreadable: 'We couldn’t check the passcode just now. Try again in a minute.',
  damaged: 'The saved admin passcode is damaged, so it can’t be checked. Tap “Forgot the passcode?” to set a new one by email.',
  none: 'There’s no admin passcode yet. Tap “Forgot the passcode?” to set one by email.',
} as const

/**
 * POST { passcode } signs the owner in to /admin → { ok, owners } (the
 * owners' names, for "Who's using this?"). DELETE signs out.
 * 503 { error, door: 'unreadable' | 'damaged' | 'none' } when nobody can sign
 * in, with a different message for each (M3). Wrong passcodes count per
 * address (memory) and for the whole site (store, L1); a day with very many
 * pauses passcode sign-in (the emailed link still works).
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(ADMIN_PASSCODE_BUCKET(clientAddress), ADMIN_PASSCODE_MAX_TRIES, ADMIN_PASSCODE_WINDOW_MS)) return json(429, { error: TOO_MANY_TRIES })
  if (await adminSignInLocked()) return json(429, { error: ADMIN_LOCKED_MESSAGE, locked: true })
  const door = await adminDoor()
  if (door !== 'open') return json(503, { error: LOGIN_MESSAGES[door], door })
  const body = await request.json().catch(() => ({}))
  const typed = typeof body?.passcode === 'string' ? body.passcode : ''
  if (!(await checkAdminPasscode(typed))) {
    await noteAdminFailedSignIn()
    return json(401, { error: typed && typed !== typed.trim() ? LOGIN_MESSAGES.wrongSpaces : LOGIN_MESSAGES.wrong })
  }
  const cookie = await adminSignInCookie()
  return json(200, { data: { ok: true, owners: await ownerNames() } }, cookie)
}

export const DELETE: APIRoute = async () => json(200, { data: { ok: true } }, clearAdminCookie())
