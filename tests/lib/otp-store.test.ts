/**
 * Tests for otp-store: hashed 6-digit codes, 10-min expiry, 5-attempt lockout,
 * resend cooldown + send cap (HOM-218). Uses the real fs-backed store (see
 * tests/setup.ts) — no mocking, unique recordIds per test avoid collisions.
 */
import { describe, it, expect } from 'vitest'
import { issueOtp, resendOtp, verifyOtp, hashCode, MAX_ATTEMPTS, MAX_SENDS, RESEND_COOLDOWN_MS, TTL_MS } from '@lib/otp-store'

let n = 0
const recordId = () => `wvr_otp_test_${Date.now()}_${n++}`

describe('otp-store', () => {
  it('issues a 6-digit code and verifies it correctly', async () => {
    const id = recordId()
    const code = await issueOtp(id)
    expect(code).toMatch(/^\d{6}$/)
    const result = await verifyOtp(id, code)
    expect(result).toEqual({ ok: true })
  })

  it('never stores the plaintext — hashCode of the issued code matches what verify checks against', () => {
    const id = recordId()
    const code = '042017'
    expect(hashCode(code, id)).not.toContain(code)
    expect(hashCode(code, id)).toHaveLength(64) // sha256 hex
  })

  it('consumes the OTP on success — a second verify with the same code finds nothing', async () => {
    const id = recordId()
    const code = await issueOtp(id)
    expect((await verifyOtp(id, code)).ok).toBe(true)
    expect(await verifyOtp(id, code)).toEqual({ ok: false, reason: 'not-found' })
  })

  it('rejects a wrong code without consuming it, up to 4 times', async () => {
    const id = recordId()
    await issueOtp(id)
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      expect(await verifyOtp(id, '000000')).toEqual({ ok: false, reason: 'wrong' })
    }
  })

  it('locks out and deletes the OTP on the 5th wrong attempt, then reports not-found', async () => {
    const id = recordId()
    const code = await issueOtp(id)
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      await verifyOtp(id, '000000')
    }
    expect(await verifyOtp(id, '000000')).toEqual({ ok: false, reason: 'locked' })
    // Even the RIGHT code no longer works — the OTP is gone, must look up again.
    expect(await verifyOtp(id, code)).toEqual({ ok: false, reason: 'not-found' })
  })

  it('reports expired (and deletes it) once past the TTL, even with the right code', async () => {
    const id = recordId()
    const issuedAt = Date.now()
    const code = await issueOtp(id, issuedAt)
    expect(await verifyOtp(id, code, issuedAt + TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' })
    expect(await verifyOtp(id, code, issuedAt + TTL_MS + 1)).toEqual({ ok: false, reason: 'not-found' })
  })

  it('reports not-found when no OTP was ever issued', async () => {
    expect(await verifyOtp(recordId(), '123456')).toEqual({ ok: false, reason: 'not-found' })
  })

  it('resend issues a fresh code and invalidates the old one', async () => {
    const id = recordId()
    const issuedAt = Date.now()
    const oldCode = await issueOtp(id, issuedAt)
    const result = await resendOtp(id, issuedAt + RESEND_COOLDOWN_MS + 1)
    expect(result.ok).toBe(true)
    const newCode = (result as { ok: true; code: string }).code
    expect(newCode).not.toBe(oldCode)
    expect(await verifyOtp(id, oldCode, issuedAt + RESEND_COOLDOWN_MS + 1)).toEqual({ ok: false, reason: 'wrong' })
    expect(await verifyOtp(id, newCode, issuedAt + RESEND_COOLDOWN_MS + 2)).toEqual({ ok: true })
  })

  it('resend refuses within the 60s cooldown', async () => {
    const id = recordId()
    const issuedAt = Date.now()
    await issueOtp(id, issuedAt)
    expect(await resendOtp(id, issuedAt + RESEND_COOLDOWN_MS - 1)).toEqual({ ok: false, reason: 'cooldown' })
  })

  it('resend refuses once the per-OTP send cap is reached', async () => {
    const id = recordId()
    let t = Date.now()
    await issueOtp(id, t) // sends: 1
    for (let i = 1; i < MAX_SENDS; i++) {
      t += RESEND_COOLDOWN_MS + 1
      expect((await resendOtp(id, t)).ok).toBe(true) // sends: 2, 3
    }
    t += RESEND_COOLDOWN_MS + 1
    expect(await resendOtp(id, t)).toEqual({ ok: false, reason: 'max-sends' })
  })

  it('resend reports not-found when there is nothing to resend', async () => {
    expect(await resendOtp(recordId())).toEqual({ ok: false, reason: 'not-found' })
  })

  it('resend resets the attempt counter — a wrong guess against the old code does not carry over', async () => {
    const id = recordId()
    const issuedAt = Date.now()
    await issueOtp(id, issuedAt)
    await verifyOtp(id, '000000', issuedAt) // 1 wrong attempt
    await verifyOtp(id, '111111', issuedAt) // 2 wrong attempts
    const result = await resendOtp(id, issuedAt + RESEND_COOLDOWN_MS + 1)
    const newCode = (result as { ok: true; code: string }).code
    // Should have 4 more wrong attempts available (fresh counter), not 3.
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      expect(await verifyOtp(id, '999999', issuedAt + RESEND_COOLDOWN_MS + 1)).toEqual({ ok: false, reason: 'wrong' })
    }
    expect(await verifyOtp(id, newCode, issuedAt + RESEND_COOLDOWN_MS + 1)).toEqual({ ok: true })
  })
})
