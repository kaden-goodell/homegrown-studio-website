import type {
  PaymentProvider,
  PaymentClientConfig,
  Order,
  Payment,
  Refund,
  LineItem,
  Discount,
  SavedCard,
  OrderPaymentStatus,
} from '../interfaces/payment'
import { taxCents } from '../../lib/tax'

export class MockPaymentProvider implements PaymentProvider {
  private nextId = 1
  /** Completed payments by order, so findOrderPayment can answer. */
  private paid = new Map<string, Payment>()

  /** Records of calls, for test assertions. */
  refundCalls: { paymentId: string; amountCents: number; idempotencyKey: string; reason?: string }[] = []
  cancelOrderCalls: { orderId: string; version: number; locationId: string }[] = []

  /**
   * Saved cards (stage 4), as Square would keep them. Source tokens that steer
   * the mock: 'FAIL' → the save is refused (CARD_DECLINED); 'DECLINE_LATER' →
   * saved, but a later charge is declined; 'NO_FUNDS_LATER' → a later charge
   * fails with INSUFFICIENT_FUNDS; 'TIMEOUT_LATER' → a later charge never answers
   * (and charges nothing); 'LOST_REPLY_LATER' → a later charge DOES charge, but
   * the reply is lost (TimeoutError); a retry with the same key returns that
   * payment and findOrderPayment finds it, as Square does (M7);
   * 'SETUP_LATER' → a later charge is refused as a setup problem (401, I3);
   * 'SETUP' → the save itself is refused as a setup problem.
   */
  savedCards = new Map<string, SavedCard & { customerId: string; referenceId: string; enabled: boolean; behaviour: string }>()
  saveCardCalls: Parameters<PaymentProvider['saveCard']>[0][] = []
  disableCardCalls: string[] = []
  chargeSavedCardCalls: Parameters<PaymentProvider['chargeSavedCard']>[0][] = []
  private cardKeys = new Map<string, string>()
  private chargeKeys = new Map<string, Payment>()

  /** Catalog variation id -> price in cents, for createClassOrder (default 0). */
  prices: Record<string, number> = {}
  classOrderCalls: Parameters<PaymentProvider['createClassOrder']>[0][] = []

