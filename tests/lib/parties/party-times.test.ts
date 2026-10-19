import { describe, it, expect } from 'vitest'
import { partyConfig, partyDays, partyDateOverrides, CAFE_PARTY_GAP_MINUTES } from '@config/party.config'
import { cafeOn } from '@lib/cafe-days'
import { closureOn } from '@config/closures'
import { CONFIG_STUDIO_DAYS, type StudioDays } from '@config/studio-days'
import { SettingsError } from '@lib/studio-settings'
import { localDate, localToUtcISO } from '@lib/party-slots'
import {
  PARTY_CLEANUP_MINUTES, bookableDates, bookableOn, configPartySettings, describePartyChanges, partyStartsForDate,
  partyStartsInRange, publicPartyFacts, startsOn, validatePartySettings,
} from '@lib/parties/party-times'
import type { PartySettings, PartySettingsInput } from '@lib/parties/types'

// ---------------------------------------------------------------- the oracle
// Today's rule (src/lib/party-slots.ts before this change), copied verbatim.
function oracleStudioDatePlus(days: number, now: Date): string {
  const [y, m, d] = localDate(now.toISOString()).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10)
}
function oracleBookableDates(now: Date): { first: string; last: string } {
  const soonest = oracleStudioDatePlus(partyConfig.minLeadDays, now)
  const early = Object.keys(partyDateOverrides).filter((d) => d >= soonest && d < partyConfig.bookingOpensDate).sort()[0]
  const opens = early ?? partyConfig.bookingOpensDate
  return { first: soonest > opens ? soonest : opens, last: oracleStudioDatePlus(partyConfig.bookingWindowDays, now) }
}
function oracleBookableOn(ymd: string, now: Date, days: StudioDays) {
  if (ymd < partyConfig.bookingOpensDate && !partyDateOverrides[ymd]) return 'before_opening'
  if (closureOn(ymd, days.closures)) return 'closed'
  const { first, last } = oracleBookableDates(now)
  if (ymd < first) return 'too_soon'
  if (ymd > last) return 'too_far'
  return 'ok'
}
const mins = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
function oracle(ymd: string, now: Date, days: StudioDays): string[] {
  if (oracleBookableOn(ymd, now, days) !== 'ok') return []
  const [y, m, d] = ymd.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
  const cfg = partyDateOverrides[ymd] ?? partyDays[weekday]
  if (!cfg) return []
  const step = partyConfig.durationMinutes + partyConfig.cleanupBufferMinutes
  const first = mins(cfg.firstStart)
  const wrap = mins(cfg.lastWrap)
  const out: string[] = []
  for (let t = first; t + step <= wrap; t += step) {
    out.push(localToUtcISO(ymd, `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`))
  }
  const cafe = cafeOn(ymd, days)
  if (cafe) {
    const gap = CAFE_PARTY_GAP_MINUTES * 60_000
    const opens = Date.parse(localToUtcISO(ymd, cafe.opens)) - gap
    const closes = Date.parse(localToUtcISO(ymd, cafe.closes)) + gap
    return out.filter((iso) => {
      const start = Date.parse(iso)
      const end = start + partyConfig.durationMinutes * 60_000
      return end <= opens || start >= closes
    })
  }
  return out
}

const plusDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10)
}

// Owners' saved closed days and café hours, different from the config.
const SAVED_DAYS: StudioDays = {
  closures: [
    { id: 'clo_a', from: '2026-11-21', to: '2026-11-22', name: 'a break' },
    { id: 'clo_b', from: '2026-12-24', to: '2026-12-26', name: 'Christmas' },
  ],
  cafe: {
    weekly: [{ weekday: 'Saturday', opens: '09:00', closes: '12:31' }, { weekday: 'Sunday', opens: '15:00', closes: '17:00' }],
    special: [{ date: '2026-11-08', opens: '09:00', closes: '11:00', name: 'Sunday café' }],
  },
}

const settingsWith = (patch: (s: PartySettings) => void): PartySettings => {
  const s = structuredClone(configPartySettings())
  patch(s)
  return s
}
const inputOf = (s: PartySettings): PartySettingsInput => ({ times: s.times, packages: s.packages, addOns: s.addOns, readSquareBookings: s.readSquareBookings })

