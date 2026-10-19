import { describe, it, expect, vi, beforeEach } from 'vitest'

// Pins the weekly rules (Sunday 1:00 and 3:30; Saturday 1:30); one-off days are tested elsewhere.
vi.mock('@config/party.config', async (orig) => ({ ...(await orig<typeof import('@config/party.config')>()), partyDateOverrides: {} }))
vi.mock('../config/party.config', async (orig) => ({ ...(await orig<typeof import('../../../src/config/party.config')>()), partyDateOverrides: {} }))

const m = vi.hoisted(() => ({
  listBookings: vi.fn(),
  listAllWorkshops: vi.fn(),
  catalogGet: vi.fn(),
  env: { environment: 'production' as 'production' | 'sandbox' },
  down: { settings: false, book: false },
}))
vi.mock('@config/providers', () => ({
  providers: {
    booking: { listBookings: (...a: any[]) => m.listBookings(...a) },
    workshop: { listAllWorkshops: (...a: any[]) => m.listAllWorkshops(...a), listWorkshops: async () => [] },
  },
}))
vi.mock('@config/site.config', () => ({
  siteConfig: { providers: { booking: { config: { locationId: 'LOC' } }, catalog: { type: 'square', config: m.env } } },
}))
vi.mock('@providers/square/client', () => ({ createSquareClient: () => ({ catalog: { object: { get: (...a: any[]) => m.catalogGet(...a) } } }) }))
vi.mock('@lib/party-store', () => ({ getPartyRecord: async () => null }))
vi.mock('@lib/parties/settings-store', async (orig) => {
  const real = await orig<typeof import('@lib/parties/settings-store')>()
  return { ...real, getPartySettings: async (o?: any) => { if (m.down.settings) throw new Error('party settings store down'); return real.getPartySettings(o) } }
})
vi.mock('@lib/parties/party-book', async (orig) => {
  const real = await orig<typeof import('@lib/parties/party-book')>()
  return { ...real, holdsBetween: async (...a: Parameters<typeof real.holdsBetween>) => { if (m.down.book) throw new Error('party book store down'); return real.holdsBetween(...a) } }
})

import { openPartyStarts, openPartyStartsInWindow, isStartOpen, PARTY_TIMES_UNREADABLE } from '@lib/parties/open-times'
import { holdTime, confirmTime, releaseTime } from '@lib/parties/party-book'
import { getPartySettings, savePartySettings, resetPartySettingsCache } from '@lib/parties/settings-store'
import { resetLegacySquareMemory } from '@lib/parties/legacy-square'
import { addBlocked } from '@lib/classes/blocked-time'
import { createClass } from '@lib/classes/class-store'
import { localToUtcISO } from '@lib/parties/party-times'
import type { PartySettingsInput } from '@lib/parties/types'
import type { ClassContent } from '@lib/classes/types'

const at = (ymd: string, hhmm: string) => localToUtcISO(ymd, hhmm)
const by = { id: 'k', name: 'Kaden' }
const NOW = new Date('2027-02-01T15:00:00.000Z') // every date below is inside the 90-day window
const square = (id: string, startIso: string, serviceVariationId = 'var-party', status = 'accepted') =>
  ({ id, status, slot: { startAt: startIso, duration: 90, serviceVariationId } })
let n = 0
const pty = () => `pty_ot${String(++n).padStart(14, '0')}`

async function setSettings(patch: (s: PartySettingsInput) => PartySettingsInput): Promise<void> {
  const cur = await getPartySettings({ fresh: true })
  await savePartySettings(patch({ times: cur.times, packages: cur.packages, addOns: cur.addOns, readSquareBookings: cur.readSquareBookings }), { expectedUpdatedAt: cur.updatedAt, by })
}

const content = (name: string): ClassContent => ({
  name, description: '', imageUrl: null, instructor: null,
  rules: { ages: '', dropOff: false, madeToOrder: false, taxable: true, maxPerBooking: 10, signupCutoffHours: null, minimumToRun: null, linkOnly: false, joinPartway: true, waitlistCutoffHours: 2, canShareRoom: false },
  ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }],
  prices: { all: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 12, defaultMinutes: 60,
})

