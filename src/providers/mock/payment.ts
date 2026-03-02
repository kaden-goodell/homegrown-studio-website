import type {
  PaymentProvider,
  PaymentClientConfig,
  Order,
  Payment,
  LineItem,
  Discount,
} from '../interfaces/payment'

export class MockPaymentProvider implements PaymentProvider {
  private nextId = 1

  private generateId(prefix: string): string {
    return `${prefix}-${this.nextId++}`
  }

  async createOrder(params: {
    locationId: string
    customerId: string
    lineItems: LineItem[]
    discounts?: Discount[]
  }): Promise<Order> {
    const discounts = params.discounts ?? []

    let total = params.lineItems.reduce(
      (sum, item) => sum + item.quantity * item.pricePerUnit,
      0,
    )

    for (const discount of discounts) {
      if (discount.type === 'percent') {
        total = Math.round(total * (1 - discount.value / 100))
      } else {
        total -= discount.value
      }
    }

    return {
      id: this.generateId('mock-order'),
      lineItems: params.lineItems,
      discounts,
      totalAmount: total,
      currency: 'USD',
      status: 'open',
    }
  }

  async processPayment(params: {
    orderId: string
    paymentToken: string
    amount: number
    currency: string
  }): Promise<Payment> {
    const id = this.generateId('mock-payment')

    if (params.paymentToken === 'FAIL') {
      return {
        id,
        orderId: params.orderId,
        amount: params.amount,
        status: 'failed',
      }
    }

    return {
      id,
      orderId: params.orderId,
      amount: params.amount,
      status: 'completed',
      receiptUrl: `https://mock-receipt.example.com/${id}`,
    }
  }

  getClientConfig(): PaymentClientConfig {
    return {
      appId: 'mock-app-id',
      locationId: 'mock-location-id',
      environment: 'sandbox',
    }
  }
}
