import { createLogger } from '../../lib/logger'
import type {
  PaymentProvider,
  LineItem,
  Discount,
  Order,
  Payment,
  Refund,
  PaymentClientConfig,
} from '../interfaces/payment'
import type { SquareConfig } from '../../config/site.config'
import { createSquareClient } from './client'

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

  async createOrder(params: {
    locationId: string
    customerId: string
    lineItems: LineItem[]
    discounts?: Discount[]
    fulfillment?: { type: 'PICKUP'; pickupAt: string; recipientName: string }
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
      order: {
        locationId: params.locationId,
        customerId: params.customerId,
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
  }): Promise<Payment> {
    logger.info('Processing payment', {
      orderId: params.orderId,
      amount: params.amount,
    })

    const response = await this.client.payments.create({
      sourceId: params.paymentToken,
      idempotencyKey: crypto.randomUUID(),
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
