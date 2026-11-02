import { createLogger } from '../../lib/logger'
import type {
  PaymentProvider,
  LineItem,
  Discount,
  Order,
  Payment,
  Refund,
  PaymentClientConfig,
  SavedCard,
  OrderPaymentStatus,
} from '../interfaces/payment'
import type { SquareConfig } from '../../config/site.config'
import { createSquareClient } from './client'
import { squareFetch } from '../../lib/classes/square-api'

const logger = createLogger('square-payment')

const STATUS_MAP: Record<string, Order['status']> = {
  DRAFT: 'draft',
  OPEN: 'open',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
}

const PAYMENT_STATUS_MAP: Record<string, Payment['status']> = {
  COMPLETED: 'completed',
  FAILED: 'failed',
}

/** A saved-card charge: CANCELED is as final a "not charged" as FAILED. */
const SAVED_CHARGE_STATUS_MAP: Record<string, Payment['status']> = { ...PAYMENT_STATUS_MAP, CANCELED: 'failed' }

/** Square payment status → waitlist answer (I1). */
const ORDER_PAYMENT_STATE: Record<string, OrderPaymentStatus['state']> = {
  COMPLETED: 'paid', APPROVED: 'going-through', PENDING: 'going-through', FAILED: 'failed', CANCELED: 'failed',
}
const STATE_RANK: Record<OrderPaymentStatus['state'], number> = { paid: 3, 'going-through': 2, failed: 1, none: 0 }

/** Square's tightest idempotency key limit (payments, cards). */
const MAX_IDEMPOTENCY_KEY = 45

function checkKey(key: string): void {
  if (!key || key.length > MAX_IDEMPOTENCY_KEY) throw new Error(`An idempotency key must be 1 to ${MAX_IDEMPOTENCY_KEY} characters.`)
}

/**
 * A raw REST refusal (squareFetch attaches `status` and Square's `errors`) in
 * the shape chargeOutcomeOf and squareErrorCodes read: `statusCode` + `errors`.
 * A timeout or network failure has no status and stays unknown.
 */
function asSquareError(e: unknown): unknown {
  const err = e as { status?: unknown; statusCode?: unknown } | null
  if (err && typeof err === 'object' && typeof err.status === 'number' && err.statusCode === undefined) {
    Object.assign(err, { statusCode: err.status })
  }
  return e
}

/**
 * Sent on every saved-card charge: seller-initiated (the buyer isn't here;
 * they agreed when the card was saved). NOT proven yet (Task 12 sandbox proof
 * 3). If the sandbox refuses it, set this to null and the field is left off;
 * nothing else changes. A refusal of it classifies as 'setup' (saved-cards.ts),
 * so it can never be read as a family's card being declined.
 */
export const SAVED_CARD_CUSTOMER_DETAILS: Record<string, unknown> | null = { customer_initiated: false, seller_keyed_in: false }

function savedCardOf(card: any): SavedCard {
  if (!card?.id) throw new Error('Square returned a card without an id.')
  return {
    cardId: String(card.id),
    brand: String(card.card_brand ?? 'OTHER_BRAND'),
    last4: String(card.last_4 ?? ''),
    expMonth: Number(card.exp_month ?? 0),
    expYear: Number(card.exp_year ?? 0),
  }
}

export class SquarePaymentProvider implements PaymentProvider {
  private client: ReturnType<typeof createSquareClient>
  private config: SquareConfig

  constructor(config: SquareConfig) {
    this.config = config
    this.client = createSquareClient(config)
  }

