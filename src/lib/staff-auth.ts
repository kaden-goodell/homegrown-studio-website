/**
 * Staff identity: a shared passcode gates entry, then a signed cookie carries
 * WHO is signed in (`{ id, name, role }`) so every custody/kit action can be
 * stamped with a real name instead of "staff". The cookie is HMAC-signed with
 * the passcode (never trust an unsigned client claim), so tampering with the
 * payload or the signature is rejected, and it expires after 12h.
 *
 * `Secure` is added only in prod builds — `netlify dev` serves plain http, and
 * Safari (unlike Chrome) drops `Secure` cookies over http, breaking local dev.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const COOKIE = 'hg_staff'
const MAX_AGE = 12 * 60 * 60 // 12h, in seconds

export interface StaffMember {
  id: string
  name: string
  role: 'owner' | 'crew'
}

export type By = { id: string; name: string }

function passcode(): string {
  const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return env.STAFF_PASSCODE || (typeof process !== 'undefined' ? process.env.STAFF_PASSCODE : '') || ''
}

function isProd(): boolean {
  const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return !!env.PROD
}

// The signing key is derived from the passcode — rotating STAFF_PASSCODE
// invalidates every outstanding cookie, which is the behavior we want.
const key = () => passcode() + ':cookie'
const sign = (payload: string) => createHmac('sha256', key()).update(payload).digest('base64url')

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function passcodeConfigured(): boolean {
  return !!passcode()
}

export function checkPasscode(input: string): boolean {
  const p = passcode()
  return !!p && safeEq(input, p)
}

export function staffCookie(member: StaffMember, iat = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...member, iat })).toString('base64url')
  const secure = isProd() ? ' Secure;' : ''
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${MAX_AGE}`
}

export function clearStaffCookie(): string {
  const secure = isProd() ? ' Secure;' : ''
  return `${COOKIE}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`
}

/** Verify the signed cookie and return who's signed in, or null if absent, tampered, or expired. */
export function staffAuthorized(request: Request): StaffMember | null {
  if (!passcodeConfigured()) return null
  const cookie = request.headers.get('cookie') || ''
  const m = cookie.match(new RegExp(`(?:^|; )${COOKIE}=([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)`))
  if (!m) return null
  const [, payload, sig] = m
  if (!safeEq(sig, sign(payload))) return null
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (typeof p.iat !== 'number' || Date.now() - p.iat > MAX_AGE * 1000) return null
    if (!p.id || !p.name || (p.role !== 'owner' && p.role !== 'crew')) return null
    return { id: String(p.id), name: String(p.name), role: p.role }
  } catch {
    return null
  }
}

/** The bit of a StaffMember worth stamping onto a custody/kit event. */
export const byOf = (m: StaffMember): By => ({ id: m.id, name: m.name })
