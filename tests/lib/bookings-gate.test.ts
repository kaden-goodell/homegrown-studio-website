import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import {
  envBookingsOpen,
  bookingsOpen,
  bookingsClosedResponse,
  bookingPageGate,
  kindOpen,
  previewQueryMatches,
  hasValidPreviewCookie,
} from '@lib/bookings-gate'
import { makeKvStore } from '@lib/blob-store'
import {
  _resetSwitchForTests, defaultPauseNote, getSwitchState, resetSwitchCache, saveSwitches, StaleSwitchError, SWITCH_CACHE_MS, validateSwitchInput,
} from '@lib/booking-switch'

// setup.ts sets BOOKINGS_OPEN=true globally; these tests flip env per-case and
// restore afterward. The env fallback is read at call time; the saved switch
// is remembered for 30 seconds (reset between tests).
const ORIG: Record<string, string | undefined> = {
  BOOKINGS_OPEN: process.env.BOOKINGS_OPEN,
  PREVIEW_TOKEN: process.env.PREVIEW_TOKEN,
}
const by = { id: 'owner-catherine', name: 'Catherine' }
const ALL_OPEN = { parties: true, workshops: true, kits: true }

beforeEach(async () => {
  await _resetSwitchForTests()
})
afterEach(() => {
  vi.useRealTimers()
  for (const k of ['BOOKINGS_OPEN', 'PREVIEW_TOKEN']) {
    if (ORIG[k] === undefined) delete process.env[k]
    else process.env[k] = ORIG[k]
  }
})

