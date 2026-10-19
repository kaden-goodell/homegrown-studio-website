import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  listBookings: vi.fn(),
  catalogGet: vi.fn(),
  env: { environment: 'production' as 'production' | 'sandbox' },
}))
vi.mock('@config/providers', () => ({ providers: { booking: { listBookings: (...a: any[]) => m.listBookings(...a) } } }))
vi.mock('@config/site.config', () => ({
  siteConfig: { providers: { booking: { config: { locationId: 'LOC' } }, catalog: { type: 'square', config: m.env } } },
}))
vi.mock('@providers/square/client', () => ({ createSquareClient: () => ({ catalog: { object: { get: (...a: any[]) => m.catalogGet(...a) } } }) }))
vi.mock('@lib/party-store', () => ({ getPartyRecord: async (id: string) => (id === 'bk_rivera' ? { hostName: 'Jamie Rivera' } : null) }))

import { legacyPartyBusy, legacyRemaining, loadPartyVariationId, onSandbox, resetLegacySquareMemory } from '@lib/parties/legacy-square'
import * as openDates from '@lib/party-open-dates'
import { getPartySettings, savePartySettings, resetPartySettingsCache } from '@lib/parties/settings-store'

const by = { id: 'k', name: 'Kaden' }
const booking = (id: string, startAt: string, over: Record<string, unknown> = {}) =>
  ({ id, status: 'accepted', slot: { startAt, duration: 90, serviceVariationId: 'var-party' }, ...over })
const FROM = '2027-02-07T06:00:00.000Z' // Sun 7 Feb 2027, studio midnight (CST)
const TO = '2027-02-08T06:00:00.000Z'

async function setRead(on: boolean): Promise<void> {
  const cur = await getPartySettings({ fresh: true })
  await savePartySettings({ times: cur.times, packages: cur.packages, addOns: cur.addOns, readSquareBookings: on }, { expectedUpdatedAt: cur.updatedAt, by })
}

beforeEach(() => {
  m.listBookings.mockReset().mockResolvedValue([])
  m.catalogGet.mockReset().mockResolvedValue({ object: { itemData: { variations: [{ id: 'var-party' }] } } })
  m.env.environment = 'production'
  resetLegacySquareMemory()
  resetPartySettingsCache()
})

