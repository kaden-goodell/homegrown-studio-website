import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockOwners = vi.fn()
const mockArtist = vi.fn()
const mockSave = vi.fn()
const mockAlert = vi.fn()
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => mockAlert(...a) }))
vi.mock('@lib/artist-applications', async (orig) => ({
  ...(await orig<typeof import('@lib/artist-applications')>()),
  saveApplication: (...a: any[]) => mockSave(...a),
  emailOwners: (...a: any[]) => mockOwners(...a),
  emailArtist: (...a: any[]) => mockArtist(...a),
}))

import { POST, applicationText } from '@pages/api/teach/apply.json'
import { goodBody } from '../fixtures/artist-application'

let ip = 0
const call = (body: unknown) => POST({ clientAddress: `198.51.100.${++ip}`, request: new Request('https://ourhometownstudio.com/api/teach/apply.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) } as any)

beforeEach(() => {
  vi.clearAllMocks()
  mockSave.mockImplementation(async (value: any, photos: any[]) => ({ ...value, id: '2026-10-15-abcdef12', at: '', status: 'new', photos: photos.length }))
  mockOwners.mockResolvedValue(true)
  mockArtist.mockResolvedValue(true)
  mockAlert.mockResolvedValue({ attempted: 2, sent: 2 })
})

describe('POST /api/teach/apply.json', () => {
  it('saves, emails the owners (with the admin link) and the artist', async () => {
    const res = await call(goodBody())
    expect(res.status).toBe(200)
    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(mockOwners.mock.calls[0][2]).toBe('https://ourhometownstudio.com/admin')
    expect(mockArtist).toHaveBeenCalledTimes(1)
    expect(mockAlert).toHaveBeenCalledWith('New teacher application: Lou Maker (Lou Makes), Linocut printing. Details in your email and at ourhometownstudio.com/admin.')
  })

  it('the text keeps a long class idea short', () => {
    const t = applicationText('Bea', '', 'A very long description of a class that goes on and on about every single step we take.', 'https://x.test/admin')
    expect(t).toMatch(/^New teacher application: Bea, A very long description .{20,}…\. Details in your email and at x\.test\/admin\.$/)
  })

  it('a failed text never fails the application, and bots get no text', async () => {
    mockAlert.mockRejectedValue(new Error('quo down'))
    expect((await call(goodBody())).status).toBe(200)
    mockAlert.mockClear()
    await call(goodBody({ company: 'Spam' }))
    expect(mockAlert).not.toHaveBeenCalled()
  })
  it('says what to fix, naming the field', async () => {
    const res = await call(goodBody({ photos: [] }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Add at least one photo of your work.', field: 'photos' })
    expect(mockSave).not.toHaveBeenCalled()
  })
  it('a bot that fills the hidden field is told OK and nothing is kept or sent', async () => {
    const res = await call(goodBody({ company: 'Spam Inc' }))
    expect(res.status).toBe(200)
    expect(mockSave).not.toHaveBeenCalled()
    expect(mockOwners).not.toHaveBeenCalled()
  })
  it('when it can’t be saved, says try again and emails no one', async () => {
    mockSave.mockRejectedValue(new Error('blobs down'))
    const res = await call(goodBody())
    expect(res.status).toBe(502)
    expect(mockOwners).not.toHaveBeenCalled()
  })
  it('a failed email never fails a saved application', async () => {
    mockOwners.mockResolvedValue(false)
    mockArtist.mockResolvedValue(false)
    expect((await call(goodBody())).status).toBe(200)
  })
  it('slows down someone hammering it', async () => {
    const fixed = (body: unknown) => POST({ clientAddress: '203.0.113.250', request: new Request('https://x.test/api/teach/apply.json', { method: 'POST', body: JSON.stringify(body) }) } as any)
    for (let i = 0; i < 5; i++) await fixed(goodBody())
    expect((await fixed(goodBody())).status).toBe(429)
  })
})
