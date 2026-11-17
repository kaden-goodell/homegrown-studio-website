import { describe, it, expect, vi, beforeEach } from 'vitest'

// No Square in tests: no legacy classes, no Square parties.
const mocks = vi.hoisted(() => ({ listBookings: vi.fn(async () => []), listAllWorkshops: vi.fn(async () => []) }))
vi.mock('@config/providers', () => ({
  providers: {
    booking: { listBookings: mocks.listBookings },
    workshop: { listAllWorkshops: mocks.listAllWorkshops, listWorkshops: vi.fn(async () => []) },
  },
}))
vi.mock('@config/site.config', () => ({
  siteConfig: { providers: { booking: { config: { locationId: 'test-location' } } } },
}))
vi.mock('@providers/square/client', () => ({
  createSquareClient: () => ({ catalog: { object: { get: async () => ({ object: { itemData: { variations: [{ id: 'var-party' }] } } }) } } }),
}))

import { applyHold, releaseQuoteHold } from '@lib/quotes/holds'
import { newToken, newQuoteId, partyIdForQuote, createQuote } from '@lib/quotes/quote-store'
import type { Quote } from '@lib/quotes/types'
import { holdsBetween, holdTime } from '@lib/parties/party-book'
import { partyBusy } from '@lib/classes/studio-schedule'
import { findPartyClashes } from '@lib/class-guard'
import { freeOrphanHold, OrphanHoldError } from '@lib/parties/hold-actions'
import { partyWarnings } from '@lib/parties/warnings'
import { saveRequest } from '@lib/event-requests'
import { localToUtcISO } from '@lib/parties/party-times'

const at = (ymd: string, hhmm: string) => localToUtcISO(ymd, hhmm)
const NOW = new Date()
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()
const dayOf = (ymd: string) => [at(ymd, '00:00'), at(ymd, '23:59')] as const

function quote(ymd: string, over: Partial<Quote> = {}): Quote {
  const id = newQuoteId()
  return {
    id, requestId: `req-${id}`, partyId: partyIdForQuote(id), token: newToken(), version: 1, priceKey: 'k',
    status: 'sent', place: 'studio', address: '', startIso: at(ymd, '18:00'), endIso: at(ymd, '20:00'), guests: 20, crafters: 'both',
    targetCents: 5000, note: '', depositPct: 50, expiresAt: days(14), tiers: [], held: false,
    views: 0, history: [{ at: NOW.toISOString(), by: 'kaden', what: 'drafted' }], ...over,
  }
}
const mine = async (q: Quote, ymd: string) => (await holdsBetween(...dayOf(ymd), NOW)).filter((h) => h.partyId === q.partyId)
const held = (q: Quote, over: Partial<Quote> = {}): Quote => ({ ...q, held: true, ...over })

beforeEach(() => {
  mocks.listBookings.mockReset().mockResolvedValue([])
  mocks.listAllWorkshops.mockReset().mockResolvedValue([])
})