  async createClassOrder(params: Parameters<PaymentProvider['createClassOrder']>[0]) {
    const order: Record<string, any> = {
      location_id: params.locationId,
      reference_id: params.referenceId,
      line_items: params.lines.map((l, i) => ({
        uid: `l${i}`,
        catalog_object_id: l.catalogObjectId,
        quantity: '1',
        note: l.note.slice(0, 500),
      })),
      pricing_options: { auto_apply_taxes: true },
    }
    if (params.customerId) order.customer_id = params.customerId
    // S4-R1: one fixed-amount LINE_ITEM discount per discount per line, applied to that line only.
    const discounts: any[] = []
    const perLine = new Map<number, number>()
    for (const d of params.lineDiscounts ?? []) {
      if (!Number.isInteger(d.line) || d.line < 0 || d.line >= params.lines.length) throw new Error(`A discount points at order line ${d.line}, which isn't there.`)
      if (!Number.isInteger(d.cents) || d.cents <= 0) continue
      const k = perLine.get(d.line) ?? 0
      perLine.set(d.line, k + 1)
      const uid = `d${d.line}-${k}`
      discounts.push({ uid, name: d.name.slice(0, 255), type: 'FIXED_AMOUNT', amount_money: { amount: d.cents, currency: 'USD' }, scope: 'LINE_ITEM' })
      const item = order.line_items[d.line]
      item.applied_discounts = [...(item.applied_discounts ?? []), { discount_uid: uid }]
    }
    if (discounts.length) order.discounts = discounts
    const res = await squareFetch('/orders', {
      method: 'POST',
      body: JSON.stringify({ idempotency_key: params.idempotencyKey, order }),
    })
    const o = res?.order ?? {}
    if (!o.id) throw new Error('Square returned an order without an id.')
    const items: any[] = o.line_items ?? []
    if (items.length !== params.lines.length) {
      throw new Error(`Square returned ${items.length} order lines for ${params.lines.length} requested.`)
    }
    const byUid = new Map<string, any>(items.map((i) => [String(i.uid), i]))
    const lineTotals = params.lines.map((_, i) => {
      const it = byUid.get(`l${i}`)
      if (!it) throw new Error(`Square's order is missing line l${i}.`)
      return {
        uid: `l${i}`,
        totalCents: Number(it.total_money?.amount ?? 0),
        taxCents: Number(it.total_tax_money?.amount ?? 0),
      }
    })
    return {
      orderId: String(o.id),
      totalCents: Number(o.total_money?.amount ?? 0),
      lineUids: lineTotals.map((l) => l.uid),
      lineTotals,
    }
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
    logger.info('Creating order', {
      locationId: params.locationId,
      customerId: params.customerId,
      lineItemCount: params.lineItems.length,
    })

    const lineItems = params.lineItems.map((item) => {
      const base: Record<string, any> = {
        quantity: String(item.quantity),
        basePriceMoney: {
          amount: BigInt(item.pricePerUnit),
          currency: 'USD',
        },
      }
      if (item.catalogObjectId) {
        base.catalogObjectId = item.catalogObjectId
      } else {
        base.name = item.name
      }
      if (item.note) base.note = item.note.slice(0, 500)
      return base
    })

    const discounts = (params.discounts ?? []).map((discount) => {
      const base: Record<string, any> = {
        name: discount.name,
        scope: discount.scope === 'order' ? 'ORDER' : 'LINE_ITEM',
      }
      if (discount.type === 'percent') {
        base.discountType = 'FIXED_PERCENTAGE'
        base.percentage = String(discount.value)
      } else {
        base.discountType = 'FIXED_AMOUNT'
        base.amountMoney = {
          amount: BigInt(discount.value),
          currency: 'USD',
        }
      }
      return base
    })

    const fulfillments = params.fulfillment
      ? [
          {
            type: 'PICKUP',
            pickupDetails: {
              pickupAt: params.fulfillment.pickupAt,
              recipient: { displayName: params.fulfillment.recipientName },
            },
          },
        ]
      : undefined

    const response = await this.client.orders.create({
      ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
      order: {
        locationId: params.locationId,
        ...(params.customerId ? { customerId: params.customerId } : {}),
        ...(params.referenceId ? { referenceId: params.referenceId } : {}),
        lineItems: lineItems as any,
        discounts: discounts.length > 0 ? discounts as any : undefined,
        fulfillments: fulfillments as any,
      },
    })

    const order = response.order!

    logger.info('Order created', { orderId: order.id })

    return {
      id: order.id!,
      version: order.version!,
      lineItems: params.lineItems,
      discounts: params.discounts ?? [],
      totalAmount: Number(order.totalMoney!.amount!),
      currency: String(order.totalMoney!.currency!),
      status: STATUS_MAP[order.state as string] ?? 'open',
    }
  }

