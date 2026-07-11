import { createHmac, timingSafeEqual } from 'node:crypto'
import { createLogger } from '@lib/logger'

const TTL_MS = 15 * 60 * 1000
const logger = createLogger('reuse-token')
let warned = false

function secret(): string {
  const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  const s = env.LOOKUP_SIGNING_SECRET || process.env.LOOKUP_SIGNING_SECRET || env.STAFF_PASSCODE || process.env.STAFF_PASSCODE
  if (s) return s
  // Fixed fallback so issue (lookup route) and verify (sign route) — separate
  // module scopes — always agree. Fine in dev; in prod this is a config error.
  if (env.PROD && !warned) { warned = true; logger.error('LOOKUP_SIGNING_SECRET unset in production — reuse tokens are not secret') }
  return 'dev-only-not-a-secret'
}

const sig = (payload: string) => createHmac('sha256', secret()).update(payload).digest('hex')

export function issueReuseToken(recordId: string, now = Date.now()): string {
  const exp = now + TTL_MS
  return `${exp}.${sig(`${recordId}.${exp}`)}`
}

export function verifyReuseToken(recordId: string, token: string, now = Date.now()): boolean {
  const [expStr, mac] = String(token).split('.')
  const exp = Number(expStr)
  if (!exp || exp < now || !mac) return false
  const expected = sig(`${recordId}.${exp}`)
  const a = Buffer.from(String(mac))
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