beforeEach(async () => {
  m.listBookings.mockReset().mockResolvedValue([])
  m.listAllWorkshops.mockReset().mockResolvedValue([])
  m.catalogGet.mockReset().mockResolvedValue({ object: { itemData: { variations: [{ id: 'var-party' }] } } })
  m.env.environment = 'production'
  m.down.settings = false
  m.down.book = false
  resetLegacySquareMemory()
  resetPartySettingsCache()
})

// Each test uses its own Sunday (1:00 and 3:30) so the shared party book doesn't leak between them.
describe('openPartyStarts: our party book', () => {
  it('a booked party removes its start and every start whose span + 60 overlaps it', async () => {
    const day = '2027-02-14'
    const id = pty()
    // 1:00 with 30 minutes of extra time ends 3:00; with its cleanup hour 3:30 is out too.
    expect((await holdTime({ partyId: id, startIso: at(day, '13:00'), endIso: at(day, '15:00'), ttlMinutes: 10 }, [], new Date())).ok).toBe(true)
    await confirmTime(id, at(day, '13:00'), at(day, '15:00'))
    expect(await openPartyStarts(day, {}, NOW)).toEqual([])
    await releaseTime(id, at(day, '13:00'))
    expect(await openPartyStarts(day, {}, NOW)).toEqual([at(day, '13:00'), at(day, '15:30')])
  })

  it('a held time disappears from the picker for everyone else, but not for the party moving past itself', async () => {
    const day = '2027-02-21'
    const id = pty()
    expect((await holdTime({ partyId: id, startIso: at(day, '15:30'), endIso: at(day, '17:00'), ttlMinutes: 10 }, [], new Date())).ok).toBe(true)
    expect(await openPartyStarts(day, {}, NOW)).toEqual([at(day, '13:00')])
    expect(await openPartyStarts(day, { ignorePartyId: id }, NOW)).toEqual([at(day, '13:00'), at(day, '15:30')])
    expect(await isStartOpen(at(day, '15:30'), 90, {}, NOW)).toEqual({ ok: false, message: 'That party time was just taken. Please pick another time.' })
    expect(await isStartOpen(at(day, '15:30'), 90, { ignorePartyId: id }, NOW)).toEqual({ ok: true })
  })

  it('an expired hold frees the time', async () => {
    const day = '2027-02-28'
    const id = pty()
    expect((await holdTime({ partyId: id, startIso: at(day, '13:00'), endIso: at(day, '14:30'), ttlMinutes: 10 }, [], new Date(Date.now() - 20 * 60_000))).ok).toBe(true)
    expect(await openPartyStarts(day, {}, NOW)).toEqual([at(day, '13:00'), at(day, '15:30')])
  })
})

describe('openPartyStarts: legacy Square parties (read only)', () => {
  it('legacy blocks: a Square party booking removes its start while the read is on', async () => {
    const day = '2027-03-07'
    m.listBookings.mockResolvedValue([square('bk_legacy', at(day, '13:00'))])
    expect(await openPartyStarts(day, {}, NOW)).toEqual([at(day, '15:30')])
    expect(await isStartOpen(at(day, '13:00'), 90, {}, NOW)).toMatchObject({ ok: false })
  })

  it('only the party service counts: a Square booking of another service is not a party', async () => {
    const day = '2027-03-07'
    m.listBookings.mockResolvedValue([square('bk_other', at(day, '13:00'), 'var-something-else')])
    expect(await openPartyStarts(day, {}, NOW)).toEqual([at(day, '13:00'), at(day, '15:30')])
  })

  it('a cancelled Square party holds nothing', async () => {
    const day = '2027-03-07'
    m.listBookings.mockResolvedValue([square('bk_c', at(day, '13:00'), 'var-party', 'cancelled')])
    expect(await openPartyStarts(day, {}, NOW)).toEqual([at(day, '13:00'), at(day, '15:30')])
  })

  it('legacy read fails closed: Square throws while the read is on → openPartyStarts throws', async () => {
    m.listBookings.mockRejectedValue(new Error('Square 500'))
    await expect(openPartyStarts('2027-03-07', {}, NOW)).rejects.toThrow('Square 500')
    await expect(openPartyStartsInWindow(NOW)).rejects.toThrow('Square 500')
    await expect(isStartOpen(at('2027-03-07', '13:00'), 90, {}, NOW)).rejects.toThrow('Square 500')
  })

  it('no Square call on the sandbox', async () => {
    m.env.environment = 'sandbox'
    m.listBookings.mockRejectedValue(new Error('must not be asked'))
    expect(await openPartyStarts('2027-03-07', {}, NOW)).toEqual([at('2027-03-07', '13:00'), at('2027-03-07', '15:30')])
    expect(m.listBookings).not.toHaveBeenCalled()
  })

  it('no Square call when the owners turn the read off (readSquareBookings false)', async () => {
    await setSettings((s) => ({ ...s, readSquareBookings: false }))
    try {
      m.listBookings.mockRejectedValue(new Error('must not be asked'))
      expect(await openPartyStarts('2027-03-07', {}, NOW)).toEqual([at('2027-03-07', '13:00'), at('2027-03-07', '15:30')])
      expect(m.listBookings).not.toHaveBeenCalled()
    } finally {
      await setSettings((s) => ({ ...s, readSquareBookings: true }))
    }
  })
})