describe('the config as settings', () => {
  it('matches today\'s times', () => {
    const nows = [new Date('2026-10-19T17:00:00Z'), new Date('2026-11-01T18:00:00Z'), new Date('2026-12-15T18:00:00Z')]
    const s = configPartySettings()
    let offered = 0
    for (const now of nows) {
      for (const days of [CONFIG_STUDIO_DAYS, SAVED_DAYS]) {
        for (let i = 0; i <= 120; i++) {
          const ymd = plusDays('2026-10-19', i)
          const want = oracle(ymd, now, days)
          offered += want.length
          expect(partyStartsForDate(s, ymd, now, days), `${ymd} at ${now.toISOString()}`).toEqual(want)
          expect(bookableOn(s.times, ymd, now, days)).toBe(oracleBookableOn(ymd, now, days))
        }
        expect(bookableDates(s.times, now)).toEqual(oracleBookableDates(now))
      }
    }
    expect(offered).toBeGreaterThan(100) // the comparison is not vacuous
  })

  it('is one whole-studio package from the config, no extras, Square read on, never saved', () => {
    const s = configPartySettings()
    expect(s.packages).toEqual([{
      id: 'pkg_whole', name: 'Whole studio', priceCents: 30000, minutes: 90,
      minGuests: 10, maxGuests: 30, defaultGuests: 10, quickPicks: [10, 15, 20, 25, 30], who: 'everyone', archived: false,
    }])
    expect(s.addOns).toEqual([])
    expect(s.readSquareBookings).toBe(true)
    expect(s.updatedAt).toBeNull()
    expect(s.by).toBeNull()
    expect(s.history).toEqual([])
    expect(PARTY_CLEANUP_MINUTES).toBe(partyConfig.cleanupBufferMinutes)
    expect(s.times.weekly).toEqual({ '0': ['13:00', '15:30'], '1': [], '2': [], '3': [], '4': ['16:00'], '5': ['16:00'], '6': ['13:30'] })
    expect(s.times).toMatchObject({ bookingWindowDays: 90, minLeadDays: 7, opensDate: '2026-11-07' })
  })

  it('Oct 24 gives five starts before opening', () => {
    const s = configPartySettings()
    expect(startsOn(s.times, '2026-10-24')).toEqual(['09:00', '11:30', '14:00', '16:30', '19:00'])
    expect(s.times.dates['2026-10-22']).toEqual(['16:00', '18:30'])
    const now = new Date('2026-10-09T17:00:00Z')
    expect(partyStartsForDate(s, '2026-10-24', now, CONFIG_STUDIO_DAYS)).toHaveLength(5)
    expect(bookableOn(s.times, '2026-10-24', now, CONFIG_STUDIO_DAYS)).toBe('ok')
    expect(bookableOn(s.times, '2026-10-25', now, CONFIG_STUDIO_DAYS)).toBe('before_opening')
  })

  it('the range helper agrees with the day helper', () => {
    const now = new Date('2026-10-19T17:00:00Z')
    const s = configPartySettings()
    const range = partyStartsInRange(s, '2026-10-19T05:00:00Z', '2027-01-20T06:00:00Z', now, CONFIG_STUDIO_DAYS)
    const byDay: string[] = []
    for (let i = 0; i <= 93; i++) byDay.push(...partyStartsForDate(s, plusDays('2026-10-19', i), now, CONFIG_STUDIO_DAYS))
    expect(range).toEqual(byDay.sort())
  })
})