  async processPayment(params: {
    orderId: string
    paymentToken: string
    amount: number
    currency: string
    buyerEmailAddress?: string
    idempotencyKey?: string
    customerId?: string
    verificationToken?: string
  }): Promise<Payment> {
    logger.info('Processing payment', {
      orderId: params.orderId,
      amount: params.amount,
    })

    const response = await this.client.payments.create({
      sourceId: params.paymentToken,
      idempotencyKey: params.idempotencyKey ?? crypto.randomUUID(),
      amountMoney: {
        amount: BigInt(params.amount),
        currency: params.currency as any,
      },
      orderId: params.orderId,
      buyerEmailAddress: params.buyerEmailAddress,
      // Only when given (stage 4): a card on file needs the customer; SCA the verifyBuyer token.
      ...(params.customerId ? { customerId: params.customerId } : {}),
      ...(params.verificationToken ? { verificationToken: params.verificationToken } : {}),
    })

    const payment = response.payment!

    logger.info('Payment processed', {
      paymentId: payment.id,
      status: payment.status,
    })

    return {
      id: payment.id!,
      orderId: params.orderId,
      amount: params.amount,
      status: PAYMENT_STATUS_MAP[payment.status as string] ?? 'pending',
      receiptUrl: payment.receiptUrl ?? undefined,
    }
  }

  // ── Saved cards (stage 4, Cards API, raw REST at SQUARE_API_VERSION) ──────
  // Nothing here sees a card number: the browser's card form turns it into a
  // one-time token, Square stores the card, and we keep only its id and face.

  async saveCard(input: { customerId: string; sourceToken: string; verificationToken: string | null; idempotencyKey: string; referenceId: string }): Promise<SavedCard> {
    checkKey(input.idempotencyKey)
    logger.info('Saving a card with Square', { customerId: input.customerId, referenceId: input.referenceId })
    const body: Record<string, unknown> = {
      idempotency_key: input.idempotencyKey,
      source_id: input.sourceToken,
      card: { customer_id: input.customerId, reference_id: input.referenceId.slice(0, 128) },
    }
    if (input.verificationToken) body.verification_token = input.verificationToken
    let res: any
    try {
      res = await squareFetch('/cards', { method: 'POST', body: JSON.stringify(body) })
    } catch (e) {
      throw asSquareError(e)
    }
    const card = savedCardOf(res?.card)
    logger.info('Card saved', { cardId: card.cardId, brand: card.brand })
    return card
  }

  async disableCard(cardId: string): Promise<void> {
    try {
      await squareFetch(`/cards/${encodeURIComponent(cardId)}/disable`, { method: 'POST' })
      logger.info('Card taken off file', { cardId })
    } catch (e) {
      const err = e as { status?: unknown; errors?: { code?: string }[]; message?: string }
      const codes = (err?.errors ?? []).map((x) => String(x?.code ?? ''))
      // Already gone or already off file: nothing to take off. Anything else is a real failure the caller retries.
      if (err?.status === 404 || codes.includes('NOT_FOUND') || codes.includes('CARD_DISABLED') || (err?.status === 400 && /disabled/i.test(err?.message ?? ''))) {
        logger.warn('Card to take off file was already off', { cardId, status: err?.status ?? null, codes: codes.join(',') })
        return
      }
      throw asSquareError(e)
    }
  }

  async chargeSavedCard(input: { orderId: string; cardId: string; customerId: string; amount: number; idempotencyKey: string; buyerEmailAddress?: string; note: string }): Promise<Payment> {
    checkKey(input.idempotencyKey)
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error('A saved-card charge needs a whole number of cents above zero.')
    logger.info('Charging a saved card', { orderId: input.orderId, cardId: input.cardId, amount: input.amount })
    const body: Record<string, unknown> = {
      idempotency_key: input.idempotencyKey,
      source_id: input.cardId,
      customer_id: input.customerId,
      order_id: input.orderId,
      amount_money: { amount: input.amount, currency: 'USD' },
      autocomplete: true,
      location_id: this.config.locationId,
      note: input.note.slice(0, 500),
      ...(SAVED_CARD_CUSTOMER_DETAILS ? { customer_details: SAVED_CARD_CUSTOMER_DETAILS } : {}),
    }
    if (input.buyerEmailAddress) body.buyer_email_address = input.buyerEmailAddress
    let res: any
    try {
      res = await squareFetch('/payments', { method: 'POST', body: JSON.stringify(body) })
    } catch (e) {
      throw asSquareError(e)
    }
    const payment = res?.payment
    if (!payment?.id) throw new Error('Square returned a payment without an id.')
    logger.info('Saved card charged', { paymentId: payment.id, status: payment.status })
    return {
      id: String(payment.id),
      orderId: input.orderId,
      amount: Number(payment.amount_money?.amount ?? input.amount),
      status: SAVED_CHARGE_STATUS_MAP[String(payment.status)] ?? 'pending',
      ...(payment.receipt_url ? { receiptUrl: String(payment.receipt_url) } : {}),
    }
  }

