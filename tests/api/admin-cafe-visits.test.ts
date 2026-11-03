// @vitest-environment node
// Owners see Craft Café visits: /admin › Reports (a month), the Calendar and Home ("12 at Craft Café"), and who came on a day.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const busy = vi.hoisted(() => ({ items: [] as any[] }))
vi.mock('@lib/classes/studio-schedule', async (orig) => ({ ...(await orig<any>()), busyBetween: async () => busy.items }))
// Which days Craft Café runs (the owners' hours): every day, unless a test says otherwise.
const cafe = vi.hoisted(() => ({ off: new Set<string>() }))
vi.mock('@lib/cafe-days', async (orig) => ({ ...(await orig<any>()), cafeOn: (d: string) => (cafe.off.has(d) ? null : { opens: '09:00', closes: '13:00' }) }))
vi.mock('@lib/classes/class-store', async (orig) => ({ ...(await orig<any>()), listClasses: async () => [] }))

import * as visitsRoute from '@pages/api/admin/cafe-visits.json'
import * as calendar from '@pages/api/admin/classes/calendar.json'
import { adminCookie } from '@lib/admin-auth'
import { checkInOpenStudio } from '@lib/open-studio-store'
import { cafeMonth } from '@lib/cafe-visits'
import { itemSub } from '@components/admin/shell/items'

const cookie = () => adminCookie().split(';')[0]
const call = async (route: any, url: string, signedIn = true) => {
  const request = new Request(`https://x.test${url}`, { headers: signedIn ? { cookie: cookie() } : {} })
  const res: Response = await route.GET({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}
const BY = { id: 's', name: 'Sam' }
/** A month nobody else's test touches (the store is the real one, on disk), long past. */
const freshMonth = () => `${1200 + Math.floor(Math.random() * 600)}-0${1 + Math.floor(Math.random() * 9)}`

beforeEach(() => { vi.stubEnv('ADMIN_PASSCODE', 'owner-secret'); busy.items = []; cafe.off.clear() })
afterEach(() => vi.unstubAllEnvs())

describe('Craft Café visits for a month', () => {
  it('each day with check-ins and the month’s families, people, adults and kids', async () => {
    const m = freshMonth()
    await checkInOpenStudio(`${m}-03`, 'w1', ['adult', 'child:0', 'child:1'], BY, { name: 'Jane Doe', people: ['Jane Doe', 'Mia', 'Leo'] })
    await checkInOpenStudio(`${m}-03`, 'w2', ['adult'], BY)
    await checkInOpenStudio(`${m}-17`, 'w1', ['child:0'], BY)
    const r = await call(visitsRoute, `/x?month=${m}`)
    expect(r.status).toBe(200)
    expect(r.body.data).toEqual({
      month: m,
      days: [
        { date: `${m}-03`, households: 2, people: 4, adults: 2, kids: 2 },
        { date: `${m}-17`, households: 1, people: 1, adults: 0, kids: 1 },
      ],
      totals: { households: 3, people: 5, adults: 2, kids: 3 },
    })
  })

  it('counts Craft Café days only, the same days the Calendar shows', async () => {
    const m = freshMonth()
    await checkInOpenStudio(`${m}-03`, 'w1', ['adult'], BY)
    await checkInOpenStudio(`${m}-04`, 'w2', ['adult', 'child:0'], BY)
    cafe.off.add(`${m}-04`)
    const r = await call(visitsRoute, `/x?month=${m}`)
    expect(r.body.data.days.map((d: any) => d.date)).toEqual([`${m}-03`])
    expect(r.body.data.totals).toEqual({ households: 1, people: 1, adults: 1, kids: 0 })
  })

  it('a day still to come is never read', async () => {
    const out = await cafeMonth('2026-11', '2026-11-02')
    expect(out.days.every((d) => d.date <= '2026-11-02')).toBe(true)
  })

  it('who came on one day, newest first', async () => {
    const m = freshMonth()
    await checkInOpenStudio(`${m}-05`, 'w1', ['adult', 'child:0'], BY, { name: 'Jane Doe', people: ['Jane Doe', 'Mia'] })
    const r = await call(visitsRoute, `/x?date=${m}-05`)
    expect(r.body.data.totals).toEqual({ households: 1, people: 2, adults: 1, kids: 1 })
    expect(r.body.data.entries).toEqual([expect.objectContaining({ name: 'Jane Doe', people: ['Jane Doe', 'Mia'], by: 'Sam', adults: 1, kids: 1 })])
  })

  it('owners only, and a month or a day', async () => {
    expect((await call(visitsRoute, '/x?month=2026-10', false)).status).toBe(401)
    expect((await call(visitsRoute, '/x')).status).toBe(400)
    expect((await call(visitsRoute, '/x?month=2026-13')).status).toBe(400)
    expect((await call(visitsRoute, '/x?date=soon')).status).toBe(400)
  })
})

describe('Calendar and Home: "N at Craft Café"', () => {
  it('a café day that had check-ins carries its visits; a day still to come is never read', async () => {
    const m = freshMonth()
    await checkInOpenStudio(`${m}-07`, 'w1', ['adult', 'child:0', 'child:1'], BY)
    const start = `${m}-07T15:00:00.000Z`
    busy.items = [
      { kind: 'cafe', id: `cafe-${m}-07`, label: 'Craft Café', startIso: start, endIso: `${m}-07T19:00:00.000Z` },
      { kind: 'cafe', id: 'cafe-2999-01-02', label: 'Craft Café', startIso: '2999-01-02T15:00:00.000Z', endIso: '2999-01-02T19:00:00.000Z' },
    ]
    const r = await call(calendar, `/x?from=${encodeURIComponent(`${m}-07T00:00:00.000Z`)}&to=${encodeURIComponent(`${m}-08T00:00:00.000Z`)}`)
    expect(r.status).toBe(200)
    expect(r.body.data.items[0]).toMatchObject({ kind: 'cafe', visits: 3 })
    expect(r.body.data.items[1].visits).toBeUndefined()
    expect(itemSub(r.body.data.items[0])).toBe('3 at Craft Café')
    expect(itemSub(r.body.data.items[1])).toBe('Walk-in · pay per craft')
  })
})
