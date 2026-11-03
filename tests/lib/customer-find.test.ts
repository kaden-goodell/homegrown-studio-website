// tests/lib/customer-find.test.ts — /admin › Find a booking (final review I5).
import { describe, it, expect, vi } from 'vitest'

const ada = { givenName: 'Ada', familyName: 'Rivera', email: 'ada@example.com', phone: '(256) 555-0100' }
const bo = { givenName: 'Bo', familyName: 'Diaz', email: 'bo@example.com', phone: '(256) 555-0111' }
const cls = (id: string, ymd: string) => ({
  id, status: 'open', content: { name: `Class ${id}`, ticketTypes: [{ id: 'person', label: 'Person' }] },
  sessions: [{ id: `ses_${id}`, startIso: `${ymd}T16:00:00.000Z`, endIso: `${ymd}T17:30:00.000Z`, capacity: 8 }],
})
vi.mock('@lib/classes/class-store', () => ({ listClasses: async () => [cls('cls_a', '2031-03-12'), cls('cls_b', '2031-03-05')] }))
vi.mock('@lib/classes/seat-ledger', () => ({
  getLedger: async (id: string) => ({ classId: id, lines: id === 'cls_a' ? [{ bookingId: 'bkg_1', state: 'confirmed', customer: ada }, { bookingId: 'bkg_2', state: 'confirmed', customer: bo }] : [{ bookingId: 'bkg_3', state: 'released', customer: ada }] }),
}))
vi.mock('@lib/classes/admin-actions', () => ({
  classBookings: async (id: string) => ({ bookings: [{ bookingId: 'bkg_1', customer: ada, sessionIds: [`ses_${id}`] }, { bookingId: 'bkg_2', customer: bo, sessionIds: [`ses_${id}`] }] }),
}))
vi.mock('@lib/party-store', () => ({
  listParties: async () => [
    { bookingId: 'pty_1', startIso: '2031-04-01T18:00:00.000Z', hostName: 'Ada Rivera', hostEmail: 'ada@example.com', hostPhone: '2565550100', craftName: 'Mugs', guestCount: 10, status: 'booked', source: 'ours' },
    { bookingId: 'pty_2', startIso: '2031-04-02T18:00:00.000Z', hostName: 'Cy Smith', hostEmail: 'cy@x.co', craftName: 'Mugs', guestCount: 8, source: 'square' },
  ],
}))
vi.mock('@lib/classes/waitlist-store', () => ({
  waitlistClassIds: async () => ['cls_b', 'cls_gone'],
  getWaitlist: async () => ({ entries: [{ state: 'waiting', seats: 2, customer: ada }, { state: 'removed', seats: 1, customer: ada }] }),
  isOnList: (e: any) => e.state === 'waiting' || e.state === 'charging',
}))

import { findCustomerBookings, matcher } from '@lib/customer-find'

const now = new Date('2031-03-01T12:00:00Z')

describe('Find a booking', () => {
  it('matches part of a name, an email, or 4+ digits of a phone', () => {
    expect(matcher('rive')(ada)).toBe(true)
    expect(matcher('Ada Riv')(ada)).toBe(true)
    expect(matcher('ada@exa')(ada)).toBe(true)
    expect(matcher('0100')(ada)).toBe(true)
    expect(matcher('555-0111')(ada)).toBe(false)
    expect(matcher('rivera')(null)).toBe(false)
  })

  it('finds their class bookings (not released ones), parties and waitlist places', async () => {
    const r = await findCustomerBookings('Rivera', now)
    expect(r.classes.map((c) => [c.classId, c.booking.bookingId])).toEqual([['cls_a', 'bkg_1']])
    expect(r.classes[0]).toMatchObject({ className: 'Class cls_a', startIso: '2031-03-12T16:00:00.000Z' })
    expect(r.parties).toEqual([{ bookingId: 'pty_1', startIso: '2031-04-01T18:00:00.000Z', hostName: 'Ada Rivera', craftName: 'Mugs', guestCount: 10, status: 'booked', inSquare: false }])
    expect(r.waitlist).toEqual([{ classId: 'cls_b', className: 'Class cls_b', startIso: '2031-03-05T16:00:00.000Z', seats: 2, name: 'Ada Rivera' }])
    expect(r.more).toBe(false)
  })

  it('a phone search finds the same person', async () => {
    const r = await findCustomerBookings('555 0100', now)
    expect(r.classes).toHaveLength(1)
    expect(r.parties.map((p) => p.bookingId)).toEqual(['pty_1'])
  })
})
