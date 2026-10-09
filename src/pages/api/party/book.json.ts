import type { APIRoute } from 'astro'
import { bookingsOpen, bookingsClosedResponse } from '@lib/bookings-gate'
import { randomUUID } from 'node:crypto'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { siteConfig } from '@config/site.config'
import { providers } from '@config/providers'
import { partyConfig } from '@config/party.config'
import { partyContent } from '@config/party-content'
import { kitConfig } from '@config/kit.config'
import { kitThemes } from '@config/kit-content'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { savePartyRecord, getPartyRecord, newHostToken, type PartyRecord } from '@lib/party-store'
import { isStartOpen, studioDateOf, bookingHeldBy } from '@lib/party-availability'
import { bookableOn } from '@lib/party-slots'
import { partyRefundLine } from '@lib/refund-lines'
import { STUDIO_DIRECTIONS_URL } from '@config/studio-address'
import { attemptKey, chargeOutcomeOf, isAttemptId, squareErrorCodes, type CheckoutErrorCode } from '@lib/checkout-attempt'
import { partyMessages, giftCardShortMessage } from '@lib/checkout-messages'
import { alertOwners } from '@lib/owner-alert'
import { tierFor, weekKeyFor } from '@lib/kit-dates'
import { claimWeek, confirmWeekClaim, releaseWeekClaim, listKitOrders, kitOrderToLedgerRecord } from '@lib/kit-store'
import type { LedgerRecord } from '@lib/kit-ledger'
import { sendPartyConfirmationEmail } from '@lib/email'
import { partyInviteUrl, googleCalendarUrl, buildIcs, addMinutesIso } from '@lib/party-share'
import { inviteContent } from '@config/invite-content'
import { formatSlotLabel, formatCalendarDate } from '@lib/studio-time'
import { lookupHouseholdEntry } from '@lib/waiver-store'
import type { Booking } from '@providers/interfaces/booking'

const logger = createLogger('api:party:book')

/** A themed table resolved against server config — prices and variation ids never come from the client. */
interface ResolvedTheme {
  themeId: string
  displayName: string
  ledgerThemeId: string
  serves: number
  priceCents: number
  variationId: string
  claimRef: string
}

/** Build + persist the party record for the host's management view. Returns hostToken or null. */
async function persistParty(bookingId: string, body: BookRequest, theme?: ResolvedTheme, simulated = false): Promise<string | null> {
  // A retried checkout reaches here a second time for the same booking. Keep
  // the record and token from the first time: that token is already in the
  // host's confirmation email.
  try {
    const existing = await getPartyRecord(bookingId)
    if (existing?.hostToken) return existing.hostToken
  } catch {
    /* fall through and save a fresh record */
  }
  const hostToken = newHostToken()
  const record: PartyRecord = {
    bookingId,
    hostToken,
    craftName: body.craft?.name ?? 'Craft party',
    startIso: body.startTime,
    durationMinutes: body.durationMinutes ?? null,
    hostName: [body.customer.firstName, body.customer.lastName].filter(Boolean).join(' '),
    hostEmail: body.customer.email,
    hostPhone: body.customer.phone,
    guestCount: Math.floor(body.people ?? 0),
    title: null,
    dropOff: false, // host-party default; PNO drop-off events would set true
    ...(theme
      ? { theme: { themeId: theme.themeId, displayName: theme.displayName, serves: theme.serves, claimRef: theme.claimRef } }
      : {}),
    ...(simulated ? { simulated: true as const } : {}),
    createdAt: new Date().toISOString(),
  }
  try {
    await savePartyRecord(record)
    return hostToken
  } catch (err) {
    logger.error('Party record save failed — retrying once', {
      bookingId,
      error: err instanceof Error ? err.message : String(err),
    })
    try {
      await savePartyRecord(record)
      return hostToken
    } catch (err2) {
      logger.error('Party record save failed after retry (booking still succeeded)', {
        bookingId,
        error: err2 instanceof Error ? err2.message : String(err2),
      })
      return null
    }
  }
}

