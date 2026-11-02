import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { adminConfigured, checkAdminPasscode, adminCookie, adminAuthorized, adminSignInCookie, clearAdminCookie } from '@lib/admin-auth'
import { _resetAdminPasscodeForTests } from '@lib/admin-passcode'

const req = (cookie?: string) => new Request('https://x.test/admin', { headers: cookie ? { cookie } : {} })
const value = (setCookie: string) => setCookie.split(';')[0]
beforeEach(async () => { await _resetAdminPasscodeForTests() })
afterEach(() => vi.unstubAllEnvs())

describe('admin-auth (owner-only /admin), ADMIN_PASSCODE until an owner sets one', () => {
  it('nobody gets in when no passcode is set', async () => {
    vi.stubEnv('ADMIN_PASSCODE', '')
    expect(await adminConfigured()).toBe(false)
    expect(await checkAdminPasscode('')).toBe(false)
    expect(await adminAuthorized(req('hg_admin=x.y'))).toBe(false)
    await expect(adminSignInCookie()).rejects.toThrow()
  })
  it('the right passcode gives a cookie that works; a wrong one does not', async () => {
    vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
    expect(await checkAdminPasscode('owner-secret')).toBe(true)
    expect(await checkAdminPasscode('nope')).toBe(false)
    expect(await adminAuthorized(req(value(await adminSignInCookie())))).toBe(true)
    // The setting's cookie is the same one handed out before owners could set a passcode.
    expect(value(adminCookie(1_000))).toBe(value(await adminSignInCookie(1_000)))
  })
  it('a tampered, expired, or staff cookie is refused', async () => {
    vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
    const good = value(adminCookie())
    expect(await adminAuthorized(req(good.slice(0, -2) + 'xx'))).toBe(false)
    expect(await adminAuthorized(req(value(adminCookie(Date.now() - 31 * 24 * 3600_000))))).toBe(false)
    expect(await adminAuthorized(req('hg_staff=abc.def'))).toBe(false)
  })
  it('changing the setting signs everyone out', async () => {
    vi.stubEnv('ADMIN_PASSCODE', 'one')
    const c = value(adminCookie())
    vi.stubEnv('ADMIN_PASSCODE', 'two')
    expect(await adminAuthorized(req(c))).toBe(false)
  })
  it('sign-out clears the cookie', () => {
    expect(clearAdminCookie()).toMatch(/^hg_admin=; .*Max-Age=0/)
  })
})
