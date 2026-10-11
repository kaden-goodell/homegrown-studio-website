/**
 * Catching mistyped emails (11 Oct 2026: a customer booked as
 * "…phptography@gmail.com" and never got her confirmation).
 *
 * Client-safe: no imports.
 */

/** The providers our customers actually use. A typo near one of these gets a "Did you mean…?". */
const COMMON_DOMAINS = [
  'gmail.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'me.com', 'mac.com', 'live.com', 'msn.com', 'att.net', 'comcast.net', 'bellsouth.net',
  'charter.net', 'ymail.com', 'protonmail.com',
]

/** How many single-letter changes (add, drop, swap neighbours, replace) turn a into b. */
export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  if (Math.abs(m - n) > 3) return 99
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[m][n]
}

/**
 * "jane@gmial.com" → "jane@gmail.com". Only for a domain one or two letters
 * off a common one, so a real but unusual address is never second-guessed.
 * Null when there is nothing to suggest.
 */
export function suggestEmailFix(email: string): string | null {
  const trimmed = email.trim()
  const at = trimmed.lastIndexOf('@')
  if (at < 1 || at === trimmed.length - 1) return null
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1).toLowerCase()
  if (COMMON_DOMAINS.includes(domain)) return null
  let best: string | null = null
  let bestDistance = 3
  for (const known of COMMON_DOMAINS) {
    const distance = editDistance(domain, known)
    if (distance < bestDistance) { best = known; bestDistance = distance }
  }
  // A short domain two letters off is too likely a different, real domain.
  if (!best || (bestDistance === 2 && domain.length < 8)) return null
  return `${local}@${best}`
}

/**
 * The same address with a slip of a letter or two — "phptography" vs
 * "photography". Not the same address, and not two different ones.
 */
export function isNearMiss(a: string, b: string): boolean {
  const x = a.trim().toLowerCase()
  const y = b.trim().toLowerCase()
  if (!x || !y || x === y) return false
  return editDistance(x, y) <= 2
}
