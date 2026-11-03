/**
 * /api/staff/open-studio.json — Craft Café check-ins: check in (waiver
 * required), Undo (audited), the day's row count and the sheet's detail.
 * The real day store; the waivers, sign-in and audit are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Test', role: 'crew' }
const mockAudit = vi.fn()
vi.mock('@lib/audit', () => ({ recordAudit: (...a: any[]) => mockAudit(...a) }))
vi.mock('@lib/staff-auth', () => ({
  staffAuthorized: () => authed,
  byOf: (m: any) => ({ id: m.id, name: m.name }),
}))

const waivers = new Map<string, any>()
const byPhone = new Map<string, any>()
const byName = new Map<string, any[]>()
// Whether Craft Café runs today (the owners' hours), and whether this is a test site with no store of its own (R41).
let cafeRuns = true
let testSite = false
vi.mock('@lib/cafe-days', () => ({ cafeOn: () => (cafeRuns ? { opens: '09:00', closes: '13:00' } : null) }))
vi.mock('@lib/classes/test-site-guard', async (orig) => {
  const real = await orig<any>()
  return { ...real, classWritesRefusal: () => (testSite ? real.NO_TEST_STORE : null) }
})
vi.mock('@lib/waiver-store', () => ({
  householdFrom: (w: any) => household(w),
  getWaiverRecord: async (id: string) => waivers.get(id) ?? null,
  lookupHouseholdEntry: async (c: string) => byPhone.get(c.replace(/\D/g, '')) ?? null,
  lookupHouseholdsByName: async (n: string) => byName.get(n.toLowerCase()) ?? [],
}))

import { POST, DELETE, GET } from '@pages/api/staff/open-studio.json'
import { addCafeWaiting, getCafeWaiting, getOpenStudioDay } from '@lib/open-studio-store'

const BY = { id: 't', name: 'Test' }
function waiver(id: string, over: Record<string, any> = {}) {
  return {
    id,
    agreementVersion: 'v99',
    signedAt: new Date().toISOString(),
    validUntil: '9999-01-01T00:00:00.000Z',
    adult: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '2565550142', dob: '', allergies: '' },
    minors: [{ name: 'Mia Doe', dob: '', allergies: '' }, { name: 'Leo Doe', dob: '', allergies: '' }],
    ...over,
  }
}
/** The same family as the door search returns it. */
const household = (w: any) => ({
  recordId: w.id, firstName: w.adult.firstName, lastName: w.adult.lastName, email: w.adult.email, phone: w.adult.phone,
  signedAt: w.signedAt, validUntil: w.validUntil, agreementVersion: w.agreementVersion, dob: '', adultAllergies: '', minors: w.minors,
  emergency: { name: '', phone: '', relationship: '' }, authorizedPickup: [], notAuthorized: '', photoConsent: true,
})

