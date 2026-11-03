import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import * as gate from '@lib/bookings-gate'
import {
  bookingsOpenNow,
  bookingsClosedResponse,
  bookingPageGate,
  kindOpenNow,
  previewQueryMatchesNow,
  hasValidPreviewCookieNow,
  secretMatches,
  urlWithoutPreview,
  waitlistChargesAllowedNow,
} from '@lib/bookings-gate'
import { makeKvStore } from '@lib/blob-store'
import {
  _resetSwitchForTests, defaultPauseNote, envOpenKinds, getSwitchState, getSwitchStateStrict, hiccupPauseNote, resetSwitchCache, saveSwitches, StaleSwitchError, SWITCH_CACHE_MS, validateSwitchInput,
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
    expect(envOpenKinds().kinds.size).toBe(0)
    expect(await bookingsOpenNow(undefined, 'parties')).toBe(false)
  })

  it('is open when BOOKINGS_OPEN=true', async () => {
    process.env.BOOKINGS_OPEN = 'true'
    for (const k of ['parties', 'workshops', 'kits', 'other'] as const) expect(await bookingsOpenNow(undefined, k)).toBe(true)
  })

  it('BOOKINGS_OPEN=parties opens parties only', async () => {
    process.env.BOOKINGS_OPEN = 'parties'
    expect(await bookingsOpenNow(undefined, 'parties')).toBe(true)
    expect(await bookingsOpenNow(undefined, 'workshops')).toBe(false)
    expect(await bookingsOpenNow(undefined, 'kits')).toBe(false)
    expect(await bookingsOpenNow(undefined, 'other')).toBe(false)
    expect(envOpenKinds().kinds.has('parties')).toBe(true) // something is open
    expect(await kindOpenNow()).toBe(true)
  })

  it('takes a comma list, case and spaces forgiven', () => {
    process.env.BOOKINGS_OPEN = ' Parties , workshops '
    expect([...envOpenKinds().kinds].sort()).toEqual(['parties', 'workshops'])
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
    expect(await hasValidPreviewCookieNow(ok)).toBe(true)
    expect(await bookingsOpenNow(ok, 'workshops')).toBe(true)
    expect(await bookingsOpenNow(bad, 'workshops')).toBe(false)
    expect(await bookingsOpenNow(none, 'workshops')).toBe(false)
  })

  it('preview query matches only the configured token', async () => {
    process.env.PREVIEW_TOKEN = 'secret123'
    expect(await previewQueryMatchesNow(new URL('https://x/book?preview=secret123'))).toBe(true)
    expect(await previewQueryMatchesNow(new URL('https://x/book?preview=wrong'))).toBe(false)
    expect(await previewQueryMatchesNow(new URL('https://x/book'))).toBe(false)
  })

  it('no preview token configured → cookie/query never unlock', async () => {
    process.env.BOOKINGS_OPEN = 'false'
    delete process.env.PREVIEW_TOKEN
    const req = new Request('https://x/api', { headers: { cookie: 'hg_preview=anything' } })
    expect(await bookingsOpenNow(req, 'parties')).toBe(false)
    expect(await previewQueryMatchesNow(new URL('https://x/book?preview=anything'))).toBe(false)
  })
})

