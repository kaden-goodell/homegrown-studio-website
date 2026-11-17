import { describe, it, expect } from 'vitest'
import { PG_STORES } from '@lib/db/pg-stores'
import {
  getSettings, saveSettings, getMenu, saveMenuItems, listPackages, savePackage, deletePackage, QuoteStoreError,
} from '@lib/quotes/menu-store'
import {
  newToken, newQuoteId, partyIdForQuote, createQuote, getQuote, getQuoteByToken, getQuoteForRequest, updateQuote,
} from '@lib/quotes/quote-store'
import { DEFAULT_SETTINGS, type Quote } from '@lib/quotes/types'

const quote = (over: Partial<Quote> = {}): Quote => {
  const id = newQuoteId()
  return {
    id, requestId: `req-${id}`, partyId: partyIdForQuote(id), token: newToken(), version: 1, priceKey: 'k',
    status: 'draft', place: 'studio', address: '', startIso: null, endIso: null, guests: 10, crafters: 'both',
    targetCents: 5000, note: '', depositPct: 50, expiresAt: '2026-12-01T00:00:00.000Z', tiers: [], held: false,
    views: 0, history: [{ at: '2026-11-17T00:00:00.000Z', by: 'kaden', what: 'drafted' }], ...over,
  }
}

describe('quote stores', () => {
  it('quotes live in Postgres', () => {
    expect(PG_STORES.has('quotes')).toBe(true)
  })

  it('settings default, save, and refuse a stale save', async () => {
    const s0 = await getSettings()
    expect(s0.capPct).toBe(DEFAULT_SETTINGS.capPct)
    const s1 = await saveSettings({ capPct: 30 }, s0.updatedAt)
    expect((await getSettings()).capPct).toBe(30)
    await expect(saveSettings({ capPct: 20 }, s0.updatedAt)).rejects.toMatchObject({ why: 'stale' })
    await expect(saveSettings({ capPct: 20, yellowFromPct: 25 }, s1.updatedAt)).rejects.toBeInstanceOf(QuoteStoreError)
  })

  it('menu items and packages round-trip', async () => {
    await saveMenuItems(() => [{ id: 'i1', source: 'own', name: 'Travel', photoUrl: null, cents: 5000, per: 'event', costCents: null, tags: [], hidden: false, updatedAt: '' }], '2026-11-17T00:00:00.000Z')
    const m = await getMenu()
    expect(m.items.map((i) => i.name)).toEqual(['Travel'])
    expect(m.syncedAt).toBe('2026-11-17T00:00:00.000Z')
    await savePackage({ id: 'p1', name: 'Holiday Glow', photoUrl: null, lines: [], savedAt: '', by: 'kaden' })
    expect((await listPackages()).map((p) => p.id)).toContain('p1')
    await deletePackage('p1')
    expect((await listPackages()).map((p) => p.id)).not.toContain('p1')
  })

  it('creates, finds by token and request, and updates a quote', async () => {
    const q = await createQuote(quote())
    expect(q.token).toMatch(/^[0-9a-f]{32}$/)
    expect(newToken()).not.toBe(q.token)
    expect(q.partyId).toMatch(/^pty_[0-9a-f]{16}$/)
    expect((await getQuoteByToken(q.token))?.id).toBe(q.id)
    expect(await getQuoteByToken('nope')).toBeNull()
    expect((await getQuoteForRequest(q.requestId))?.id).toBe(q.id)
    const u = await updateQuote(q.id, (cur) => ({ ...cur, note: 'hi' }))
    expect(u.note).toBe('hi')
    const same = await updateQuote(q.id, () => null)
    expect(same.note).toBe('hi')
    expect((await getQuote(q.id))?.note).toBe('hi')
    await expect(createQuote(q)).rejects.toThrow()
  })
})
