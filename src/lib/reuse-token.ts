import { createHmac, timingSafeEqual } from 'node:crypto'
import { createLogger } from '@lib/logger'

const TTL_MS = 15 * 60 * 1000
const logger = createLogger('reuse-token')
let warned = false

function secret(): string {
  const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  const lookupSecret = env.LOOKUP_SIGNING_SECRET || process.env.LOOKUP_SIGNING_SECRET
  if (lookupSecret) return lookupSecret
  // HOM-218: the hard-coded fallback below must never be used silently in
  // production — LOOKUP_SIGNING_SECRET is a documented, Netlify-set env var
  // (see .env.example / docs/NEEDS-FROM-KADEN.md); a deploy missing it is a
  // config error we want to fail loudly on, not limp along on STAFF_PASSCODE
  // or the dev fallback. Checks `process.env.PROD` too, alongside the usual
  // `import.meta.env.PROD` — Vite/Astro give every module its own snapshot
  // of `import.meta.env`, so a test simulating a prod deploy can only flip
  // this via the one env object every module actually shares.
  if (env.PROD || process.env.PROD === 'true') {
    throw new Error('LOOKUP_SIGNING_SECRET is required in production')
  }
  const staffPasscode = env.STAFF_PASSCODE || process.env.STAFF_PASSCODE
  if (staffPasscode) return staffPasscode
  // Fixed fallback so issue (lookup route) and verify (sign route) — separate
  // module scopes — always agree. Dev/test only — production throws above.
  if (!warned) { warned = true; logger.error('LOOKUP_SIGNING_SECRET unset — reuse tokens use a non-secret dev fallback') }
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
