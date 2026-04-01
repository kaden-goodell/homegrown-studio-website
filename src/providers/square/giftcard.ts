import type { GiftCard, GiftCardProvider } from '@providers/interfaces/giftcard'
import type { SquareConfig } from '@config/site.config'
import { createLogger } from '@lib/logger'
import { createSquareClient } from './client'

const logger = createLogger('square-giftcard')

export class SquareGiftCardProvider implements GiftCardProvider {
  private client: ReturnType<typeof createSquareClient>

  constructor(config: SquareConfig) {
    this.client = createSquareClient(config)
  }

  async createAndLink(params: {
    amountCents: number
    customerId: string
    locationId: string
  }): Promise<GiftCard> {
    const { amountCents, customerId, locationId } = params

    logger.info('Creating gift card', { amountCents, customerId, locationId })

    // Step 1: Create the digital gift card
    const createResult = await (this.client as any).giftCards.create({
      idempotencyKey: crypto.randomUUID(),
      locationId,
      type: 'DIGITAL',
    })

    const giftCardId = createResult.giftCard.id
    const ganCode = createResult.giftCard.gan

    logger.info('Gift card created', { giftCardId, ganCode })

    // Step 2: Activate with the deposit amount
    await (this.client as any).giftCardActivities.create({
      idempotencyKey: crypto.randomUUID(),
      giftCardActivity: {
        giftCardId,
        type: 'ACTIVATE',
        locationId,
        activateActivityDetails: {
          amountMoney: {
            amount: BigInt(amountCents),
            currency: 'USD',
          },
        },
      },
    })

    logger.info('Gift card activated', { giftCardId, amountCents })

    // Step 3: Link to customer profile so it shows up at POS
    await (this.client as any).giftCards.linkCustomer({
      giftCardId,
      customerId,
    })

    logger.info('Gift card linked to customer', { giftCardId, customerId })

    return {
      id: giftCardId,
      ganCode,
      balanceCents: amountCents,
      state: 'ACTIVE',
    }
  }

  async deactivate(giftCardId: string): Promise<void> {
    logger.info('Deactivating gift card', { giftCardId })

    await (this.client as any).giftCardActivities.create({
      idempotencyKey: crypto.randomUUID(),
      giftCardActivity: {
        giftCardId,
        type: 'DEACTIVATE',
        deactivateActivityDetails: {
          reason: 'SUSPICIOUS_ACTIVITY',
        },
      },
    })

    logger.info('Gift card deactivated', { giftCardId })
  }
}
