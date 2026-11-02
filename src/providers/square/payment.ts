import { createLogger } from '../../lib/logger'
import type {
  PaymentProvider,
  LineItem,
  Discount,
  Order,
  Payment,
  Refund,
  PaymentClientConfig,
  PaymentState,
  RefundState,
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
    if (params.discount) {
      order.discounts = [
        {
          name: params.discount.name,
          amount_money: { amount: params.discount.cents, currency: 'USD' },
          scope: 'ORDER',
        },
      ]
    }
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

  async orderPaymentInFlight(orderId: string): Promise<boolean> {
    const response = await this.client.orders.get({ orderId })
    const order = ((response as any)?.order ?? response) as any
    for (const tender of order?.tenders ?? []) {
      const paymentId = tender?.paymentId ?? tender?.id
      if (!paymentId) continue
      const paymentResponse = await this.client.payments.get({ paymentId })
      const payment = ((paymentResponse as any)?.payment ?? paymentResponse) as any
      if (payment?.status === 'APPROVED' || payment?.status === 'PENDING') return true
    }
    return false
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

  async readPayment(paymentId: string): Promise<PaymentState> {
    const p = (await squareFetch(`/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' }))?.payment
    if (!p) throw new Error('Square returned no payment')
    const ids: string[] = Array.isArray(p.refund_ids) ? p.refund_ids.filter((x: unknown): x is string => typeof x === 'string') : []
    const refunds: RefundState[] = []
    for (const id of ids) {
      const r = await this.readRefund(id)
      if (r) refunds.push(r)
    }
    return {
      id: String(p.id ?? paymentId),
      orderId: typeof p.order_id === 'string' ? p.order_id : null,
      status: String(p.status ?? ''),
      amountCents: Number(p.amount_money?.amount ?? 0),
      refundedCents: Number(p.refunded_money?.amount ?? 0),
      refunds,
      createdAt: typeof p.created_at === 'string' ? p.created_at : null,
    }
  }

  async readRefund(refundId: string): Promise<RefundState | null> {
    let r: any
    try {
      r = (await squareFetch(`/refunds/${encodeURIComponent(refundId)}`, { method: 'GET' }))?.refund
    } catch (e) {
      if ((e as { status?: number })?.status === 404) return null
      throw e
    }
    if (!r) return null
    return {
      id: String(r.id ?? refundId),
      paymentId: String(r.payment_id ?? ''),
      amountCents: Number(r.amount_money?.amount ?? 0),
      status: String(r.status ?? ''),
      createdAt: typeof r.created_at === 'string' ? r.created_at : null,
    }
  }

  async findOrderByReference(referenceId: string, aroundIso: string): Promise<{ orderId: string } | null> {
    const t = Date.parse(aroundIso)
    const start = new Date((Number.isFinite(t) ? t : Date.now()) - 86_400_000).toISOString()
    const end = new Date((Number.isFinite(t) ? t : Date.now()) + 86_400_000).toISOString()
    let cursor: string | undefined
    for (let page = 0; page < 10; page++) {
      const res = await squareFetch('/orders/search', {
        method: 'POST',
        body: JSON.stringify({
          location_ids: [this.config.locationId],
          limit: 500,
          ...(cursor ? { cursor } : {}),
          query: { filter: { date_time_filter: { created_at: { start_at: start, end_at: end } } } },
        }),
      })
      const hit = (res?.orders ?? []).find((o: any) => o?.reference_id === referenceId)
      if (hit?.id) return { orderId: String(hit.id) }
      cursor = res?.cursor
      if (!cursor) break
    }
    return null
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
