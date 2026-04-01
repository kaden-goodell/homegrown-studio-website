export interface GiftCard {
  id: string
  ganCode: string          // The gift card number (GAN)
  balanceCents: number
  state: 'ACTIVE' | 'DEACTIVATED' | 'PENDING'
}

export interface GiftCardProvider {
  /** Create a new gift card, activate it with the given amount, and link to a customer */
  createAndLink(params: {
    amountCents: number
    customerId: string
    locationId: string
  }): Promise<GiftCard>

  /** Deactivate a gift card (for refunds/cancellations) */
  deactivate(giftCardId: string): Promise<void>
}