// Each test sits on its own far-future day so the shared party book doesn't collide.
describe('applyHold', () => {
  it('send holds the time under the party id, with the TTL to the quote expiry', async () => {
    const q = quote('2031-12-11')
    expect(await applyHold(null, q, NOW)).toEqual({ held: true })
    const h = await mine(q, '2031-12-11')
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ state: 'held', startIso: q.startIso, endIso: q.endIso })
    // TTL is whole minutes rounded up: lands within a minute of the expiry, never before it.
    const diff = Date.parse(h[0].holdExpiresAt!) - Date.parse(q.expiresAt)
    expect(diff).toBeGreaterThanOrEqual(0)
    expect(diff).toBeLessThan(60_000)
  })

  it('a clash with a party hold refuses with its label and start; the book is unchanged', async () => {
    const ymd = '2031-12-12'
    await holdTime({ partyId: 'pty_other1', startIso: at(ymd, '18:30'), endIso: at(ymd, '20:00'), ttlMinutes: 60 }, [], NOW)
    const before = await holdsBetween(...dayOf(ymd), NOW)
    const q = quote(ymd)
    const r = await applyHold(null, q, NOW)
    expect(r.held).toBe(false)
    expect(r.clash).toEqual({ label: expect.any(String), startIso: at(ymd, '18:30') })
    expect(await holdsBetween(...dayOf(ymd), NOW)).toEqual(before)
  })

  it('start moved an hour later moves the hold; a clash keeps the old one', async () => {
    const ymd = '2031-12-13'
    const q0 = quote(ymd)
    await applyHold(null, q0, NOW)
    const q1 = held(q0, { startIso: at(ymd, '19:00'), endIso: at(ymd, '21:00') })
    expect(await applyHold(held(q0), q1, NOW)).toEqual({ held: true })
    expect((await mine(q0, ymd)).map((h) => h.startIso)).toEqual([at(ymd, '19:00')])

    // Something else at 14:00; moving there clashes and the 19:00 hold stays.
    await holdTime({ partyId: 'pty_other2', startIso: at(ymd, '14:00'), endIso: at(ymd, '15:00'), ttlMinutes: 60 }, [], NOW)
    const q2 = held(q0, { startIso: at(ymd, '14:30'), endIso: at(ymd, '16:00') })
    const r = await applyHold(q1, q2, NOW)
    expect(r).toMatchObject({ held: false, clash: { startIso: at(ymd, '14:00') } })
    expect((await mine(q0, ymd)).map((h) => h.startIso)).toEqual([at(ymd, '19:00')])
  })

  it('end changed resizes the hold', async () => {
    const ymd = '2031-12-14'
    const q0 = quote(ymd)
    await applyHold(null, q0, NOW)
    const q1 = held(q0, { endIso: at(ymd, '21:00') })
    expect(await applyHold(held(q0), q1, NOW)).toEqual({ held: true })
    expect((await mine(q0, ymd)).map((h) => h.endIso)).toEqual([at(ymd, '21:00')])
  })

  it('studio → away lets the time go; away → studio holds it again', async () => {
    const ymd = '2031-12-15'
    const q0 = quote(ymd)
    await applyHold(null, q0, NOW)
    const away = held(q0, { place: 'away', address: '1 Main St', held: false })
    expect(await applyHold(held(q0), away, NOW)).toEqual({ held: false })
    expect(await mine(q0, ymd)).toHaveLength(0)
    expect(await applyHold(away, { ...away, place: 'studio' }, NOW)).toEqual({ held: true })
    expect(await mine(q0, ymd)).toHaveLength(1)
  })

  it('expiry later extends the hold; expiry earlier shortens it', async () => {
    const ymd = '2031-12-16'
    const q0 = quote(ymd)
    await applyHold(null, q0, NOW)
    const later = held(q0, { expiresAt: days(20) })
    expect(await applyHold(held(q0), later, NOW)).toEqual({ held: true })
    expect((await mine(q0, ymd))[0].holdExpiresAt).toBe(later.expiresAt)
    const earlier = held(q0, { expiresAt: days(3) })
    expect(await applyHold(later, earlier, NOW)).toEqual({ held: true })
    const exp = Date.parse((await mine(q0, ymd))[0].holdExpiresAt!)
    expect(exp - Date.parse(earlier.expiresAt)).toBeGreaterThanOrEqual(0)
    expect(exp - Date.parse(earlier.expiresAt)).toBeLessThan(60_000)
  })

  it('withdraw lets the time go; reopen holds it with the new expiry', async () => {
    const ymd = '2031-12-17'
    const q0 = quote(ymd)
    await applyHold(null, q0, NOW)
    const gone = held(q0, { status: 'withdrawn', held: false })
    expect(await applyHold(held(q0), gone, NOW)).toEqual({ held: false })
    expect(await mine(q0, ymd)).toHaveLength(0)
    const back = { ...gone, status: 'sent' as const, expiresAt: days(10) }
    expect(await applyHold(gone, back, NOW)).toEqual({ held: true })
    expect(await mine(q0, ymd)).toHaveLength(1)
  })

  it('releaseQuoteHold lets a held quote time go', async () => {
    const ymd = '2031-12-18'
    const q0 = quote(ymd)
    await applyHold(null, q0, NOW)
    await releaseQuoteHold(held(q0))
    expect(await mine(q0, ymd)).toHaveLength(0)
  })

  it('a draft or an away quote holds nothing', async () => {
    const ymd = '2031-12-19'
    const d = quote(ymd, { status: 'draft' })
    expect(await applyHold(null, d, NOW)).toEqual({ held: false })
    const a = quote(ymd, { place: 'away', address: 'x' })
    expect(await applyHold(null, a, NOW)).toEqual({ held: false })
    expect(await holdsBetween(...dayOf(ymd), NOW)).toHaveLength(0)
  })
})

describe('quote holds elsewhere', () => {
  it('a quote hold is a short hold: To decide cannot free it, and after expiry no warning names it', async () => {
    const ymd = '2031-12-20'
    const q = quote(ymd)
    await applyHold(null, q, NOW)
    // Before expiry: freeing it is refused (it is not a lasting hold).
    await expect(freeOrphanHold(q.partyId, q.startIso!, { id: 'k', name: 'Kaden' } as any, new Date(NOW.getTime() + 60 * 60_000)))
      .rejects.toBeInstanceOf(OrphanHoldError)
    expect(await mine(q, ymd)).toHaveLength(1)
    // After expiry: no warning about it.
    const after = new Date(Date.parse(q.expiresAt) + 120_000)
    const warnings = await partyWarnings(ymd, ymd, after, { squareParties: Promise.resolve([]) })
    expect(warnings.filter((w) => w.eventId === q.partyId || w.when === q.startIso)).toEqual([])
  })

  it('partyBusy labels a quote hold with the requester\'s first name', async () => {
    const ymd = '2031-12-21'
    const req = await saveRequest({ about: { name: 'Paige Turner', email: 'p@example.com', phone: '2565551234' } } as any, [])
    const q = await createQuote(quote(ymd, { requestId: req.id }))
    await applyHold(null, q, NOW)
    const b = (await partyBusy(...dayOf(ymd), NOW)).find((x) => x.id === q.partyId)
    expect(b).toMatchObject({ label: 'Quote hold: Paige', hostName: 'Paige Turner' })
  })

  it('the class guard sees a live quote hold', async () => {
    const ymd = '2031-12-22'
    const q = quote(ymd)
    await applyHold(null, q, NOW)
    const hits = await findPartyClashes(at(ymd, '18:30'), 60)
    expect(hits.map((h) => h.id)).toContain(q.partyId)
  })
})
