import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockOwners = vi.fn()
const mockSender = vi.fn()
const mockSave = vi.fn()
const mockAlert = vi.fn()
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => mockAlert(...a) }))
vi.mock('@lib/contact-messages', async (orig) => ({
  ...(await orig<typeof import('@lib/contact-messages')>()),
  saveMessage: (...a: any[]) => mockSave(...a),
  emailOwners: (...a: any[]) => mockOwners(...a),
  emailSender: (...a: any[]) => mockSender(...a),
}))

import { POST } from '@pages/api/contact/send.json'
import { GET, POST as MOVE } from '@pages/api/admin/messages.json'
import { adminCookie } from '@lib/admin-auth'

const good = (over: any = {}) => ({ name: 'Dana Planner', email: 'dana@example.com', phone: '(256) 555-0142', topic: 'party', message: 'Can we bring our own cake?', ...over })
let ip = 0
const call = (b: unknown, address = `198.51.100.${++ip}`) => POST({ clientAddress: address, request: new Request('https://ourhometownstudio.com/api/contact/send.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }) } as any)

beforeEach(() => {
  vi.clearAllMocks()
  mockSave.mockImplementation(async (value: any) => ({ ...value, id: '2026-10-17-abcdef12', at: '', status: 'new', photos: 0 }))
  mockOwners.mockResolvedValue(true)
  mockSender.mockResolvedValue(true)
  mockAlert.mockResolvedValue({ attempted: 2, sent: 2 })
})

describe('POST /api/contact/send.json', () => {
  it('saves, then emails and texts the owners and emails the sender', async () => {
    expect((await call(good())).status).toBe(200)
    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(mockOwners.mock.calls[0][1]).toBe('https://ourhometownstudio.com/admin')
    expect(mockSender).toHaveBeenCalledTimes(1)
    expect(mockAlert.mock.calls[0][0]).toBe('New message from Dana Planner about a party: Can we bring our own cake? Details in your email and at ourhometownstudio.com/admin.')
  })
  it('a refused answer names the field, and nothing is saved or sent', async () => {
    const res = await call(good({ message: '' }))
    expect(res.status).toBe(400)
    expect((await res.json()).field).toBe('message')
    expect(mockSave).not.toHaveBeenCalled()
    expect(mockAlert).not.toHaveBeenCalled()
  })
  it('a bot that fills the hidden field is told it worked, and nothing is kept', async () => {
    expect((await call(good({ company: 'Spam' }))).status).toBe(200)
    expect(mockSave).not.toHaveBeenCalled()
  })
  it('says so when it could not be saved, and sends nothing', async () => {
    mockSave.mockRejectedValue(new Error('down'))
    expect((await call(good())).status).toBe(502)
    expect(mockOwners).not.toHaveBeenCalled()
  })
  it('slows down someone hammering it', async () => {
    const statuses = []
    for (let i = 0; i < 6; i++) statuses.push((await call(good(), '203.0.113.77')).status)
    expect(statuses[5]).toBe(429)
  })
})

describe('/api/admin/messages.json', () => {
  beforeEach(() => vi.stubEnv('ADMIN_PASSCODE', 'owner-secret'))
  afterEach(() => vi.unstubAllEnvs())
  const req = (init: RequestInit & { cookie?: string } = {}) => new Request('https://x.test/api/admin/messages.json', { ...init, headers: { 'Content-Type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) } })

  it('refuses without the owner cookie', async () => {
    expect((await GET({ request: req() } as any)).status).toBe(401)
    expect((await MOVE({ request: req({ method: 'POST', body: '{}' }) } as any)).status).toBe(401)
  })
  it('lists for an owner, and refuses an unknown status or a missing message', async () => {
    const cookie = adminCookie().split(';')[0]
    expect((await GET({ request: req({ cookie }) } as any)).status).toBe(200)
    expect((await MOVE({ request: req({ method: 'POST', cookie, body: JSON.stringify({ id: 'x', status: 'gone' }) }) } as any)).status).toBe(400)
    expect((await MOVE({ request: req({ method: 'POST', cookie, body: JSON.stringify({ id: '2026-01-01-00000000', status: 'replied' }) }) } as any)).status).toBe(404)
  })
})