describe('times from saved settings', () => {
  const now = new Date('2026-10-19T17:00:00Z')
  it('a café Saturday drops 1:30 only inside the 60-minute gap', () => {
    const s = configPartySettings()
    const cafeTill = (closes: string): StudioDays => ({ closures: [], cafe: { weekly: [{ weekday: 'Saturday', opens: '09:00', closes }], special: [] } })
    expect(partyStartsForDate(s, '2026-11-14', now, cafeTill('12:31'))).toEqual([])
    expect(partyStartsForDate(s, '2026-11-14', now, cafeTill('12:30'))).toEqual(['2026-11-14T19:30:00.000Z'])
  })

  it('a closure gives none', () => {
    const s = configPartySettings()
    const closed: StudioDays = { ...CONFIG_STUDIO_DAYS, closures: [{ from: '2026-11-15', to: '2026-11-15', name: 'x' }] }
    expect(partyStartsForDate(s, '2026-11-15', now, CONFIG_STUDIO_DAYS)).toHaveLength(2)
    expect(partyStartsForDate(s, '2026-11-15', now, closed)).toEqual([])
    expect(bookableOn(s.times, '2026-11-15', now, closed)).toBe('closed')
  })

  it('dates[x] = [] gives none, and does not pull the first day back before opening', () => {
    const s = settingsWith((x) => { x.times.dates = { '2026-11-15': [], '2026-10-31': [] } })
    expect(partyStartsForDate(s, '2026-11-15', now, CONFIG_STUDIO_DAYS)).toEqual([])
    expect(partyStartsForDate(s, '2026-11-22', now, CONFIG_STUDIO_DAYS)).toHaveLength(2)
    expect(bookableDates(s.times, now).first).toBe('2026-11-07')
    expect(bookableOn(s.times, '2026-10-31', now, CONFIG_STUDIO_DAYS)).toBe('before_opening')
  })

  it('a dated day replaces its weekday', () => {
    const s = settingsWith((x) => { x.times.dates = { '2026-11-15': ['10:00'] } })
    expect(startsOn(s.times, '2026-11-15')).toEqual(['10:00'])
    expect(partyStartsForDate(s, '2026-11-15', now, CONFIG_STUDIO_DAYS)).toEqual(['2026-11-15T16:00:00.000Z'])
  })

  it('admin offers tomorrow and later today but never a past start (R37)', () => {
    const s = configPartySettings()
    const satNoon = new Date('2026-11-14T18:00:00Z') // Sat Nov 14, noon CST
    expect(partyStartsForDate(s, '2026-11-14', satNoon, CONFIG_STUDIO_DAYS)).toEqual([])
    expect(partyStartsForDate(s, '2026-11-15', satNoon, CONFIG_STUDIO_DAYS)).toEqual([])
    expect(partyStartsForDate(s, '2026-11-14', satNoon, CONFIG_STUDIO_DAYS, { admin: true })).toEqual(['2026-11-14T19:30:00.000Z'])
    expect(partyStartsForDate(s, '2026-11-15', satNoon, CONFIG_STUDIO_DAYS, { admin: true })).toEqual(['2026-11-15T19:00:00.000Z', '2026-11-15T21:30:00.000Z'])
    // Past the window too.
    expect(partyStartsForDate(s, '2027-03-13', satNoon, CONFIG_STUDIO_DAYS, { admin: true })).toEqual(['2027-03-13T19:30:00.000Z'])
    const satLate = new Date('2026-11-14T19:30:00Z') // exactly 1:30 PM: that start has begun
    expect(partyStartsForDate(s, '2026-11-14', satLate, CONFIG_STUDIO_DAYS, { admin: true })).toEqual([])
    expect(partyStartsForDate(s, '2026-11-13', satNoon, CONFIG_STUDIO_DAYS, { admin: true })).toEqual([])
    // A closed day stays closed for owners too.
    expect(partyStartsForDate(s, '2026-11-27', satNoon, CONFIG_STUDIO_DAYS, { admin: true })).toEqual([])
    const range = partyStartsInRange(s, '2026-11-14T06:00:00Z', '2026-11-16T06:00:00Z', satNoon, CONFIG_STUDIO_DAYS, { admin: true })
    expect(range).toEqual(['2026-11-14T19:30:00.000Z', '2026-11-15T19:00:00.000Z', '2026-11-15T21:30:00.000Z'])
  })

  it('no notice never offers a start that has passed today', () => {
    const s = settingsWith((x) => { x.times.minLeadDays = 0 })
    const satTwo = new Date('2026-11-14T20:00:00Z') // 2 PM
    expect(partyStartsForDate(s, '2026-11-14', satTwo, CONFIG_STUDIO_DAYS)).toEqual([])
    expect(partyStartsForDate(s, '2026-11-14', new Date('2026-11-14T18:00:00Z'), CONFIG_STUDIO_DAYS)).toEqual(['2026-11-14T19:30:00.000Z'])
  })

  it('a 120-minute package widens the café gap check', () => {
    // Party at 12:30 on a Sunday; café 3–5, so the party must end by 2.
    const days: StudioDays = { closures: [], cafe: { weekly: [{ weekday: 'Sunday', opens: '15:00', closes: '17:00' }], special: [] } }
    const s = settingsWith((x) => { x.times.weekly['0'] = ['12:30'] })
    expect(partyStartsForDate(s, '2026-11-15', now, days)).toEqual(['2026-11-15T18:30:00.000Z'])
    expect(partyStartsForDate(s, '2026-11-15', now, days, { minutes: 120 })).toEqual([])
    // The default is the shortest package everyone can book.
    const long = settingsWith((x) => {
      x.times.weekly['0'] = ['12:30']
      x.packages[0].minutes = 120
      x.packages.push({ ...x.packages[0], id: 'pkg_test', minutes: 60, who: 'link' })
    })
    expect(partyStartsForDate(long, '2026-11-15', now, days)).toEqual([])
  })
})

