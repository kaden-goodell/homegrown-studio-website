/**
 * Owner-only admin page (/admin), separate from the staff console (Kaden,
 * 15 Oct 2026: "an admin page outside of the staff page"). Its own passcode,
 * ADMIN_PASSCODE, set in Netlify; then a signed cookie for 30 days. Same
 * shape as staff-auth: HMAC-signed with the passcode, so rotating the
 * passcode signs everyone out. No passcode set = nobody gets in.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { By } from '@lib/staff-auth'
import { ADMIN_WHO_HEADER, ownerOf } from '@lib/admin-who'

const COOKIE = 'hg_admin'
const MAX_AGE = 30 * 24 * 60 * 60 // 30 days, in seconds

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}
const passcode = () => env('ADMIN_PASSCODE')
const isProd = () => !!((typeof import.meta !== 'undefined' && (import.meta as any).env) || {}).PROD
const sign = (payload: string) => createHmac('sha256', passcode() + ':admin-cookie').update(payload).digest('base64url')

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export const adminConfigured = () => !!passcode()

export function checkAdminPasscode(input: string): boolean {
  const p = passcode()
  return !!p && typeof input === 'string' && safeEq(input, p)
}

export function adminCookie(iat = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ admin: true, iat })).toString('base64url')
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly;${isProd() ? ' Secure;' : ''} SameSite=Lax; Max-Age=${MAX_AGE}`
}

export function clearAdminCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly;${isProd() ? ' Secure;' : ''} SameSite=Lax; Max-Age=0`
}

/** True when the request carries a valid, unexpired admin cookie. */
export function adminAuthorized(request: Request): boolean {
  if (!adminConfigured()) return false
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|; )${COOKIE}=([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)`))
  if (!m) return false
  const [, payload, sig] = m
  if (!safeEq(sig, sign(payload))) return false
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return p.admin === true && typeof p.iat === 'number' && Date.now() - p.iat <= MAX_AGE * 1000
  } catch {
    return false
  }
}

/**
 * Who made an admin change: the owner named in the X-Admin-Who header when it
 * is on the fixed owner list, else the plain "Owner" (an old tab, or a script).
 */
export function adminActor(request: Request): By {
  const owner = ownerOf(request.headers.get(ADMIN_WHO_HEADER))
  return owner ? { id: `owner-${owner.toLowerCase()}`, name: owner } : { id: 'admin', name: 'Owner' }
}
