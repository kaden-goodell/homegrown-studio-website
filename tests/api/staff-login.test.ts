import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAudit = vi.fn()
vi.mock('@lib/audit', () => ({ recordAudit: (...a: any[]) => mockAudit(...a) }))
vi.mock('@lib/staff-auth', () => ({
  checkPasscode: (p: string) => p === 'right',
  passcodeConfigured: () => true,
  clearStaffCookie: () => 'hg_staff=; Max-Age=0',
}))
vi.mock('@lib/staff-directory', () => ({ listStaff: async () => [{ id: 'm1', name: 'Mara', role: 'crew' }] }))
vi.mock('@lib/rate-limit', () => ({ rateLimited: () => false }))

import { POST } from '../../src/pages/api/staff/login.json'

const call = (passcode: string) =>
  POST({ request: new Request('http://x/api/staff/login.json', { method: 'POST', body: JSON.stringify({ passcode }) }), clientAddress: '1.2.3.4' } as any)

beforeEach(() => mockAudit.mockReset())

describe('POST /api/staff/login.json', () => {
  it('logs a wrong passcode with where it came from', async () => {
    expect((await call('wrong')).status).toBe(401)
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'staff.login-refused',
      target: { kind: 'staff-login', id: '1.2.3.4' },
    }))
  })

  it('logs nothing for a right passcode (pick.json logs the sign-in)', async () => {
    expect((await call('right')).status).toBe(200)
    expect(mockAudit).not.toHaveBeenCalled()
  })
})