describe('publicPartyFacts', () => {
  it('shows everyone packages, the named link package, and online extras only', () => {
    const s = settingsWith((x) => {
      x.packages.push(
        { ...x.packages[0], id: 'pkg_test', name: 'Test', priceCents: 100, who: 'link' },
        { ...x.packages[0], id: 'pkg_admin', name: 'Phone only', who: 'admin' },
        { ...x.packages[0], id: 'pkg_old', name: 'Old', archived: true },
      )
      x.addOns = [
        { id: 'add_bags', label: 'Goodie bags', priceCents: 500, per: 'guest', extraMinutes: 0, maxQty: 30, online: true, archived: false },
        { id: 'add_desk', label: 'Desk only', priceCents: 500, per: 'party', extraMinutes: 0, maxQty: 1, online: false, archived: false },
        { id: 'add_gone', label: 'Gone', priceCents: 500, per: 'party', extraMinutes: 0, maxQty: 1, online: true, archived: true },
      ]
    })
    const now = new Date('2026-10-19T17:00:00Z')
    const plain = publicPartyFacts(s, CONFIG_STUDIO_DAYS, now)
    expect(plain.packages.map((p) => p.id)).toEqual(['pkg_whole'])
    expect(plain.addOns.map((a) => a.id)).toEqual(['add_bags'])
    expect(plain).toMatchObject({ first: '2026-10-29', last: '2027-01-17', days: CONFIG_STUDIO_DAYS, times: s.times })
    expect(publicPartyFacts(s, CONFIG_STUDIO_DAYS, now, { packageId: 'pkg_test' }).packages.map((p) => p.id)).toEqual(['pkg_whole', 'pkg_test'])
    expect(publicPartyFacts(s, CONFIG_STUDIO_DAYS, now, { packageId: 'pkg_admin' }).packages.map((p) => p.id)).toEqual(['pkg_whole'])
    expect(publicPartyFacts(s, CONFIG_STUDIO_DAYS, now, { packageId: 'pkg_old' }).packages.map((p) => p.id)).toEqual(['pkg_whole'])
  })
})

// ---------------------------------------------------------------- validation

const TODAY = new Date('2026-10-19T17:00:00Z')
const good = (): any => {
  const s = inputOf(structuredClone(configPartySettings()))
  delete s.times.dates['2026-10-24'] // its 7 PM party's cleanup runs past the 9 PM close (see below)
  return s
}
function refusal(raw: any): { message: string; field?: string } {
  try {
    validatePartySettings(raw, { now: TODAY })
  } catch (e) {
    expect(e).toBeInstanceOf(SettingsError)
    expect((e as SettingsError).status).toBe(400)
    return { message: (e as Error).message, field: (e as SettingsError).field }
  }
  throw new Error('expected a refusal')
}

