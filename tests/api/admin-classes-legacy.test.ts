// @vitest-environment node
/** /admin for classes still run from Square (Kaden, 17 Nov 2026): seats, price, who is booked and their waiver. Read only. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({ getEvent: vi.fn(), findWorkshop: vi.fn(), families: vi.fn(), busy: vi.fn() }))
vi.mock('@lib/events', () => ({ getEvent: m.getEvent, findWorkshop: m.findWorkshop }))
vi.mock('@lib/waiver-reminders', () => ({ squareClassFamilies: m.families }))
vi.mock('@lib/classes/studio-schedule', async (orig) => ({ ...(await orig<typeof import('@lib/classes/studio-schedule')>()), busyBetween: m.busy }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async () => undefined) }))

import * as legacyRoute from '@pages/api/admin/classes/legacy.json'
import * as calendar from '@pages/api/admin/classes/calendar.json'
import { legacyClassCounts } from '@lib/classes/legacy-class-details'
import { legacyBookedLabel } from '@lib/classes/legacy-label'
import { adminCookie } from '@lib/admin-auth'

const cookie = () => adminCookie().split(';')[0]
const call = async (route: any, url: string, signedIn = true) => {
  const request = new Request(`https://x.test${url}`, { headers: signedIn ? { cookie: cookie() } : {} })
  const res: Response = await route.GET({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}
const FELTING = { kind: 'workshop', id: 'clssch_felt', title: 'Christmas Needle Felting', capacity: 20, seats: 13, priceCents: 3000 }

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  m.getEvent.mockReset().mockResolvedValue(FELTING)
  m.findWorkshop.mockReset().mockResolvedValue({ scheduleId: 'clssch_felt' })
  m.families.mockReset().mockResolvedValue([{ name: 'Ann Lee', seats: 2, waiver: 'current' }])
  m.busy.mockReset().mockResolvedValue([])
})
afterEach(() => vi.unstubAllEnvs())

describe('legacyClassCounts', () => {
  it('booked = size − seats left, with the price', async () => {
    expect(await legacyClassCounts('clssch_felt')).toEqual({ capacity: 20, remaining: 13, booked: 7, priceCents: 3000 })
  })
  it('fail-soft: no class, or a failed read, gives nothing (never throws)', async () => {
    m.getEvent.mockResolvedValueOnce(null)
    expect(await legacyClassCounts('clssch_x')).toEqual({})
    m.getEvent.mockRejectedValueOnce(new Error('Square down'))
    expect(await legacyClassCounts('clssch_x')).toEqual({})
  })
  it('no size known: seats left only, no booked', async () => {
    m.getEvent.mockResolvedValueOnce({ ...FELTING, capacity: undefined })
    expect(await legacyClassCounts('clssch_felt')).toEqual({ remaining: 13, priceCents: 3000 })
  })
})

describe('legacyBookedLabel', () => {
  it('reads like our own classes', () => {
    expect(legacyBookedLabel({ booked: 7, capacity: 20 })).toBe('7 of 20 booked')
    expect(legacyBookedLabel({ booked: 7 })).toBe('7 booked')
    expect(legacyBookedLabel({ remaining: 13 })).toBe('13 seats left')
    expect(legacyBookedLabel({})).toBe('')
  })
})

describe('/api/admin/classes/legacy.json', () => {
  it('owners only, and only Square class ids', async () => {
    expect((await call(legacyRoute, '/x?id=clssch_felt', false)).status).toBe(401)
    expect((await call(legacyRoute, '/x?id=cls_ours')).status).toBe(400)
    expect((await call(legacyRoute, '/x')).status).toBe(400)
  })
  it('seats, price and who is booked with their waiver', async () => {
    const r = await call(legacyRoute, '/x?id=clssch_felt')
    expect(r.status).toBe(200)
    expect(r.body.data).toEqual({ capacity: 20, remaining: 13, booked: 7, priceCents: 3000, families: [{ name: 'Ann Lee', seats: 2, waiver: 'current' }] })
  })
  it('a list that can’t be read still answers with the seats (families null)', async () => {
    m.families.mockRejectedValueOnce(new Error('blobs down'))
    const r = await call(legacyRoute, '/x?id=clssch_felt')
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ booked: 7, families: null })
  })
})

describe('calendar.json: Square classes carry their seats', () => {
  const from = '2031-03-12T05:00:00.000Z', to = '2031-03-13T05:00:00.000Z'
  const square = { kind: 'legacy-class', id: 'clssch_felt', label: 'Christmas Needle Felting', startIso: '2031-03-13T01:00:00.000Z', endIso: '2031-03-13T03:00:00.000Z' }
  it('booked, size, seats left and price on the item', async () => {
    m.busy.mockResolvedValue([square])
    const r = await call(calendar, `/x?from=${from}&to=${to}`)
    expect(r.status).toBe(200)
    expect(r.body.data.items).toEqual([{ ...square, capacity: 20, remaining: 13, booked: 7, priceCents: 3000 }])
  })
  it('fail-soft: a failed read leaves the item as it was', async () => {
    m.busy.mockResolvedValue([square])
    m.getEvent.mockRejectedValue(new Error('Square down'))
    const r = await call(calendar, `/x?from=${from}&to=${to}`)
    expect(r.body.data.items).toEqual([square])
  })
})
