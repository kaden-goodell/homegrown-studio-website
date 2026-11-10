// src/pages/api/shop/magnet-order.json.ts
import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { shopConfig } from '@config/shop.config'
import { rateLimited } from '@lib/rate-limit'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { isAttemptId, attemptKey, chargeOutcomeOf, type CheckoutErrorCode } from '@lib/checkout-attempt'
import { isValidSets, quoteMagnets, isValidSilhouetteCount, quoteSilhouettes } from '@lib/magnet-pricing'
import { isDraftId, isPhotoId, draftPhotoIds, newReference, saveOrder, orderForDraft, getPending, markPending, clearPending, type MagnetOrder } from '@lib/magnet-orders'
import { sendMagnetConfirmation, sendMagnetOwnerNotice } from '@lib/magnet-emails'
import { reportBooking } from '@lib/posthog-server'
import { cleanAttribution } from '@lib/attribution'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:shop:magnet-order')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ITEM_NAME = 'Photo Magnets – Set of 6'
const SILHOUETTE_NAME = 'Framed Silhouette'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const fail = (status: number, detail: string, code?: CheckoutErrorCode) =>
  json(status, { error: 'Unable to complete magnet order', code: code ?? (status === 400 ? 'invalid' : status === 402 ? 'card_declined' : 'unavailable'), detail })
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** One endpoint for every shop product: magnets (sets of 6) and framed silhouettes (each). */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const m = shopConfig.magnets
  const sil = shopConfig.silhouettes
  if (rateLimited(`magnet-order:${clientAddress}`, 5, 60_000)) return fail(429, 'Too many tries. Give it a minute.')
  const body = await request.json().catch(() => null)
  if (!body) return fail(400, 'Invalid request.')

  // --- Validate ---
  if (!isDraftId(body.draftId) || !isAttemptId(body.attemptId)) return fail(400, 'Your order expired. Close it and start again.')
  const product = body.product === 'silhouettes' ? 'silhouettes' : 'magnets'
  if (product === 'magnets' && !isValidSets(body.sets)) return fail(400, `Pick between 1 and ${m.maxSets} sets.`)
  if (product === 'silhouettes' && !isValidSilhouetteCount(body.sets)) return fail(400, `Pick between 1 and ${sil.maxCount} silhouettes.`)
  const delivery = body.delivery === 'ship' ? 'ship' : body.delivery === 'pickup' ? 'pickup' : null
  if (!delivery) return fail(400, 'Choose pickup or shipping.')
  const address = str(body.address, 300)
  if (delivery === 'ship' && address.length < 8) return fail(400, 'Add your shipping address.')
  const name = str(body.contact?.name, 120)
  const email = str(body.contact?.email, 200).toLowerCase()
  const phone = str(body.contact?.phone, 40).replace(/\D/g, '')
  if (!name) return fail(400, 'Add your name.')
  if (!EMAIL_RE.test(email)) return fail(400, 'Check your email address.')
  if (!(phone.length === 10 || (phone.length === 11 && phone.startsWith('1')))) return fail(400, 'Check your phone number.')
  const magnets: unknown[] = Array.isArray(body.magnets) ? body.magnets : []
  const wantItems = product === 'magnets' ? body.sets * m.setSize : body.sets
  if (magnets.length !== wantItems || !magnets.every(isPhotoId)) return fail(400, product === 'magnets' ? 'Pick a photo for every magnet.' : 'Finish every silhouette.')

  const existing = await orderForDraft(body.draftId)
  if (existing) return json(200, { data: { reference: existing.id, totalCents: existing.amounts.totalCents, receiptUrl: existing.receiptUrl, emailSent: true, already: true } })

  const uploaded = new Set(await draftPhotoIds(body.draftId))
  const missing = [...new Set((magnets as string[]).filter((p) => !uploaded.has(p)))]
  if (missing.length) return json(400, { error: 'Unable to complete magnet order', code: 'invalid', detail: 'Some photos did not save. Add them again.', missingPhotos: missing })

  const quote = product === 'magnets' ? quoteMagnets(body.sets, delivery) : quoteSilhouettes(body.sets, delivery)
  const line = product === 'magnets'
    ? { variationId: m.square.variationId, name: ITEM_NAME, unitCents: m.setPriceCents, taxId: m.taxId, taxPercent: m.taxPercent }
    : { variationId: sil.square.variationId, name: SILHOUETTE_NAME, unitCents: sil.priceCents, taxId: sil.taxId, taxPercent: sil.taxPercent }
  const id = newReference()
  const record = (over: Pick<MagnetOrder, 'squareOrderId' | 'paymentId' | 'receiptUrl'> & { simulated?: boolean }): MagnetOrder => ({
    id, createdAt: new Date().toISOString(), status: 'new', product, draftId: body.draftId, sets: body.sets, magnets: magnets as string[],
    delivery, address: delivery === 'ship' ? address : null, contact: { name, email, phone },
    amounts: { subtotalCents: quote.subtotalCents, taxCents: quote.taxCents, shippingCents: quote.shippingCents, totalCents: quote.totalCents },
    doneAt: null, photosDeletedAt: null, emailed: {}, ...over,
  })
  const adminUrl = `${new URL(request.url).origin}/admin`
  const finish = async (saved: MagnetOrder, receiptUrl: string | null) => {
    const { sent } = await sendMagnetConfirmation(saved).catch(() => ({ sent: false }))
    await sendMagnetOwnerNotice(saved, adminUrl).catch(() => ({ sent: false }))
    return json(200, { data: { reference: saved.id, totalCents: saved.amounts.totalCents, receiptUrl, emailSent: sent } })
  }

  // --- Preview / dev: no card charged, no Square ids needed ---
  if (paymentBypassEnabled(request)) {
    const saved = record({ squareOrderId: `dev_${Date.now().toString(36)}`, paymentId: 'dev_pay', receiptUrl: null, simulated: true })
    await saveOrder(saved)
    return finish(saved, null)
  }
  if (!line.variationId || !m.square.shippingVariationId) return fail(503, `${product === 'magnets' ? 'Magnets are' : 'Silhouettes are'} not available yet.`)
  if (!body.paymentToken) return fail(400, 'Missing payment information.')

  // Save the paid order, clear the marker, tell everyone. Shared by a fresh charge and a found earlier one.
  const complete = async (squareOrderId: string, payment: { id: string; receiptUrl?: string | null }) => {
    const saved = record({ squareOrderId, paymentId: payment.id, receiptUrl: payment.receiptUrl ?? null })
    let ok = false
    for (let i = 0; i < 2 && !ok; i++) { try { await saveOrder(saved); ok = true } catch { /* retry once */ } }
    if (!ok) {
      logger.error('ORPHANED PAID MAGNET ORDER', { id, draftId: body.draftId, squareOrderId, paymentId: payment.id, email })
      return fail(500, `Your card was charged but we could not save your order. Call ${siteConfig.contactPhone} with order ${id} and keep your receipt.`)
    }
    await clearPending(body.draftId).catch(() => undefined)

    await reportBooking({
      requestUrl: request.url, kind: 'shop', bookingId: id, amountCents: quote.totalCents, email,
      firstName: name.split(/\s+/)[0], lastName: name.split(/\s+/).slice(1).join(' '),
      items: [{ item_id: line.variationId, item_name: line.name, item_category: 'shop', price: line.unitCents / 100, quantity: body.sets }],
      attribution: cleanAttribution(body.attribution), posthogId: body.posthogId, extra: { delivery, product, items: magnets.length },
    })
    return finish(saved, payment.receiptUrl ?? null)
  }

  // An earlier try (different attempt id) may have charged the card but lost the answer. Look before making a new order.
  const pending = await getPending(body.draftId)
  if (pending?.squareOrderId && pending.attemptId !== body.attemptId) {
    let earlier: Awaited<ReturnType<typeof providers.payment.findOrderPayment>>
    try {
      earlier = await providers.payment.findOrderPayment(pending.squareOrderId)
    } catch (err) {
      // Can't tell whether the earlier try charged them — never risk a second charge.
      logger.error('earlier magnet payment lookup failed', { draftId: body.draftId, orderId: pending.squareOrderId, error: msg(err) })
      return fail(502, `We are still checking an earlier payment. Check your email for a receipt, or try again in a minute. Questions? ${siteConfig.contactPhone}`, 'unknown_outcome')
    }
    if (earlier) return complete(pending.squareOrderId, earlier)
  }

  const locationId = siteConfig.providers.payment.config.locationId
  let order: Awaited<ReturnType<typeof providers.payment.createOrder>>
  try {
    const [givenName, ...rest] = name.split(/\s+/)
    const customer = await providers.customer.findOrCreate({ email, givenName, familyName: rest.join(' ') || undefined, phone })
    order = await providers.payment.createOrder({
      locationId, customerId: customer.id, idempotencyKey: attemptKey(body.attemptId, 'order'),
      lineItems: [
        { catalogObjectId: line.variationId, name: line.name, quantity: body.sets, pricePerUnit: line.unitCents, tax: { catalogObjectId: line.taxId, percent: line.taxPercent } },
        ...(quote.shippingCents ? [{ catalogObjectId: m.square.shippingVariationId, name: 'Shipping', quantity: 1, pricePerUnit: quote.shippingCents }] : []),
      ],
    })
  } catch (err) {
    logger.error('order create failed', { error: msg(err) })
    return fail(502, 'We could not start your order. Your card was not charged. Try again.')
  }

  const cancel = async () => {
    try { await providers.payment.cancelOrder({ orderId: order.id, version: order.version, locationId }) }
    catch (err) { logger.error('ORPHANED ORDER — cancel failed', { orderId: order.id, error: msg(err) }) }
  }
  if (order.totalAmount !== quote.totalCents) {
    logger.error('magnet price mismatch', { expected: quote.totalCents, square: order.totalAmount })
    await cancel()
    return fail(500, `Something did not add up on our side. Your card was not charged. Call ${siteConfig.contactPhone} and we will sort it out.`)
  }

  let payment = await providers.payment.findOrderPayment(order.id).catch(() => null)
  if (!payment) {
    await markPending(body.draftId, { attemptId: body.attemptId, email, squareOrderId: order.id })
    try {
      payment = await providers.payment.processPayment({ orderId: order.id, paymentToken: body.paymentToken, amount: order.totalAmount, currency: 'USD', buyerEmailAddress: email, idempotencyKey: attemptKey(body.attemptId, 'pay') })
    } catch (err) {
      if (chargeOutcomeOf(err) === 'not_charged') {
        await clearPending(body.draftId)
        return fail(402, 'Your card was not charged. Check the details or try another card.')
      }
      logger.error('magnet payment outcome unknown', { draftId: body.draftId, orderId: order.id, error: msg(err) })
      return fail(502, `We are not sure your payment went through. Check your email for a receipt before trying again, or call ${siteConfig.contactPhone}.`, 'unknown_outcome')
    }
    if (payment.status === 'failed') { await cancel(); await clearPending(body.draftId); return fail(402, 'Your card was declined. Nothing was charged. Try another card.') }
  }

  return complete(order.id, payment)
}