describe('validatePartySettings', () => {
  it('accepts the config (less Oct 24) and gives it back tidied', () => {
    const out = validatePartySettings(good(), { now: TODAY })
    expect(out).toEqual(good())
  })

  it('refuses the config Oct 24 7 PM start: the party and its cleanup must end by closing', () => {
    expect(refusal(inputOf(configPartySettings()))).toEqual({
      message: 'Party times on Sat, Oct 24 must start by 6:30 PM, so the party and its cleanup end by closing at 9 PM.',
      field: 'times.dates.2026-10-24',
    })
  })

  it('a dated day already past is kept but not checked against the hours', () => {
    const out = validatePartySettings(inputOf(configPartySettings()), { now: new Date('2026-10-26T17:00:00Z') })
    expect(out.times.dates['2026-10-24']).toHaveLength(5)
  })

  it('sorts starts and dated days', () => {
    const raw = good()
    raw.times.weekly['0'] = ['15:30', '13:00']
    const out = validatePartySettings(raw, { now: TODAY })
    expect(out.times.weekly['0']).toEqual(['13:00', '15:30'])
    expect(Object.keys(out.times.dates)).toEqual([...Object.keys(out.times.dates)].sort())
  })

  it('missing weekdays are days without parties', () => {
    const raw = good()
    delete raw.times.weekly['1']
    expect(validatePartySettings(raw, { now: TODAY }).times.weekly['1']).toEqual([])
  })

  const cases: [string, (r: any) => void, string, string][] = [
    ['nothing', () => {}, 'Nothing to save.', ''],
    ['a bad time', (r) => { r.times.weekly['0'] = ['1pm'] }, 'Write times like 13:30.', 'times.weekly.0'],
    ['too close together', (r) => { r.times.weekly['0'] = ['13:00', '15:00'] }, 'Party times on Sundays must be at least 2 hours 30 minutes apart.', 'times.weekly.0'],
    ['the same time twice', (r) => { r.times.weekly['6'] = ['13:30', '13:30'] }, 'Party times on Saturdays must be at least 2 hours 30 minutes apart.', 'times.weekly.6'],
    ['a longer package widens the gap', (r) => { r.packages[0].minutes = 120 }, 'Party times on Sundays must be at least 3 hours apart.', 'times.weekly.0'],
    ['before opening', (r) => { r.times.weekly['0'] = ['12:00', '15:30'] }, 'Party times on Sundays can’t start before the studio opens at 12:30 PM.', 'times.weekly.0'],
    ['past closing', (r) => { r.times.weekly['6'] = ['13:30', '19:00'] }, 'Party times on Saturdays must start by 6:30 PM, so the party and its cleanup end by closing at 9 PM.', 'times.weekly.6'],
    ['extra time counts', (r) => {
      r.times.weekly['4'] = ['18:30']
      r.addOns = [{ id: 'add_hour', label: 'Extra hour', priceCents: 5000, per: 'party', extraMinutes: 30, maxQty: 1, online: true, archived: false }]
    }, 'Party times on Thursdays must start by 6 PM, so the party and its cleanup end by closing at 9 PM.', 'times.weekly.4'],
    ['crossing midnight on a day without hours', (r) => { r.times.weekly['2'] = ['23:00'] }, 'Party times on Tuesdays must start by 9:30 PM, so the party and its cleanup end by midnight.', 'times.weekly.2'],
    ['a bad date', (r) => { r.times.dates['2026-02-30'] = [] }, 'Pick a real day for each dated party day.', 'times.dates'],
    ['too close on a date', (r) => { r.times.dates['2026-11-15'] = ['13:00', '14:00'] }, 'Party times on Sun, Nov 15 must be at least 2 hours 30 minutes apart.', 'times.dates.2026-11-15'],
    ['window 0', (r) => { r.times.bookingWindowDays = 0 }, 'Take bookings from 1 to 365 days ahead.', 'times.bookingWindowDays'],
    ['window 366', (r) => { r.times.bookingWindowDays = 366 }, 'Take bookings from 1 to 365 days ahead.', 'times.bookingWindowDays'],
    ['notice 61', (r) => { r.times.minLeadDays = 61 }, 'Ask for 0 to 60 days of notice.', 'times.minLeadDays'],
    ['notice 1.5', (r) => { r.times.minLeadDays = 1.5 }, 'Ask for 0 to 60 days of notice.', 'times.minLeadDays'],
    ['first day', (r) => { r.times.opensDate = 'soon' }, 'Pick the first day parties can be booked.', 'times.opensDate'],
    ['guests 0', (r) => { r.packages[0].minGuests = 0 }, 'Guests go from 1 to 60.', 'packages.0'],
    ['guests 61', (r) => { r.packages[0].maxGuests = 61 }, 'Guests go from 1 to 60.', 'packages.0'],
    ['default outside', (r) => { r.packages[0].defaultGuests = 31 }, 'The usual number of guests has to be between the fewest and the most.', 'packages.0'],
    ['min over max', (r) => { r.packages[0].minGuests = 31; r.packages[0].defaultGuests = 31 }, 'The usual number of guests has to be between the fewest and the most.', 'packages.0'],
    ['price', (r) => { r.packages[0].priceCents = 1_000_001 }, 'Prices go from $0 to $10,000.', 'packages.0'],
    ['price in dollars', (r) => { r.packages[0].priceCents = 300.5 }, 'Prices go from $0 to $10,000.', 'packages.0'],
    ['package name', (r) => { r.packages[0].name = 'x'.repeat(61) }, 'Keep the name to 60 characters.', 'packages.0'],
    ['package unnamed', (r) => { r.packages[0].name = '  ' }, 'Give the package a name.', 'packages.0'],
    ['length', (r) => { r.packages[0].minutes = 10 }, 'A party lasts from 15 minutes to 8 hours.', 'packages.0'],
    ['who', (r) => { r.packages[0].who = 'nobody' }, 'Choose who can book the package.', 'packages.0'],
    ['nobody can book', (r) => { r.packages[0].who = 'link' }, 'Keep at least one package that everyone can book.', 'packages'],
    ['only archived', (r) => { r.packages[0].archived = true }, 'Keep at least one package that everyone can book.', 'packages'],
    ['same package id', (r) => { r.packages.push({ ...r.packages[0], who: 'admin' }) }, 'Two packages have the same id.', 'packages.1'],
    ['too many packages', (r) => { r.packages = Array.from({ length: 21 }, (_, i) => ({ ...r.packages[0], id: `pkg_${i}` })) }, 'Keep it to 20 packages.', 'packages'],
    ['extra label', (r) => { r.addOns = [{ id: 'add_a', label: 'y'.repeat(61), priceCents: 0, per: 'party', extraMinutes: 0, maxQty: 1, online: true, archived: false }] }, 'Keep the name to 60 characters.', 'addOns.0'],
    ['extra per', (r) => { r.addOns = [{ id: 'add_a', label: 'Bags', priceCents: 0, per: 'table', extraMinutes: 0, maxQty: 1, online: true, archived: false }] }, 'Choose per party or per guest.', 'addOns.0'],
    ['extra minutes', (r) => { r.addOns = [{ id: 'add_a', label: 'Time', priceCents: 0, per: 'party', extraMinutes: 20, maxQty: 1, online: true, archived: false }] }, 'Extra time comes in 15, 30, 45 or 60 minutes.', 'addOns.0'],
    ['extra time twice', (r) => { r.addOns = [{ id: 'add_a', label: 'Time', priceCents: 0, per: 'party', extraMinutes: 15, maxQty: 2, online: true, archived: false }] }, 'Extra time can be added once per party.', 'addOns.0'],
    ['extra qty', (r) => { r.addOns = [{ id: 'add_a', label: 'Bags', priceCents: 0, per: 'guest', extraMinutes: 0, maxQty: 0, online: true, archived: false }] }, 'Allow from 1 to 60 of each extra.', 'addOns.0'],
    ['extra price', (r) => { r.addOns = [{ id: 'add_a', label: 'Bags', priceCents: -1, per: 'guest', extraMinutes: 0, maxQty: 1, online: true, archived: false }] }, 'Prices go from $0 to $10,000.', 'addOns.0'],
    ['same extra id', (r) => { const a = { id: 'add_a', label: 'Bags', priceCents: 0, per: 'guest', extraMinutes: 0, maxQty: 1, online: true, archived: false }; r.addOns = [a, { ...a }] }, 'Two extras have the same id.', 'addOns.1'],
    ['too many extras', (r) => { r.addOns = Array.from({ length: 21 }, (_, i) => ({ id: `add_${i}`, label: 'Bags', priceCents: 0, per: 'guest', extraMinutes: 0, maxQty: 1, online: true, archived: false })) }, 'Keep it to 20 extras.', 'addOns'],
    ['too many dates', (r) => { r.times.dates = Object.fromEntries(Array.from({ length: 121 }, (_, i) => [plusDays('2027-01-01', i), []])) }, 'Keep it to 120 dated party days.', 'times.dates'],
    ['square read', (r) => { r.readSquareBookings = 'yes' }, 'Say whether to read parties booked in Square.', 'readSquareBookings'],
  ]
  for (const [name, edit, message, field] of cases) {
    it(`refuses ${name}`, () => {
      const raw = name === 'nothing' ? null : good()
      if (raw) edit(raw)
      const got = refusal(raw)
      expect(got.message).toBe(message)
      expect(got.field ?? '').toBe(field)
    })
  }

  it('gives new packages and extras ids with the right prefix', () => {
    const raw = good()
    raw.packages.push({ ...raw.packages[0], id: undefined, name: 'Small', who: 'admin' })
    raw.addOns = [{ label: 'Bags', priceCents: 300, per: 'guest', extraMinutes: 0, maxQty: 30, online: true, archived: false }]
    const out = validatePartySettings(raw, { now: TODAY })
    expect(out.packages[1].id).toMatch(/^pkg_[A-Za-z0-9_-]+$/)
    expect(out.addOns[0].id).toMatch(/^add_[A-Za-z0-9_-]+$/)
  })

  it('archived packages and extras do not count toward the gap or closing time', () => {
    const raw = good()
    raw.packages.push({ ...raw.packages[0], id: 'pkg_long', minutes: 300, archived: true })
    raw.addOns = [{ id: 'add_t', label: 'Time', priceCents: 0, per: 'party', extraMinutes: 60, maxQty: 1, online: true, archived: true }]
    expect(() => validatePartySettings(raw, { now: TODAY })).not.toThrow()
  })
})