interface BookRequest {
  startTime: string
  serviceVariationId: string
  serviceVariationVersion: number
  durationMinutes: number
  craft: {
    id: string
    name: string
    perHeadCents: number
    /** Upper bound when the craft has a price range — email display only. */
    perHeadMaxCents?: number
    /** Catalog description — rides into the confirmation email only. */
    description?: string
    /** Catalog image — rides into the confirmation email only. */
    imageUrl?: string
  }
  people: number
  customer: {
    firstName: string
    lastName: string
    email: string
    /** Required — the studio's day-of contact channel for the host. */
    phone: string
  }
  /** Optional in-studio themed-table add-on. Price + variation are derived server-side. */
  theme?: { themeId: string; serves: number }
  paymentToken: string
  /** 'gift_card' when the browser tokenized a gift card; absent or 'card' otherwise. */
  sourceKind?: 'card' | 'gift_card'
  /**
   * Made by the browser when the pay step opens and sent again on every retry
   * of that checkout. Becomes the idempotency keys given to the booking
   * system, so a retry can't book or charge twice (see checkout-attempt.ts).
   */
  attemptId?: string
}

/** Studio-local today (America/Chicago), YYYY-MM-DD — matches WhatsOnCalendar's todayISO. */
function studioToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: kitConfig.timezone })
}

/**
 * "Participation agreement on file — signed {date}, valid through {date}."
 * for the confirmation email, when a currently-valid signature exists for
 * this contact (HOM-216). `undefined` (line omitted) when there's no
 * household on file, it's expired, or the lookup itself fails — a lookup
 * hiccup must never break the booking confirmation email.
 */
