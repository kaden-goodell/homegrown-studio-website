import { describe, it, expect, vi, afterEach } from 'vitest'
import { adminConfigured, checkAdminPasscode, adminCookie, adminAuthorized, clearAdminCookie } from '@lib/admin-auth'

const req = (cookie?: string) => new Request('https://x.test/admin', { headers: cookie ? { cookie } : {} })
const value = (setCookie: string) => setCookie.split(';')[0]
afterEach(() => vi.unstubAllEnvs())

describe('admin-auth (owner-only /admin)', () => {
  it('nobody gets in when no passcode is set', () => {
    vi.stubEnv('ADMIN_PASSCODE', '')
    expect(adminConfigured()).toBe(false)
    expect(checkAdminPasscode('')).toBe(false)
    expect(adminAuthorized(req('hg_admin=x.y'))).toBe(false)
  })
  it('the right passcode gives a cookie that works; a wrong one does not', () => {
    vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
    expect(checkAdminPasscode('owner-secret')).toBe(true)
    expect(checkAdminPasscode('nope')).toBe(false)
    expect(adminAuthorized(req(value(adminCookie())))).toBe(true)
  })
  it('a tampered, expired, or staff cookie is refused', () => {
    vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
    const good = value(adminCookie())
    expect(adminAuthorized(req(good.slice(0, -2) + 'xx'))).toBe(false)
    expect(adminAuthorized(req(value(adminCookie(Date.now() - 31 * 24 * 3600_000))))).toBe(false)
    expect(adminAuthorized(req('hg_staff=abc.def'))).toBe(false)
  })
  it('changing the passcode signs everyone out', () => {
    vi.stubEnv('ADMIN_PASSCODE', 'one')
    const c = value(adminCookie())
    vi.stubEnv('ADMIN_PASSCODE', 'two')
    expect(adminAuthorized(req(c))).toBe(false)
  })
  it('sign-out clears the cookie', () => {
    expect(clearAdminCookie()).toMatch(/^hg_admin=; .*Max-Age=0/)
  })
})
