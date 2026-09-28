import { describe, it, expect, beforeEach } from 'vitest'
import { staffCookie, staffAuthorized, checkPasscode } from '@lib/staff-auth'

const member = { id: 'kaden', name: 'Kaden', role: 'owner' as const }
const req = (cookie: string) => new Request('http://x/', { headers: { cookie } })

describe('staff-auth', () => {
  beforeEach(() => {
    process.env.STAFF_PASSCODE = 'secret-123'
  })

  it('round-trips a signed cookie', () => {
    const c = staffCookie(member).split(';')[0]
    expect(staffAuthorized(req(c))).toEqual(member)
  })

  it('rejects a tampered payload', () => {
    const c = staffCookie(member).split(';')[0]
    const [k, v] = c.split('=')
    const [payload, sig] = v.split('.')
    const bad = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), role: 'crew', name: 'Mallory' }),
    ).toString('base64url')
    expect(staffAuthorized(req(`${k}=${bad}.${sig}`))).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const c = staffCookie(member).split(';')[0]
    expect(staffAuthorized(req(c.slice(0, -2) + 'zz'))).toBeNull()
  })

  it('rejects an expired cookie', () => {
    const c = staffCookie(member, Date.now() - 13 * 3600 * 1000).split(';')[0]
    expect(staffAuthorized(req(c))).toBeNull()
  })

  it('fails closed without a passcode', () => {
    const c = staffCookie(member).split(';')[0]
    process.env.STAFF_PASSCODE = ''
    expect(staffAuthorized(req(c))).toBeNull()
    expect(checkPasscode('anything')).toBe(false)
  })

  it('compares the passcode in constant time (no throw on length mismatch)', () => {
    expect(checkPasscode('x')).toBe(false)
    expect(checkPasscode('secret-123')).toBe(true)
  })
})
