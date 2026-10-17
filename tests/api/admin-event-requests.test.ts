import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GET, POST } from '@pages/api/admin/event-requests.json'
import { GET as photo } from '@pages/api/admin/event-request-photo'
import { adminCookie } from '@lib/admin-auth'
import { checkRequest, saveRequest } from '@lib/event-requests'
import { goodBody, NOW } from '../fixtures/event-request'

const signedIn = () => adminCookie().split(';')[0]
const req = (url: string, init: RequestInit & { cookie?: string } = {}) => new Request(`https://x.test${url}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) } })

beforeEach(() => vi.stubEnv('ADMIN_PASSCODE', 'owner-secret'))
afterEach(() => vi.unstubAllEnvs())

describe('/api/admin/event-requests.json and photos', () => {
  it('everything refuses without the owner cookie', async () => {
    expect((await GET({ request: req('/api/admin/event-requests.json') } as any)).status).toBe(401)
    expect((await POST({ request: req('/api/admin/event-requests.json', { method: 'POST', body: '{}' }) } as any)).status).toBe(401)
    expect((await photo({ request: req('/api/admin/event-request-photo'), url: new URL('https://x.test/api/admin/event-request-photo?id=x&n=0') } as any)).status).toBe(401)
  })

  it('lists requests, moves one along, and serves its photo', async () => {
    const c = checkRequest(goodBody(), NOW)
    if (!c.ok) throw new Error('fixture refused')
    const saved = await saveRequest(c.value, c.photos)
    const cookie = signedIn()

    const list = await (await GET({ request: req('/api/admin/event-requests.json', { cookie }) } as any)).json()
    expect(list.data.requests.some((r: any) => r.id === saved.id)).toBe(true)

    const moved = await POST({ request: req('/api/admin/event-requests.json', { method: 'POST', cookie, body: JSON.stringify({ id: saved.id, status: 'booked' }) }) } as any)
    expect((await moved.json()).data.request.status).toBe('booked')

    const pic = await photo({ request: req('/x', { cookie }), url: new URL(`https://x.test/x?id=${saved.id}&n=0`) } as any)
    expect(pic.status).toBe(200)
    expect(pic.headers.get('content-type')).toBe('image/jpeg')
  })

  it('refuses an unknown status, and says when the request is not there', async () => {
    const cookie = signedIn()
    expect((await POST({ request: req('/x', { method: 'POST', cookie, body: JSON.stringify({ id: 'x', status: 'done' }) }) } as any)).status).toBe(400)
    expect((await POST({ request: req('/x', { method: 'POST', cookie, body: JSON.stringify({ id: '2026-01-01-00000000', status: 'quoted' }) }) } as any)).status).toBe(404)
    expect((await photo({ request: req('/x', { cookie }), url: new URL('https://x.test/x?id=2026-01-01-00000000&n=0') } as any)).status).toBe(404)
  })
})
