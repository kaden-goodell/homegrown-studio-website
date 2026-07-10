import { describe, it, expect } from 'vitest'
import { issueReuseToken, verifyReuseToken } from '@lib/reuse-token'

describe('issueReuseToken / verifyReuseToken', () => {
  it('round-trips: a fresh token verifies against its recordId', () => {
    const now = Date.now()
    const token = issueReuseToken('rec-abc', now)
    expect(verifyReuseToken('rec-abc', token, now)).toBe(true)
  })

  it('rejects a tampered payload (wrong mac)', () => {
    const now = Date.now()
    const token = issueReuseToken('rec-abc', now)
    // Flip one character in the mac portion
    const [exp, mac] = token.split('.')
    const badMac = mac.slice(0, -1) + (mac.endsWith('a') ? 'b' : 'a')
    expect(verifyReuseToken('rec-abc', `${exp}.${badMac}`, now)).toBe(false)
  })

  it('rejects an expired token', () => {
    const TTL_MS = 15 * 60 * 1000
    const issuedAt = Date.now()
    const token = issueReuseToken('rec-abc', issuedAt)
    // Verify at issuedAt + TTL + 1ms (just past expiry)
    expect(verifyReuseToken('rec-abc', token, issuedAt + TTL_MS + 1)).toBe(false)
  })

  it('accepts a token right at expiry boundary', () => {
    const TTL_MS = 15 * 60 * 1000
    const issuedAt = Date.now()
    const token = issueReuseToken('rec-abc', issuedAt)
    // Exactly at the expiry ms: exp === now, so exp < now is false → valid
    const [expStr] = token.split('.')
    const exp = Number(expStr)
    expect(verifyReuseToken('rec-abc', token, exp)).toBe(true)
  })

  it('token is bound to recordId: verify with different recordId fails', () => {
    const now = Date.now()
    const token = issueReuseToken('rec-abc', now)
    expect(verifyReuseToken('rec-xyz', token, now)).toBe(false)
  })
})
