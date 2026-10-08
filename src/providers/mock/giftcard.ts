import type { GiftCard, GiftCardProvider } from '@providers/interfaces/giftcard'

/** In-memory gift cards for mock mode and tests. */
export class MockGiftCardProvider implements GiftCardProvider {
  private byId = new Map<string, GiftCard>()
  private byGan = new Map<string, GiftCard>()
  private counter = 0

  private newGan(): string {
    let digits = ''
    for (let i = 0; i < 12; i++) digits += Math.floor(Math.random() * 10)
    return '7783' + digits
  }

  private store(card: GiftCard): GiftCard {
    this.byId.set(card.id, card)
    this.byGan.set(card.gan, card)
    return card
  }

  async mint({ amountCents }: { amountCents: number; idempotencyKey: string }): Promise<GiftCard> {
    this.counter += 1
    return this.store({ id: `mock-gc-${this.counter}`, gan: this.newGan(), balanceCents: amountCents, state: 'ACTIVE' })
  }

  async get(id: string): Promise<GiftCard | null> {
    return this.byId.get(id) ?? null
  }

  async fromGan(gan: string): Promise<GiftCard | null> {
    return this.byGan.get(gan) ?? null
  }

  async fromNonce(nonce: string): Promise<GiftCard | null> {
    if (nonce.startsWith('mock-gift:')) return this.byGan.get(nonce.slice('mock-gift:'.length)) ?? null
    if (nonce.startsWith('mock-gift-cents:')) {
      const cents = Number(nonce.slice('mock-gift-cents:'.length))
      if (!Number.isFinite(cents) || cents < 0) return null
      return this.mint({ amountCents: cents, idempotencyKey: nonce })
    }
    return null
  }
}
