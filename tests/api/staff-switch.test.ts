import { describe, it, expect, vi, beforeEach } from 'vitest'

let me: any = { id: 'a', name: 'Kaden', role: 'owner' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => me, staffCookie: (s: any) => `hg_staff=${s.id}.sig; Path=/`, checkPasscode: async (p: string) => p === 'right-code' }))
vi.mock('@lib/staff-signin-failures', async (orig) => ({ ...(await orig<any>()), noteFailedSignIn: async () => undefined }))
vi.mock('@lib/staff-directory', () => ({ listStaff: async () => [{ id: 'a', name: 'Kaden', role: 'owner' }, { id: 'b', name: 'Catherine', role: 'owner' }, { id: 'c', name: 'Ava', role: 'crew' }] }))
const mockAudit = vi.fn()
vi.mock('@lib/audit', () => ({ recordAudit: (...a: any[]) => mockAudit(...a) }))

import { GET, POST } from '@pages/api/staff/switch.json'
let ip = 0
const post = (body: unknown, clientAddress = `10.0.0.${++ip}`) => POST({ request: new Request('http://x/api/staff/switch.json', { method: 'POST', body: JSON.stringify(body) }), clientAddress } as any)

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
  it('DV19: switching TO an owner needs the staff passcode; crew to crew stays one tap', async () => {
    me = { id: 'c', name: 'Ava', role: 'crew' }
    const none = await post({ staffId: 'b' })
    expect(none.status).toBe(403)
    expect(await none.json()).toEqual({ error: 'Enter the staff passcode to switch to Catherine.', needsPasscode: true })
    expect(none.headers.get('set-cookie')).toBeNull()
    const wrong = await post({ staffId: 'b', passcode: 'nope' })
    expect(wrong.status).toBe(403)
    expect((await wrong.json()).error).toBe('Incorrect passcode.')
    expect(wrong.headers.get('set-cookie')).toBeNull()
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'staff.switch-refused' }))
    const ok = await post({ staffId: 'b', passcode: 'right-code' })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('set-cookie')).toMatch(/^hg_staff=b\./)
  })
  it('wrong passcodes share the sign-in bucket: 5 per address, then 429', async () => {
    me = { id: 'c', name: 'Ava', role: 'crew' }
    for (let i = 0; i < 5; i++) expect((await post({ staffId: 'a', passcode: 'nope' }, '9.9.9.9')).status).toBe(403)
    expect((await post({ staffId: 'a', passcode: 'right-code' }, '9.9.9.9')).status).toBe(429)
  })
  it('an owner tapping themself needs nothing; owner to crew is one tap', async () => {
    expect((await post({ staffId: 'a' })).status).toBe(200)
    expect((await post({ staffId: 'c' })).status).toBe(200)
  })
})
