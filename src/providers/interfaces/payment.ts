export interface LineItem {
  catalogObjectId?: string
  name: string
  quantity: number
  pricePerUnit: number         // cents
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
    customerId: string
    lineItems: LineItem[]
    discounts?: Discount[]
    /** Optional pickup fulfillment (kits are picked up in-studio, not shipped). */
    fulfillment?: { type: 'PICKUP'; pickupAt: string; recipientName: string }
  }): Promise<Order>

  processPayment(params: {
    orderId: string
    paymentToken: string
    amount: number
    currency: string
    buyerEmailAddress?: string
  }): Promise<Payment>

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
