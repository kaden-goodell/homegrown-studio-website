import { describe, it, expect, afterEach } from 'vitest'
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

  // HOM-218: the hard-coded 'dev-only-not-a-secret' fallback must never be
  // reachable in production — a deploy missing LOOKUP_SIGNING_SECRET should
  // fail loudly (throw) at first use, not silently sign tokens with a secret
  // anyone can read out of the source.
  //
  // Simulated via `process.env` (never `import.meta.env` directly) — Vite/
  // Astro give every module its own snapshot of `import.meta.env`, so a
  // mutation from this test file's snapshot never reaches reuse-token.ts's;
  // `process.env` is the one env surface every module actually shares, and
  // `secret()` already falls back to reading each var off it for exactly
  // this reason.
  describe('in production without LOOKUP_SIGNING_SECRET', () => {
    const originalProd = process.env.PROD
    const originalLookupSecret = process.env.LOOKUP_SIGNING_SECRET
    const originalStaffPasscode = process.env.STAFF_PASSCODE

    afterEach(() => {
      process.env.PROD = originalProd
      process.env.LOOKUP_SIGNING_SECRET = originalLookupSecret
      process.env.STAFF_PASSCODE = originalStaffPasscode
    })

    it('throws on issueReuseToken', () => {
      process.env.PROD = 'true'
      delete process.env.LOOKUP_SIGNING_SECRET
      expect(() => issueReuseToken('rec-abc')).toThrow('LOOKUP_SIGNING_SECRET is required in production')
    })

    it('throws on verifyReuseToken, even with STAFF_PASSCODE set (that fallback is dev/test-only)', () => {
      process.env.PROD = 'true'
      delete process.env.LOOKUP_SIGNING_SECRET
      process.env.STAFF_PASSCODE = 'some-staff-passcode'
      // Not-yet-expired so verifyReuseToken gets past its early exp check and
      // actually computes the mac (where secret() — and the throw — lives).
      const notExpiredToken = `${Date.now() + 100_000}.deadbeef`
      expect(() => verifyReuseToken('rec-abc', notExpiredToken)).toThrow('LOOKUP_SIGNING_SECRET is required in production')
    })

    it('does not throw when LOOKUP_SIGNING_SECRET is set', () => {
      process.env.PROD = 'true'
      process.env.LOOKUP_SIGNING_SECRET = 'a-real-secret'
      expect(() => issueReuseToken('rec-abc')).not.toThrow()
    })
  })
})
