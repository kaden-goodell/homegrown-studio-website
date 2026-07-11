import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { siteConfig } from '@config/site.config'
import { providers } from '@config/providers'
import { kitConfig } from '@config/kit.config'
import { kitContent, kitThemes } from '@config/kit-content'
import { paymentBypassEnabled } from '@lib/dev-flags'
import {
  pickupThursdayFor,
  returnByFor,
  weekKeyFor,
  isOrderable,
  tierFor,
} from '@lib/kit-dates'
import {
  createKitOrder,
  claimWeek,
  confirmWeekClaim,
  releaseWeekClaim,
  listKitOrders,
  kitOrderToLedgerRecord,
  type KitOrderRecord,
} from '@lib/kit-store'
import type { LedgerRecord } from '@lib/kit-ledger'
import { sendKitConfirmationEmail } from '@lib/email'
import { fetchPartyCrafts } from '@lib/craft-catalog'

const logger = createLogger('api:kits:order')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface KitOrderRequest {
  crafts: { craftId: string; name: string; perHeadCents: number }[]
  guests: number
  /** Absent for a crafts-only kit. `serves` must equal the guest tier. */
  theme?: { themeId: string; serves: number }
  partyDate: string
  contact: { name: string; email: string; phone: string; address: string }
  rentalTermsAccepted?: boolean
  /** Required when any craft is personalized (made-to-order, non-refundable). */
  personalizedAck?: boolean
  paymentToken: string
}

/** A theme resolved against server config — prices and variation ids never come from the client. */
interface ResolvedTheme {
  themeId: string
  displayName: string
  ledgerThemeId: string
  serves: number
  packagePriceCents: number
  depositCents: number
  packageVariationId: string
  depositVariationId: string
  keeps: string[]
  returns: string[]
}

/** Studio-local today (America/Chicago), YYYY-MM-DD — matches WhatsOnCalendar's todayISO. */
function studioToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: kitConfig.timezone })
}

