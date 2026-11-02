/**
 * Owner-only admin page (/admin), separate from the staff console (Kaden,
 * 15 Oct 2026: "an admin page outside of the staff page"). Its own passcode,
 * then a signed cookie for 30 days.
 *
 * The passcode: the one an owner set in /admin › More › Admin access
 * (admin-passcode.ts, a salted hash) when there is one, else the
 * ADMIN_PASSCODE setting. The cookie is HMAC-signed with a key made from
 * whichever is in use (the stored hash plus its generation, or the setting),
 * so changing the passcode signs everyone out. No passcode at all = nobody
 * gets in. A saved passcode that is damaged or lost lets nobody in; a
 * deliberately NEW ADMIN_PASSCODE (changed after the last change in /admin)
 * takes over, the way back when nobody remembers it (admin-passcode.ts).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { By } from '@lib/staff-auth'
import { ADMIN_WHO_HEADER } from '@lib/admin-who'
import { resolveOwner } from '@lib/admin-owners'
import { envIsNewSince, matchesAdminRecord, readAdminPasscode } from '@lib/admin-passcode'

const COOKIE = 'hg_admin'
const MAX_AGE = 30 * 24 * 60 * 60 // 30 days, in seconds

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}
/** The ADMIN_PASSCODE setting (the fallback until an owner sets one in /admin). */
export const envAdminPasscode = () => env('ADMIN_PASSCODE')
const isProd = () => !!((typeof import.meta !== 'undefined' && (import.meta as any).env) || {}).PROD
const sign = (key: string, payload: string) => createHmac('sha256', key).update(payload).digest('base64url')
/** The key cookies were signed with before owners could set a passcode, so those cookies keep working. */
const envKey = (p: string) => p + ':admin-cookie'

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** What the door checks against right now: a signing key and a passcode check. null = nobody gets in. */
interface Access { key: string; check: (input: string) => Promise<boolean>; source: 'admin' | 'setting' }

async function access(): Promise<Access | null> {
  const state = await readAdminPasscode()
  if (state === 'unreadable') return null
  const p = envAdminPasscode()
  if (state.kind === 'set' && !envIsNewSince(state.marker, p)) {
    const rec = state.rec
    return { key: `${rec.hash}:${rec.gen}:admin-cookie`, check: (input) => matchesAdminRecord(rec, input), source: 'admin' }
  }
  // Once an owner has set one, only a deliberately NEW setting opens the door (forgotten or damaged passcode); the old one never comes back.
  if (state.kind !== 'none' && !envIsNewSince(state.marker, p)) return null
  if (!p) return null
  return { key: envKey(p), check: async (input) => typeof input === 'string' && safeEq(input, p), source: 'setting' }
}

/** True when there is an admin passcode (set in /admin, or ADMIN_PASSCODE) and it can be read. */
export async function adminConfigured(): Promise<boolean> {
  return !!(await access())
}

export async function checkAdminPasscode(input: string): Promise<boolean> {
  const a = await access()
  return !!a && typeof input === 'string' && !!input && (await a.check(input))
}

function cookieWith(key: string, iat: number): string {
  const payload = Buffer.from(JSON.stringify({ admin: true, iat })).toString('base64url')
  return `${COOKIE}=${payload}.${sign(key, payload)}; Path=/; HttpOnly;${isProd() ? ' Secure;' : ''} SameSite=Lax; Max-Age=${MAX_AGE}`
}

/** The sign-in cookie for the passcode in force now. Throws when there is none. */
export async function adminSignInCookie(iat = Date.now()): Promise<string> {
  const a = await access()
  if (!a) throw new Error('Admin passcode unavailable')
  return cookieWith(a.key, iat)
}

/**
 * A cookie signed with the ADMIN_PASSCODE setting. Only valid while no owner
 * has set a passcode in /admin (tests and the old sign-in path use it).
 * Sign-in uses adminSignInCookie().
 */
export function adminCookie(iat = Date.now()): string {
  return cookieWith(envKey(envAdminPasscode()), iat)
}

export function clearAdminCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly;${isProd() ? ' Secure;' : ''} SameSite=Lax; Max-Age=0`
}

/** True when the request carries a valid, unexpired admin cookie for the passcode in force now. */
export async function adminAuthorized(request: Request): Promise<boolean> {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|; )${COOKIE}=([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)`))
  if (!m) return false
  const a = await access()
  if (!a) return false
  const [, payload, sig] = m
  if (!safeEq(sig, sign(a.key, payload))) return false
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return p.admin === true && typeof p.iat === 'number' && Date.now() - p.iat <= MAX_AGE * 1000
  } catch {
    return false
  }
}

/**
 * Who made an admin change: the owner named in the X-Admin-Who header when
 * they are an owner now (the staff list's Owners; Catherine and Kaden until
 * that list exists), else the plain "Owner" (an old tab, a removed owner, or
 * a script).
 */
export async function adminActor(request: Request): Promise<By> {
  const owner = await resolveOwner(request.headers.get(ADMIN_WHO_HEADER))
  if (!owner) return { id: 'admin', name: 'Owner' }
  // The same id shape as always ('owner-catherine'), so records made before the owner list moved still match.
  return { id: `owner-${owner.name.toLowerCase()}`, name: owner.name }
}
