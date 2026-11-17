/**
 * Review (16 Nov 2026): every charge and refund carries its own idempotency
 * key (a retry never charges or refunds twice), and Square's 45-character
 * limit is checked before anything is sent.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { SQUARE_KEY_MAX, checkSquareKey } from '@providers/square/idempotency'
import { attemptKey } from '@lib/checkout-attempt'

const ROOT = join(__dirname, '..', '..')
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(n)) out.push(p)
  }
  return out
}

describe('idempotency keys on money calls', () => {
  it('every processPayment / refundPayment / chargeSavedCard call outside the providers passes an idempotencyKey', () => {
    const missing: string[] = []
    for (const f of walk(join(ROOT, 'src'))) {
      if (f.includes(`${join('src', 'providers')}`)) continue
      const text = readFileSync(f, 'utf8')
      const re = /\.(processPayment|refundPayment|chargeSavedCard)\(\{/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        // The call's object literal: up to its matching close brace.
        let depth = 0, i = m.index + m[0].length - 1, end = i
        for (; i < text.length; i++) { if (text[i] === '{') depth++; else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break } } }
        if (!/\bidempotencyKey\s*:/.test(text.slice(m.index, end))) missing.push(`${relative(ROOT, f)}:${text.slice(0, m.index).split('\n').length} ${m[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('Square’s limit is 45; keys over it are refused before sending; ours fit', () => {
    expect(SQUARE_KEY_MAX).toBe(45)
    expect(() => checkSquareKey('x'.repeat(46))).toThrow(/45/)
    expect(() => checkSquareKey('')).toThrow()
    expect(checkSquareKey(attemptKey('9a2b8a0e-5c1d-4e7a-9b3c-000000000001', 'pay'))).toBe('9a2b8a0e-5c1d-4e7a-9b3c-000000000001:pay')
    // refund requests: 'refund:' + a 38-character request id is exactly 45.
    expect(() => checkSquareKey(`refund:${'r'.repeat(38)}`)).not.toThrow()
  })
})
