/**
 * The two safety rules every file the site hands out follows (the weekly
 * archive email, /admin › More › Records, the tax spreadsheet):
 *
 * 1. `redactSecrets`: no keys to anything. Party host links (`hostToken`),
 *    payment links (`payToken`), card tokens, pickup-code hashes and any
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
const SECRET_KEY_RE = /(token|tokens|hash|secret|passcode|password)$/i
/** Not secrets: a fingerprint of a request's own inputs, used to spot repeats. */
const KEEP_KEYS = new Set(['inputHash'])

export function isSecretKey(key: string): boolean {
  return !KEEP_KEYS.has(key) && SECRET_KEY_RE.test(key)
}

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