async function agreementLineFor(email: string): Promise<string | undefined> {
  try {
    const entry = await lookupHouseholdEntry(email)
    if (!entry || new Date(entry.validUntil).getTime() <= Date.now()) return undefined
    return `Participation agreement on file — signed ${formatCalendarDate(entry.signedAt)}, valid through ${formatCalendarDate(entry.validUntil)}.`
  } catch (err) {
    logger.error('Household lookup failed (confirmation email unaffected)', { error: String(err) })
    return undefined
  }
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!bookingsOpen(request, 'parties')) return bookingsClosedResponse()
  if (rateLimited(`party-book:${clientAddress}`, 5, 60_000)) {
    return errorResponse('Too many booking attempts — give it a minute.', 429)
  }
  let body: BookRequest
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid request body', 400)
  }

  // --- Validation ---
  if (
    !body.startTime ||
    !body.durationMinutes ||
    !body.serviceVariationId ||
    body.serviceVariationVersion == null
  ) {
    return errorResponse('Missing party time information', 400)
  }
  if (!body.paymentToken) {
    return errorResponse('Missing payment information', 400)
  }
  if (!body.customer?.email || !body.customer?.firstName?.trim() || !body.customer?.lastName?.trim()) {
    return errorResponse('Full name and email are required', 400)
  }
  if ((body.customer?.phone ?? '').replace(/\D/g, '').length < 10) {
    return errorResponse('A phone number is required — it’s how we reach you on party day', 400)
  }
  if (!body.craft?.id || body.craft.perHeadCents == null) {
    return errorResponse('Missing craft selection', 400)
  }
  const people = Math.floor(body.people ?? 0)
  if (people < partyConfig.minGuests) {
    return errorResponse(`Parties are for groups of ${partyConfig.minGuests} or more`, 400)
  }
  if (people > partyConfig.maxGuests) {
    return errorResponse(`Bookings are limited to ${partyConfig.maxGuests} guests`, 400)
  }

  // The date must be one we offer today: not before opening, not with too
  // little notice, not past the booking window. Said plainly, before anything
  // is looked up or held.
  if (Number.isNaN(Date.parse(String(body.startTime)))) return errorResponse('Missing party time information', 400)
  const offered = bookableOn(studioDateOf(body.startTime))
  if (offered !== 'ok') {
    const detail =
      offered === 'too_soon'
        ? `Parties need ${partyConfig.minLeadDays} days’ notice, so that date is too soon to book. Nothing was charged. Pick a later date.`
        : offered === 'closed'
          ? 'The studio is closed on that date, so it can’t be booked. Nothing was charged. Pick another date.'
          : partyMessages.not_open
    return errorResponse(detail, 409, 'not_open')
  }

  // Resolve the optional themed-table add-on server-side (client sends only
  // themeId + serves). Never trust a client price or variation id.
  let theme: ResolvedTheme | undefined
  if (body.theme) {
    if (!siteConfig.features.kits.enabled || !kitConfig.square.packageItemId) {
      return errorResponse('Themed tables aren’t available right now', 400)
    }
    const t = kitThemes.find((k) => k.id === body.theme!.themeId && k.stocked)
    if (!t) return errorResponse('That themed table isn’t available', 400)
    const serves = Math.floor(body.theme.serves ?? 0)
    if (tierFor(people) !== serves) {
      return errorResponse('The themed-table size doesn’t match your guest count', 400)
    }
    const tier = kitConfig.tiers.find((tt) => tt.serves === serves)
    const variationId = kitConfig.square.packageVariations[t.id]?.[serves]
    if (!tier || !variationId) return errorResponse('That themed table isn’t available', 400)
    theme = {
      themeId: t.id,
      displayName: t.displayName,
      ledgerThemeId: t.ledgerThemeId ?? t.id,
      serves,
      priceCents: tier.packagePriceCents,
      variationId,
      claimRef: `party-${randomUUID().slice(0, 8)}`,
    }
  }
  // Pickup Thursday of the party's week — the ledger key the theme claim lives under.
  const weekKey = theme ? weekKeyFor(studioDateOf(body.startTime)) : ''

  const locationId = siteConfig.providers.booking.config.locationId

  // Older browsers' cached pages may not send one; then every request is its own attempt.
  const attemptId = isAttemptId(body.attemptId) ? body.attemptId : randomUUID()

  // Craft image for the confirmation email: absolute http(s) only; site-relative
  // paths resolve against this deployment's origin. Anything else is dropped.
  const requestOrigin = new URL(request.url).origin
  const rawImage = String(body.craft.imageUrl ?? '')
  const craftImageUrl = /^https?:\/\//.test(rawImage)
    ? rawImage
    : rawImage.startsWith('/')
      ? `${requestOrigin}${rawImage}`
      : ''

  let bookingIdForLog: string | undefined

  // Simulated payments (local dev and Netlify previews only, never production):
  // skip Square entirely and return a synthetic confirmation so the booking
  // flow (and its waiver/invite handoff) can be exercised without a real
  // charge or a live booking.
  if (paymentBypassEnabled(request)) {
    // Only a mock gift-card token is checked under bypass, so the short path
    // can be tried on previews. Nothing is held yet, so nothing to release.
    if (body.sourceKind === 'gift_card' && String(body.paymentToken).startsWith('mock-gift')) {
      const refusal = await giftCardRefusal(body.paymentToken, partyConfig.basePriceCents + (theme?.priceCents ?? 0))
      if (refusal) return refusal
    }
    logger.info('Payment bypass active — returning synthetic party booking')
    const bookingId = `dev_${Date.now().toString(36)}`
    const hostToken = await persistParty(bookingId, body, theme, true)
    // Send the real confirmation email too (no-ops without GMAIL_* creds) so
    // the whole flow — including the email — is testable locally. Beware: with
    // creds in .env this sends an ACTUAL email to whatever address you typed.
    const bypassOrigin = new URL(request.url).origin
    const bypassSlotLabel = formatSlotLabel(body.startTime)
    const bypassInviteUrl = partyInviteUrl(
      { bookingId, craftName: body.craft.name, slotLabel: bypassSlotLabel, startIso: body.startTime },
      bypassOrigin,
    )
    // Host's calendar event — token-free details ON PURPOSE: hosts often invite
    // guests via this very calendar event, and the party-page URL is the key to
    // the whole roster. The email itself carries the private link instead.
    const bypassCalEvent = {
      title: `${body.craft.name} — Party at Hometown Studio`,
      startIso: body.startTime,
      endIso: addMinutesIso(body.startTime, body.durationMinutes),
      details: `Your private party at Hometown Studio.\n\nInvitation link for guests: ${bypassInviteUrl}`,
      location: inviteContent.where,
    }
    const { sent: bypassEmailSent } = hostToken
      ? await sendPartyConfirmationEmail({
          to: body.customer.email,
          hostName: body.customer.firstName,
          craftName: body.craft.name,
          craftDescription: String(body.craft.description ?? '').slice(0, 2000),
          craftImageUrl,
          perHeadCents: body.craft.perHeadCents,
          perHeadMaxCents: body.craft.perHeadMaxCents,
          slotLabel: theme ? `${bypassSlotLabel} — with ${theme.displayName}` : bypassSlotLabel,
          hostPageUrl: `${bypassOrigin}/party/${encodeURIComponent(bookingId)}?key=${encodeURIComponent(hostToken)}`,
          inviteUrl: bypassInviteUrl,
          totalChargedCents: partyConfig.basePriceCents + (theme?.priceCents ?? 0),
          receiptUrl: null,
          googleCalendarUrl: googleCalendarUrl(bypassCalEvent),
          icsContent: buildIcs(bypassCalEvent),
          bookingRef: bookingId,
          agreementLine: await agreementLineFor(body.customer.email),
        })
      : { sent: false }
    return new Response(
      JSON.stringify({
        data: {
          bookingId,
          hostToken,
          orderId: `dev_order_${Date.now().toString(36)}`,
          receiptUrl: null,
          totalCharged: partyConfig.basePriceCents + (theme?.priceCents ?? 0),
          emailSent: bypassEmailSent,
          customer: { id: 'dev-customer' },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Compensation for the themed-table claim — released on every failure after
  // the reservation succeeds (charge fails, booking fails, or a later throw).
  let claimed = false
  const releaseIfClaimed = async () => {
    if (theme && claimed) {
      try {
        await releaseWeekClaim(theme.ledgerThemeId, weekKey, theme.claimRef)
      } catch (err) {
        logger.error('releaseWeekClaim failed', { error: String(err) })
      }
    }
  }

  try {
    // Step 1: Re-verify the slot server-side BEFORE any Square write.
    // A race between two browsers choosing the same slot must be caught here.
    let slotOpen = true
    try {
      slotOpen = await isStartOpen(body.startTime, body.serviceVariationId)
    } catch (err) {
      logger.error('Availability re-check failed — proceeding', { error: String(err) })
      // availability lookup failure must not block booking
    }

    // Step 1a: The time is taken. By someone else, or by this customer's own
    // earlier attempt whose answer never reached them? Ask the booking system.
    let resumed: Booking | null = null
    let resumedCustomer: Awaited<ReturnType<typeof providers.customer.findOrCreate>> | null = null
    if (!slotOpen) {
      try {
        resumedCustomer = await providers.customer.findOrCreate({
          email: body.customer.email,
          givenName: body.customer.firstName,
          familyName: body.customer.lastName,
          phone: body.customer.phone,
        })
        const own = await bookingHeldBy(body.startTime, resumedCustomer.id, body.serviceVariationId)
        if (own) {
          if ((own.customerNote ?? '').includes(attemptId)) {
            // Same checkout, retried: carry on with the booking it already made.
            // The order and charge below repeat the same keys, so Square
            // returns the originals (or makes them now, exactly once).
            resumed = own
            logger.info('Resuming a retried party checkout', { bookingId: own.id })
          } else {
            // Theirs, from a different checkout. Never charge again for it.
            logger.info('Customer already holds this party time', { bookingId: own.id })
            return errorResponse(partyMessages.already_booked, 409, 'already_booked')
          }
        }
      } catch (err) {
        logger.error('Own-booking lookup failed', { error: err instanceof Error ? err.message : String(err) })
      }
      if (!resumed) return errorResponse(partyMessages.slot_taken, 409, 'slot_taken')
    }

    // A gift card must cover the whole fee. Check before anything is held, so a
    // short card never books or claims anything. A resumed checkout skips this:
    // its first charge may already have spent the card, and the payment lookup
    // below decides that case.
    if (body.sourceKind === 'gift_card' && !resumed) {
      const refusal = await giftCardRefusal(body.paymentToken, partyConfig.basePriceCents + (theme?.priceCents ?? 0))
      if (refusal) return refusal
    }

    // Step 1b: Reserve the themed-table week BEFORE booking or charging (LR-1) —
    // the party analogue of book-before-charge. Two hosts racing for the last
    // styled table can't both win: the CAS-guarded claim gives it to one.
    if (theme && !resumed) {
      try {
        const overdueOrders: LedgerRecord[] = (await listKitOrders())
          .map(kitOrderToLedgerRecord)
          .filter((r): r is LedgerRecord => r !== null)
        const outcome = await claimWeek({
          ledgerThemeId: theme.ledgerThemeId,
          weekKey,
          serves: theme.serves,
          kind: 'party',
          ref: theme.claimRef,
          today: studioToday(),
          overdueOrders,
        })
        if (outcome === 'full') {
          return errorResponse(
            'That themed table is fully booked that week — pick another date or book without the table.',
            409,
          )
        }
        claimed = true
      } catch (err) {
        logger.error('claimWeek failed', { error: String(err) })
        return errorResponse(
          "We couldn't reserve the themed table. Your card was not charged — please try again.",
          502,
        )
      }
    }

    // Step 2: Find or create customer
    let customer: Awaited<ReturnType<typeof providers.customer.findOrCreate>>
    try {
      customer =
        resumedCustomer ??
        (await providers.customer.findOrCreate({
          email: body.customer.email,
          givenName: body.customer.firstName,
          familyName: body.customer.lastName,
          phone: body.customer.phone,
        }))
    } catch (err) {
      logger.error('Customer find-or-create failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      await releaseIfClaimed()
      return errorResponse(
        "We couldn't start your booking. Your card was not charged — please try again.",
        502,
      )
    }

    logger.info('Customer resolved', { customerId: customer.id })

    // Step 3: Create the single whole-room booking FIRST — before charging.
    // If this fails the customer has not been charged. Craft selection is stored
    // on an existing field (specialRequests) — no new custom-attribute definitions
    // (Square's 10-cap is maxed). orderIdRef is intentionally omitted here; we
    // don't yet have an order ID and we don't want to fail the booking over it.
    let booking: Booking
    try {
      booking = resumed ?? await providers.booking.createBooking({
        idempotencyKey: attemptKey(attemptId, 'book'),
        slotId: body.startTime,
        customerId: customer.id,
        eventType: 'party',
        guestCount: people,
        // Description deliberately excluded — Square note fields have length
        // caps; the description only rides into the confirmation email.
        specialRequests: JSON.stringify({
          // The attempt ID lets a retried checkout recognise its own booking.
          attempt: attemptId,
          craft: { id: body.craft.id, name: body.craft.name, perHeadCents: body.craft.perHeadCents },
          ...(theme ? { theme: { themeId: theme.themeId, displayName: theme.displayName, serves: theme.serves } } : {}),
        }),
        teamMemberId: partyConfig.square.defaultTeamMemberId,
        serviceVariationId: body.serviceVariationId,
        serviceVariationVersion: body.serviceVariationVersion,
        durationMinutes: body.durationMinutes,
      })
    } catch (err) {
      logger.error('createBooking failed — slot may be gone', {
        error: err instanceof Error ? err.message : String(err),
      })
      await releaseIfClaimed()
      return errorResponse(
        "We couldn't reserve that time. Your card was not charged — please try again.",
        502,
      )
    }

    // A repeated key hands back the booking it made the first time, even if
    // that booking has since been released. Never take money for one of those.
    if (booking.status === 'cancelled') {
      logger.error('Booking came back already cancelled — not charging', { bookingId: booking.id, attemptId })
      await releaseIfClaimed()
      return errorResponse(partyMessages.unavailable, 502, 'unavailable')
    }

    bookingIdForLog = booking.id
    logger.info('Party booking created', { bookingId: booking.id })

    /** Cancel the booking if payment fails. Non-fatal — logs an orphan warning if cancel also fails. */
    async function releaseBooking(b: { id: string; version?: number }): Promise<void> {
      try {
        await providers.booking.cancelBooking(b.id, b.version ?? 0)
      } catch (err) {
        logger.error('ORPHANED BOOKING — cancel failed after payment failure', {
          bookingId: b.id,
          error: String(err),
        })
      }
    }

    // Step 4: Deposit model — charge the flat studio fee now (plus the themed-
    // table package when one is added; unlike the take-home kit it carries no
    // rental deposit — the pieces never leave the studio). The per-head craft
    // cost is settled in person based on actual attendance.
    const lineItems = [
      {
        name: 'Whole Studio Party — studio fee',
        quantity: 1,
        pricePerUnit: partyConfig.basePriceCents,
      },
      ...(theme
        ? [{ catalogObjectId: theme.variationId, name: `Themed Table — ${theme.displayName}`, quantity: 1, pricePerUnit: theme.priceCents }]
        : []),
    ]

    let order: Awaited<ReturnType<typeof providers.payment.createOrder>>
    let payment: Awaited<ReturnType<typeof providers.payment.processPayment>> | null = null
    try {
      order = await providers.payment.createOrder({
        idempotencyKey: attemptKey(attemptId, 'order'),
        locationId,
        customerId: customer.id,
        lineItems,
      })

      // Studio fee (+ themed-table package, when added) — guard against a
      // divergent amount. Both sides move together with the package line item.
      const expectedTotal = partyConfig.basePriceCents + (theme?.priceCents ?? 0)
      if (order.totalAmount !== expectedTotal) {
        logger.error('Party order total mismatch', {
          orderId: order.id,
          orderTotal: order.totalAmount,
          expectedTotal,
        })
        await releaseBooking(booking)
        await releaseIfClaimed()
        return errorResponse(
          'Pricing mismatch — your card was not charged and the date was released. Please try again or text us.',
          500,
          'unavailable',
        )
      }

      logger.info('Order created', { orderId: order.id, totalAmount: order.totalAmount })
    } catch (err) {
      // Failed before any charge was attempted.
      logger.error('Order failed — releasing booking', {
        bookingId: booking.id,
        error: err instanceof Error ? err.message : String(err),
      })
      await releaseBooking(booking)
      await releaseIfClaimed()
      return errorResponse(
        "We couldn't start the payment, so we released the date. Your card was not charged — please try again.",
        502,
        'unavailable',
      )
    }

    // A retried checkout: did the first try's charge go through? Ask before
    // charging. The customer has typed their card again, so this request
    // carries a new payment token and would otherwise be a second charge.
    if (resumed) {
      try {
        payment = await providers.payment.findOrderPayment(order.id)
        if (payment) logger.info('Retried checkout was already paid — not charging again', { orderId: order.id })
      } catch (err) {
        logger.error('Paid-order lookup failed — outcome unknown, not charging', {
          orderId: order.id,
          error: err instanceof Error ? err.message : String(err),
        })
        return errorResponse(partyMessages.unknown_outcome, 502, 'unknown_outcome')
      }
    }

    if (!payment) {
      try {
        payment = await providers.payment.processPayment({
          idempotencyKey: attemptKey(attemptId, 'pay'),
          orderId: order.id,
          paymentToken: body.paymentToken,
          amount: order.totalAmount,
          currency: 'USD',
          buyerEmailAddress: body.customer.email,
        })
      } catch (err) {
        const outcome = chargeOutcomeOf(err)

        // No clear answer. Before telling anyone "we're not sure", ask whether
        // the order shows as paid: an earlier try may have gone through.
        if (outcome === 'unknown') {
          try {
            payment = await providers.payment.findOrderPayment(order.id)
          } catch {
            /* still unknown */
          }
        }

        if (payment) {
          logger.info('Charge answer was unclear but the order is paid — confirming', { orderId: order.id, paymentId: payment.id })
        } else if (outcome === 'not_charged') {
          // Square refused the charge and said why. The card was not charged.
          logger.error('Payment refused — releasing booking', {
            bookingId: booking.id,
            codes: squareErrorCodes(err),
            error: err instanceof Error ? err.message : String(err),
          })
          await releaseBooking(booking)
          await releaseIfClaimed()
          return errorResponse(partyMessages.card_declined, 402, 'card_declined')
        } else {
          // No answer from Square. The charge may have gone through, so the date
          // STAYS held and the customer is told we're not sure. A person settles it.
          logger.error('PAYMENT OUTCOME UNKNOWN — booking kept, needs a person', {
            bookingId: booking.id,
            orderId: order.id,
            attemptId,
            codes: squareErrorCodes(err),
            error: err instanceof Error ? err.message : String(err),
          })
          claimed = false // the table stays reserved along with the date
          await alertOwners(
            `Party payment unclear: ${body.customer.firstName} ${body.customer.lastName} (${body.customer.email}, ${body.customer.phone}), ${formatSlotLabel(body.startTime)}. Check Square for a $${(order.totalAmount / 100).toFixed(0)} payment, then confirm with them or cancel booking ${booking.id}.`,
          ).catch(() => undefined)
          return errorResponse(partyMessages.unknown_outcome, 502, 'unknown_outcome')
        }
      }
    }

    // Every path above either set the payment or has already answered.
    if (!payment) return errorResponse(partyMessages.unknown_outcome, 502, 'unknown_outcome')

    logger.info('Payment processed', { paymentId: payment.id, status: payment.status })

    if (payment.status === 'failed') {
      await releaseBooking(booking)
      await releaseIfClaimed()
      return errorResponse(partyMessages.card_declined, 402, 'card_declined')
    }

    // Payment succeeded — the reservation is now owned, so no downstream throw
    // (e.g. the confirmation email) may roll it back via the outer catch.
    claimed = false

    // Confirm the themed-table claim (money reality wins; an aged-out pending
    // claim is reinstated rather than dropped).
    if (theme) {
      try {
        const outcome = await confirmWeekClaim({
          ledgerThemeId: theme.ledgerThemeId,
          weekKey,
          ref: theme.claimRef,
          serves: theme.serves,
          kind: 'party',
        })
        if (outcome === 'reinstated') {
          logger.warn('Party theme claim reinstated on confirm (pending aged out)', { bookingId: booking.id, weekKey })
        }
      } catch (err) {
        logger.error('confirmWeekClaim failed (booking still paid + confirmed)', { bookingId: booking.id, error: String(err) })
      }
    }

    // Step 5: Persist party record + send confirmation email.
    const hostToken = await persistParty(booking.id, body, theme)

    const origin = new URL(request.url).origin
    // No party page (the record could not be saved): say so, and tell a person.
    // The email must never point somewhere else in its place.
    const hostPageUrl = hostToken
      ? `${origin}/party/${encodeURIComponent(booking.id)}?key=${encodeURIComponent(hostToken)}`
      : null
    if (!hostToken) {
      await alertOwners(
        `Party booked and paid, but its party page could not be set up: ${body.customer.firstName} ${body.customer.lastName} (${body.customer.email}, ${body.customer.phone}), ${formatSlotLabel(body.startTime)}, booking ${booking.id}. They were told to text us for the link.`,
      ).catch(() => undefined)
    }
    const slotLabel = formatSlotLabel(body.startTime)
    const inviteUrl = partyInviteUrl(
      { bookingId: booking.id, craftName: body.craft.name, slotLabel, startIso: body.startTime },
      origin,
    )
    // Host's calendar event — token-free details (the invite link is shareable).
    const calEvent = {
      title: `${body.craft.name} — Party at Hometown Studio`,
      startIso: body.startTime,
      endIso: addMinutesIso(body.startTime, body.durationMinutes),
      details: `Your private party at Hometown Studio.\n\nInvitation link for guests: ${inviteUrl}`,
      location: inviteContent.where,
    }

    const { sent: emailSent } = await sendPartyConfirmationEmail({
      to: body.customer.email,
      hostName: body.customer.firstName,
      craftName: body.craft.name,
      craftDescription: String(body.craft.description ?? '').slice(0, 2000),
      craftImageUrl,
      perHeadCents: body.craft.perHeadCents,
      perHeadMaxCents: body.craft.perHeadMaxCents,
      slotLabel: theme ? `${slotLabel} — with ${theme.displayName}` : slotLabel,
      hostPageUrl,
      inviteUrl,
      totalChargedCents: order.totalAmount,
      receiptUrl: payment.receiptUrl ?? null,
      googleCalendarUrl: googleCalendarUrl(calEvent),
      icsContent: buildIcs(calEvent),
      bookingRef: booking.id,
      agreementLine: await agreementLineFor(body.customer.email),
      arriveEarlyMinutes: partyConfig.hostArrivalMinutesEarly,
      minGuests: partyConfig.minGuests,
      refundLine: partyRefundLine(body.startTime),
      directionsUrl: STUDIO_DIRECTIONS_URL,
    })

    return new Response(
      JSON.stringify({
        data: {
          bookingId: booking.id,
          hostToken,
          orderId: order.id,
          receiptUrl: payment.receiptUrl ?? null,
          totalCharged: order.totalAmount,
          emailSent,
          customer: {
            id: customer.id,
          },
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Party booking failed', { error: msg, ...(bookingIdForLog ? { bookingId: bookingIdForLog } : {}) })
    await releaseIfClaimed()
    if (bookingIdForLog) {
      await alertOwners(
        `Party booking hit an error after the date was held: ${body.customer?.email ?? 'unknown email'}, booking ${bookingIdForLog}. Check Square for a payment and follow up.`,
      ).catch(() => undefined)
    }
    return errorResponse(
      `Something went wrong finishing your booking. Don't rebook — if you were charged, we'll make it right.${partyContent.textNumber ? ` Text us at ${partyContent.textNumber}.` : ''}`,
      500,
      'unknown_outcome',
    )
  }
}

/** Null when the gift card can pay; otherwise the response that refuses it. */
async function giftCardRefusal(token: string, totalCents: number): Promise<Response | null> {
  let card: Awaited<ReturnType<typeof providers.giftcard.fromNonce>>
  try {
    card = await providers.giftcard.fromNonce(token)
  } catch (err) {
    // Square is down. Nothing has been charged or held, so say so.
    logger.error('Gift card lookup failed', { error: String(err) })
    return errorResponse(partyMessages.unavailable, 503, 'unavailable')
  }
  if (!card) return errorResponse('That doesn’t look like a gift card. Use a card instead.', 400, 'invalid')
  if (card.state !== 'ACTIVE') return errorResponse('That gift card can’t be used right now. Use a card instead.', 400, 'invalid')
  if (card.balanceCents < totalCents) {
    return errorResponse(giftCardShortMessage(card.balanceCents, totalCents), 402, 'gift_card_short', {
      balanceCents: card.balanceCents,
      totalCents,
    })
  }
  return null
}

/** A plain sentence for the customer, plus a code the booking panel can act on. */
function errorResponse(detail: string, status: number, code?: CheckoutErrorCode, extra?: Record<string, unknown>) {
  const resolved: CheckoutErrorCode =
    code ?? (status === 400 ? 'invalid' : status === 409 ? 'slot_taken' : status === 402 ? 'card_declined' : 'unavailable')
  return new Response(
    JSON.stringify({ error: 'Unable to complete party booking', code: resolved, detail, ...extra }),
    { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
}