describe('openPartyStarts: fails closed', () => {
  it('store down refuses: a party-settings read error throws', async () => {
    m.down.settings = true
    await expect(openPartyStarts('2027-03-07', {}, NOW)).rejects.toThrow('party settings store down')
    await expect(isStartOpen(at('2027-03-07', '13:00'), 90, {}, NOW)).rejects.toThrow()
  })

  it('store down refuses: a party-book read error throws', async () => {
    m.down.book = true
    await expect(openPartyStarts('2027-03-07', {}, NOW)).rejects.toThrow('party book store down')
    await expect(openPartyStartsInWindow(NOW)).rejects.toThrow('party book store down')
  })

  it('a legacy CLASS lookup failure is still ignored on the party offering path', async () => {
    m.listAllWorkshops.mockRejectedValue(new Error('Square Classes 503'))
    expect(await openPartyStarts('2027-03-07', {}, NOW)).toEqual([at('2027-03-07', '13:00'), at('2027-03-07', '15:30')])
  })

  it('the sentence the APIs answer with', () => {
    expect(PARTY_TIMES_UNREADABLE).toBe("We couldn't load party times. Try again in a minute.")
  })
})

describe('openPartyStarts: the rest of the schedule', () => {
  it('our class, a Square class and blocked time each take the starts within their cleanup hour', async () => {
    const day = '2027-03-21'
    await createClass({ content: content('Pottery'), sessions: [{ id: 'ses_ot1', startIso: at(day, '12:00'), endIso: at(day, '12:30'), capacity: 12 }], status: 'open', by })
    expect(await openPartyStarts(day, {}, NOW)).toEqual([at(day, '15:30')])
    m.listAllWorkshops.mockResolvedValue([{ scheduleId: 'clssch_x', name: 'Square Class', startAt: at(day, '17:30'), durationMinutes: 60 }])
    expect(await openPartyStarts(day, {}, NOW)).toEqual([])

    const day2 = '2027-03-28'
    await addBlocked({ startIso: at(day2, '16:00'), endIso: at(day2, '16:30'), reason: 'Plumber', by })
    expect(await openPartyStarts(day2, {}, NOW)).toEqual([at(day2, '13:00')])
  })

  it('a closed day offers nothing, even to owners', async () => {
    // Christmas holidays, 21 Dec to 1 Jan.
    expect(await openPartyStarts('2026-12-27', { admin: true }, new Date('2026-12-01T12:00:00Z'))).toEqual([])
  })

  it('Craft Café keeps its 60-minute gap (a Saturday 9:00 and 11:00 are out, 1:30 stays)', async () => {
    const day = '2027-03-13' // Saturday: café 9 to 12:30
    await setSettings((s) => ({ ...s, times: { ...s.times, dates: { ...s.times.dates, [day]: ['09:00', '11:00', '13:30'] } } }))
    try {
      expect(await openPartyStarts(day, {}, NOW)).toEqual([at(day, '13:30')])
    } finally {
      await setSettings((s) => { const { [day]: _, ...dates } = s.times.dates; return { ...s, times: { ...s.times, dates } } })
    }
  })

  it('extra time lengthens the party: a 4:00 class leaves 1:00 open, but not with an hour of extra time', async () => {
    const day = '2027-04-04'
    await setSettings((s) => ({ ...s, addOns: [{ id: 'add_hour', label: 'Extra hour', priceCents: 5000, per: 'party', extraMinutes: 60, maxQty: 1, online: true, archived: false }] }))
    try {
      m.listAllWorkshops.mockResolvedValue([{ scheduleId: 'clssch_4', name: 'Four O’Clock', startAt: at(day, '16:00'), durationMinutes: 60 }])
      expect(await openPartyStarts(day, {}, NOW)).toEqual([at(day, '13:00')])
      expect(await openPartyStarts(day, { addOns: { add_hour: 1 } }, NOW)).toEqual([])
      expect(await openPartyStarts(day, { packageId: 'pkg_whole', addOns: { add_unknown: 1 } }, NOW)).toEqual([at(day, '13:00')])
    } finally {
      await setSettings((s) => ({ ...s, addOns: [] }))
    }
  })

  it('owners (admin) see a date inside the notice; the public does not', async () => {
    const soon = new Date('2027-04-08T15:00:00.000Z') // Thu; Sun 11 Apr is 3 days away (notice is 7)
    expect(await openPartyStarts('2027-04-11', {}, soon)).toEqual([])
    expect(await openPartyStarts('2027-04-11', { admin: true }, soon)).toEqual([at('2027-04-11', '13:00'), at('2027-04-11', '15:30')])
  })

  it('DST: Sun 14 Mar 2027 (clocks go forward) offers 1:00 PM CDT = 18:00Z, and a hold there takes exactly that time', async () => {
    const day = '2027-03-14'
    expect(await openPartyStarts(day, {}, NOW)).toEqual(['2027-03-14T18:00:00.000Z', '2027-03-14T20:30:00.000Z'])
    const id = pty()
    expect((await holdTime({ partyId: id, startIso: '2027-03-14T20:30:00.000Z', endIso: '2027-03-14T22:00:00.000Z', ttlMinutes: null }, [], new Date())).ok).toBe(true)
    expect(await openPartyStarts(day, {}, NOW)).toEqual(['2027-03-14T18:00:00.000Z'])
  })

  it('the window view leaves out held and Square-booked times', async () => {
    const id = pty()
    expect((await holdTime({ partyId: id, startIso: at('2027-04-18', '13:00'), endIso: at('2027-04-18', '14:30'), ttlMinutes: null }, [], new Date())).ok).toBe(true)
    m.listBookings.mockResolvedValue([square('bk_w', at('2027-04-25', '15:30'))])
    const starts = await openPartyStartsInWindow(NOW)
    expect(starts).not.toContain(at('2027-04-18', '13:00'))
    expect(starts).toContain(at('2027-04-18', '15:30'))
    expect(starts).not.toContain(at('2027-04-25', '15:30'))
    expect(starts).toContain(at('2027-04-25', '13:00'))
  })
})