describe('describePartyChanges', () => {
  it('names each change in plain words', () => {
    const before = good()
    const after = good()
    after.times.weekly['0'] = ['13:00']
    after.times.dates['2026-12-05'] = ['10:00']
    delete after.times.dates['2026-10-29']
    after.times.dates['2026-10-22'] = ['16:00']
    after.times.bookingWindowDays = 60
    after.times.minLeadDays = 3
    after.times.opensDate = '2026-11-01'
    after.packages[0].priceCents = 32500
    after.packages.push({ ...after.packages[0], id: 'pkg_t', name: 'Test', who: 'link' })
    after.addOns = [{ id: 'add_b', label: 'Goodie bags', priceCents: 300, per: 'guest', extraMinutes: 0, maxQty: 30, online: true, archived: false }]
    after.readSquareBookings = false
    expect(describePartyChanges(before, after)).toEqual([
      'Party times on Sundays',
      'Party times on Thu, Oct 22',
      'Added party times on Sat, Dec 5',
      'Removed party times on Thu, Oct 29',
      'Booking window',
      'Notice',
      'First party day',
      'Changed a package: Whole studio',
      'Added a package: Test',
      'Added an extra: Goodie bags',
      'Stopped reading parties booked in Square',
    ])
    expect(describePartyChanges(before, good())).toEqual([])
  })

  it('names removed and archived packages and extras', () => {
    const before = good()
    before.addOns = [{ id: 'add_b', label: 'Goodie bags', priceCents: 300, per: 'guest', extraMinutes: 0, maxQty: 30, online: true, archived: false }]
    before.packages.push({ ...before.packages[0], id: 'pkg_t', name: 'Test', who: 'link' })
    const after = structuredClone(before)
    after.packages[1].archived = true
    after.addOns = []
    expect(describePartyChanges(before, after)).toEqual(['Archived a package: Test', 'Removed an extra: Goodie bags'])
  })
})

describe('browser-safe', () => {
  it('party-times and types import no node modules, stores or env', async () => {
    const { readFileSync } = await import('node:fs')
    for (const f of ['src/lib/parties/party-times.ts', 'src/lib/parties/types.ts', 'src/lib/settings-error.ts']) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/from ['"]node:|blob-store|studio-settings['"]|import\.meta\.env|process\.env/)
    }
  })
})
