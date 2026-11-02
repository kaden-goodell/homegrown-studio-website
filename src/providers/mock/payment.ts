import type {
  PaymentProvider,
  PaymentClientConfig,
  Order,
  Payment,
  Refund,
  LineItem,
  Discount,
  PaymentState,
  RefundState,
} from '../interfaces/payment'
import { taxCents } from '../../lib/tax'

export class MockPaymentProvider implements PaymentProvider {
  private nextId = 1
  /** Completed payments by order, so findOrderPayment can answer. */
  private paid = new Map<string, Payment>()

  /** Records of calls, for test assertions. */
  refundCalls: { paymentId: string; amountCents: number; idempotencyKey: string; reason?: string }[] = []
  cancelOrderCalls: { orderId: string; version: number; locationId: string }[] = []

  /** Catalog variation id -> price in cents, for createClassOrder (default 0). */
  prices: Record<string, number> = {}
  classOrderCalls: Parameters<PaymentProvider['createClassOrder']>[0][] = []

  async createClassOrder(params: Parameters<PaymentProvider['createClassOrder']>[0]) {
    this.classOrderCalls.push(params)
    const lineTotals = params.lines.map((l) => {
      const price = this.prices[l.catalogObjectId] ?? 0
      const tax = taxCents(price, 9)
      return { uid: this.generateId('mock-line'), totalCents: price + tax, taxCents: tax }
    })
    const sum = lineTotals.reduce((s, l) => s + l.totalCents, 0)
    return {
      orderId: this.generateId('mock-order'),
      totalCents: Math.max(0, sum - (params.discount?.cents ?? 0)),
      lineUids: lineTotals.map((l) => l.uid),
      lineTotals,
    }
  }

  private generateId(prefix: string): string {
    return `${prefix}-${this.nextId++}`
  }

  async createOrder(params: {
    locationId: string
    customerId?: string | null
    lineItems: LineItem[]
    discounts?: Discount[]
    fulfillment?: { type: 'PICKUP'; pickupAt: string; recipientName: string }
    idempotencyKey?: string
    referenceId?: string
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
      version: 1,
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

    const payment: Payment = {
      id,
      orderId: params.orderId,
      amount: params.amount,
      status: 'completed',
      receiptUrl: `https://mock-receipt.example.com/${id}`,
    }
    this.paid.set(params.orderId, payment)
    return payment
  }

  async findOrderPayment(orderId: string): Promise<Payment | null> {
    return this.paid.get(orderId) ?? null
  }

  async refundPayment(input: {
    paymentId: string
    amountCents: number
    idempotencyKey: string
    reason?: string
  }): Promise<Refund> {
    this.refundCalls.push({ ...input })
    // The same key gives back the same refund, as Square does.
    const again = this.refundsByKey.get(input.idempotencyKey)
    if (again) return { id: again.id, paymentId: again.paymentId, amountCents: again.amountCents, status: again.status }
    const refund: RefundState = { id: this.generateId('mock-refund'), paymentId: input.paymentId, amountCents: input.amountCents, status: 'COMPLETED', createdAt: new Date().toISOString() }
    this.refundsByKey.set(input.idempotencyKey, refund)
    return { id: refund.id, paymentId: refund.paymentId, amountCents: refund.amountCents, status: refund.status }
  }

  private refundsByKey = new Map<string, RefundState>()

  async readPayment(paymentId: string): Promise<PaymentState> {
    const pay = [...this.paid.values()].find((p) => p.id === paymentId)
    const refunds = [...this.refundsByKey.values()].filter((r) => r.paymentId === paymentId)
    return {
      id: paymentId, orderId: pay?.orderId ?? null, status: 'COMPLETED', amountCents: pay?.amount ?? 0,
      refundedCents: refunds.filter((r) => r.status === 'COMPLETED').reduce((s, r) => s + r.amountCents, 0), refunds, createdAt: null,
    }
  }

  async readRefund(refundId: string): Promise<RefundState | null> {
    return [...this.refundsByKey.values()].find((r) => r.id === refundId) ?? null
  }

  async findOrderByReference(): Promise<{ orderId: string } | null> {
    return null
  }

  async cancelOrder(input: { orderId: string; version: number; locationId: string }): Promise<void> {
    this.cancelOrderCalls.push({ ...input })
  }

  getClientConfig(): PaymentClientConfig {
    return {
      appId: 'mock-app-id',
      locationId: 'mock-location-id',
      environment: 'sandbox',
    }
  }
}