describe('isStartOpen', () => {
  it('online: only an offered party time', async () => {
    expect(await isStartOpen(at('2027-05-04', '13:00'), 90, {}, NOW)).toEqual({ ok: false, message: 'That party time isn’t offered. Please pick another time.' })
  })

  it('owners: any free time (a Tuesday), but a clash is named', async () => {
    const day = '2027-05-04' // Tuesday
    expect(await isStartOpen(at(day, '13:00'), 90, { admin: true }, NOW)).toEqual({ ok: true })
    await addBlocked({ startIso: at(day, '15:00'), endIso: at(day, '16:00'), reason: 'Deep clean', by })
    expect(await isStartOpen(at(day, '13:00'), 90, { admin: true }, NOW)).toEqual({ ok: false, message: 'Clashes with Deep clean, Tue May 4 3 PM.' })
  })

  it('never a start in the past (R37), never past midnight', async () => {
    expect(await isStartOpen('2027-01-31T19:00:00.000Z', 90, { admin: true }, NOW)).toEqual({ ok: false, message: 'That time has already passed. Pick a later time.' })
    expect(await isStartOpen(at('2027-05-05', '22:00'), 90, { admin: true }, NOW)).toEqual({ ok: false, message: 'A party and its hour of cleanup have to finish by midnight.' })
    expect(await isStartOpen(at('2027-05-05', '21:30'), 90, { admin: true }, NOW)).toEqual({ ok: true })
  })
})
