import { describe, it, expect, afterEach } from 'vitest'
import {
  envBookingsOpen,
  bookingsOpen,
  bookingsClosedResponse,
  previewQueryMatches,
  hasValidPreviewCookie,
} from '@lib/bookings-gate'

// setup.ts sets BOOKINGS_OPEN=true globally; these tests flip env per-case and
// restore afterward. The gate reads env at call time, so no module reset needed.
const ORIG: Record<string, string | undefined> = {
  BOOKINGS_OPEN: process.env.BOOKINGS_OPEN,
  PREVIEW_TOKEN: process.env.PREVIEW_TOKEN,
}
afterEach(() => {
  for (const k of ['BOOKINGS_OPEN', 'PREVIEW_TOKEN']) {
    if (ORIG[k] === undefined) delete process.env[k]
    else process.env[k] = ORIG[k]
  }
})

describe('bookings-gate', () => {
  it('is closed by default (BOOKINGS_OPEN not "true")', () => {
    process.env.BOOKINGS_OPEN = 'false'
    expect(envBookingsOpen()).toBe(false)
    expect(bookingsOpen(undefined, 'parties')).toBe(false)
  })

  it('is open when BOOKINGS_OPEN=true', () => {
    process.env.BOOKINGS_OPEN = 'true'
    for (const k of ['parties', 'workshops', 'kits', 'other'] as const) expect(bookingsOpen(undefined, k)).toBe(true)
  })

  it('BOOKINGS_OPEN=parties opens parties only', () => {
    process.env.BOOKINGS_OPEN = 'parties'
    expect(bookingsOpen(undefined, 'parties')).toBe(true)
    expect(bookingsOpen(undefined, 'workshops')).toBe(false)
    expect(bookingsOpen(undefined, 'kits')).toBe(false)
    expect(bookingsOpen(undefined, 'other')).toBe(false)
    expect(envBookingsOpen()).toBe(true) // something is open
  })

  it('takes a comma list, case and spaces forgiven', () => {
    process.env.BOOKINGS_OPEN = ' Parties , workshops '
    expect(envBookingsOpen('parties')).toBe(true)
    expect(envBookingsOpen('workshops')).toBe(true)
    expect(envBookingsOpen('kits')).toBe(false)
  })

  it('bookingsClosedResponse is a 403 with a friendly message', async () => {
    const res = bookingsClosedResponse()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/isn't open yet/i)
  })

  it('preview cookie unlocks a closed gate (only with the right token)', () => {
    process.env.BOOKINGS_OPEN = 'false'
    process.env.PREVIEW_TOKEN = 'secret123'
    const ok = new Request('https://x/api', { headers: { cookie: 'a=1; hg_preview=secret123' } })
    const bad = new Request('https://x/api', { headers: { cookie: 'hg_preview=nope' } })
    const none = new Request('https://x/api')
    expect(hasValidPreviewCookie(ok)).toBe(true)
    expect(bookingsOpen(ok, 'workshops')).toBe(true)
    expect(bookingsOpen(bad, 'workshops')).toBe(false)
    expect(bookingsOpen(none, 'workshops')).toBe(false)
  })

  it('preview query matches only the configured token', () => {
    process.env.PREVIEW_TOKEN = 'secret123'
    expect(previewQueryMatches(new URL('https://x/book?preview=secret123'))).toBe(true)
    expect(previewQueryMatches(new URL('https://x/book?preview=wrong'))).toBe(false)
    expect(previewQueryMatches(new URL('https://x/book'))).toBe(false)
  })

  it('no preview token configured → cookie/query never unlock', () => {
    process.env.BOOKINGS_OPEN = 'false'
    delete process.env.PREVIEW_TOKEN
    const req = new Request('https://x/api', { headers: { cookie: 'hg_preview=anything' } })
    expect(bookingsOpen(req, 'parties')).toBe(false)
    expect(previewQueryMatches(new URL('https://x/book?preview=anything'))).toBe(false)
  })
})
