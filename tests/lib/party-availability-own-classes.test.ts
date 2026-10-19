import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@config/party.config', async (orig) => ({ ...(await orig<typeof import('@config/party.config')>()), partyDateOverrides: {} }))
vi.mock('../config/party.config', async (orig) => ({ ...(await orig<typeof import('../../src/config/party.config')>()), partyDateOverrides: {} }))

const mocks = vi.hoisted(() => ({ listBookings: vi.fn(), listAllWorkshops: vi.fn(), storeDown: false }))
vi.mock('@config/providers', () => ({
  providers: {
    booking: { listBookings: mocks.listBookings },
    workshop: { listAllWorkshops: mocks.listAllWorkshops, listWorkshops: vi.fn(async () => []) },
  },
}))
vi.mock('@config/site.config', () => ({
  siteConfig: { providers: { booking: { config: { locationId: 'test-location' } } } },
}))
vi.mock('@lib/classes/class-store', async (orig) => {
  const real = await orig<typeof import('@lib/classes/class-store')>()
  return {
    ...real,
    listClasses: async (...a: Parameters<typeof real.listClasses>) => {
      if (mocks.storeDown) throw new Error('store down')
      return real.listClasses(...a)
    },
  }
})

import { createClass } from '@lib/classes/class-store'
import { addBlocked } from '@lib/classes/blocked-time'
import { openPartyStarts, isStartOpen } from '@lib/party-availability'
import { busyBetween } from '@lib/classes/studio-schedule'
import { localToUtcISO } from '@lib/party-slots'
import type { ClassContent } from '@lib/classes/types'

const by = { id: 'k', name: 'Kaden' }
const content = (name: string): ClassContent => ({
  name, description: '', imageUrl: null, instructor: null,
  rules: { ages: '', dropOff: false, madeToOrder: false, taxable: true, maxPerBooking: 10, signupCutoffHours: null, minimumToRun: null, linkOnly: false, joinPartway: true, waitlistCutoffHours: 2, canShareRoom: false },
  ticketTypes: [{ id: 'person', label: 'Person' }],
  passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }],
  prices: { all: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 12, defaultMinutes: 60,
})
const at = (ymd: string, hhmm: string) => localToUtcISO(ymd, hhmm)
let s = 0
const session = (start: string, end: string) => ({ id: `ses_p${++s}`, startIso: start, endIso: end, capacity: 12 })

// Sundays offer 1:00 and 3:30. Each test uses its own Sunday so the shared store doesn't leak between them.
const NOW = new Date('2027-07-01T12:00:00.000Z')

beforeEach(() => {
  vi.setSystemTime(NOW)
  mocks.storeDown = false
  mocks.listBookings.mockReset().mockResolvedValue([])
  mocks.listAllWorkshops.mockReset().mockResolvedValue([])
})
afterEach(() => vi.useRealTimers())

describe('party times respect our own classes and blocked time', () => {
  it('our class at noon drops the 1:00 party; the picker and the pre-charge re-check both refuse it', async () => {
    const day = '2027-07-11'
    await createClass({ content: content('Pottery'), sessions: [session(at(day, '12:00'), at(day, '12:30'))], status: 'open', by })
    expect(await openPartyStarts(day)).toEqual([at(day, '15:30')])
    expect((await isStartOpen(at(day, '13:00'), 90)).ok).toBe(false)
    expect((await isStartOpen(at(day, '15:30'), 90)).ok).toBe(true)
  })

  it('a draft class holds the room too; a cancelled one does not', async () => {
    const day = '2027-07-18'
    await createClass({ content: content('Draft'), sessions: [session(at(day, '17:00'), at(day, '18:00'))], status: 'draft', by })
    await createClass({ content: content('Gone'), sessions: [session(at(day, '12:00'), at(day, '12:30'))], status: 'cancelled', by })
    expect(await openPartyStarts(day)).toEqual([at(day, '13:00')])
  })

  it('blocked time drops the party it covers', async () => {
    const day = '2027-07-25'
    await addBlocked({ startIso: at(day, '16:00'), endIso: at(day, '16:30'), reason: 'Plumber', by })
    expect(await openPartyStarts(day)).toEqual([at(day, '13:00')])
    expect((await isStartOpen(at(day, '15:30'), 90)).ok).toBe(false)
  })

  it('a Square class drops the party times it rules out; a closed day offers none', async () => {
    const day = '2027-08-01'
    mocks.listAllWorkshops.mockResolvedValue([{ scheduleId: 'clssch_x', name: 'Square Class', startAt: at(day, '16:00'), durationMinutes: 60 }])
    expect(await openPartyStarts(day)).toEqual([at(day, '13:00')])
    expect(await openPartyStarts('2026-12-27', { admin: true }, new Date('2026-12-01T12:00:00Z'))).toEqual([])
  })

  it('a failed legacy lookup still never blocks parties, but our classes still count', async () => {
    const day = '2027-08-08'
    mocks.listAllWorkshops.mockRejectedValue(new Error('Square 503'))
    await createClass({ content: content('Ours'), sessions: [session(at(day, '12:00'), at(day, '12:30'))], status: 'open', by })
    expect(await openPartyStarts(day)).toEqual([at(day, '15:30')])
  })

  it('if our classes cannot be read, party times are not offered as free (fails closed)', async () => {
    mocks.storeDown = true
    await expect(busyBetween(at('2027-08-15', '00:00'), at('2027-08-16', '00:00'), undefined, { legacyClasses: 'ignore-failure' })).rejects.toThrow()
    await expect(openPartyStarts('2027-08-15')).rejects.toThrow()
    await expect(isStartOpen(at('2027-08-15', '13:00'), 90)).rejects.toThrow()
  })
})