describe('legacyPartyBusy', () => {
  it('only the party service counts: bookings of other services and cancelled ones are left out', async () => {
    m.listBookings.mockResolvedValue([
      booking('bk_rivera', '2027-02-07T19:00:00.000Z'),
      booking('bk_other', '2027-02-07T21:30:00.000Z', { slot: { startAt: '2027-02-07T21:30:00.000Z', duration: 60, serviceVariationId: 'var-class' } }),
      booking('bk_gone', '2027-02-07T21:30:00.000Z', { status: 'cancelled' }),
    ])
    expect(await legacyPartyBusy(FROM, TO)).toEqual([
      { kind: 'party', id: 'bk_rivera', label: 'the Rivera party', hostName: 'Jamie Rivera', startIso: '2027-02-07T19:00:00.000Z', endIso: '2027-02-07T20:30:00.000Z' },
    ])
  })

  it('asks Square from 12 hours before (a party still running), and keeps only parties overlapping the range', async () => {
    m.listBookings.mockResolvedValue([
      booking('bk_late', '2027-02-07T03:00:00.000Z', { slot: { startAt: '2027-02-07T03:00:00.000Z', duration: 240, serviceVariationId: 'var-party' } }), // runs past midnight
      booking('bk_early', '2027-02-06T20:00:00.000Z'),
    ])
    const list = await legacyPartyBusy(FROM, TO)
    expect(m.listBookings).toHaveBeenCalledWith({ startDate: '2027-02-06T18:00:00.000Z', endDate: TO, locationId: 'LOC' })
    expect(list.map((b) => b.id)).toEqual(['bk_late'])
  })

  it('asks the catalog nothing when there are no bookings, and once per 10 minutes otherwise', async () => {
    expect(await legacyPartyBusy(FROM, TO)).toEqual([])
    expect(m.catalogGet).not.toHaveBeenCalled()
    m.listBookings.mockResolvedValue([booking('bk_1', '2027-02-07T19:00:00.000Z')])
    await legacyPartyBusy(FROM, TO)
    await legacyPartyBusy(FROM, TO)
    expect(m.catalogGet).toHaveBeenCalledTimes(1)
  })

  it('fails closed: a Square bookings error, a catalog error, or a party item with no variation throws', async () => {
    m.listBookings.mockRejectedValue(new Error('Square 500'))
    await expect(legacyPartyBusy(FROM, TO)).rejects.toThrow('Square 500')
    m.listBookings.mockResolvedValue([booking('bk_1', '2027-02-07T19:00:00.000Z')])
    m.catalogGet.mockRejectedValue(new Error('catalog 500'))
    await expect(legacyPartyBusy(FROM, TO)).rejects.toThrow('catalog 500')
    m.catalogGet.mockResolvedValue({ object: { itemData: { variations: [] } } })
    await expect(legacyPartyBusy(FROM, TO)).rejects.toThrow('party service could not be found')
  })

  it('no Square call on the sandbox', async () => {
    m.env.environment = 'sandbox'
    m.listBookings.mockRejectedValue(new Error('must not be asked'))
    expect(await legacyPartyBusy(FROM, TO)).toEqual([])
    expect(m.listBookings).not.toHaveBeenCalled()
  })

  it('no Square call when the owners turn the read off; back on, it reads again', async () => {
    await setRead(false)
    try {
      m.listBookings.mockRejectedValue(new Error('must not be asked'))
      expect(await legacyPartyBusy(FROM, TO)).toEqual([])
      expect(m.listBookings).not.toHaveBeenCalled()
    } finally {
      await setRead(true)
    }
    await expect(legacyPartyBusy(FROM, TO)).rejects.toThrow('must not be asked')
  })

  it('never writes Square: the module has no booking create, update or cancel', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(process.cwd(), 'src/lib/parties/legacy-square.ts'), 'utf8')
    expect(src).not.toMatch(/createBooking|cancelBooking|updateBooking|\.bookings\.(create|cancel|update)/)
  })
})

describe('legacyRemaining (Parties setup: the read switch stays on while any remain)', () => {
  it('lists future Square parties still to run, whatever the switch says', async () => {
    const now = new Date('2027-02-07T20:00:00.000Z')
    m.listBookings.mockResolvedValue([
      booking('bk_running', '2027-02-07T19:00:00.000Z'), // ends 20:30: still to run
      booking('bk_done', '2027-02-07T17:00:00.000Z'), // ended 18:30
      booking('bk_next', '2027-03-07T19:00:00.000Z'),
      booking('bk_class', '2027-03-07T19:00:00.000Z', { slot: { startAt: '2027-03-07T19:00:00.000Z', duration: 60, serviceVariationId: 'var-class' } }),
    ])
    await setRead(false)
    try {
      expect((await legacyRemaining(now)).map((b) => b.id)).toEqual(['bk_running', 'bk_next'])
    } finally {
      await setRead(true)
    }
    const asked = m.listBookings.mock.calls[0][0]
    expect(Date.parse(asked.endDate) - now.getTime()).toBeGreaterThanOrEqual(365 * 86_400_000)
  })

  it('none on the sandbox, without asking Square', async () => {
    m.env.environment = 'sandbox'
    expect(await legacyRemaining(new Date())).toEqual([])
    expect(m.listBookings).not.toHaveBeenCalled()
  })
})

describe('moved helpers', () => {
  it('party-open-dates re-exports the Square helpers', () => {
    expect(openDates.onSandbox).toBe(onSandbox)
    expect(openDates.loadPartyVariationId).toBe(loadPartyVariationId)
  })

  it('on the sandbox a missing party item is "no variation", not a failure', async () => {
    m.env.environment = 'sandbox'
    m.catalogGet.mockRejectedValue(Object.assign(new Error('NOT_FOUND'), { statusCode: 404 }))
    expect(await loadPartyVariationId()).toBe('')
  })
})