  async orderPaymentStatus(input: { orderId: string; since?: string; last4?: string }): Promise<OrderPaymentStatus> {
    // Raw REST (read only): the order's tenders, then each tender's payment.
    const res: any = await squareFetch(`/orders/${encodeURIComponent(input.orderId)}`)
    const seen: any[] = []
    for (const tender of res?.order?.tenders ?? []) {
      const paymentId = tender?.payment_id ?? tender?.id
      if (!paymentId) continue
      const p: any = await squareFetch(`/payments/${encodeURIComponent(paymentId)}`)
      if (p?.payment) seen.push(p.payment)
    }
    // Tenders can lag, and a FAILED payment is never tendered: also list the payments made since the try.
    if (!seen.length && input.since) {
      const q = new URLSearchParams({ begin_time: input.since, location_id: this.config.locationId, sort_order: 'ASC', limit: '100' })
      if (input.last4) q.set('last_4', input.last4)
      const list: any = await squareFetch(`/payments?${q.toString()}`)
      for (const p of list?.payments ?? []) if (p?.order_id === input.orderId) seen.push(p)
    }
    let best: OrderPaymentStatus = { state: 'none' }
    for (const p of seen) {
      const state = ORDER_PAYMENT_STATE[String(p.status)] ?? 'going-through'
      if (STATE_RANK[state] <= STATE_RANK[best.state]) continue
      best = {
        state,
        payment: {
          id: String(p.id), orderId: input.orderId, amount: Number(p.amount_money?.amount ?? 0),
          status: state === 'paid' ? 'completed' : state === 'failed' ? 'failed' : 'pending',
          ...(p.receipt_url ? { receiptUrl: String(p.receipt_url) } : {}),
          ...(p.created_at ? { createdAt: String(p.created_at) } : {}),
        },
      }
    }
    logger.info('Asked Square about an order\'s payment', { orderId: input.orderId, state: best.state })
    return best
  }

  async findOrderPayment(orderId: string): Promise<Payment | null> {
    const response = await this.client.orders.get({ orderId })
    const order = ((response as any)?.order ?? response) as any
    // A paid order lists what paid it; each entry carries the payment's id.
    for (const tender of order?.tenders ?? []) {
      const paymentId = tender?.paymentId ?? tender?.id
      if (!paymentId) continue
      const paymentResponse = await this.client.payments.get({ paymentId })
      const payment = ((paymentResponse as any)?.payment ?? paymentResponse) as any
      if (payment?.status !== 'COMPLETED') continue
      logger.info('Order already paid', { orderId, paymentId })
      return {
        id: payment.id ?? paymentId,
        orderId,
        amount: Number(payment.amountMoney?.amount ?? 0),
        status: 'completed',
        receiptUrl: payment.receiptUrl ?? undefined,
      }
    }
    return null
  }

  async refundPayment(input: {
    paymentId: string
    amountCents: number
    idempotencyKey: string
    reason?: string
  }): Promise<Refund> {
    logger.info('Refunding payment', {
      paymentId: input.paymentId,
      amountCents: input.amountCents,
    })

    const response = await this.client.refunds.refundPayment({
      idempotencyKey: input.idempotencyKey,
      paymentId: input.paymentId,
      amountMoney: {
        amount: BigInt(input.amountCents),
        currency: 'USD',
      },
      reason: input.reason,
    })

    const refund = response.refund!

    logger.info('Payment refunded', { refundId: refund.id, status: refund.status })

    return {
      id: refund.id!,
      paymentId: refund.paymentId!,
      amountCents: Number(refund.amountMoney!.amount!),
      status: String(refund.status),
    }
  }

  async cancelOrder(input: {
    orderId: string
    version: number
    locationId: string
  }): Promise<void> {
    logger.info('Cancelling order', { orderId: input.orderId, version: input.version })

    await this.client.orders.update({
      orderId: input.orderId,
      order: {
        locationId: input.locationId,
        version: input.version,
        state: 'CANCELED',
      },
    })

    logger.info('Order cancelled', { orderId: input.orderId })
  }

  getClientConfig(): PaymentClientConfig {
    return {
      appId: this.config.applicationId,
      locationId: this.config.locationId,
      environment: this.config.environment,
    }
  }
}
