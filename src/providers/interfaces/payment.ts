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
  }): Promise<Payment>

  /**
   * One Square order for a class booking: catalog lines, Square applies the
   * tax itself. lineUids / lineTotals follow the input line order.
   */
  createClassOrder(params: {
    locationId: string
    customerId: string | null
    idempotencyKey: string
    lines: { catalogObjectId: string; quantity: 1; note: string }[]
    discount?: { name: string; cents: number }
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
