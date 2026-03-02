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
  lineItems: LineItem[]
  discounts: Discount[]
  totalAmount: number          // cents
  currency: string
  status: 'draft' | 'open' | 'completed' | 'cancelled'
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
  }): Promise<Order>

  processPayment(params: {
    orderId: string
    paymentToken: string
    amount: number
    currency: string
  }): Promise<Payment>

  getClientConfig(): PaymentClientConfig
}
