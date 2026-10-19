// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  listBookings: vi.fn(),
  listAllWorkshops: vi.fn(),
  waivers: vi.fn(),
}))
vi.mock('@config/providers', () => ({
  providers: {
    booking: { listBookings: mocks.listBookings },
    workshop: { listAllWorkshops: mocks.listAllWorkshops, listWorkshops: vi.fn(async () => []) },
  },
}))
vi.mock('@lib/party-store', () => ({ getPartyRecord: vi.fn(async () => null) }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async () => undefined) }))
vi.mock('@lib/waiver-store', () => ({ listWaiversByEvent: mocks.waivers }))

import * as calendar from '@pages/api/admin/classes/calendar.json'
import * as dayRoute from '@pages/api/admin/classes/day.json'
import { adminCookie } from '@lib/admin-auth'
import { createClass } from '@lib/classes/class-store'
import { makeKvStore } from '@lib/blob-store'
import { localToUtcISO } from '@lib/party-slots'
import { defaultRules } from '@lib/classes/validate'
import type { ClassContent } from '@lib/classes/types'

const cookie = () => adminCookie().split(';')[0]
const call = async (route: any, url: string, signedIn = true) => {
  const request = new Request(`https://x.test${url}`, { headers: signedIn ? { cookie: cookie() } : {} })
  const res: Response = await route.GET({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}
const content = (name: string): ClassContent => ({
  name, description: '', imageUrl: null, instructor: null, rules: defaultRules(),
  ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'Full class', covers: { kind: 'all' } }],
  prices: { all: { person: 2500 } },
  questions: [{ id: 'q1', label: 'Colour', choices: ['Red', 'Blue'] }], addOns: [], defaultCapacity: 12, defaultMinutes: 90,
})
const DAY = '2031-03-12' // a Wednesday: no Craft Café
const at = (hhmm: string) => localToUtcISO(DAY, hhmm)

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  mocks.listBookings.mockReset().mockResolvedValue([])
  mocks.listAllWorkshops.mockReset().mockResolvedValue([])
  mocks.waivers.mockReset().mockResolvedValue([])
})
afterEach(() => vi.unstubAllEnvs())

describe('calendar.json', () => {
  it('refuses without the owner cookie and needs a range', async () => {
    expect((await call(calendar, `/x?from=${at('00:00')}&to=${at('23:00')}`, false)).status).toBe(401)
    expect((await call(calendar, '/x')).status).toBe(400)
  })

  it('lists our classes with their status, and blocked time', async () => {
    const draft = await createClass({ content: content('Cal Draft Candles'), sessions: [{ id: 'ses_cal1', startIso: at('10:00'), endIso: at('11:30'), capacity: 8 }], status: 'draft', by: { id: 'a', name: 'A' } })
    const r = await call(calendar, `/x?from=${encodeURIComponent(at('00:00'))}&to=${encodeURIComponent(at('23:59'))}`)
    expect(r.status).toBe(200)
    const mine = r.body.data.items.find((i: any) => i.id === draft.id)
    expect(mine).toMatchObject({ kind: 'class', status: 'draft', sessionId: 'ses_cal1', label: 'Cal Draft Candles' })
  })

  it('a source that cannot be read is a 503, never an empty calendar', async () => {
    mocks.listAllWorkshops.mockRejectedValue(new Error('square down'))
    const r = await call(calendar, `/x?from=${encodeURIComponent(at('00:00'))}&to=${encodeURIComponent(at('23:59'))}`)
    expect(r.status).toBe(503)
    expect(r.body.error).toBe("The calendar couldn't be loaded. Try again.")
  })
})

describe('day.json', () => {
  it('lists each class session with its bookings and the waivers signed', async () => {
    const cls = await createClass({ content: content('Day Sheet Pottery'), sessions: [{ id: 'ses_day1', startIso: at('14:00'), endIso: at('16:00'), capacity: 10 }], status: 'open', by: { id: 'a', name: 'A' } })
    await makeKvStore('seat-ledger', 'seat-ledger').set(`ledger-${cls.id}`, JSON.stringify({
      classId: cls.id,
      lines: [{
        id: 'led_d1', bookingId: 'bkg_d1', sessionIds: ['ses_day1'], ticketTypeId: 'person', passId: 'all', seat: 1,
        priceCents: 2500, taxCents: 225, addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: { q1: 'Red' }, source: 'online',
        state: 'confirmed', holdExpiresAt: null, customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '' },
        square: { orderId: 'o', paymentId: 'p', lineUid: null }, by: null, refunds: [], at: new Date().toISOString(),
      }],
    }))
    mocks.waivers.mockImplementation(async (kind: string, id: string) =>
      kind === 'workshop' && id === cls.id ? [{ adult: { firstName: 'Ada', lastName: 'Lovelace', email: 'ADA@example.com' }, minors: [{}] }] : [])
    const r = await call(dayRoute, `/x?day=${DAY}`)
    expect(r.status).toBe(200)
    const c = r.body.data.classes.find((x: any) => x.id === cls.id)
    expect(c).toMatchObject({ name: 'Day Sheet Pottery', capacity: 10, waivers: [{ name: 'Ada Lovelace', email: 'ADA@example.com', kids: 1 }] })
    expect(c.bookings).toHaveLength(1)
    expect(c.bookings[0].picks[0].answers).toEqual({ q1: 'Red' })
  })

  it('refuses without the owner cookie', async () => {
    const r = await call(dayRoute, `/x?day=${DAY}`, false)
    expect(r.status).toBe(401)
    expect(r.body.error).toBe('Sign in first.')
  })

  it('needs a day', async () => {
    expect((await call(dayRoute, '/x?day=soon')).status).toBe(400)
  })
})
