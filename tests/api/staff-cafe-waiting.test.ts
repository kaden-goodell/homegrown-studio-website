/** /api/staff/cafe-waiting.json — a new Craft Café family starting the waiver (iPad, text or QR). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Sam', role: 'crew' }
const mockAudit = vi.fn()
const mockText = vi.fn()
let quoOn = true
vi.mock('@lib/audit', () => ({ recordAudit: (...a: any[]) => mockAudit(...a) }))
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed, byOf: (m: any) => ({ id: m.id, name: m.name }) }))
vi.mock('@lib/quo', () => ({ quoConfigured: () => quoOn, sendQuoText: (...a: any[]) => mockText(...a) }))

import { POST, DELETE } from '@pages/api/staff/cafe-waiting.json'
import { getCafeWaiting } from '@lib/open-studio-store'

const post = (body: any) => POST({ request: new Request('http://x/api/staff/cafe-waiting.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) } as any)
const del = (q: string) => { const request = new Request(`http://x/api/staff/cafe-waiting.json${q}`, { method: 'DELETE' }); return DELETE({ request, url: new URL(request.url) } as any) }

let TODAY = ''
beforeEach(() => {
  vi.clearAllMocks()
  authed = { id: 't', name: 'Sam', role: 'crew' }
  quoOn = true
  mockText.mockResolvedValue(undefined)
  TODAY = `${2100 + Math.floor(Math.random() * 800)}-05-${String(1 + Math.floor(Math.random() * 27)).padStart(2, '0')}`
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T18:00:00Z`))
})
afterEach(() => vi.useRealTimers())

describe('POST /api/staff/cafe-waiting.json', () => {
  it('staff only', async () => {
    authed = null
    expect((await post({ how: 'ipad' })).status).toBe(401)
  })

  it('on the iPad: no name needed; they go on Waiting on a waiver', async () => {
    const res = await post({ how: 'ipad', name: '' })
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.id).toMatch(/^cw_/)
    expect(await getCafeWaiting(TODAY)).toEqual([expect.objectContaining({ id: data.id, name: 'New family', how: 'ipad', by: { id: 't', name: 'Sam' } })])
    expect(mockText).not.toHaveBeenCalled()
  })

  it('by text: needs a name and a 10-digit mobile, texts the café waiver link once, and audits it', async () => {
    expect((await post({ how: 'text', name: 'Kim', phone: '555' })).status).toBe(400)
    expect((await post({ how: 'text', name: '', phone: '2565550199' })).status).toBe(400)
    const res = await post({ how: 'text', name: 'Kim Lee', phone: '(256) 555-0199' })
    expect((await res.json()).data).toMatchObject({ sent: true, existing: false })
    expect(mockText).toHaveBeenCalledWith({ to: '2565550199', content: expect.stringMatching(/Craft Café .*\/waiver/) })
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'waiver-link.sent', details: expect.objectContaining({ where: 'craft-cafe', sent: true }) }))
    // A second tap: nothing texted twice.
    const again = await (await post({ how: 'text', name: 'Kim Lee', phone: '2565550199' })).json()
    expect(again.data).toMatchObject({ existing: true })
    expect(mockText).toHaveBeenCalledTimes(1)
    expect(await getCafeWaiting(TODAY)).toHaveLength(1)
  })

  it('a text that fails (or no texting set up) says so, and they still wait', async () => {
    mockText.mockRejectedValue(new Error('down'))
    expect((await (await post({ how: 'text', name: 'Kim', phone: '2565550199' })).json()).data.sent).toBe(false)
    quoOn = false
    expect((await (await post({ how: 'text', name: 'Bo', phone: '2565550111' })).json()).data.sent).toBe(false)
    expect(await getCafeWaiting(TODAY)).toHaveLength(2)
  })

  it('QR: needs a name so they can be found once signed', async () => {
    expect((await post({ how: 'qr', name: '' })).status).toBe(400)
    expect((await post({ how: 'qr', name: 'Bo Park' })).status).toBe(200)
    expect((await post({ how: 'nope', name: 'Bo Park' })).status).toBe(400)
  })
})

describe('DELETE /api/staff/cafe-waiting.json', () => {
  it('takes a family off the list and logs it', async () => {
    const { data } = await (await post({ how: 'qr', name: 'Bo Park' })).json()
    mockAudit.mockClear()
    expect((await del(`?id=${data.id}`)).status).toBe(200)
    expect(await getCafeWaiting(TODAY)).toEqual([])
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'waiver.waiting-removed', target: expect.objectContaining({ label: 'Bo Park' }) }))
    expect((await del('')).status).toBe(400)
  })
})
