// @vitest-environment node
/**
 * Expiry sweep (spec §5): a sent or picked quote past its expiry, never paid,
 * texts the owners once. expiryTold is written by compare-and-set first; only
 * the write that changed it sends the text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rmSync } from 'node:fs'

const m = vi.hoisted(() => ({
  alert: vi.fn(async (_c: string) => ({ attempted: 1, sent: 1 })),
  update: null as null | ((id: string, fn: (q: any) => any) => Promise<any>),
}))
vi.mock('@lib/owner-alert', () => ({ alertOwners: (c: string) => m.alert(c) }))
vi.mock('@lib/quotes/quote-store', async (orig) => {
  const real = await orig<typeof import('@lib/quotes/quote-store')>()
  return { ...real, updateQuote: (id: string, fn: (q: any) => any) => (m.update ? m.update(id, fn) : real.updateQuote(id, fn)) }
})

import { sweepExpiredQuotes } from '@lib/quotes/expiry'
import { newToken, newQuoteId, partyIdForQuote, createQuote, getQuote } from '@lib/quotes/quote-store'
import { checkRequest, saveRequest } from '@lib/event-requests'
import type { Quote } from '@lib/quotes/types'
import { goodBody } from '../../fixtures/event-request'

const NOW = new Date('2026-12-02T18:00:00.000Z')

async function requestId(name: string): Promise<string> {
  const c = checkRequest(goodBody({ about: { ...goodBody().about, name } }), new Date('2026-10-17T17:00:00Z'))
  if (!c.ok) throw new Error('bad fixture')
  return (await saveRequest(c.value, [])).id
}

async function makeQuote(name: string, over: Partial<Quote> = {}): Promise<Quote> {
  const id = newQuoteId()
  return createQuote({
    id, requestId: await requestId(name), partyId: partyIdForQuote(id), token: newToken(), version: 1, priceKey: 'k',
    status: 'sent', place: 'studio', address: '',
    startIso: '2026-12-05T20:00:00.000Z', endIso: '2026-12-05T22:00:00.000Z', guests: 20, crafters: 'adults',
    targetCents: 4000, note: '', depositPct: 50, expiresAt: '2026-12-01T00:00:00.000Z',
    tiers: [], held: true, sentAt: '2026-11-17T12:00:00.000Z', sentBy: 'Kaden', views: 0,
    history: [{ at: '2026-11-17T00:00:00.000Z', by: 'Kaden', what: 'drafted' }],
    ...over,
  })
}

beforeEach(() => {
  rmSync(`${process.env.BLOB_STORE_FS_DIR}/quotes`, { recursive: true, force: true })
  m.alert.mockClear()
  m.update = null
})

describe('sweepExpiredQuotes', () => {
  it('texts the owners once for each expired unpaid quote, and never again', async () => {
    const a = await makeQuote('Avery Expired')
    const b = await makeQuote('Blake Picked', { status: 'picked', startIso: '2026-12-12T20:00:00.000Z' })
    await makeQuote('Casey Paid', { status: 'paid' })
    await makeQuote('Drew Fresh', { expiresAt: '2026-12-10T00:00:00.000Z' })
    await makeQuote('Emery Withdrawn', { status: 'withdrawn' })

    const first = await sweepExpiredQuotes(NOW)
    expect(first).toEqual({ expired: 2, told: 2 })
    const texts = m.alert.mock.calls.map((c) => c[0]).sort()
    expect(texts).toEqual(['Quote expired: Avery, Sat, Dec 5', 'Quote expired: Blake, Sat, Dec 12'])
    expect((await getQuote(a.id))?.expiryTold).toBe(true)
    expect((await getQuote(b.id))?.expiryTold).toBe(true)

    m.alert.mockClear()
    expect(await sweepExpiredQuotes(NOW)).toEqual({ expired: 0, told: 0 })
    expect(m.alert).not.toHaveBeenCalled()
  })

  it('no text when another run already set expiryTold (the write lost)', async () => {
    const q = await makeQuote('Finley Race')
    const real = (await vi.importActual<typeof import('@lib/quotes/quote-store')>('@lib/quotes/quote-store')).updateQuote
    m.update = async (id, fn) => {
      await real(id, (cur) => ({ ...cur, expiryTold: true })) // the other run wins first
      return real(id, fn)
    }
    expect(await sweepExpiredQuotes(NOW)).toEqual({ expired: 1, told: 0 })
    expect(m.alert).not.toHaveBeenCalled()
    expect((await getQuote(q.id))?.expiryTold).toBe(true)
  })

  it('no text when the customer paid between the scan and the write', async () => {
    await makeQuote('Gray Paying')
    const real = (await vi.importActual<typeof import('@lib/quotes/quote-store')>('@lib/quotes/quote-store')).updateQuote
    m.update = async (id, fn) => {
      await real(id, (cur) => ({ ...cur, status: 'paying' }))
      return real(id, fn)
    }
    expect((await sweepExpiredQuotes(NOW)).told).toBe(0)
    expect(m.alert).not.toHaveBeenCalled()
  })

  it('a quote with no date still texts, saying so', async () => {
    await makeQuote('Harper Nodate', { startIso: null, endIso: null })
    await sweepExpiredQuotes(NOW)
    expect(m.alert).toHaveBeenCalledWith('Quote expired: Harper, no date yet')
  })

  it('one quote that fails to write does not stop the others', async () => {
    const bad = await makeQuote('Indy Broken')
    await makeQuote('Jules Fine')
    const real = (await vi.importActual<typeof import('@lib/quotes/quote-store')>('@lib/quotes/quote-store')).updateQuote
    m.update = async (id, fn) => {
      if (id === bad.id) throw new Error('blob down')
      return real(id, fn)
    }
    expect(await sweepExpiredQuotes(NOW)).toEqual({ expired: 2, told: 1 })
    expect(m.alert).toHaveBeenCalledWith('Quote expired: Jules, Sat, Dec 5')
  })

})
