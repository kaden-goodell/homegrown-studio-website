import { describe, it, expect, vi } from 'vitest'

let preview = true
vi.mock('@lib/deploy-context', () => ({ isPreviewOrDev: () => preview }))

import { saveMintedGiftCard, listMintedGiftCards, validateMint, type MintedGiftCard } from '@lib/gift-cards'

function card(id: string, at: string): MintedGiftCard {
  return { id, giftCardId: 'gc-sq', gan: '7783', amountCents: 2500, forWhom: 'Megan', note: '', by: { id: 't', name: 'Test' }, at }
}

describe('gift-cards store', () => {
  it('lists newest first', async () => {
    const t = Date.now()
    const a = `gc_a${t}`, b = `gc_b${t}`
    await saveMintedGiftCard(card(a, '2090-01-01T00:00:00.000Z'))
    await saveMintedGiftCard(card(b, '2090-01-02T00:00:00.000Z'))
    const ids = (await listMintedGiftCards()).map((c) => c.id)
    expect(ids.indexOf(b)).toBeLessThan(ids.indexOf(a))
    expect(ids.indexOf(b)).toBeGreaterThanOrEqual(0)
  })

  it('hides simulated cards outside preview and dev, and shows them inside', async () => {
    const t = Date.now()
    const real = `gc_real${t}`, sim = `gc_sim${t}`
    await saveMintedGiftCard(card(real, '2090-02-01T00:00:00.000Z'))
    await saveMintedGiftCard({ ...card(sim, '2090-02-02T00:00:00.000Z'), simulated: true })
    try {
      preview = false
      const prodIds = (await listMintedGiftCards()).map((c) => c.id)
      expect(prodIds).toContain(real)
      expect(prodIds).not.toContain(sim)
      preview = true
      expect((await listMintedGiftCards()).map((c) => c.id)).toContain(sim)
    } finally {
      preview = true
    }
  })
})

describe('validateMint', () => {
  it('rejects bad amounts', () => {
    for (const amountDollars of [0, 501, 12.5, '25', undefined]) {
      expect(validateMint({ amountDollars, forWhom: 'Megan' }).ok).toBe(false)
    }
  })
  it('requires forWhom of 1..80 chars', () => {
    expect(validateMint({ amountDollars: 25 }).ok).toBe(false)
    expect(validateMint({ amountDollars: 25, forWhom: 'x'.repeat(81) }).ok).toBe(false)
  })
  it('limits note to 200', () => {
    expect(validateMint({ amountDollars: 25, forWhom: 'M', note: 'x'.repeat(201) }).ok).toBe(false)
  })
  it('accepts a good body', () => {
    expect(validateMint({ amountDollars: 25, forWhom: 'Megan' })).toEqual({ ok: true, value: { amountCents: 2500, forWhom: 'Megan', note: '' } })
  })
})