describe('the owners’ switch (More › Online booking)', () => {
  it('a saved switch beats BOOKINGS_OPEN, kind by kind', async () => {
    process.env.BOOKINGS_OPEN = 'true'
    await saveSwitches({ open: { parties: false, workshops: true, kits: false }, pauseNote: '' }, { expectedUpdatedAt: null, by })
    expect(await bookingsOpenNow(undefined, 'parties')).toBe(false)
    expect(await bookingsOpenNow(undefined, 'workshops')).toBe(true)
    expect(await bookingsOpenNow(undefined, 'kits')).toBe(false)
    // and the other way round: env closed, switch open
    process.env.BOOKINGS_OPEN = 'false'
    const cur = await getSwitchState()
    await saveSwitches({ open: { parties: true, workshops: false, kits: true }, pauseNote: '' }, { expectedUpdatedAt: cur.updatedAt, by })
    expect(await bookingsOpenNow(undefined, 'parties')).toBe(true)
    expect(await bookingsOpenNow(undefined, 'workshops')).toBe(false)
    expect(await bookingsOpenNow(undefined, 'kits')).toBe(true)
  })

  it('“other” (hidden older flows) stays with BOOKINGS_OPEN', async () => {
    process.env.BOOKINGS_OPEN = 'false'
    await saveSwitches({ open: ALL_OPEN, pauseNote: '' }, { expectedUpdatedAt: null, by })
    expect(await bookingsOpenNow(undefined, 'other')).toBe(false)
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
    const g = await bookingPageGate({ url: new URL('https://x/book'), request: new Request('https://x/book') }, 'parties')
    expect(g).toEqual({ open: false, preview: false, note: 'Back online Monday. Call us to book a party.' })
  })

  it('the first save keeps the PREVIEW_TOKEN test link she may already have copied', async () => {
    process.env.PREVIEW_TOKEN = 'old-env-secret'
    const withCookie = (t: string) => new Request('https://x/api', { headers: { cookie: `hg_preview=${t}` } })
    // Before any save, "Copy party test link" hands out the env link; her phone holds its cookie.
    expect((await getSwitchState()).previewToken).toBe('old-env-secret')
    const { saved } = await saveSwitches({ open: { parties: false, workshops: false, kits: false }, pauseNote: '' }, { expectedUpdatedAt: null, by })
    expect(saved.previewToken).toBe('old-env-secret')
    expect(await bookingsOpenNow(withCookie('old-env-secret'), 'parties')).toBe(true)
    // Even if the hosting setting later goes away, the saved copy carries on.
    delete process.env.PREVIEW_TOKEN
    expect(await bookingsOpenNow(withCookie('old-env-secret'), 'parties')).toBe(true)
  })

  it('with no PREVIEW_TOKEN the first save makes a test link; a new one stops the old', async () => {
    delete process.env.PREVIEW_TOKEN
    const { saved } = await saveSwitches({ open: { parties: false, workshops: false, kits: false }, pauseNote: '' }, { expectedUpdatedAt: null, by })
    expect(saved.previewToken).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    const withCookie = (t: string) => new Request('https://x/api', { headers: { cookie: `hg_preview=${t}` } })
    expect(await bookingsOpenNow(withCookie('something-else'), 'parties')).toBe(false)
    expect(await bookingsOpenNow(withCookie(saved.previewToken), 'parties')).toBe(true)

    // The page sets the cookie from ?preview=
    const set = vi.fn()
    const g = await bookingPageGate({ url: new URL(`https://x/book?preview=${saved.previewToken}`), request: new Request('https://x/book'), setCookie: set }, 'parties')
    expect(g.open).toBe(true)
    expect(set).toHaveBeenCalledWith('hg_preview', saved.previewToken, expect.objectContaining({ httpOnly: true, secure: true, maxAge: 60 * 60 * 24 * 30 }))

    const again = await saveSwitches({ open: saved.open, pauseNote: '', newTestLink: true }, { expectedUpdatedAt: saved.updatedAt, by })
    expect(again.saved.previewToken).not.toBe(saved.previewToken)
    expect(await bookingsOpenNow(withCookie(saved.previewToken), 'parties')).toBe(false)
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
    expect(await kindOpenNow('parties')).toBe(true)
    // Another server pauses parties: written straight to the store, this server's memory untouched.
    const other = makeKvStore('site-switches', 'site-switches')
    const doc = JSON.parse((await other.get('switches'))!)
    await other.set('switches', JSON.stringify({ ...doc, open: { ...doc.open, parties: false }, updatedAt: '2026-11-02T15:00:05.000Z' }))
    vi.setSystemTime(new Date(Date.parse('2026-11-02T15:00:00Z') + SWITCH_CACHE_MS - 1000))
    expect(await kindOpenNow('parties')).toBe(true) // still remembered
    vi.setSystemTime(new Date(Date.parse('2026-11-02T15:00:00Z') + SWITCH_CACHE_MS + 1000))
    expect(await kindOpenNow('parties')).toBe(false) // asked again
  })

  it('a store outage keeps the last answer (never flips to BOOKINGS_OPEN after a save)', async () => {
    process.env.BOOKINGS_OPEN = 'true'
    await saveSwitches({ open: { ...ALL_OPEN, parties: false }, pauseNote: '' }, { expectedUpdatedAt: null, by })
    resetSwitchCache()
    expect(await kindOpenNow('parties')).toBe(false)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.now() + SWITCH_CACHE_MS + 1000))
    const other = makeKvStore('site-switches', 'site-switches')
    await other.set('switches', '{broken')
    expect(await kindOpenNow('parties')).toBe(false)
  })

  it('a fresh server that can’t read a damaged switch treats every kind as PAUSED (never BOOKINGS_OPEN)', async () => {
    process.env.BOOKINGS_OPEN = 'true'
    process.env.PREVIEW_TOKEN = 'env-secret'
    await saveSwitches({ open: { ...ALL_OPEN, parties: false }, pauseNote: '' }, { expectedUpdatedAt: null, by })
    const other = makeKvStore('site-switches', 'site-switches')
    for (const broken of ['{broken', '{"hello":1}', 'null', '42']) {
      await other.set('switches', broken)
      resetSwitchCache() // a cold function instance: nothing remembered
      for (const k of ['parties', 'workshops', 'kits'] as const) expect(await bookingsOpenNow(undefined, k)).toBe(false)
      expect(await kindOpenNow()).toBe(false)
      // The env test link doesn't unlock it either.
      expect(await bookingsOpenNow(new Request('https://x/api', { headers: { cookie: 'hg_preview=env-secret' } }), 'parties')).toBe(false)
      const res = await bookingsClosedResponse()
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe(hiccupPauseNote())
      expect((await getSwitchState()).source).toBe('unreadable')
    }
    expect(hiccupPauseNote()).toMatch(/hiccup.*\(256\) 464-1710/)
  })

  it('/admin sees a damaged switch as everything paused, and an owner’s save replaces it', async () => {
    const other = makeKvStore('site-switches', 'site-switches')
    await other.set('switches', '{broken')
    const shown = await getSwitchStateStrict()
    expect(shown.source).toBe('unreadable')
    expect(shown.open).toEqual({ parties: false, workshops: false, kits: false })
    const { saved, changed } = await saveSwitches({ open: { ...ALL_OPEN, kits: false }, pauseNote: '' }, { expectedUpdatedAt: shown.updatedAt, by })
    expect(changed).toEqual(['Opened parties', 'Opened classes & workshops'])
    expect(saved.previewToken).toMatch(/^[A-Za-z0-9_-]{20,}$/) // a damaged doc never hands back an env link
    resetSwitchCache()
    expect(await kindOpenNow('parties')).toBe(true)
  })

  it('while classes are paused the waitlist runner doesn’t charge; it resumes once reopened', async () => {
    const { saved } = await saveSwitches({ open: { ...ALL_OPEN, workshops: false }, pauseNote: '' }, { expectedUpdatedAt: null, by })
    expect(await waitlistChargesAllowedNow()).toBe(false)
    await saveSwitches({ open: ALL_OPEN, pauseNote: '' }, { expectedUpdatedAt: saved.updatedAt, by })
    expect(await waitlistChargesAllowedNow()).toBe(true)
  })
})

