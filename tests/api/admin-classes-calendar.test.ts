// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  listBookings: vi.fn(),
  listAllWorkshops: vi.fn(),
  waivers: vi.fn(),
  party: vi.fn(),
}))
vi.mock('@config/providers', () => ({
  providers: {
    booking: { listBookings: mocks.listBookings },
    workshop: { listAllWorkshops: mocks.listAllWorkshops, listWorkshops: vi.fn(async () => []) },
  },
}))
vi.mock('@lib/party-store', () => ({ getPartyRecord: mocks.party }))
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
  mocks.party.mockReset().mockResolvedValue(null)
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

  it('blocked time is named by its Why, and carries the owners’ note (admin only)', async () => {
    const { addBlocked } = await import('@lib/classes/blocked-time')
    const b = await addBlocked({ startIso: at('07:00'), endIso: at('08:00'), reason: 'Private event', note: 'Smith baby shower', by: { id: 'a', name: 'A' } })
    const r = await call(calendar, `/x?from=${encodeURIComponent(at('00:00'))}&to=${encodeURIComponent(at('23:59'))}`)
    expect(r.body.data.items.find((i: any) => i.id === b.id)).toMatchObject({ kind: 'blocked', label: 'Private event', note: 'Smith baby shower' })
    await expect(addBlocked({ startIso: at('07:00'), endIso: at('08:00'), reason: 'Setup', note: 'x'.repeat(201), by: { id: 'a', name: 'A' } })).rejects.toThrow('The note can be up to 200 characters.')
  })

  it('our class sessions carry seats taken and capacity; parties carry their guest count', async () => {
    const cls = await createClass({ content: content('Cal Seats Looms'), sessions: [{ id: 'ses_cal2', startIso: at('16:00'), endIso: at('17:00'), capacity: 12 }], status: 'open', by: { id: 'a', name: 'A' } })
    await makeKvStore('seat-ledger', 'seat-ledger').set(`ledger-${cls.id}`, JSON.stringify({
      classId: cls.id,
      lines: [1, 2, 3].map((seat) => ({
        id: `led_cs${seat}`, bookingId: 'bkg_cs', sessionIds: ['ses_cal2'], ticketTypeId: 'person', passId: 'all', seat,
        priceCents: 2500, taxCents: 0, addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online',
        state: 'confirmed', holdExpiresAt: null, customer: null, square: { orderId: 'o', paymentId: 'p', lineUid: null }, by: null, refunds: [], at: new Date().toISOString(),
      })),
    }))
    mocks.listBookings.mockResolvedValue([{ id: 'bk_guests', status: 'accepted', slot: { startAt: at('13:00'), duration: 90 } }])
    mocks.party.mockImplementation(async (id: string) => (id === 'bk_guests' ? { bookingId: id, hostName: 'Sam Host', guestCount: 14 } : null))
    const r = await call(calendar, `/x?from=${encodeURIComponent(at('00:00'))}&to=${encodeURIComponent(at('23:59'))}`)
    expect(r.body.data.items.find((i: any) => i.id === cls.id)).toMatchObject({ booked: 3, capacity: 12 })
    expect(r.body.data.items.find((i: any) => i.id === 'bk_guests')).toMatchObject({ kind: 'party', guests: 14 })
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

  it('R43: a full refund that kept the seat is still on the sheet; a freed seat is not, and doesn’t count', async () => {
    const cls = await createClass({ content: content('Day Sheet Kept Seat'), sessions: [{ id: 'ses_day2', startIso: at('18:00'), endIso: at('19:00'), capacity: 10 }], status: 'open', by: { id: 'a', name: 'A' } })
    const by = { id: 'a', name: 'A' }
    const line = (id: string, bookingId: string, seat: number, given: string, refunds: any[]) => ({
      id, bookingId, sessionIds: ['ses_day2'], ticketTypeId: 'person', passId: 'all', seat,
      priceCents: 2500, taxCents: 0, addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online',
      state: refunds.length ? 'refunded' : 'confirmed', holdExpiresAt: null, customer: { givenName: given, familyName: 'X', email: `${given}@example.com`, phone: '' },
      square: { orderId: 'o', paymentId: 'p', lineUid: null }, by: null, refunds, at: new Date().toISOString(),
    })
    const kept = { at: new Date().toISOString(), cents: 2500, reason: 'Goodwill', by, freedSeat: false, squareRefundId: 'r1' }
    const freed = { at: new Date().toISOString(), cents: 2500, reason: 'Can’t come', by, freedSeat: true, squareRefundId: 'r2' }
    await makeKvStore('seat-ledger', 'seat-ledger').set(`ledger-${cls.id}`, JSON.stringify({
      classId: cls.id,
      lines: [
        line('led_k1', 'bkg_kept', 1, 'Kept', [kept]),
        // part refunded: seat 1 freed, seat 2 still coming
        line('led_p1', 'bkg_part', 1, 'Part', [freed]),
        line('led_p2', 'bkg_part', 2, 'Part', []),
        line('led_g1', 'bkg_gone', 1, 'Gone', [freed]),
      ],
    }))
    const r = await call(dayRoute, `/x?day=${DAY}`)
    const c = r.body.data.classes.find((x: any) => x.id === cls.id)
    const ids = c.bookings.map((b: any) => b.bookingId).sort()
    expect(ids).toEqual(['bkg_kept', 'bkg_part'])
    const seats = c.bookings.reduce((s: number, b: any) => s + Object.values(b.seats as Record<string, number>).reduce((a, n) => a + n, 0), 0)
    expect(seats).toBe(2)
    expect(c.bookings.find((b: any) => b.bookingId === 'bkg_part').lineIds).toEqual(['led_p2'])
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
