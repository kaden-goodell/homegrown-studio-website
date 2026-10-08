import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAudit = vi.fn()
vi.mock('@lib/audit', () => ({ recordAudit: (...a: any[]) => mockAudit(...a) }))
vi.mock('@lib/staff-auth', () => ({
  checkPasscode: (p: string) => p === 'right',
  passcodeConfigured: () => true,
  staffCookie: () => 'hg_staff=abc.def',
}))
vi.mock('@lib/staff-directory', () => ({
  listStaff: async () => [{ id: 'm1', name: 'Mara', role: 'crew' }],
}))
vi.mock('@lib/rate-limit', () => ({ rateLimited: () => false }))

import { POST } from '../../src/pages/api/staff/pick.json'

const call = (body: unknown) =>
  POST({ request: new Request('http://x/api/staff/pick.json', { method: 'POST', body: JSON.stringify(body) }), clientAddress: '1.2.3.4' } as any)

beforeEach(() => mockAudit.mockReset())

describe('POST /api/staff/pick.json', () => {
  it('sets the cookie and records staff.signed-in with the member picked', async () => {
    const res = await call({ passcode: 'right', staffId: 'm1' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toBe('hg_staff=abc.def')
    expect(mockAudit).toHaveBeenCalledTimes(1)
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'staff.signed-in',
      by: { id: 'm1', name: 'Mara', role: 'crew' },
      target: expect.objectContaining({ kind: 'staff', id: 'm1' }),
    }))
  })

  it('records nothing on a wrong passcode or unknown member', async () => {
    expect((await call({ passcode: 'wrong', staffId: 'm1' })).status).toBe(401)
    expect((await call({ passcode: 'right', staffId: 'nobody' })).status).toBe(400)
    expect(mockAudit).not.toHaveBeenCalled()
  })
})