describe('the test link (?preview=)', () => {
  it('compares the secret in constant time and refuses blanks', () => {
    expect(secretMatches('abc', 'abc')).toBe(true)
    expect(secretMatches('abd', 'abc')).toBe(false)
    expect(secretMatches('ab', 'abc')).toBe(false)
    expect(secretMatches('', '')).toBe(false)
    expect(secretMatches(null, 'abc')).toBe(false)
    expect(secretMatches('abc', '')).toBe(false)
  })

  it('sets the cookie, then sends the browser to the same address without `preview`', async () => {
    process.env.PREVIEW_TOKEN = 'secret123'
    const set = vi.fn()
    const g = await bookingPageGate({ url: new URL('https://x/workshops?w=abc123&preview=secret123#top'), request: new Request('https://x/workshops'), setCookie: set }, 'workshops')
    expect(set).toHaveBeenCalledWith('hg_preview', 'secret123', expect.objectContaining({ path: '/', httpOnly: true }))
    expect(g.redirect).toBe('/workshops?w=abc123#top')
    expect(g.redirect).not.toMatch(/preview|secret123/)
    // The follow-up request carries only the cookie, and is unlocked.
    process.env.BOOKINGS_OPEN = 'false'
    const next = await bookingPageGate({ url: new URL('https://x/workshops?w=abc123'), request: new Request('https://x/workshops', { headers: { cookie: 'hg_preview=secret123' } }), setCookie: set }, 'workshops')
    expect(next).toMatchObject({ open: true, preview: true })
    expect(next.redirect).toBeUndefined()
  })

  it('a wrong or missing secret never redirects or sets a cookie', async () => {
    process.env.PREVIEW_TOKEN = 'secret123'
    const set = vi.fn()
    for (const q of ['?preview=wrong', '', '?preview=']) {
      const g = await bookingPageGate({ url: new URL(`https://x/book${q}`), request: new Request('https://x/book'), setCookie: set }, 'parties')
      expect(g.redirect).toBeUndefined()
    }
    expect(set).not.toHaveBeenCalled()
    expect(urlWithoutPreview(new URL('https://x/book?preview=a&date=2026-12-05'))).toBe('/book?date=2026-12-05')
  })

  it('every booking page answers the test link with the redirect', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    for (const f of ['src/pages/book.astro', 'src/pages/workshops.astro', 'src/pages/classes/[id].astro', 'src/pages/calendar.astro']) {
      expect(readFileSync(f, 'utf8'), f).toMatch(/if \((?:gate|partyGate)\.redirect\) return Astro\.redirect\((?:gate|partyGate)\.redirect, 302\)/)
    }
  })

  it('the old synchronous gate names are gone (code written against them fails to compile)', () => {
    for (const old of ['bookingsOpen', 'kindOpen', 'pauseNote', 'envBookingsOpen', 'previewToken', 'hasValidPreviewCookie', 'previewQueryMatches']) {
      expect(gate, old).not.toHaveProperty(old)
    }
  })
})
