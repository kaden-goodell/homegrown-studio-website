export interface LineItem {
  catalogObjectId?: string
  name: string
  quantity: number
  pricePerUnit: number         // cents
  /** Shown on the order line (ad hoc lines: our package or extra id). */
  note?: string
}

export interface Discount {
  name: string
  type: 'percent' | 'fixed'
  value: number
  scope: 'order' | 'line_item'
  lineItemIndex?: number
}

export interface Order {
  id: string
  version: number              // Square order version; required to update/cancel
  lineItems: LineItem[]
  discounts: Discount[]
  totalAmount: number          // cents
  currency: string
  status: 'draft' | 'open' | 'completed' | 'cancelled'
}

export interface Refund {
  id: string
  paymentId: string
  amountCents: number
  status: string
}

export interface Payment {
  id: string
  orderId: string
  amount: number               // cents
  status: 'completed' | 'failed' | 'pending'
  receiptUrl?: string
}

/**
 * A card Square keeps on file for a customer (stage 4, waitlist). We keep only
 * these: Square's card id and what's printed on the card's face that a
 * person needs to recognise it. Never a number, CVV or token.
 */
export interface SavedCard {
  cardId: string
  /** Square's card_brand, e.g. 'VISA', 'MASTERCARD', 'AMERICAN_EXPRESS'. */
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

/**
 * What Square shows for the payment on one order (stage 4 waitlist, I1):
 *   paid           a COMPLETED payment
 *   going-through  an APPROVED or PENDING payment (not final yet)
 *   failed         only FAILED or CANCELED payments: a final "not charged"
 *   none           no payment for this order at all
 */
export interface OrderPaymentStatus {
  state: 'paid' | 'going-through' | 'failed' | 'none'
  /** The payment behind `state` (paid / going-through / failed). */
  payment?: Payment & { createdAt?: string }
}

export interface PaymentClientConfig {
  appId: string
  locationId: string
  environment: 'sandbox' | 'production'
}

export interface PaymentProvider {
  createOrder(params: {
    locationId: string
    /** Omitted or null: an order with no customer (the customer lookup failed; not fatal). */
    customerId?: string | null
    lineItems: LineItem[]
    discounts?: Discount[]
    /** Optional pickup fulfillment (kits are picked up in-studio, not shipped). */
    fulfillment?: { type: 'PICKUP'; pickupAt: string; recipientName: string }
    /** Makes the create safe to repeat (see BookingDetails.idempotencyKey). */
    idempotencyKey?: string
    /** Our own id for the order (parties: the party id 'pty_…'), so Square's events can be traced back. */
    referenceId?: string
  }): Promise<Order>

  processPayment(params: {
    orderId: string
    paymentToken: string
    amount: number
    currency: string
    buyerEmailAddress?: string
    /**
     * Makes the charge safe to repeat: sending the very same request again
     * returns the original payment and never charges twice. A retry with a
     * NEW payment token under the same key is refused by the backend, not
     * replayed, so callers ask findOrderPayment() what happened first.
     * Omitted → a fresh key per call.
     */
    idempotencyKey?: string
    /** Sent only when given: the Square customer the payment belongs to. */
    customerId?: string
    /** Sent only when given: the Web Payments SDK's verifyBuyer token (SCA). */
    verificationToken?: string
  }): Promise<Payment>

  /**
   * Save a card with Square for a customer (Cards API, CreateCard). The card
   * number is only ever typed into Square's card form; `sourceToken` is the
   * one-time token it gave, and `verificationToken` the verifyBuyer answer
   * with intent STORE (null when the buyer wasn't asked). `referenceId` is our
   * own id for why it's on file (a waitlist entry). Throws Square's refusal as
   * an error carrying `statusCode` and `errors` (see chargeOutcomeOf).
   */
  saveCard(input: { customerId: string; sourceToken: string; verificationToken: string | null; idempotencyKey: string; referenceId: string }): Promise<SavedCard>

  /** Take a saved card off file (DisableCard). Already disabled or not found → resolves (logged). */
  disableCard(cardId: string): Promise<void>

  /**
   * Charge a saved card without the buyer present (seller-initiated, with the
   * consent they gave when it was saved): CreatePayment with the card id as
   * the source, the customer, our order and autocomplete. The same key sent
   * again returns the first payment. A declined, disabled or missing card
   * throws a 4xx (chargeOutcomeOf → not charged); a timeout is unknown.
   *
   * M9, for Task 10: a retry MUST send the identical body for the same key
   * (`wl:{entryId}:{n}:pay`): same amount, same order, same note, same
   * customer_details. A different body under the same key is refused as
   * IDEMPOTENCY_KEY_REUSED, which is "unknown" for good. A new attempt n
   * (new keys, new order) is made only after a FINAL "not charged" (a 4xx, a
   * FAILED or CANCELED payment, or a charge never sent); otherwise the same
   * order, amount and keys are kept (orderPaymentStatus tells which). Classify refusals with cardTroubleOf: 'setup' stops the
   * run and never disables a card or tells a family (saved-cards.ts).
   */
  chargeSavedCard(input: { orderId: string; cardId: string; customerId: string; amount: number; idempotencyKey: string; buyerEmailAddress?: string; note: string }): Promise<Payment>

  /**
   * One Square order for a class booking: catalog lines, Square applies the
   * tax itself. lineUids / lineTotals follow the input line order.
   */
  createClassOrder(params: {
    locationId: string
    customerId: string | null
    idempotencyKey: string
    lines: { catalogObjectId: string; quantity: 1; note: string }[]
    /**
     * Stage 4 (S4-R1): money off single lines, each a LINE_ITEM-scoped fixed
     * amount applied to its line only (`line` indexes `lines`). Never an
     * ORDER-scoped discount, so Square never apportions anything.
     */
    lineDiscounts?: { line: number; name: string; cents: number }[]
    /** Our booking id. */
    referenceId: string
  }): Promise<{
    orderId: string
    totalCents: number
    lineUids: string[]
    lineTotals: { uid: string; totalCents: number; taxCents: number }[]
  }>

  /**
   * The completed payment on this order, or null if it has not been paid.
   * This is how a retried checkout learns whether its first try went through:
   * the backend is asked, nothing is remembered on our side.
   */
  findOrderPayment(orderId: string): Promise<Payment | null>

  /**
   * Stage 4 (waitlist I1): the real status of the latest payment on this
   * order, not only a completed one. Read only. Asks the order's tenders, and,
   * when they show nothing and `since` is given, also lists the location's
   * payments since then (with `last4`) and keeps those on this order, so an
   * APPROVED, PENDING, FAILED or CANCELED payment is seen too. Throws when
   * Square can't be asked.
   */
  orderPaymentStatus(input: { orderId: string; since?: string; last4?: string }): Promise<OrderPaymentStatus>

  refundPayment(input: {
    paymentId: string
    amountCents: number
    idempotencyKey: string
    reason?: string
  }): Promise<Refund>

  /** Void an order after a failed charge (kits: no orphaned orders). */
  cancelOrder(input: { orderId: string; version: number; locationId: string }): Promise<void>

  getClientConfig(): PaymentClientConfig
}