/** Human display of a YYYY-MM-DD date, e.g. "Saturday, June 5" (UTC-noon arithmetic, no TZ traps). */
function formatKitDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full.trim()
}
function lastName(full: string): string {
  const parts = full.trim().split(/\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : ''
}

/** Short human-facing order reference, e.g. KIT-4F9K2A. */
function generateReference(): string {
  return `KIT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Not seeded yet → no catalog ids to build line items from.
  if (!kitConfig.square.packageItemId) {
    return errorResponse('Kits are not available yet', 503)
  }

  if (rateLimited(`kit-order:${clientAddress}`, 5, 60_000)) {
    return errorResponse('Too many order attempts — give it a minute.', 429)
  }

  let body: KitOrderRequest
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid request body', 400)
  }

  // --- Validation ---
  const guests = Math.floor(body.guests ?? 0)
  const crafts = Array.isArray(body.crafts) ? body.crafts : []
  if (!crafts.length || crafts.some((c) => !c?.craftId || c.perHeadCents == null)) {
    return errorResponse('Missing craft selection', 400)
  }
  if (guests < kitConfig.minGuests) {
    return errorResponse(`Kits are for groups of ${kitConfig.minGuests} or more`, 400)
  }
  if (guests > kitConfig.maxGuests) {
    return errorResponse(`Kits are limited to ${kitConfig.maxGuests} guests`, 400)
  }
  // Kits come in tier sizes only (10/15/20) — crafts-only included. One box
  // size per tier keeps assembly, pricing, and the receipt clean.
  if (!kitConfig.tiers.some((t) => t.serves === guests)) {
    return errorResponse(
      `Kits come in sizes of ${kitConfig.tiers.map((t) => t.serves).join(', ')} guests`,
      400,
    )
  }

  const contact = body.contact ?? ({} as KitOrderRequest['contact'])
  if (!contact.name?.trim() || !EMAIL_RE.test(contact.email ?? '')) {
    return errorResponse('A name and valid email are required', 400)
  }
  if ((contact.phone ?? '').replace(/\D/g, '').length < 10) {
    return errorResponse('A phone number is required — it’s how we reach you about pickup', 400)
  }
  if ((contact.address ?? '').trim().length < 8) {
    return errorResponse('A party address is required', 400)
  }
  if (!body.paymentToken && !paymentBypassEnabled()) {
    return errorResponse('Missing payment information', 400)
  }

  const today = studioToday()
  if (!body.partyDate || !isOrderable(body.partyDate, today)) {
    return errorResponse(`That date is too soon — kits need ${kitConfig.leadTimeDays} days.`, 400)
  }

  const pickupDate = pickupThursdayFor(body.partyDate)
  const returnBy = returnByFor(pickupDate)
  const weekKey = weekKeyFor(body.partyDate)

  // Resolve the themed table server-side (client sends only themeId + serves).
  let theme: ResolvedTheme | undefined
  if (body.theme) {
    const t = kitThemes.find((k) => k.id === body.theme!.themeId && k.stocked)
    if (!t) return errorResponse('That themed table isn’t available', 400)
    const serves = Math.floor(body.theme.serves ?? 0)
    if (tierFor(guests) !== serves) {
      return errorResponse('The package size doesn’t match your guest count', 400)
    }
    const tier = kitConfig.tiers.find((tt) => tt.serves === serves)
    const packageVariationId = kitConfig.square.packageVariations[t.id]?.[serves]
    const depositVariationId = kitConfig.square.depositVariations[serves]
    if (!tier || !packageVariationId || !depositVariationId) {
      return errorResponse('That themed table isn’t available', 400)
    }
    if (!body.rentalTermsAccepted) {
      return errorResponse('Please accept the rental terms to reserve the table', 400)
    }
    theme = {
      themeId: t.id,
      displayName: t.displayName,
      ledgerThemeId: t.ledgerThemeId ?? t.id,
      serves,
      // Take-home price: packing/prep folded in (in-studio parties pay the
      // lower packagePriceCents through their own flow).
      packagePriceCents: tier.kitPackagePriceCents,
      depositCents: tier.depositCents,
      packageVariationId,
      depositVariationId,
      keeps: t.keeps,
      returns: t.returns,
    }
  }

  const locationId = siteConfig.providers.payment.config.locationId
  const reference = generateReference()

  // Deposit-only model: the deposit books the week, everything else settles on
  // the POS at pickup. Themed kits charge the refundable rental deposit today
  // (so the return flow can refund the very payment we hold) and their package
  // price already CONTAINS packing/prep — no separate assembly charge. Crafts-
  // only kits charge the flat packing fee today (which the late-cancel policy
  // already keeps).
  const quoteFor = (craftList: { perHeadCents: number }[]) =>
    craftList.reduce((s, c) => s + c.perHeadCents * guests, 0) +
    (theme ? theme.packagePriceCents + theme.depositCents : kitConfig.assemblyFeeCents)
  const dueTodayCents = theme ? theme.depositCents : kitConfig.assemblyFeeCents

  // Dev-only: skip Square + the ledger claim entirely and return a synthetic
  // confirmation so the flow (persist + email) is exercisable without a charge.
  // Gated to `astro dev` — never in prod. Mirrors party book.json's bypass.
  if (paymentBypassEnabled()) {
    logger.info('Payment bypass active — returning synthetic kit order')
    const orderId = `dev_${Date.now().toString(36)}`
    const record = buildRecord({
      orderId,
      paymentId: `dev_pay_${Date.now().toString(36)}`,
      reference,
      contact,
      crafts,
      guests,
      theme,
      partyDate: body.partyDate,
      pickupDate,
      returnBy,
      weekKey,
      totalChargedCents: dueTodayCents,
      quoteTotalCents: quoteFor(crafts),
    })
    try {
      await createKitOrder(record)
    } catch (err) {
      logger.error('Bypass: kit order persist failed', { error: String(err) })
    }
    const { sent: emailSent } = await sendConfirmation(record, theme, null)
    return okResponse({ orderId, reference, record, depositCents: theme?.depositCents, receiptUrl: null, emailSent })
  }

  // Resolve crafts against the live catalog — the charged price NEVER comes from
  // the client. A client-sent price that disagrees means a stale (or tampered)
  // page: refuse rather than charge an amount the customer wasn't shown.
  let resolvedCrafts: { craftId: string; name: string; perHeadCents: number; personalized?: boolean }[]
  try {
    const catalog = await fetchPartyCrafts()
    const missing = crafts.find((c) => !catalog.some((k) => k.id === c.craftId))
    if (missing) {
      return errorResponse('That craft isn’t available anymore — refresh and pick again.', 400)
    }
    const stale = crafts.find((c) => {
      const k = catalog.find((kk) => kk.id === c.craftId)!
      return k.perHeadCents !== c.perHeadCents
    })
    if (stale) {
      return errorResponse('Craft prices have changed since you loaded the page — refresh and try again.', 409)
    }
    resolvedCrafts = crafts.map((c) => {
      const k = catalog.find((kk) => kk.id === c.craftId)!
      return { craftId: k.id, name: k.name, perHeadCents: k.perHeadCents, personalized: k.personalized || undefined }
    })
  } catch (err) {
    logger.error('Craft catalog lookup failed', { error: String(err) })
    return errorResponse("We couldn't verify craft pricing. Your card was not charged — please try again.", 502)
  }

  // Made-to-order crafts bind the customer to a non-refundable commitment —
  // the acknowledgment is enforced HERE (catalog truth), not just in the UI.
  if (resolvedCrafts.some((c) => c.personalized) && !body.personalizedAck) {
    return errorResponse('Please confirm the made-to-order terms for personalized crafts.', 400)
  }

  // --- Reserve → charge → confirm (LR-1 book-before-charge for the theme week) ---
  let claimed = false
  const releaseIfClaimed = async () => {
    if (theme && claimed) {
      try {
        await releaseWeekClaim(theme.ledgerThemeId, weekKey, reference)
      } catch (err) {
        logger.error('releaseWeekClaim failed', { reference, error: String(err) })
      }
    }
  }
  const cancelOrderSafe = async (order: { id: string; version: number }) => {
    try {
      await providers.payment.cancelOrder({ orderId: order.id, version: order.version, locationId })
    } catch (err) {
      logger.error('ORPHANED ORDER — cancelOrder failed after failure', { orderId: order.id, error: String(err) })
    }
  }

  try {
    if (theme) {
      const overdueOrders: LedgerRecord[] = (await listKitOrders())
        .map(kitOrderToLedgerRecord)
        .filter((r): r is LedgerRecord => r !== null)
      const outcome = await claimWeek({
        ledgerThemeId: theme.ledgerThemeId,
        weekKey,
        serves: theme.serves,
        kind: 'kit',
        ref: reference,
        today,
        overdueOrders,
      })
      if (outcome === 'full') {
        return errorResponse('That themed table is fully booked that week — try another date or theme.', 409)
      }
      claimed = true
    }

    // Customer (address rides into the note; the field is the durable lookup place).
    let customer: Awaited<ReturnType<typeof providers.customer.findOrCreate>>
    try {
      customer = await providers.customer.findOrCreate({
        email: contact.email,
        givenName: firstName(contact.name),
        familyName: lastName(contact.name) || undefined,
        phone: contact.phone,
      })
      try {
        await providers.customer.appendNote(customer.id, `Kit ${reference} · party ${body.partyDate} · ${contact.address.trim()}`)
      } catch (err) {
        logger.error('appendNote failed (non-fatal)', { error: String(err) })
      }
    } catch (err) {
      logger.error('Customer find-or-create failed', { error: String(err) })
      await releaseIfClaimed()
      return errorResponse("We couldn't start your order. Your card was not charged — please try again.", 502)
    }

    // Only today's $50 goes on the Square order — the rental deposit variation
    // for themed kits (so return-time refunds hit this very payment), the
    // assembly variation for crafts-only. The rest of the quote is collected on
    // the POS at pickup; the full breakdown lives in our record.
    const lineItems = theme
      ? [{ catalogObjectId: theme.depositVariationId, name: 'Rental Deposit', quantity: 1, pricePerUnit: theme.depositCents }]
      : [{ catalogObjectId: kitConfig.square.assemblyVariationId, name: 'Kit Assembly', quantity: 1, pricePerUnit: kitConfig.assemblyFeeCents }]
    const expectedTotal = dueTodayCents

    let order: Awaited<ReturnType<typeof providers.payment.createOrder>>
    try {
      order = await providers.payment.createOrder({
        locationId,
        customerId: customer.id,
        lineItems,
        fulfillment: { type: 'PICKUP', pickupAt: `${pickupDate}T12:00:00Z`, recipientName: contact.name.trim() },
      })
    } catch (err) {
      logger.error('createOrder failed', { error: String(err) })
      await releaseIfClaimed()
      return errorResponse("We couldn't set up your order. Your card was not charged — please try again.", 502)
    }

    if (order.totalAmount !== expectedTotal) {
      logger.error('Kit order total mismatch', { orderId: order.id, orderTotal: order.totalAmount, expectedTotal })
      await cancelOrderSafe(order)
      await releaseIfClaimed()
      return errorResponse('Pricing mismatch — your card was not charged. Please try again or text us.', 500)
    }

    let payment: Awaited<ReturnType<typeof providers.payment.processPayment>>
    try {
      payment = await providers.payment.processPayment({
        orderId: order.id,
        paymentToken: body.paymentToken,
        amount: order.totalAmount,
        currency: 'USD',
        buyerEmailAddress: contact.email,
      })
    } catch (err) {
      logger.error('processPayment threw — voiding order', { orderId: order.id, error: String(err) })
      await cancelOrderSafe(order)
      await releaseIfClaimed()
      return errorResponse("Payment didn't go through, so we released your date. Your card was not charged — please try again.", 502)
    }

    if (payment.status === 'failed') {
      await cancelOrderSafe(order)
      await releaseIfClaimed()
      return errorResponse('Payment was declined, so we released your date. Please try a different card.', 402)
    }

    // Persist, then confirm the claim (order is now paid — money reality wins).
    const record = buildRecord({
      orderId: order.id,
      paymentId: payment.id,
      reference,
      contact,
      crafts: resolvedCrafts,
      guests,
      theme,
      partyDate: body.partyDate,
      pickupDate,
      returnBy,
      weekKey,
      totalChargedCents: order.totalAmount,
      quoteTotalCents: quoteFor(resolvedCrafts),
    })

    if (!(await persistKitOrder(record))) {
      // The card is charged and the slot is pending-claimed, but we couldn't save
      // the record after a retry. Money reality wins: do NOT void the paid order
      // and do NOT release the claim — leave the pending claim to age out via TTL
      // if it's truly lost, and reconcile the paid order by hand.
      logger.error('ORPHANED PAID ORDER — kit record failed to persist after retry; manual reconciliation required', {
        reference,
        paymentId: payment.id,
        orderId: order.id,
      })
      return errorResponse(
        "Your card was charged and your kit is reserved — we hit a snag saving the record. We'll reconcile it; keep your receipt.",
        500,
      )
    }

    if (theme) {
      try {
        const outcome = await confirmWeekClaim({
          ledgerThemeId: theme.ledgerThemeId,
          weekKey,
          ref: reference,
          serves: theme.serves,
          kind: 'kit',
        })
        if (outcome === 'reinstated') {
          logger.warn('Kit claim reinstated on confirm (pending aged out)', { reference, weekKey })
        }
      } catch (err) {
        logger.error('confirmWeekClaim failed (order still paid + persisted)', { reference, error: String(err) })
      }
    }

    const { sent: emailSent } = await sendConfirmation(record, theme, payment.receiptUrl ?? null)

    // Best-effort staff heads-up — a missing webhook must not fail the order.
    try {
      await providers.notification.send({
        type: 'corporate-inquiry',
        title: `New kit order — ${reference}`,
        details: {
          reference,
          guests,
          theme: theme?.displayName ?? 'crafts only',
          partyDate: body.partyDate,
          pickupDate,
          depositPaidCents: order.totalAmount,
          balanceDueAtPickupCents: record.balanceDueCents ?? 0,
        },
        severity: 'info',
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      logger.error('Kit order Slack notify failed', { error: String(err) })
    }

    return okResponse({
      orderId: order.id,
      reference,
      record,
      depositCents: theme?.depositCents,
      receiptUrl: payment.receiptUrl ?? null,
      emailSent,
    })
  } catch (error) {
    logger.error('Kit order failed', { error: error instanceof Error ? error.message : String(error) })
    await releaseIfClaimed()
    return errorResponse("Something went wrong finishing your order. Don't reorder — if you were charged, we'll make it right.", 500)
  }
}

/**
 * Persist a kit order with one automatic retry (mirrors party book.json's
 * persistParty). A transient blob-store hiccup must not orphan a PAID order.
 * Returns false only when both attempts fail — the caller then keeps the charge
 * and the claim, and logs for manual reconciliation.
 */
async function persistKitOrder(record: KitOrderRecord): Promise<boolean> {
  try {
    await createKitOrder(record)
    return true
  } catch (err) {
    logger.error('Kit order persist failed — retrying once', { reference: record.reference, error: String(err) })
    try {
      await createKitOrder(record)
      return true
    } catch (err2) {
      logger.error('Kit order persist failed after retry', { reference: record.reference, error: String(err2) })
      return false
    }
  }
}

function buildRecord(input: {
  orderId: string
  paymentId: string
  reference: string
  contact: KitOrderRequest['contact']
  crafts: { craftId: string; name: string; perHeadCents: number; personalized?: boolean }[]
  guests: number
  theme?: ResolvedTheme
  partyDate: string
  pickupDate: string
  returnBy: string
  weekKey: string
  totalChargedCents: number
  quoteTotalCents: number
}): KitOrderRecord {
  return {
    orderId: input.orderId,
    paymentId: input.paymentId,
    reference: input.reference,
    createdAt: new Date().toISOString(),
    contact: {
      name: input.contact.name.trim(),
      email: input.contact.email,
      phone: input.contact.phone,
      address: input.contact.address.trim(),
    },
    crafts: input.crafts.map((c) => ({ craftId: c.craftId, name: c.name, qty: input.guests, perHeadCents: c.perHeadCents, personalized: c.personalized })),
    guests: input.guests,
    theme: input.theme
      ? {
          themeId: input.theme.themeId,
          ledgerThemeId: input.theme.ledgerThemeId,
          serves: input.theme.serves,
          packagePriceCents: input.theme.packagePriceCents,
          depositCents: input.theme.depositCents,
        }
      : undefined,
    partyDate: input.partyDate,
    pickupDate: input.pickupDate,
    returnBy: input.returnBy,
    weekKey: input.weekKey,
    totalChargedCents: input.totalChargedCents,
    quoteTotalCents: input.quoteTotalCents,
    balanceDueCents: Math.max(0, input.quoteTotalCents - input.totalChargedCents),
    status: 'upcoming',
    events: [{ at: new Date().toISOString(), action: 'order' }],
  }
}

async function sendConfirmation(record: KitOrderRecord, theme: ResolvedTheme | undefined, receiptUrl: string | null): Promise<{ sent: boolean }> {
  return sendKitConfirmationEmail({
    to: record.contact.email,
    hostName: firstName(record.contact.name),
    reference: record.reference,
    crafts: record.crafts.map((c) => ({ name: c.name, qty: c.qty })),
    themeName: theme?.displayName,
    keeps: theme?.keeps,
    returns: theme?.returns,
    partyDate: formatKitDate(record.partyDate),
    pickupDate: formatKitDate(record.pickupDate),
    returnBy: formatKitDate(record.returnBy),
    returnWindow: kitConfig.returnWindow,
    earlyDropLine: kitContent.earlyDropLine,
    depositCents: theme?.depositCents,
    totalChargedCents: record.totalChargedCents,
    balanceDueCents: record.balanceDueCents,
    receiptUrl,
  })
}

function okResponse(input: {
  orderId: string
  reference: string
  record: KitOrderRecord
  depositCents?: number
  receiptUrl: string | null
  emailSent: boolean
}) {
  return new Response(
    JSON.stringify({
      data: {
        orderId: input.orderId,
        reference: input.reference,
        summary: {
          pickupDate: input.record.pickupDate,
          returnBy: input.record.returnBy,
          returnWindow: kitConfig.returnWindow,
          totalChargedCents: input.record.totalChargedCents,
          quoteTotalCents: input.record.quoteTotalCents,
          balanceDueCents: input.record.balanceDueCents,
          depositCents: input.depositCents,
          receiptUrl: input.receiptUrl,
          emailSent: input.emailSent,
        },
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function errorResponse(detail: string, status: number) {
  return new Response(
    JSON.stringify({ error: 'Unable to complete kit order', detail }),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
}
