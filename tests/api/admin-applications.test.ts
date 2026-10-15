import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { POST as login, DELETE as logout } from '@pages/api/admin/login.json'
import { GET, POST } from '@pages/api/admin/applications.json'
import { GET as photo } from '@pages/api/admin/application-photo'
import { adminCookie } from '@lib/admin-auth'
import { checkApplication, saveApplication } from '@lib/artist-applications'
import { goodBody } from '../fixtures/artist-application'

const signedIn = () => adminCookie().split(';')[0]
let ip = 0
const req = (url: string, init: RequestInit & { cookie?: string } = {}) => new Request(`https://x.test${url}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) } })

beforeEach(() => vi.stubEnv('ADMIN_PASSCODE', 'owner-secret'))
afterEach(() => vi.unstubAllEnvs())

describe('/admin sign-in', () => {
  it('right passcode sets the cookie; wrong one is refused', async () => {
    const ok = await login({ clientAddress: `192.0.2.${++ip}`, request: req('/api/admin/login.json', { method: 'POST', body: JSON.stringify({ passcode: 'owner-secret' }) }) } as any)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('set-cookie')).toMatch(/^hg_admin=/)
    const bad = await login({ clientAddress: `192.0.2.${++ip}`, request: req('/api/admin/login.json', { method: 'POST', body: JSON.stringify({ passcode: 'nope' }) }) } as any)
    expect(bad.status).toBe(401)
    expect(bad.headers.get('set-cookie')).toBeNull()
  })
  it('says so when no passcode is set up', async () => {
    vi.stubEnv('ADMIN_PASSCODE', '')
    expect((await login({ clientAddress: `192.0.2.${++ip}`, request: req('/api/admin/login.json', { method: 'POST', body: '{}' }) } as any)).status).toBe(503)
  })
  it('sign out clears it', async () => {
    expect((await logout({} as any)).headers.get('set-cookie')).toMatch(/Max-Age=0/)
  })
})

describe('/api/admin/applications.json and photos', () => {
  it('everything refuses without the owner cookie', async () => {
    expect((await GET({ request: req('/api/admin/applications.json') } as any)).status).toBe(401)
    expect((await POST({ request: req('/api/admin/applications.json', { method: 'POST', body: '{}' }) } as any)).status).toBe(401)
    expect((await photo({ request: req('/api/admin/application-photo'), url: new URL('https://x.test/api/admin/application-photo?id=x&n=0') } as any)).status).toBe(401)
  })
  it('lists applications, moves one along, and serves its photo', async () => {
    const c = checkApplication(goodBody()); if (!c.ok) throw new Error('bad')
    const app = await saveApplication(c.value, c.photos)
    const list = await (await GET({ request: req('/api/admin/applications.json', { cookie: signedIn() }) } as any)).json()
    expect(list.data.applications.some((a: any) => a.id === app.id)).toBe(true)
    const moved = await POST({ request: req('/api/admin/applications.json', { method: 'POST', cookie: signedIn(), body: JSON.stringify({ id: app.id, status: 'booked' }) }) } as any)
    expect((await moved.json()).data.application.status).toBe('booked')
    const bad = await POST({ request: req('/api/admin/applications.json', { method: 'POST', cookie: signedIn(), body: JSON.stringify({ id: app.id, status: 'deleted' }) }) } as any)
    expect(bad.status).toBe(400)
    const img = await photo({ request: req('/x', { cookie: signedIn() }), url: new URL(`https://x.test/api/admin/application-photo?id=${app.id}&n=0`) } as any)
    expect(img.status).toBe(200)
    expect(img.headers.get('content-type')).toBe('image/jpeg')
  })
})
