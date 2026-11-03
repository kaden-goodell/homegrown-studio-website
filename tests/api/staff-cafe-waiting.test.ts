/** /api/staff/cafe-waiting.json — a new Craft Café family starting the waiver (iPad, text or QR). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Sam', role: 'crew' }
const mockAudit = vi.fn()
const mockText = vi.fn()
let quoOn = true
vi.mock('@lib/audit', () => ({ recordAudit: (...a: any[]) => mockAudit(...a) }))
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed, byOf: (m: any) => ({ id: m.id, name: m.name }) }))
vi.mock('@lib/quo', () => ({ quoConfigured: () => quoOn, sendQuoText: (...a: any[]) => mockText(...a) }))
let testSite = false
vi.mock('@lib/classes/test-site-guard', async (orig) => {
  const real = await orig<any>()
  return { ...real, classWritesRefusal: () => (testSite ? real.NO_TEST_STORE : null) }
})
const waivers = new Map<string, any>()
vi.mock('@lib/waiver-store', () => ({ getWaiverRecord: async (id: string) => waivers.get(id) ?? null }))

import { POST, DELETE, PATCH, CAFE_TEXTS_MAX, WAITING_FULL } from '@pages/api/staff/cafe-waiting.json'
import { addCafeWaiting, getCafeWaiting, WAITING_CAP } from '@lib/open-studio-store'
import { activityWhat } from '@lib/activity'

const post = (body: any) => POST({ request: new Request('http://x/api/staff/cafe-waiting.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) } as any)
const patch = (body: any) => PATCH({ request: new Request('http://x/api/staff/cafe-waiting.json', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) } as any)
const del = (q: string) => { const request = new Request(`http://x/api/staff/cafe-waiting.json${q}`, { method: 'DELETE' }); return DELETE({ request, url: new URL(request.url) } as any) }

let TODAY = ''
beforeEach(() => {
  vi.clearAllMocks()
  // A fresh crew id each test: the rate limit is per crew member and lives in memory.
  authed = { id: `t${Math.random().toString(36).slice(2, 8)}`, name: 'Sam', role: 'crew' }
  quoOn = true
  testSite = false
  waivers.clear()
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
    expect(await getCafeWaiting(TODAY)).toEqual([expect.objectContaining({ id: data.id, name: 'New family', how: 'ipad', by: { id: authed!.id, name: 'Sam' } })])
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
    expect(again.data).toMatchObject({ existing: true, alreadySent: true })
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

  it('a text that failed is sent again on the retry, and only “Already texted” once it went', async () => {
    mockText.mockRejectedValueOnce(new Error('down'))
    const first = (await (await post({ how: 'text', name: 'Kim', phone: '2565550199' })).json()).data
    expect(first).toMatchObject({ sent: false, existing: false })
    expect((await getCafeWaiting(TODAY))[0].sent).toBe(false)
    expect(activityWhat(mockAudit.mock.calls[0][0])).toBe('Tried to text Kim the waiver link for Craft Café (it didn’t send)')
    // The crew tap again: this time it goes.
    const retry = (await (await post({ how: 'text', name: 'Kim', phone: '2565550199' })).json()).data
    expect(retry).toMatchObject({ sent: true, existing: true })
    expect(retry.alreadySent).toBeUndefined()
    expect(mockText).toHaveBeenCalledTimes(2)
    expect((await getCafeWaiting(TODAY))[0].sent).toBe(true)
    expect(activityWhat(mockAudit.mock.calls[1][0])).toBe('Texted Kim the waiver link for Craft Café (again, the first text didn’t send)')
    // A third tap: nothing sent, nothing logged.
    mockAudit.mockClear()
    const third = (await (await post({ how: 'text', name: 'Kim', phone: '2565550199' })).json()).data
    expect(third).toMatchObject({ existing: true, alreadySent: true })
    expect(mockText).toHaveBeenCalledTimes(2)
    expect(mockAudit).not.toHaveBeenCalled()
    expect(await getCafeWaiting(TODAY)).toHaveLength(1)
  })

  it('texts are rate limited per crew member', async () => {
    for (let i = 0; i < CAFE_TEXTS_MAX; i++) {
      expect((await post({ how: 'text', name: `Fam ${i}`, phone: `25655501${String(i).padStart(2, '0')}` })).status).toBe(200)
    }
    const over = await post({ how: 'text', name: 'One More', phone: '2565559999' })
    expect(over.status).toBe(429)
    expect(mockText).toHaveBeenCalledTimes(CAFE_TEXTS_MAX)
  })

  it('a full waiting list refuses new families in plain words (nobody is dropped)', async () => {
    for (let i = 0; i < WAITING_CAP; i++) await addCafeWaiting(TODAY, { name: `Fam ${i}`, how: 'qr', by: { id: 't', name: 'Sam' } })
    const res = await post({ how: 'text', name: 'Kim', phone: '2565550199' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(WAITING_FULL)
    expect(mockText).not.toHaveBeenCalled()
    const list = await getCafeWaiting(TODAY)
    expect(list).toHaveLength(WAITING_CAP)
    expect(list[0].name).toBe('Fam 0')
  })

  it('a test site with no store of its own adds and texts nothing (R41)', async () => {
    testSite = true
    expect((await post({ how: 'text', name: 'Kim', phone: '2565550199' })).status).toBe(503)
    expect((await del('?id=cw_12345678')).status).toBe(503)
    expect((await patch({ id: 'cw_12345678', recordId: 'w1' })).status).toBe(503)
    expect(mockText).not.toHaveBeenCalled()
    expect(await getCafeWaiting(TODAY)).toEqual([])
  })

  it('QR: needs a name so they can be found once signed', async () => {
    expect((await post({ how: 'qr', name: '' })).status).toBe(400)
    expect((await post({ how: 'qr', name: 'Bo Park' })).status).toBe(200)
    expect((await post({ how: 'nope', name: 'Bo Park' })).status).toBe(400)
  })
})

describe('PATCH /api/staff/cafe-waiting.json (the iPad finished a café waiver)', () => {
  it('the row keeps their waiver and takes the signer’s name when none was typed', async () => {
    waivers.set('w_kim', { id: 'w_kim', adult: { firstName: 'Kim', lastName: 'Lee' }, minors: [] })
    const { data } = await (await post({ how: 'ipad', name: '' })).json()
    expect((await patch({ id: data.id, recordId: 'w_kim' })).status).toBe(200)
    expect(await getCafeWaiting(TODAY)).toEqual([expect.objectContaining({ id: data.id, name: 'Kim Lee', recordId: 'w_kim' })])
    // A typed name stays.
    const typed = (await (await post({ how: 'ipad', name: 'Kimmy' })).json()).data
    await patch({ id: typed.id, recordId: 'w_kim' })
    expect((await getCafeWaiting(TODAY)).find((w) => w.id === typed.id)).toMatchObject({ name: 'Kimmy', recordId: 'w_kim' })
  })

  it('needs a sign-in, a real row id and a real waiver', async () => {
    expect((await patch({ id: 'nope', recordId: 'w1' })).status).toBe(400)
    expect((await patch({ id: 'cw_12345678', recordId: 'w_missing' })).status).toBe(404)
    authed = null
    expect((await patch({ id: 'cw_12345678', recordId: 'w1' })).status).toBe(401)
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