const post = (body: any) => POST({ request: new Request('http://x/api/staff/open-studio.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) } as any)
const del = (q: string) => { const request = new Request(`http://x/api/staff/open-studio.json${q}`, { method: 'DELETE' }); return DELETE({ request, url: new URL(request.url) } as any) }
const get = (q: string) => { const request = new Request(`http://x/api/staff/open-studio.json${q}`); return GET({ request, url: new URL(request.url) } as any) }

let TODAY = ''
beforeEach(() => {
  vi.clearAllMocks()
  authed = { id: 't', name: 'Test', role: 'crew' }
  cafeRuns = true
  testSite = false
  waivers.clear(); byPhone.clear(); byName.clear()
  // A fresh studio day every test (the store is the real one, on disk): noon, a random far-off date.
  const year = 2100 + Math.floor(Math.random() * 800)
  const day = 1 + Math.floor(Math.random() * 27)
  TODAY = `${year}-03-${String(day).padStart(2, '0')}`
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T18:00:00Z`))
  // Agreement versions: our fixture is newer than any real one.
})
afterEach(() => vi.useRealTimers())

vi.mock('@config/waiver-content', async (orig) => ({ ...(await orig<any>()), substantiveSince: 'v1' }))

describe('POST — check a family in at Craft Café', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    expect((await post({ recordId: 'w1', personIds: ['adult'] })).status).toBe(401)
  })

  it('requires recordId and at least one person', async () => {
    expect((await post({ recordId: '', personIds: [] })).status).toBe(400)
  })

  it('no waiver, no check-in', async () => {
    const res = await post({ recordId: 'w_missing', personIds: ['adult'] })
    expect(res.status).toBe(404)
    expect(await getOpenStudioDay(TODAY)).toEqual({})
  })

  it('an expired waiver is refused: sign again first', async () => {
    waivers.set('w_old', waiver('w_old', { validUntil: '2000-01-01T00:00:00.000Z' }))
    const res = await post({ recordId: 'w_old', personIds: ['adult'] })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Their waiver needs signing again before they craft. Tap Get them signed again.')
    expect(await getOpenStudioDay(TODAY)).toEqual({})
  })

  it('“Mark here anyway” counts an expired waiver in, and the log says so', async () => {
    waivers.set('w_old', waiver('w_old', { validUntil: '2000-01-01T00:00:00.000Z' }))
    const res = await post({ recordId: 'w_old', personIds: ['adult', 'child:0'], anyway: true })
    expect(res.status).toBe(200)
    expect(Object.keys(await getOpenStudioDay(TODAY))).toEqual(['w_old'])
    expect(mockAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'checkin.here', details: expect.objectContaining({ anyway: true, where: 'craft-cafe' }) }))
  })

  it('“anyway” never counts in a family with no waiver at all', async () => {
    expect((await post({ recordId: 'w_missing', personIds: ['adult'], anyway: true })).status).toBe(404)
  })

  it('refuses on a day Craft Café doesn’t run (nothing saved, nothing logged)', async () => {
    cafeRuns = false
    waivers.set('w1', waiver('w1'))
    const res = await post({ recordId: 'w1', personIds: ['adult'] })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Only on Craft Café days — ask Catherine or Kaden to add a special day.')
    expect(await getOpenStudioDay(TODAY)).toEqual({})
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('a test site with no store of its own writes nothing (R41)', async () => {
    testSite = true
    waivers.set('w1', waiver('w1'))
    expect((await post({ recordId: 'w1', personIds: ['adult'] })).status).toBe(503)
    expect((await del('?recordId=w1')).status).toBe(503)
    expect(await getOpenStudioDay(TODAY)).toEqual({})
  })

  it('keeps the family’s name and who came, stamps who checked them in, and audits it', async () => {
    waivers.set('w1', waiver('w1'))
    const res = await post({ recordId: 'w1', personIds: ['adult', 'child:1', 'child:9', 'bogus'] })
    expect(res.status).toBe(200)
    const day = await getOpenStudioDay(TODAY)
    expect(day.w1).toMatchObject({ personIds: ['adult', 'child:1'], name: 'Jane Doe', people: ['Jane Doe', 'Leo Doe'], by: BY })
    expect(mockAudit).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'checkin.here',
      target: expect.objectContaining({ kind: 'household', id: 'w1', label: 'Jane Doe' }),
      details: expect.objectContaining({ where: 'craft-cafe', people: 2, date: TODAY }),
    }))
  })

  it('a double tap is one entry, not two', async () => {
    waivers.set('w1', waiver('w1'))
    await Promise.all([post({ recordId: 'w1', personIds: ['adult'] }), post({ recordId: 'w1', personIds: ['adult'] })])
    expect(Object.keys(await getOpenStudioDay(TODAY))).toEqual(['w1'])
  })

  it('clears them off Waiting on a waiver: the kiosk’s entry, and a texted entry their waiver matches', async () => {
    waivers.set('w1', waiver('w1'))
    const before = new Date(Date.now() - 60_000)
    const ipad = await addCafeWaiting(TODAY, { name: 'New family', how: 'ipad', by: BY }, before)
    const texted = await addCafeWaiting(TODAY, { name: 'Jane', how: 'text', by: BY, phone: '2565550142' }, before)
    const other = await addCafeWaiting(TODAY, { name: 'Kim Lee', how: 'qr', by: BY }, before)
    await post({ recordId: 'w1', personIds: ['adult'], waitingId: ipad.entry.id })
    expect((await getCafeWaiting(TODAY)).map((w) => w.id)).toEqual([other.entry.id])
    expect(texted.existing).toBe(false)
  })

  it('a last name alone never clears another family’s waiting row; the row’s own id or signed waiver does', async () => {
    waivers.set('w1', waiver('w1'))
    const before = new Date(Date.now() - 60_000)
    const doe = await addCafeWaiting(TODAY, { name: 'Doe', how: 'qr', by: BY }, before)
    const kiosk = await addCafeWaiting(TODAY, { name: 'New family', how: 'ipad', by: BY }, before)
    const { setCafeWaitingSigned } = await import('@lib/open-studio-store')
    await setCafeWaitingSigned(TODAY, kiosk.entry.id, { recordId: 'w1', name: 'Jane Doe' })
    await post({ recordId: 'w1', personIds: ['adult'] })
    expect((await getCafeWaiting(TODAY)).map((w) => w.id)).toEqual([doe.entry.id])
    await post({ recordId: 'w1', personIds: ['adult'], waitingId: doe.entry.id })
    expect(await getCafeWaiting(TODAY)).toEqual([])
  })
})

describe('DELETE — Undo a check-in', () => {
  it('takes them off today’s list and logs who did it; a second Undo changes nothing', async () => {
    waivers.set('w1', waiver('w1'))
    await post({ recordId: 'w1', personIds: ['adult', 'child:0'] })
    mockAudit.mockClear()
    const res = await del('?recordId=w1')
    expect(res.status).toBe(200)
    expect(await getOpenStudioDay(TODAY)).toEqual({})
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'checkin.undone',
      target: expect.objectContaining({ id: 'w1', label: 'Jane Doe' }),
      details: expect.objectContaining({ where: 'craft-cafe', people: 2 }),
    }))
    mockAudit.mockClear()
    expect((await (await del('?recordId=w1')).json()).data.already).toBe(true)
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('needs a sign-in and a family', async () => {
    expect((await del('')).status).toBe(400)
    authed = null
    expect((await del('?recordId=w1')).status).toBe(401)
  })
})

describe('GET — the Craft Café row and sheet', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    expect((await get(`?date=${TODAY}`)).status).toBe(401)
  })

  it('the row: people here, with totals', async () => {
    waivers.set('w1', waiver('w1'))
    waivers.set('w2', waiver('w2', { adult: { firstName: 'Sam', lastName: 'Ray', email: 's@x.com', phone: '2565550100', dob: '', allergies: '' }, minors: [] }))
    await post({ recordId: 'w1', personIds: ['adult', 'child:0', 'child:1'] })
    await post({ recordId: 'w2', personIds: ['adult'] })
    const json = await (await get(`?date=${TODAY}`)).json()
    expect(json.data).toMatchObject({ date: TODAY, count: 4, isToday: true, totals: { households: 2, people: 4, adults: 2, kids: 2 } })
    expect(json.data.entries).toBeUndefined()
  })

  it('the sheet: everyone checked in, newest first, and waiting families with their waiver once signed', async () => {
    waivers.set('w1', waiver('w1'))
    await post({ recordId: 'w1', personIds: ['adult', 'child:0'] })
    // Kim was texted, then signed: her waiver comes back so the crew can check her in.
    const kim = waiver('w_kim', { adult: { firstName: 'Kim', lastName: 'Lee', email: 'k@x.com', phone: '2565550199', dob: '', allergies: '' }, minors: [] })
    byPhone.set('2565550199', household(kim))
    await addCafeWaiting(TODAY, { name: 'Kim', how: 'text', by: BY, phone: '2565550199' }, new Date(Date.now() - 60_000))
    // Bo hasn't signed yet.
    await addCafeWaiting(TODAY, { name: 'Bo Park', how: 'qr', by: BY })
    const json = await (await get(`?date=${TODAY}&detail=1`)).json()
    expect(json.data.entries).toEqual([expect.objectContaining({ recordId: 'w1', name: 'Jane Doe', people: ['Jane Doe', 'Mia Doe'], by: 'Test', adults: 1, kids: 1 })])
    expect(json.data.waiting).toEqual([
      expect.objectContaining({ name: 'Kim', how: 'text', signed: expect.objectContaining({ recordId: 'w_kim', covered: true }) }),
      expect.objectContaining({ name: 'Bo Park', how: 'qr', signed: null }),
    ])
    // The phone never goes back to the browser.
    expect(JSON.stringify(json)).not.toContain('2565550199')
  })

  it('two signed families share the typed last name: neither is guessed, the crew pick', async () => {
    const at = new Date(Date.now() - 60_000)
    const a = waiver('w_a', { adult: { firstName: 'Ann', lastName: 'Smith', email: 'a@x.com', phone: '2565550001', dob: '', allergies: '' } })
    const b = waiver('w_b', { adult: { firstName: 'Bea', lastName: 'Smith', email: 'b@x.com', phone: '2565550002', dob: '', allergies: '' } })
    byName.set('smith', [household(a), household(b)])
    await addCafeWaiting(TODAY, { name: 'Smith', how: 'qr', by: BY }, at)
    const json = await (await get(`?date=${TODAY}&detail=1`)).json()
    expect(json.data.waiting).toEqual([expect.objectContaining({ name: 'Smith', signed: null, signedMany: 2 })])
    // One Smith only: that one.
    byName.set('smith', [household(a)])
    const one = await (await get(`?date=${TODAY}&detail=1`)).json()
    expect(one.data.waiting[0].signed).toEqual(expect.objectContaining({ recordId: 'w_a' }))
  })

  it('a family who signed on the iPad shows ✓ Signed under their own name, even when the check-in didn’t go through', async () => {
    const kim = waiver('w_kim', { adult: { firstName: 'Kim', lastName: 'Lee', email: 'k@x.com', phone: '2565550199', dob: '', allergies: '' }, minors: [] })
    waivers.set('w_kim', kim)
    const w = await addCafeWaiting(TODAY, { name: 'New family', how: 'ipad', by: BY }, new Date(Date.now() - 60_000))
    const { setCafeWaitingSigned } = await import('@lib/open-studio-store')
    await setCafeWaitingSigned(TODAY, w.entry.id, { recordId: 'w_kim', name: 'Kim Lee' })
    const json = await (await get(`?date=${TODAY}&detail=1`)).json()
    expect(json.data.waiting).toEqual([expect.objectContaining({ name: 'Kim Lee', signed: expect.objectContaining({ recordId: 'w_kim', covered: true }) })])
  })

  it('a texted family whose text didn’t send says so', async () => {
    const w = await addCafeWaiting(TODAY, { name: 'Kim', how: 'text', by: BY, phone: '2565550199' })
    const { markCafeWaitingSent } = await import('@lib/open-studio-store')
    await markCafeWaitingSent(TODAY, w.entry.id, false)
    const json = await (await get(`?date=${TODAY}&detail=1`)).json()
    expect(json.data.waiting).toEqual([expect.objectContaining({ name: 'Kim', textFailed: true })])
  })

  it('crew open today’s and the last 7 days’ lists; older ones are owners only', async () => {
    const { addDays } = await import('@lib/kit-dates')
    expect((await get(`?date=${addDays(TODAY, -7)}&detail=1`)).status).toBe(200)
    const old = await get(`?date=${addDays(TODAY, -8)}&detail=1`)
    expect(old.status).toBe(403)
    expect((await old.json()).error).toMatch(/last week/)
    // The row's count (no names) is fine for any day.
    expect((await get(`?date=${addDays(TODAY, -30)}`)).status).toBe(200)
    authed = { id: 'o', name: 'Catherine', role: 'owner' }
    expect((await get(`?date=${addDays(TODAY, -30)}&detail=1`)).status).toBe(200)
  })
})
