/**
 * Staff identity: a shared passcode gates entry, then a signed cookie carries
 * WHO is signed in (`{ id, name, role }`) so every custody/kit action can be
 * stamped with a real name instead of "staff". The cookie is HMAC-signed
 * (never trust an unsigned client claim), so tampering with the payload or the
 * signature is rejected, and it expires after 12h.
 *
 * The passcode: the one an owner set in /admin (staff-passcode.ts, a salted
 * hash) when there is one, else the STAFF_PASSCODE setting. The signing key
 * comes from whichever is in use (the stored hash plus its generation, or the
 * setting), so changing the passcode signs everyone out of /staff.
 *
 * Every signed-in request also checks the person still works here (the staff
 * list): someone marked "No longer working here" is refused at once, not after
 * their cookie runs out. When the list can't be read at all, the cookie is
 * allowed (logged), so a store blip never locks the door; the two fallback
 * owner ids (handed out only while the list is unreadable) are allowed too.
 *
 * `Secure` is added only in prod builds — `netlify dev` serves plain http, and
 * Safari (unlike Chrome) drops `Secure` cookies over http, breaking local dev.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createLogger } from '@lib/logger'
import { FALLBACK_IDS, staffIdStatus } from '@lib/staff-directory'
import { matchesRecord, readPasscodeRecord } from '@lib/staff-passcode'

const COOKIE = 'hg_staff'
const MAX_AGE = 12 * 60 * 60 // 12h, in seconds

export interface StaffMember {
  id: string
  name: string
  role: 'owner' | 'crew'
}

export type By = { id: string; name: string }

function envPasscode(): string {
  const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return env.STAFF_PASSCODE || (typeof process !== 'undefined' ? process.env.STAFF_PASSCODE : '') || ''
}

function isProd(): boolean {
  const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return !!env.PROD
}

const logger = createLogger('staff-auth')

/** What the door checks against right now: a signing key and a passcode check. null = nobody gets in. */
interface Access { key: string; check: (input: string) => Promise<boolean> }

async function access(): Promise<Access | null> {
  const rec = await readPasscodeRecord()
  if (rec === 'unreadable') return null
  if (rec) return { key: `${rec.hash}:${rec.gen}:cookie`, check: (input) => matchesRecord(rec, input) }
  const env = envPasscode()
  if (!env) return null
  // The same key as before owners could set a passcode, so cookies already handed out keep working.
  return { key: env + ':cookie', check: async (input) => typeof input === 'string' && safeEq(input, env) }
}

const sign = (key: string, payload: string) => createHmac('sha256', key).update(payload).digest('base64url')

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** True when there is a staff passcode (set in /admin, or STAFF_PASSCODE) and it can be read. */
export async function passcodeConfigured(): Promise<boolean> {
  return !!(await access())
}

export async function checkPasscode(input: string): Promise<boolean> {
  const a = await access()
  return !!a && !!input && (await a.check(input))
}

export async function staffCookie(member: StaffMember, iat = Date.now()): Promise<string> {
  const a = await access()
  if (!a) throw new Error('Staff passcode unavailable')
  const payload = Buffer.from(JSON.stringify({ ...member, iat })).toString('base64url')
  const secure = isProd() ? ' Secure;' : ''
  return `${COOKIE}=${payload}.${sign(a.key, payload)}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${MAX_AGE}`
}

export function clearStaffCookie(): string {
  const secure = isProd() ? ' Secure;' : ''
  return `${COOKIE}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`
}

/**
 * Who's signed in, or null when the cookie is absent, tampered, expired, from
 * before the passcode changed, or belongs to someone who no longer works here.
 */
export async function staffAuthorized(request: Request): Promise<StaffMember | null> {
  const cookie = request.headers.get('cookie') || ''
  const m = cookie.match(new RegExp(`(?:^|; )${COOKIE}=([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)`))
  if (!m) return null
  const a = await access()
  if (!a) return null
  const [, payload, sig] = m
  if (!safeEq(sig, sign(a.key, payload))) return null
  let member: StaffMember
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (typeof p.iat !== 'number' || Date.now() - p.iat > MAX_AGE * 1000) return null
    if (!p.id || !p.name || (p.role !== 'owner' && p.role !== 'crew')) return null
    member = { id: String(p.id), name: String(p.name), role: p.role }
  } catch {
    return null
  }
  if (FALLBACK_IDS.has(member.id)) return member
  const status = await staffIdStatus(member.id)
  if (status === 'no') return null
  if (status === 'unknown') logger.warn('Staff list unreadable — letting a signed-in person through', { id: member.id })
  return member
}

/** The bit of a StaffMember worth stamping onto a custody/kit event. */
export const byOf = (m: StaffMember): By => ({ id: m.id, name: m.name })
