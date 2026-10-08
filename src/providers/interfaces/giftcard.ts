export interface GiftCard {
  id: string
  /** The 16-digit gift card number */
  gan: string
  balanceCents: number
  state: 'ACTIVE' | 'DEACTIVATED' | 'PENDING' | 'NOT_ACTIVE'
}

export interface GiftCardProvider {
  /** Create a DIGITAL card and load a promotional balance (ADJUST_INCREMENT, COMPLIMENTARY). No money moves. */
  mint(params: { amountCents: number; idempotencyKey: string }): Promise<GiftCard>
  /** Card by id (balance is live). */
  get(id: string): Promise<GiftCard | null>
  /** Card behind a Web Payments token (cnon:...). Null when the token is not a gift card. */
  fromNonce(nonce: string): Promise<GiftCard | null>
  /** Card by its 16-digit number. Null when unknown. */
  fromGan(gan: string): Promise<GiftCard | null>
}
