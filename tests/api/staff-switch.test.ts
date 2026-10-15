import { describe, it, expect, vi, beforeEach } from 'vitest'

let me: any = { id: 'a', name: 'Kaden', role: 'owner' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => me, staffCookie: (s: any) => `hg_staff=${s.id}.sig; Path=/` }))
vi.mock('@lib/staff-directory', () => ({ listStaff: async () => [{ id: 'a', name: 'Kaden', role: 'owner' }, { id: 'b', name: 'Catherine', role: 'owner' }, { id: 'c', name: 'Ava', role: 'crew' }] }))
const mockAudit = vi.fn()
vi.mock('@lib/audit', () => ({ recordAudit: (...a: any[]) => mockAudit(...a) }))

import { GET, POST } from '@pages/api/staff/switch.json'
const post = (body: unknown) => POST({ request: new Request('http://x/api/staff/switch.json', { method: 'POST', body: JSON.stringify(body) }) } as any)

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
})
