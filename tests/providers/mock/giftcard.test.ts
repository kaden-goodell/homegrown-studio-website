import { describe, it, expect } from 'vitest'
import { MockGiftCardProvider } from '@providers/mock/giftcard'

describe('MockGiftCardProvider', () => {
  it('mints a card with the balance and remembers it by id, gan and nonce', async () => {
    const p = new MockGiftCardProvider()
    const card = await p.mint({ amountCents: 2500, idempotencyKey: 'k1' })
    expect(card.balanceCents).toBe(2500)
    expect(card.gan).toMatch(/^\d{16}$/)
    expect(await p.get(card.id)).toEqual(card)
    expect(await p.fromGan(card.gan)).toEqual(card)
    expect(await p.fromNonce(`mock-gift:${card.gan}`)).toEqual(card)
  })
  it('treats a fixed-balance test token as a card: mock-gift-cents:1500 has $15', async () => {
    const p = new MockGiftCardProvider()
    const card = await p.fromNonce('mock-gift-cents:1500')
    expect(card?.balanceCents).toBe(1500)
  })
  it('returns null for a card token', async () => {
    expect(await new MockGiftCardProvider().fromNonce('cnon:card')).toBeNull()
  })
})