  async createClassOrder(params: Parameters<PaymentProvider['createClassOrder']>[0]) {
    this.classOrderCalls.push(params)
    // Line discounts come off their own line before its 9%, as Square does with LINE_ITEM discounts.
    const lineTotals = params.lines.map((l, i) => {
      const price = this.prices[l.catalogObjectId] ?? 0
      const off = (params.lineDiscounts ?? []).filter((d) => d.line === i).reduce((s, d) => s + Math.max(0, d.cents), 0)
      const net = Math.max(0, price - off)
      const tax = taxCents(net, 9)
      return { uid: this.generateId('mock-line'), totalCents: net + tax, taxCents: tax }
    })
    const sum = lineTotals.reduce((s, l) => s + l.totalCents, 0)
    return {
      orderId: this.generateId('mock-order'),
      totalCents: sum,
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

  async saveCard(input: Parameters<PaymentProvider['saveCard']>[0]): Promise<SavedCard> {
    this.saveCardCalls.push({ ...input })
    const again = this.cardKeys.get(input.idempotencyKey)
    if (again) return this.faceOf(again)
    if (input.sourceToken === 'FAIL') throw squareRefusal(400, 'CARD_DECLINED', 'The card was declined.')
    if (input.sourceToken === 'SETUP') throw squareRefusal(401, 'ACCESS_TOKEN_EXPIRED', 'The access token has expired.', 'AUTHENTICATION_ERROR')
    const cardId = this.generateId('mock-card')
    this.savedCards.set(cardId, {
      cardId, brand: 'VISA', last4: '4242', expMonth: 12, expYear: new Date().getUTCFullYear() + 3,
      customerId: input.customerId, referenceId: input.referenceId, enabled: true, behaviour: input.sourceToken,
    })
    this.cardKeys.set(input.idempotencyKey, cardId)
    return this.faceOf(cardId)
  }

  async disableCard(cardId: string): Promise<void> {
    this.disableCardCalls.push(cardId)
    const card = this.savedCards.get(cardId)
    if (card) card.enabled = false
  }

  async chargeSavedCard(input: Parameters<PaymentProvider['chargeSavedCard']>[0]): Promise<Payment> {
    this.chargeSavedCardCalls.push({ ...input })
    const again = this.chargeKeys.get(input.idempotencyKey)
    if (again) return again
    const card = this.savedCards.get(input.cardId)
    if (!card || card.customerId !== input.customerId) throw squareRefusal(404, 'NOT_FOUND', 'Card not found.')
    if (!card.enabled) throw squareRefusal(400, 'CARD_DECLINED', 'The card is disabled.')
    if (card.behaviour === 'DECLINE_LATER') throw squareRefusal(400, 'CARD_DECLINED', 'The card was declined.')
    if (card.behaviour === 'NO_FUNDS_LATER') throw squareRefusal(400, 'INSUFFICIENT_FUNDS', 'Insufficient funds.')
    if (card.behaviour === 'TIMEOUT_LATER') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    if (card.behaviour === 'SETUP_LATER') throw squareRefusal(401, 'ACCESS_TOKEN_EXPIRED', 'The access token has expired.', 'AUTHENTICATION_ERROR')
    const id = this.generateId('mock-payment')
    const payment: Payment = { id, orderId: input.orderId, amount: input.amount, status: 'completed', receiptUrl: `https://mock-receipt.example.com/${id}` }
    this.paid.set(input.orderId, payment)
    this.chargeKeys.set(input.idempotencyKey, payment)
    // Charged, but the answer never arrives: the caller must treat it as unknown and look again.
    if (card.behaviour === 'LOST_REPLY_LATER') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    return payment
  }

  private faceOf(cardId: string): SavedCard {
    const c = this.savedCards.get(cardId)!
    return { cardId: c.cardId, brand: c.brand, last4: c.last4, expMonth: c.expMonth, expYear: c.expYear }
  }

  async findOrderPayment(orderId: string): Promise<Payment | null> {
    return this.paid.get(orderId) ?? null
  }

  /** Tests set an order's not-yet-final or failed payment here (paid orders answer from charges). */
  orderStates = new Map<string, Exclude<OrderPaymentStatus['state'], 'paid'>>()
  orderPaymentStatusCalls: { orderId: string; since?: string; last4?: string }[] = []

  async orderPaymentStatus(input: { orderId: string; since?: string; last4?: string }): Promise<OrderPaymentStatus> {
    this.orderPaymentStatusCalls.push({ ...input })
    const paid = await this.findOrderPayment(input.orderId)
    if (paid?.status === 'completed') return { state: 'paid', payment: paid }
    const state = this.orderStates.get(input.orderId) ?? 'none'
    if (state === 'none') return { state }
    return { state, payment: { id: `mock-payment-${state}`, orderId: input.orderId, amount: 0, status: state === 'failed' ? 'failed' : 'pending' } }
  }

  async refundPayment(input: {
    paymentId: string
    amountCents: number
    idempotencyKey: string
    reason?: string
  }): Promise<Refund> {
    this.refundCalls.push({ ...input })

    return {
      id: this.generateId('mock-refund'),
      paymentId: input.paymentId,
      amountCents: input.amountCents,
      status: 'COMPLETED',
    }
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

/** A refusal shaped like Square's (what chargeOutcomeOf and squareErrorCodes read). */
function squareRefusal(statusCode: number, code: string, detail: string, category = code === 'NOT_FOUND' ? 'INVALID_REQUEST_ERROR' : 'PAYMENT_METHOD_ERROR'): Error {
  return Object.assign(new Error(`Square said: ${detail}`), { status: statusCode, statusCode, errors: [{ code, detail, category }] })
}
