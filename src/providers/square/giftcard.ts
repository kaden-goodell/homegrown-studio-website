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

export class SquareGiftCardProvider implements GiftCardProvider {
  private client: ReturnType<typeof createSquareClient>
  private locationId: string

  constructor(config: SquareConfig, client: ReturnType<typeof createSquareClient> = createSquareClient(config)) {
    this.client = client
    this.locationId = config.locationId
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
