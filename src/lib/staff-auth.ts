/**
 * Shared-passcode gate for the staff console. Set `STAFF_PASSCODE` in the
 * environment. Login checks the passcode and sets an httpOnly cookie holding a
 * hash of it (never the passcode itself); requests are checked against that.
 * Simple by design — email/password or Google sign-in can replace it later.
 */
import { createHash } from 'node:crypto'

const COOKIE = 'hg_staff'
const MAX_AGE = 12 * 60 * 60 // 12h

function passcode(): string {
  const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return env.STAFF_PASSCODE || (typeof process !== 'undefined' ? process.env.STAFF_PASSCODE : '') || ''
}

function token(): string {
  return createHash('sha256').update('hg-staff:' + passcode()).digest('hex')
}

export function passcodeConfigured(): boolean {
  return !!passcode()
}

export function checkPasscode(input: string): boolean {
  const p = passcode()
  return !!p && input === p
}

export function staffCookie(): string {
  return `${COOKIE}=${token()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}`
}

export function clearStaffCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export function staffAuthorized(request: Request): boolean {
  if (!passcodeConfigured()) return false
  const cookie = request.headers.get('cookie') || ''
  const m = cookie.match(new RegExp(`(?:^|; )${COOKIE}=([a-f0-9]+)`))
  return !!m && m[1] === token()
}
