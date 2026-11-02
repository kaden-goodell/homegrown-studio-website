import type { GiftCard, GiftCardProvider } from '@providers/interfaces/giftcard'
import type { SquareConfig } from '@config/site.config'
import { createLogger } from '@lib/logger'
import { createSquareClient } from './client'

const logger = createLogger('square-giftcard')

function toCard(raw: any): GiftCard {
  return {
    id: raw.id,
    gan: raw.gan ?? '',
    balanceCents: Number(raw.balanceMoney?.amount ?? 0),
    state: raw.state ?? 'PENDING',
  }
}

/** Square answers "no such card" as a thrown error; everything else is a real failure. */
function isNotFound(err: any): boolean {
  const errors = err?.errors ?? err?.body?.errors ?? []
  return (
    err?.statusCode === 404 ||
    errors.some((e: any) => e.code === 'NOT_FOUND' || e.category === 'NOT_FOUND' || e.category === 'INVALID_REQUEST_ERROR')
  )
}

/**
 * Square's documented sandbox gift-card test nonces. CreatePayment accepts them,
 * but no gift card stands behind them: RetrieveGiftCardFromNonce answers 404
 * "There is no giftcard associated with that nonce" (sandbox, 2026-11-02), so the
 * gift-card check before a hold refused the paying test card. In the sandbox only,
 * the ok nonce stands for an active card with plenty on it. Never consulted
 * against production.
 */
const SANDBOX_TEST_GIFT_CARDS: Record<string, number> = {
  'cnon:gift-card-nonce-ok': 100_000_00,
}

export class SquareGiftCardProvider implements GiftCardProvider {
  private client: ReturnType<typeof createSquareClient>
  private locationId: string
  private sandbox: boolean

  constructor(config: SquareConfig, client: ReturnType<typeof createSquareClient> = createSquareClient(config)) {
    this.client = client
    this.locationId = config.locationId
    this.sandbox = config.environment === 'sandbox'
  }

  /**
   * Create a DIGITAL card and ACTIVATE it with the amount in one step. Square
   * only accepts ADJUST_INCREMENT on a card that is already ACTIVE, so a fresh
   * card is loaded the way the crew-credit script does it (live-proven).
   */
  async mint({ amountCents, idempotencyKey }: { amountCents: number; idempotencyKey: string }): Promise<GiftCard> {
    const gc = this.client.giftCards
    const created = await gc.create({
      idempotencyKey: `${idempotencyKey}-create`,
      locationId: this.locationId,
      giftCard: { type: 'DIGITAL' },
    })
    const id = created.giftCard?.id
    if (!id) throw new Error('Square returned no gift card id')
    await gc.activities.create({
      idempotencyKey: `${idempotencyKey}-load`,
      giftCardActivity: {
        type: 'ACTIVATE',
        locationId: this.locationId,
        giftCardId: id,
        activateActivityDetails: {
          amountMoney: { amount: BigInt(amountCents), currency: 'USD' },
          buyerPaymentInstrumentIds: ['complimentary'],
        },
      },
    })
    const after = await gc.get({ id })
    logger.info('Gift card minted', { id, amountCents })
    return toCard(after.giftCard)
  }

  async get(id: string): Promise<GiftCard | null> {
    return this.lookup((gc) => gc.get({ id }))
  }

  async fromNonce(nonce: string): Promise<GiftCard | null> {
    if (this.sandbox && Object.hasOwn(SANDBOX_TEST_GIFT_CARDS, nonce)) {
      logger.warn('Sandbox test gift-card nonce: standing in for Square\'s card lookup', { nonce })
      return { id: `sandbox-test:${nonce}`, gan: '', balanceCents: SANDBOX_TEST_GIFT_CARDS[nonce], state: 'ACTIVE' }
    }
    return this.lookup((gc) => gc.getFromNonce({ nonce }))
  }

  async fromGan(gan: string): Promise<GiftCard | null> {
    return this.lookup((gc) => gc.getFromGan({ gan }))
  }

  private async lookup(
    call: (gc: ReturnType<typeof createSquareClient>['giftCards']) => Promise<{ giftCard?: unknown }>,
  ): Promise<GiftCard | null> {
    try {
      const r = await call(this.client.giftCards)
      return r?.giftCard ? toCard(r.giftCard) : null
    } catch (e) {
      if (isNotFound(e)) return null
      throw e
    }
  }
}
