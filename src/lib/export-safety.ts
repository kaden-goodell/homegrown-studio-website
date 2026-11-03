/**
 * The two safety rules every file the site hands out follows (the weekly
 * archive email, /admin › More › Records, the tax spreadsheet):
 *
 * 1. `redactSecrets`: no keys to anything. Party host links (`hostToken`),
 *    payment links (`payToken`), card tokens, saved-card ids (`cardId`),
 *    waitlist leave-link hashes, pickup-code hashes and any
 *    other token, hash, secret or passcode are dropped from every record
 *    before it goes into a file. A record is still complete as evidence:
 *    none of these say who did what, they only open doors.
 * 2. `csvRow` / `csvCell`: a spreadsheet cell never runs as a formula. A
 *    value starting with = + - @ (or a tab or carriage return) gets a
 *    leading ' so Numbers or Excel shows it as text. Plain numbers ("-12.50")
 *    are left alone so money columns still add up.
 *
 * Pure, client-safe and alias-free on purpose: netlify/functions imports
 * archive-export.ts (which uses this) by a relative path.
 */

/** Keys that open something: tokens, hashes, secrets, passcodes. */
const SECRET_KEY_RE = /(token|tokens|hash|secret|passcode|password|salt)$/i
/** Not secrets: a fingerprint of a request's own inputs, used to spot repeats. */
const KEEP_KEYS = new Set(['inputHash'])
/**
 * Named keys that open something without the word in their name. `cardId`:
 * the Square card on file a waitlist joiner saved (stage 4); with the shop's
 * Square key it could be charged. Brand, last 4 and expiry stay as evidence.
 * (Waitlist leave links keep only `leaveHash`, reader and cancel links are
 * signed on the fly and never stored, so the rule above covers them.)
 * `fp` / `envFp` / `envSeen`: salted fingerprints of a passcode or key (the
 * /admin passcode marker, a tested Gmail or Quo key). `iv` / `ct` / `tag`: an
 * encrypted key pasted in /admin (AES-GCM parts). Those stores are never
 * exported at all (below); this is the second lock.
 */
const SECRET_KEYS = new Set(['cardId', 'fp', 'envFp', 'envSeen', 'iv', 'ct', 'tag'])

export function isSecretKey(key: string): boolean {
  return !KEEP_KEYS.has(key) && (SECRET_KEY_RE.test(key) || SECRET_KEYS.has(key))
}

/**
 * Stores never put in any file, even if someone lists them: `site-switches`
 * holds the online booking test link's secret; `staff-access` the staff
 * passcode's hash; `admin-access` the /admin passcode's hash, its marker,
 * recovery-link hashes and the wrong-passcode count; `outbound-keys` the
 * Gmail app password and Quo key pasted in /admin (encrypted) and the
 * "tested" fingerprints; `outbound-health` is service state, not a record.
 */
export const NEVER_EXPORTED_STORES: readonly string[] = ['site-switches', 'staff-access', 'admin-access', 'outbound-keys', 'outbound-health']

/** A deep copy of `value` with every secret key dropped (at any depth). */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v)) as unknown as T
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(k)) continue
    out[k] = redactSecrets(v)
  }
  return out as T
}

const PLAIN_NUMBER_RE = /^-?\d+(\.\d+)?$/
const FORMULA_START_RE = /^[=+\-@\t\r]/

/** One CSV cell: never a formula, quoted per RFC 4180 when needed. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v)
  if (FORMULA_START_RE.test(s) && !PLAIN_NUMBER_RE.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Rows to CSV text, each line ended with `eol`. */
export function csvRows(rows: unknown[][], eol: '\n' | '\r\n' = '\n'): string {
  return rows.map((r) => r.map(csvCell).join(',')).join(eol) + eol
}
