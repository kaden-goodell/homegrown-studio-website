// @vitest-environment node
// More › Online booking (G1): the owners' switch, its admin route, and every
// public booking path refusing a paused kind with the pause note.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({ audit: vi.fn(), purge: vi.fn() }))
vi.mock('@lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@lib/booking-cache', () => ({ BOOKING_CACHE_TAG: 'booking-pages', purgeBookingPages: mocks.purge }))

import * as route from '@pages/api/admin/online-booking.json'
import { adminCookie } from '@lib/admin-auth'
import { _resetSwitchForTests, defaultPauseNote } from '@lib/booking-switch'

const cookie = () => adminCookie().split(';')[0]
async function call(method: 'GET' | 'POST', body?: unknown, opts: { signedIn?: boolean; who?: string } = {}) {
  const request = new Request('https://x.test/api/admin/online-booking.json', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.signedIn === false ? {} : { cookie: cookie() }),
      ...(opts.who ? { 'X-Admin-Who': opts.who } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const res: Response = await (route as any)[method]({ request, url: new URL(request.url) })
  return { status: res.status, body: await res.json() }
}
const loaded = async () => (await call('GET')).body.data
async function setSwitch(open: Record<string, boolean>, pauseNote = '') {
  const v = await loaded()
  const r = await call('POST', { open: { ...v.open, ...open }, pauseNote, expectedUpdatedAt: v.updatedAt }, { who: 'Catherine' })
  expect(r.status).toBe(200)
  return r.body.data
}

beforeEach(async () => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  vi.stubEnv('BOOKINGS_OPEN', 'true')
  vi.stubEnv('PREVIEW_TOKEN', '')
  await _resetSwitchForTests()
  mocks.audit.mockReset().mockResolvedValue(undefined)
  mocks.purge.mockReset().mockResolvedValue(true)
})
afterEach(() => vi.unstubAllEnvs())

describe('/api/admin/online-booking.json', () => {
  it('owners only', async () => {
    expect((await call('GET', undefined, { signedIn: false })).status).toBe(401)
    expect((await call('POST', { open: {} }, { signedIn: false })).status).toBe(401)
  })

  it('before any save: the hosting setting, marked as such, with the plain default note', async () => {
    vi.stubEnv('BOOKINGS_OPEN', 'parties,workshops')
    const v = await loaded()
    expect(v).toMatchObject({
      open: { parties: true, workshops: true, kits: false },
      source: 'setup', updatedAt: null, pauseNoteWritten: '', pauseNote: defaultPauseNote(), defaultNote: defaultPauseNote(), noteMax: 140, readOnly: false,
    })
    expect(v.pauseNote).not.toMatch(/grand opening/i)
  })

  it('a pause saves, is audited under her name, clears the kept booking pages, and says what changed', async () => {
    const data = await setSwitch({ parties: false }, 'Back next week. Call us to book.')
    expect(data).toMatchObject({ source: 'saved', open: { parties: false, workshops: true }, pauseNote: 'Back next week. Call us to book.', changed: ['Paused parties', 'Changed the pause note'] })
    expect(data.by).toEqual({ id: 'owner-catherine', name: 'Catherine' })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'online-booking', details: { changed: 'Paused parties; Changed the pause note' } }))
    expect(mocks.purge).toHaveBeenCalledTimes(1)
  })

  it('a stale save is a 409 with what’s there now; a bad note is refused on its field', async () => {
    await setSwitch({ parties: false })
    const r = await call('POST', { open: { parties: true, workshops: true, kits: true }, pauseNote: '', expectedUpdatedAt: null })
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ stale: true, current: { open: { parties: false } } })
    const v = await loaded()
    const bad = await call('POST', { open: v.open, pauseNote: 'x'.repeat(141), expectedUpdatedAt: v.updatedAt })
    expect(bad).toMatchObject({ status: 400, body: { field: 'pauseNote' } })
    expect((await call('POST', { open: v.open, pauseNote: '' })).status).toBe(400) // no expectedUpdatedAt
  })
})

// Each public booking path, with its kind paused: refused before anything is read or charged.
const PATHS = [
  { kind: 'parties', name: 'party booking', mod: () => import('@pages/api/party/book.json'), url: '/api/party/book.json', method: 'POST', body: { attemptId: 'x' } },
  { kind: 'parties', name: 'party times', mod: () => import('@pages/api/party/availability.json'), url: '/api/party/availability.json', method: 'POST', body: { date: '2027-01-09' } },
  { kind: 'parties', name: 'party dates', mod: () => import('@pages/api/party/available-dates.json'), url: '/api/party/available-dates.json', method: 'POST', body: {} },
  { kind: 'workshops', name: 'class booking', mod: () => import('@pages/api/classes/book.json'), url: '/api/classes/book.json', method: 'POST', body: {} },
  { kind: 'workshops', name: 'Square workshop booking', mod: () => import('@pages/api/workshops/book.json'), url: '/api/workshops/book.json', method: 'POST', body: {} },
  { kind: 'kits', name: 'kit order', mod: () => import('@pages/api/kits/order.json'), url: '/api/kits/order.json', method: 'POST', body: {} },
] as const

async function hit(p: (typeof PATHS)[number], headers: Record<string, string> = {}) {
  const mod: any = await p.mod()
  const request = new Request(`https://x.test${p.url}`, {
    method: p.method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...('body' in p ? { body: JSON.stringify(p.body) } : {}),
  })
  const res: Response = await mod[p.method]({ request, url: new URL(request.url), clientAddress: '127.0.0.1', locals: {} })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

describe('every public booking path respects the switch', () => {
  for (const p of PATHS) {
    it(`${p.name}: paused → 403 with the pause note`, async () => {
      await setSwitch({ [p.kind]: false }, 'Booking is paused today. Text us and we’ll fit you in.')
      const r = await hit(p)
      expect(r).toEqual({ status: 403, body: { error: 'Booking is paused today. Text us and we’ll fit you in.' } })
    })
  }

  it('pausing one kind leaves the others alone', async () => {
    await setSwitch({ parties: false, kits: false })
    const party = await hit(PATHS[0])
    expect(party.status).toBe(403)
    // Classes still open: the class path gets past the gate (whatever it then says about the empty request).
    const cls = await hit(PATHS[3])
    expect(cls.status).not.toBe(403)
  })

  it('the test link’s cookie lets the owner through while paused', async () => {
    const data = await setSwitch({ parties: false, workshops: false, kits: false })
    const r = await hit(PATHS[2], { cookie: `hg_preview=${data.previewToken}` })
    expect(r.status).not.toBe(403)
    const wrong = await hit(PATHS[2], { cookie: 'hg_preview=nope' })
    expect(wrong.status).toBe(403)
  })

  it('the public calendar offers no party times while parties are paused', async () => {
    await setSwitch({ parties: false })
    const { bookingsOpen } = await import('@lib/bookings-gate')
    expect(await bookingsOpen(new Request('https://x.test/api/calendar.json'), 'parties')).toBe(false)
  })
})
