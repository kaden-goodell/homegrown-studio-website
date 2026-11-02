// @vitest-environment node
/**
 * Every place that reads closed days or café hours uses what the owners saved
 * on /admin (More › Hours & Craft Café, Closed days), not only the config.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  listBookings: vi.fn(),
  listAllWorkshops: vi.fn(),
  listWorkshops: vi.fn(),
  getEventTypes: vi.fn(),
  listEvents: vi.fn(),
}))
vi.mock('@config/providers', () => ({
  providers: {
    booking: { listBookings: mocks.listBookings },
    workshop: { listAllWorkshops: mocks.listAllWorkshops, listWorkshops: mocks.listWorkshops },
    catalog: { getEventTypes: mocks.getEventTypes },
  },
}))
vi.mock('@lib/party-store', () => ({ getPartyRecord: vi.fn(async () => null) }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async () => undefined) }))
vi.mock('@lib/bookings-gate', () => ({ previewCookieName: 'hg_preview', bookingsOpen: () => true, bookingsClosedResponse: () => new Response('closed', { status: 403 }) }))
vi.mock('@lib/classes/square-catalog', () => ({ syncClassToSquare: vi.fn(async () => ({ itemId: 'i', variations: {}, imageUrl: null })), archiveClassInSquare: vi.fn(), CLASS_TAX_NOT_SET: 'x' }))
vi.mock('@lib/classes/square-api', () => ({ squareFetch: vi.fn(async () => { throw new Error('no Square in tests') }), squareSettings: () => ({ environment: 'sandbox' }) }))
vi.mock('@lib/staff-auth', async (orig) => ({ ...(await orig<typeof import('@lib/staff-auth')>()), staffAuthorized: () => ({ id: 't', name: 'Test', role: 'crew' }) }))
vi.mock('@lib/events', async (orig) => ({ ...(await orig<typeof import('@lib/events')>()), listEvents: mocks.listEvents }))
vi.mock('@lib/event-prep', () => ({ prepForEvent: vi.fn(async () => ({})) }))
vi.mock('@config/party.config', async (orig) => ({ ...(await orig<typeof import('@config/party.config')>()), partyDateOverrides: {} }))
vi.mock('../config/party.config', async (orig) => ({ ...(await orig<typeof import('../../src/config/party.config')>()), partyDateOverrides: {} }))

import { configSettings, getSettingsView, getStudioDays, resetStudioDaysCache, saveStudioSettings, type SettingsInput } from '@lib/studio-settings'
import { forgetAll } from '@lib/short-memory'
import { bookableOn, localToUtcISO, partyStartsForDate } from '@lib/party-slots'
import { busyBetween } from '@lib/classes/studio-schedule'
import { adminCookie } from '@lib/admin-auth'
import * as availableDates from '@pages/api/party/available-dates.json'
import * as availability from '@pages/api/party/availability.json'
import * as calendar from '@pages/api/calendar.json'
import * as cafeHours from '@pages/api/cafe-hours.json'
import * as classes from '@pages/api/admin/classes/classes.json'
import * as adminCalendar from '@pages/api/admin/classes/calendar.json'
import * as week from '@pages/api/staff/week.json'
import * as events from '@pages/api/staff/events.json'
import * as openStudio from '@pages/api/staff/open-studio.json'
import { listWarnings } from '@lib/warnings'
import { rmSync } from 'node:fs'
import { holdTime } from '@lib/parties/party-book'

const KADEN = { id: 'owner-kaden', name: 'Kaden' }
async function saveSettings(change: (s: SettingsInput) => SettingsInput) {
  const view = await getSettingsView()
  await saveStudioSettings(change(view), { expectedUpdatedAt: view.updatedAt, by: KADEN })
}
const post = async (route: any, body: unknown, headers: Record<string, string> = {}) => {
  const request = new Request('https://x.test/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const res: Response = await route.POST({ request, url: new URL(request.url) })
  return { status: res.status, body: await res.json() }
}
const get = async (route: any, url: string, headers: Record<string, string> = {}) => {
  const request = new Request(`https://x.test${url}`, { headers })
  const res: Response = await route.GET({ request, url: new URL(request.url) })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  rmSync(`${process.env.BLOB_STORE_FS_DIR}/studio-settings`, { recursive: true, force: true })
  resetStudioDaysCache()
  forgetAll()
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  mocks.listBookings.mockReset().mockResolvedValue([])
  mocks.listAllWorkshops.mockReset().mockResolvedValue([])
  mocks.listWorkshops.mockReset().mockResolvedValue([])
  mocks.getEventTypes.mockReset().mockResolvedValue([])
  mocks.listEvents.mockReset().mockResolvedValue({ events: [], sources: { parties: 'ok', workshops: 'ok', classes: 'ok' } })
  vi.useFakeTimers({ toFake: ['Date'] })
  // Noon Central, Sunday 1 Nov 2026: the booking window covers November and December.
  vi.setSystemTime(new Date('2026-11-01T18:00:00Z'))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

const SNOW = '2026-11-15' // a Sunday with party times
const closeSnowDay = (s: SettingsInput): SettingsInput => ({ ...s, closures: [...s.closures, { id: 'clo_snow', from: SNOW, to: SNOW, name: 'a snow day' }] })

describe('a closed day saved on /admin', () => {
  it('takes the party times away everywhere: the rules, the date list, the day’s times, and the booking check', async () => {
    expect(partyStartsForDate(SNOW, new Date(), await getStudioDays()).length).toBeGreaterThan(0)
    const before = await post(availableDates, { serviceVariationId: 'var-party' })
    expect(before.body.data.dates).toContain(SNOW)

    await saveSettings(closeSnowDay)
    const days = await getStudioDays()
    expect(partyStartsForDate(SNOW, new Date(), days)).toEqual([])
    expect(bookableOn(SNOW, new Date(), days)).toBe('closed')
    const after = await post(availableDates, { serviceVariationId: 'var-party' })
    expect(after.body.data.dates).not.toContain(SNOW)
    expect(after.body.data.offered[SNOW]).toBeUndefined()
    const slots = await post(availability, { date: SNOW, serviceVariationId: 'var-party' })
    expect(slots.body.data).toEqual({ slots: [], offered: 0 })
  })

  it('refuses a new class on it, naming the closed day', async () => {
    await saveSettings(closeSnowDay)
    const at = (hhmm: string) => localToUtcISO(SNOW, hhmm)
    const r = await post(classes, {
      action: 'create',
      content: {
        name: 'Snowy Pottery', description: 'x', imageUrl: null, instructor: null,
        rules: { ages: '', dropOff: false, madeToOrder: false, taxable: true, maxPerBooking: 10, signupCutoffHours: null, minimumToRun: null, linkOnly: false, joinPartway: true, waitlistCutoffHours: 2, canShareRoom: false },
        ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }],
        prices: { all: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 12, defaultMinutes: 90,
      },
      sessions: [{ startIso: at('18:00'), endIso: at('20:00'), capacity: 10 }],
      status: 'open',
    }, { cookie: adminCookie().split(';')[0] })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/closed/)
  })

  it('shows on the public calendar, the admin calendar and as a party-on-closed-day warning', async () => {
    expect((await holdTime({ partyId: 'pty_snowday000000001', startIso: localToUtcISO(SNOW, '13:00'), endIso: localToUtcISO(SNOW, '14:30'), ttlMinutes: null }, [], new Date())).ok).toBe(true)
    await saveSettings(closeSnowDay)
    const pub = await get(calendar, '/api/calendar.json?month=2026-11')
    expect(pub.body.closures).toEqual(expect.arrayContaining([{ from: SNOW, to: SNOW, name: 'a snow day' }]))
    expect(pub.body.events).toEqual(expect.arrayContaining([expect.objectContaining({ id: `closed-${SNOW}`, title: 'Closed for a snow day' })]))
    expect(pub.body.events.some((e: any) => e.kind === 'party-available' && e.date === SNOW)).toBe(false)

    const adm = await get(adminCalendar, `/api/admin/classes/calendar.json?from=${localToUtcISO(SNOW, '00:00')}&to=${localToUtcISO('2026-11-16', '00:00')}`, { cookie: adminCookie().split(';')[0] })
    expect(adm.body.data.items.map((i: any) => i.kind)).toContain('closed')

    const warnings = await listWarnings({ from: '2026-11-15', to: '2026-11-15' })
    expect(warnings.map((w) => w.code)).toContain('party-on-closed-day')
  })

  it('removing a config closure opens those days again (Thanksgiving Friday)', async () => {
    const fri = '2026-11-27'
    expect(bookableOn(fri, new Date(), await getStudioDays())).toBe('closed')
    await saveSettings((s) => ({ ...s, closures: s.closures.filter((c) => c.name !== 'Thanksgiving') }))
    expect(bookableOn(fri, new Date(), await getStudioDays())).toBe('ok')
  })
})

describe('café hours saved on /admin', () => {
  const MARKET = '2026-11-21' // a Saturday
  const addMarket = (s: SettingsInput): SettingsInput => ({ ...s, cafeSpecialDays: [...s.cafeSpecialDays, { date: MARKET, opens: '10:00', closes: '16:00', name: 'Holiday market' }] })

  it('a special day changes the /craft-cafe hours data, the room schedule (admin calendar) and the party times', async () => {
    const plain = await busyBetween(localToUtcISO(MARKET, '00:00'), localToUtcISO('2026-11-22', '00:00'))
    expect(plain.find((b) => b.kind === 'cafe')).toMatchObject({ startIso: localToUtcISO(MARKET, '09:00'), endIso: localToUtcISO(MARKET, '13:00') })
    const partiesBefore = partyStartsForDate(MARKET, new Date(), await getStudioDays())

    await saveSettings(addMarket)
    const data = (await get(cafeHours, '/api/cafe-hours.json')).body.data
    expect(data.special).toEqual(expect.arrayContaining([{ date: MARKET, name: 'Holiday market', time: '10 AM – 4 PM' }]))
    const busy = await busyBetween(localToUtcISO(MARKET, '00:00'), localToUtcISO('2026-11-22', '00:00'))
    expect(busy.find((b) => b.kind === 'cafe')).toMatchObject({ startIso: localToUtcISO(MARKET, '10:00'), endIso: localToUtcISO(MARKET, '16:00') })
    // The 2:00 party can't sit inside a 10–4 café.
    expect(partyStartsForDate(MARKET, new Date(), await getStudioDays()).length).toBeLessThan(partiesBefore.length)
  })

  it('new weekly hours show on /craft-cafe and the staff week; a closed day has no café', async () => {
    await saveSettings((s) => closeSnowDay({ ...s, cafeWeekly: [{ weekday: 'Saturday', opens: '09:00', closes: '13:00' }, { weekday: 'Sunday', opens: '14:00', closes: '16:00' }] }))
    expect((await get(cafeHours, '/api/cafe-hours.json')).body.data.weekly).toEqual([
      { days: 'Saturday', time: '9 AM – 1 PM' },
      { days: 'Sunday', time: '2 – 4 PM' },
    ])
    vi.setSystemTime(new Date('2026-11-13T15:00:00Z')) // Fri Nov 13
    const w = (await get(week, '/api/staff/week.json')).body.data
    expect(w.cafe).toEqual({ '2026-11-14': { opens: '09:00', closes: '13:00' } }) // Sun 15th is the snow day
    expect((await get(events, '/api/staff/events.json?date=2026-11-15')).body.data.cafeOpen).toBe(false)
    expect((await get(events, '/api/staff/events.json?date=2026-11-14')).body.data.cafeOpen).toBe(true)
    expect((await get(openStudio, '/api/staff/open-studio.json?date=2026-11-22')).body.data.cafe).toEqual({ opens: '14:00', closes: '16:00' })
  })

  it('with nothing saved, every answer is the config’s', async () => {
    expect((await get(cafeHours, '/api/cafe-hours.json')).body.data.weekly).toEqual([{ days: 'Saturday', time: '9 AM – 1 PM' }])
    // The announced grand opening, for the site-wide bar and the big card.
    expect((await get(cafeHours, '/api/cafe-hours.json')).body.data.notices).toEqual([
      expect.objectContaining({ date: '2026-11-07', hours: '9 AM – 8 PM', regularHours: 'Saturdays 9 AM – 1 PM' }),
    ])
    expect((await getSettingsView()).closures).toEqual(configSettings().closures)
  })
})

describe('studio hours saved on /admin (G3)', () => {
  const WED = '2026-11-18' // a Wednesday: usually closed
  const withWednesday = (s: SettingsInput): SettingsInput => ({ ...s, studioWeekly: [...s.studioWeekly, { weekday: 'Wednesday', opens: '16:00', closes: '21:00' }] })

  it('a café special day on a Wednesday shows everywhere, though the studio is usually closed', async () => {
    await saveSettings((s) => ({ ...s, cafeSpecialDays: [...s.cafeSpecialDays, { date: WED, opens: '10:00', closes: '14:00', name: 'Midweek café' }] }))
    expect((await get(cafeHours, '/api/cafe-hours.json')).body.data.special).toEqual(expect.arrayContaining([{ date: WED, name: 'Midweek café', time: '10 AM – 2 PM' }]))
    const busy = await busyBetween(localToUtcISO(WED, '00:00'), localToUtcISO('2026-11-19', '00:00'))
    expect(busy.find((b) => b.kind === 'cafe')).toMatchObject({ startIso: localToUtcISO(WED, '10:00'), endIso: localToUtcISO(WED, '14:00') })
    expect((await get(events, `/api/staff/events.json?date=${WED}`)).body.data.cafeOpen).toBe(true)
    const pub = await get(calendar, '/api/calendar.json?month=2026-11')
    expect(pub.body.openDates).toContain(WED)
    expect(pub.body.openWeekdays).toEqual([0, 4, 5, 6])
  })

  it('the footer and Google get the saved hours; the calendar opens Wednesdays', async () => {
    const before = (await get(cafeHours, '/api/cafe-hours.json')).body.data
    expect(before.studio).toEqual([
      { days: 'Thursday', time: '6 – 8 PM' }, { days: 'Friday', time: '4 – 9 PM' }, { days: 'Saturday', time: '9 AM – 9 PM' }, { days: 'Sunday', time: '1 – 8 PM' },
    ])
    await saveSettings(withWednesday)
    resetStudioDaysCache()
    forgetAll()
    const data = (await get(cafeHours, '/api/cafe-hours.json')).body.data
    expect(data.studio[0]).toEqual({ days: 'Wednesday & Friday', time: '4 – 9 PM' })
    expect(data.studioHours).toEqual(expect.arrayContaining([{ days: ['Wednesday', 'Friday'], opens: '16:00', closes: '21:00' }]))
    const pub = await get(calendar, '/api/calendar.json?month=2026-11')
    expect(pub.body.openWeekdays).toEqual([0, 3, 4, 5, 6])
  })

  it('a party on a Wednesday is a closed-day warning until Wednesday has hours', async () => {
    expect((await holdTime({ partyId: 'pty_wednesday00000001', startIso: localToUtcISO(WED, '17:00'), endIso: localToUtcISO(WED, '18:30'), ttlMinutes: null }, [], new Date())).ok).toBe(true)
    expect((await listWarnings({ from: WED, to: WED })).map((w) => w.code)).toContain('party-on-closed-day')
    await saveSettings(withWednesday)
    expect((await listWarnings({ from: WED, to: WED })).map((w) => w.code)).not.toContain('party-on-closed-day')
  })
})

describe('special-day announcement saved on /admin (G9)', () => {
  it('a newly announced day goes out with everything the bar and card need; un-announcing takes it away', async () => {
    const MARKET = '2026-12-12'
    await saveSettings((s) => ({ ...s, cafeSpecialDays: [...s.cafeSpecialDays, { date: MARKET, opens: '10:00', closes: '16:00', name: 'Holiday market', announce: { headline: 'Holiday Market Day', daysBefore: 14 } }] }))
    const notices = (await get(cafeHours, '/api/cafe-hours.json')).body.data.notices
    expect(notices).toEqual(expect.arrayContaining([expect.objectContaining({
      date: MARKET, headline: 'Holiday Market Day', weekday: 'SAT', monthDay: 'DEC 12', shortDate: 'Sat Dec 12', hours: '10 AM – 4 PM',
      showFromIso: localToUtcISO('2026-11-28', '00:00'), showUntilIso: localToUtcISO(MARKET, '16:00'),
    })]))
    await saveSettings((s) => ({ ...s, cafeSpecialDays: s.cafeSpecialDays.map((d) => (d.date === MARKET ? { date: d.date, opens: d.opens, closes: d.closes, name: d.name } : d)) }))
    expect((await get(cafeHours, '/api/cafe-hours.json')).body.data.notices.map((n: any) => n.date)).not.toContain(MARKET)
  })
})
