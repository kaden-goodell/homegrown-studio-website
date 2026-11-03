import { describe, it, expect, vi, beforeEach } from 'vitest'

let me: any = { id: 'a', name: 'Kaden', role: 'owner' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => me, staffCookie: (s: any) => `hg_staff=${s.id}.sig; Path=/`, checkPasscode: async (p: string) => p === 'staff-code' }))
vi.mock('@lib/admin-auth', () => ({ adminConfigured: async () => true, checkAdminPasscode: async (p: string) => p === 'right-code' }))
const adminFails = vi.fn()
vi.mock('@lib/admin-signin-failures', () => ({ noteAdminFailedSignIn: async () => adminFails() }))
vi.mock('@lib/staff-directory', () => ({ listStaff: async () => [{ id: 'a', name: 'Kaden', role: 'owner' }, { id: 'b', name: 'Catherine', role: 'owner' }, { id: 'c', name: 'Ava', role: 'crew' }] }))
const mockAudit = vi.fn()
vi.mock('@lib/audit', () => ({ recordAudit: (...a: any[]) => mockAudit(...a) }))

import { GET, POST } from '@pages/api/staff/switch.json'
let ip = 0
const post = (body: unknown, clientAddress = `10.0.0.${++ip}`, device?: string) => POST({ request: new Request('http://x/api/staff/switch.json', { method: 'POST', body: JSON.stringify(body), headers: device ? { cookie: `hg_device=${device}` } : {} }), clientAddress } as any)

beforeEach(() => { me = { id: 'a', name: 'Kaden', role: 'owner' }; vi.clearAllMocks() })

describe('/api/staff/switch.json', () => {
  it('lists the team for someone signed in', async () => {
    const body = await (await GET({ request: new Request('http://x') } as any)).json()
    expect(body.data.staff.map((s: any) => s.name)).toEqual(['Kaden', 'Catherine', 'Ava'])
    expect(body.data.me.id).toBe('a')
  })
  it('switches to a teammate with no passcode, and logs who handed to whom', async () => {
    const res = await post({ staffId: 'c' })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(/^hg_staff=c\./)
    expect((await res.json()).data.staff).toEqual({ id: 'c', name: 'Ava', role: 'crew' })
    expect(mockAudit).toHaveBeenCalledWith({ by: { id: 'c', name: 'Ava', role: 'crew' }, action: 'staff.switched', target: { kind: 'staff', id: 'c', label: 'Kaden → Ava' } })
  })
  it('refuses when nobody is signed in on this device (the passcode screen stays the way in)', async () => {
    me = null
    expect((await GET({ request: new Request('http://x') } as any)).status).toBe(401)
    const res = await post({ staffId: 'c' })
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })
  it('refuses an unknown person', async () => {
    const res = await post({ staffId: 'zz' })
    expect(res.status).toBe(400)
    expect(res.headers.get('set-cookie')).toBeNull()
  })
  it('DV19/N1: switching TO an owner needs the ADMIN passcode; crew to crew stays one tap', async () => {
    me = { id: 'c', name: 'Ava', role: 'crew' }
    const none = await post({ staffId: 'b' })
    expect(none.status).toBe(403)
    expect(await none.json()).toEqual({ error: 'To switch to Catherine, enter the admin passcode.', needsAdminPasscode: true })
    expect(none.headers.get('set-cookie')).toBeNull()
    const wrong = await post({ staffId: 'b', adminPasscode: 'nope' })
    expect(wrong.status).toBe(403)
    expect((await wrong.json()).error).toBe('That admin passcode isn’t right.')
    expect(wrong.headers.get('set-cookie') ?? '').not.toMatch(/hg_staff/)
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'staff.switch-refused' }))
    expect(adminFails).toHaveBeenCalledTimes(1)
    const ok = await post({ staffId: 'b', adminPasscode: 'right-code' })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('set-cookie')).toMatch(/^hg_staff=b\./)
  })
  it('N1: crew who know the staff passcode can’t switch to an owner with it', async () => {
    me = { id: 'c', name: 'Ava', role: 'crew' }
    for (const body of [{ staffId: 'b', adminPasscode: 'staff-code' }, { staffId: 'b', passcode: 'staff-code' }]) {
      const res = await post(body)
      expect(res.status).toBe(403)
      expect(res.headers.get('set-cookie') ?? '').not.toMatch(/hg_staff/)
    }
  })
  it('N1/N2: wrong admin passcodes are limited per device (5), then 429 even for the right one; another device is unaffected', async () => {
    me = { id: 'c', name: 'Ava', role: 'crew' }
    for (let i = 0; i < 5; i++) expect((await post({ staffId: 'a', adminPasscode: 'nope' }, '9.9.9.9', 'ipad-one-aaaaaaaaaaaa')).status).toBe(403)
    expect((await post({ staffId: 'a', adminPasscode: 'right-code' }, '9.9.9.9', 'ipad-one-aaaaaaaaaaaa')).status).toBe(429)
    expect((await post({ staffId: 'a', adminPasscode: 'right-code' }, '9.9.9.9', 'ipad-two-aaaaaaaaaaaa')).status).toBe(200)
    // Crew to crew needs no passcode, so the limit never gets in its way.
    expect((await post({ staffId: 'c' }, '9.9.9.9', 'ipad-one-aaaaaaaaaaaa')).status).toBe(200)
  })
  it('N1: an address has a looser cap on wrong admin passcodes (a script dropping its device cookie)', async () => {
    me = { id: 'c', name: 'Ava', role: 'crew' }
    for (let i = 0; i < 15; i++) await post({ staffId: 'a', adminPasscode: 'nope' }, '9.9.8.8')
    expect((await post({ staffId: 'a', adminPasscode: 'right-code' }, '9.9.8.8', 'fresh-device-aaaaaaaa')).status).toBe(429)
  })
  it('an owner tapping themself needs nothing; owner to crew is one tap', async () => {
    expect((await post({ staffId: 'a' })).status).toBe(200)
    expect((await post({ staffId: 'c' })).status).toBe(200)
  })
})