describe('bookings-gate, before the owners save (BOOKINGS_OPEN / PREVIEW_TOKEN as before)', () => {
  it('is closed by default (BOOKINGS_OPEN not "true")', async () => {
    process.env.BOOKINGS_OPEN = 'false'
    expect(envBookingsOpen()).toBe(false)
    expect(await bookingsOpen(undefined, 'parties')).toBe(false)
  })

  it('is open when BOOKINGS_OPEN=true', async () => {
    process.env.BOOKINGS_OPEN = 'true'
    for (const k of ['parties', 'workshops', 'kits', 'other'] as const) expect(await bookingsOpen(undefined, k)).toBe(true)
  })

  it('BOOKINGS_OPEN=parties opens parties only', async () => {
    process.env.BOOKINGS_OPEN = 'parties'
    expect(await bookingsOpen(undefined, 'parties')).toBe(true)
    expect(await bookingsOpen(undefined, 'workshops')).toBe(false)
    expect(await bookingsOpen(undefined, 'kits')).toBe(false)
    expect(await bookingsOpen(undefined, 'other')).toBe(false)
    expect(envBookingsOpen()).toBe(true) // something is open
    expect(await kindOpen()).toBe(true)
  })

  it('takes a comma list, case and spaces forgiven', () => {
    process.env.BOOKINGS_OPEN = ' Parties , workshops '
    expect(envBookingsOpen('parties')).toBe(true)
    expect(envBookingsOpen('workshops')).toBe(true)
    expect(envBookingsOpen('kits')).toBe(false)
  })

  it('the closed answer is a 403 with the plain pause note, never the grand opening', async () => {
    const res = await bookingsClosedResponse()
    expect(res.status).toBe(403)
    const { error } = await res.json()
    expect(error).toBe(defaultPauseNote())
    expect(error).toMatch(/paused/i)
    expect(error).toMatch(/\(256\) 464-1710/)
    expect(error).not.toMatch(/grand opening|isn't open yet/i)
  })

  it('preview cookie unlocks a closed gate (only with the right token)', async () => {
    process.env.BOOKINGS_OPEN = 'false'
    process.env.PREVIEW_TOKEN = 'secret123'
    const ok = new Request('https://x/api', { headers: { cookie: 'a=1; hg_preview=secret123' } })
    const bad = new Request('https://x/api', { headers: { cookie: 'hg_preview=nope' } })
    const none = new Request('https://x/api')
    expect(await hasValidPreviewCookie(ok)).toBe(true)
    expect(await bookingsOpen(ok, 'workshops')).toBe(true)
    expect(await bookingsOpen(bad, 'workshops')).toBe(false)
    expect(await bookingsOpen(none, 'workshops')).toBe(false)
  })

  it('preview query matches only the configured token', async () => {
    process.env.PREVIEW_TOKEN = 'secret123'
    expect(await previewQueryMatches(new URL('https://x/book?preview=secret123'))).toBe(true)
    expect(await previewQueryMatches(new URL('https://x/book?preview=wrong'))).toBe(false)
    expect(await previewQueryMatches(new URL('https://x/book'))).toBe(false)
  })

  it('no preview token configured → cookie/query never unlock', async () => {
    process.env.BOOKINGS_OPEN = 'false'
    delete process.env.PREVIEW_TOKEN
    const req = new Request('https://x/api', { headers: { cookie: 'hg_preview=anything' } })
    expect(await bookingsOpen(req, 'parties')).toBe(false)
    expect(await previewQueryMatches(new URL('https://x/book?preview=anything'))).toBe(false)
  })
})

describe('the owners’ switch (More › Online booking)', () => {
  it('a saved switch beats BOOKINGS_OPEN, kind by kind', async () => {
    process.env.BOOKINGS_OPEN = 'true'
    await saveSwitches({ open: { parties: false, workshops: true, kits: false }, pauseNote: '' }, { expectedUpdatedAt: null, by })
    expect(await bookingsOpen(undefined, 'parties')).toBe(false)
    expect(await bookingsOpen(undefined, 'workshops')).toBe(true)
    expect(await bookingsOpen(undefined, 'kits')).toBe(false)
    // and the other way round: env closed, switch open
    process.env.BOOKINGS_OPEN = 'false'
    const cur = await getSwitchState()
    await saveSwitches({ open: { parties: true, workshops: false, kits: true }, pauseNote: '' }, { expectedUpdatedAt: cur.updatedAt, by })
    expect(await bookingsOpen(undefined, 'parties')).toBe(true)
    expect(await bookingsOpen(undefined, 'workshops')).toBe(false)
    expect(await bookingsOpen(undefined, 'kits')).toBe(true)
  })

  it('“other” (hidden older flows) stays with BOOKINGS_OPEN', async () => {
    process.env.BOOKINGS_OPEN = 'false'
    await saveSwitches({ open: ALL_OPEN, pauseNote: '' }, { expectedUpdatedAt: null, by })
    expect(await bookingsOpen(undefined, 'other')).toBe(false)
  })

  it('the first save starts from what was in force and says what changed', async () => {
    process.env.BOOKINGS_OPEN = 'parties,workshops'
    const before = await getSwitchState()
    expect(before.source).toBe('setup')
    expect(before.open).toEqual({ parties: true, workshops: true, kits: false })
    const { changed, saved } = await saveSwitches({ open: { parties: false, workshops: true, kits: false }, pauseNote: '' }, { expectedUpdatedAt: null, by })
    expect(changed).toEqual(['Paused parties'])
    expect(saved.source).toBe('saved')
    expect(saved.history[0]).toMatchObject({ by, changed })
  })

  it('the closed answer and booking pages show the owners’ pause note', async () => {
    await saveSwitches({ open: { parties: false, workshops: true, kits: false }, pauseNote: 'Back online Monday. Call us to book a party.' }, { expectedUpdatedAt: null, by })
    expect((await (await bookingsClosedResponse()).json()).error).toBe('Back online Monday. Call us to book a party.')
    const gate = await bookingPageGate({ url: new URL('https://x/book'), request: new Request('https://x/book') }, 'parties')
    expect(gate).toEqual({ open: false, preview: false, note: 'Back online Monday. Call us to book a party.' })
  })

  it('its own test link replaces PREVIEW_TOKEN; a new one stops the old', async () => {
    process.env.PREVIEW_TOKEN = 'old-env-secret'
    const { saved } = await saveSwitches({ open: { parties: false, workshops: false, kits: false }, pauseNote: '' }, { expectedUpdatedAt: null, by })
    expect(saved.previewToken).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(saved.previewToken).not.toBe('old-env-secret')
    const withCookie = (t: string) => new Request('https://x/api', { headers: { cookie: `hg_preview=${t}` } })
    expect(await bookingsOpen(withCookie('old-env-secret'), 'parties')).toBe(false)
    expect(await bookingsOpen(withCookie(saved.previewToken), 'parties')).toBe(true)

    // The page sets the cookie from ?preview=
    const set = vi.fn()
    const gate = await bookingPageGate({ url: new URL(`https://x/book?preview=${saved.previewToken}`), request: new Request('https://x/book'), setCookie: set }, 'parties')
    expect(gate.open).toBe(true)
    expect(set).toHaveBeenCalledWith('hg_preview', saved.previewToken, expect.objectContaining({ httpOnly: true, maxAge: 60 * 60 * 24 * 30 }))

    const again = await saveSwitches({ open: saved.open, pauseNote: '', newTestLink: true }, { expectedUpdatedAt: saved.updatedAt, by })
    expect(again.saved.previewToken).not.toBe(saved.previewToken)
    expect(await bookingsOpen(withCookie(saved.previewToken), 'parties')).toBe(false)
    expect(again.changed).toEqual(['Made a new test link'])
  })

  it('refuses a stale save, with what’s there now', async () => {
    const { saved } = await saveSwitches({ open: ALL_OPEN, pauseNote: '' }, { expectedUpdatedAt: null, by })
    await expect(saveSwitches({ open: { ...ALL_OPEN, parties: false }, pauseNote: '' }, { expectedUpdatedAt: null, by })).rejects.toBeInstanceOf(StaleSwitchError)
    await saveSwitches({ open: { ...ALL_OPEN, parties: false }, pauseNote: '' }, { expectedUpdatedAt: saved.updatedAt, by })
    expect((await getSwitchState()).open.parties).toBe(false)
  })

  it('the note is checked: 140 characters, no markup', () => {
    expect(() => validateSwitchInput({ open: ALL_OPEN, pauseNote: 'x'.repeat(141) })).toThrow(/140/)
    expect(() => validateSwitchInput({ open: ALL_OPEN, pauseNote: '<b>hi</b>' })).toThrow(/< and >/)
    expect(() => validateSwitchInput({ open: { parties: true }, pauseNote: '' })).toThrow(/classes & workshops/)
    expect(validateSwitchInput({ open: ALL_OPEN, pauseNote: '  Call   us  ' }).pauseNote).toBe('Call us')
  })

  it('another server’s flip shows here within the 30-second memory', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-02T15:00:00Z'))
    await saveSwitches({ open: ALL_OPEN, pauseNote: '' }, { expectedUpdatedAt: null, by })
    expect(await kindOpen('parties')).toBe(true)
    // Another server pauses parties: written straight to the store, this server's memory untouched.
    const other = makeKvStore('site-switches', 'site-switches')
    const doc = JSON.parse((await other.get('switches'))!)
    await other.set('switches', JSON.stringify({ ...doc, open: { ...doc.open, parties: false }, updatedAt: '2026-11-02T15:00:05.000Z' }))
    vi.setSystemTime(new Date(Date.parse('2026-11-02T15:00:00Z') + SWITCH_CACHE_MS - 1000))
    expect(await kindOpen('parties')).toBe(true) // still remembered
    vi.setSystemTime(new Date(Date.parse('2026-11-02T15:00:00Z') + SWITCH_CACHE_MS + 1000))
    expect(await kindOpen('parties')).toBe(false) // asked again
  })

  it('a store outage keeps the last answer (never flips to BOOKINGS_OPEN after a save)', async () => {
    process.env.BOOKINGS_OPEN = 'true'
    await saveSwitches({ open: { ...ALL_OPEN, parties: false }, pauseNote: '' }, { expectedUpdatedAt: null, by })
    resetSwitchCache()
    expect(await kindOpen('parties')).toBe(false)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.now() + SWITCH_CACHE_MS + 1000))
    const other = makeKvStore('site-switches', 'site-switches')
    await other.set('switches', '{broken')
    expect(await kindOpen('parties')).toBe(false)
  })
})
