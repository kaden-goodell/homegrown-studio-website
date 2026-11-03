import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAudit = vi.fn()
const adminFails = vi.fn()
vi.mock('@lib/audit', () => ({ recordAudit: (...a: any[]) => mockAudit(...a) }))
vi.mock('@lib/staff-auth', () => ({
  checkPasscode: (p: string) => p === 'right',
  passcodeConfigured: () => true,
  staffCookie: (s: any) => `hg_staff=${s.id}.def`,
}))
vi.mock('@lib/admin-auth', () => ({
  adminConfigured: async () => true,
  checkAdminPasscode: async (p: string) => p === 'owner-secret',
}))
vi.mock('@lib/admin-signin-failures', () => ({ noteAdminFailedSignIn: async () => adminFails() }))
vi.mock('@lib/staff-directory', () => ({
  listStaff: async () => [{ id: 'm1', name: 'Mara', role: 'crew' }, { id: 'o1', name: 'Catherine', role: 'owner' }],
}))
vi.mock('@lib/staff-signin-failures', async (orig) => ({ ...(await orig<any>()), noteFailedSignIn: async () => {} }))

import { POST } from '../../src/pages/api/staff/pick.json'

let ip = 0
const call = (body: unknown, opts: { address?: string; device?: string } = {}) =>
  POST({
    request: new Request('http://x/api/staff/pick.json', { method: 'POST', body: JSON.stringify(body), headers: opts.device ? { cookie: `hg_device=${opts.device}` } : {} }),
    clientAddress: opts.address ?? `10.1.0.${++ip}`,
  } as any)

beforeEach(() => { mockAudit.mockReset(); adminFails.mockReset() })

describe('POST /api/staff/pick.json', () => {
  it('sets the cookie and records staff.signed-in with the member picked', async () => {
    const res = await call({ passcode: 'right', staffId: 'm1' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toBe('hg_staff=m1.def')
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

  it('N1: the staff passcode alone can’t make someone an owner', async () => {
    const res = await call({ passcode: 'right', staffId: 'o1' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'To sign in as Catherine, enter the admin passcode.', needsAdminPasscode: true })
    expect(res.headers.get('Set-Cookie') ?? '').not.toMatch(/hg_staff/)
    // The staff passcode typed into the admin passcode box doesn't do it either.
    const staffCode = await call({ passcode: 'right', staffId: 'o1', adminPasscode: 'right' })
    expect(staffCode.status).toBe(403)
    expect((await staffCode.json()).error).toBe('That admin passcode isn’t right.')
    expect(staffCode.headers.get('Set-Cookie') ?? '').not.toMatch(/hg_staff/)
    expect(adminFails).toHaveBeenCalledTimes(1)
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'staff.owner-signin-refused' }))
  })

  it('N1: the admin passcode signs an owner in', async () => {
    const res = await call({ passcode: 'right', staffId: 'o1', adminPasscode: 'owner-secret' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toBe('hg_staff=o1.def')
  })

  it('N1: wrong admin passcodes have their own limit, apart from the staff passcode’s', async () => {
    const device = 'device-aaaaaaaaaaaaaaaa'
    for (let i = 0; i < 5; i++) expect((await call({ passcode: 'right', staffId: 'o1', adminPasscode: 'guess' }, { device, address: '9.9.1.1' })).status).toBe(403)
    // That device is now limited for owner sign-in, even with the right admin passcode…
    expect((await call({ passcode: 'right', staffId: 'o1', adminPasscode: 'owner-secret' }, { device, address: '9.9.1.1' })).status).toBe(429)
    // …but crew sign-in (the staff passcode) on the same device still works.
    expect((await call({ passcode: 'right', staffId: 'm1' }, { device, address: '9.9.1.1' })).status).toBe(200)
  })

  it('N2: one device mistyping the staff passcode doesn’t lock the other studio devices on the same wifi', async () => {
    const address = '9.9.2.2'
    for (let i = 0; i < 5; i++) expect((await call({ passcode: 'nope', staffId: 'm1' }, { device: 'ipad-one-aaaaaaaaaaaa', address })).status).toBe(401)
    expect((await call({ passcode: 'right', staffId: 'm1' }, { device: 'ipad-one-aaaaaaaaaaaa', address })).status).toBe(429)
    expect((await call({ passcode: 'right', staffId: 'm1' }, { device: 'ipad-two-aaaaaaaaaaaa', address })).status).toBe(200)
  })

  it('N2: an address still has a looser cap, so a script that drops its device cookie is slowed', async () => {
    const address = '9.9.3.3'
    for (let i = 0; i < 30; i++) await call({ passcode: 'nope', staffId: 'm1' }, { address })
    expect((await call({ passcode: 'right', staffId: 'm1' }, { device: 'fresh-device-aaaaaaaa', address })).status).toBe(429)
  })

  it('N2: a browser with no device cookie gets one with its first wrong passcode', async () => {
    const res = await call({ passcode: 'nope', staffId: 'm1' })
    expect(res.headers.get('Set-Cookie')).toMatch(/^hg_device=[A-Za-z0-9_-]{16,}; Path=\/; HttpOnly;/)
  })
})
