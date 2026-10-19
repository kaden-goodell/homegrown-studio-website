import type { APIRoute } from 'astro'
import { randomUUID } from 'node:crypto'
import { bookingsOpen, bookingsClosedResponse } from '@lib/bookings-gate'
import { rateLimited } from '@lib/rate-limit'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { isAttemptId, type CheckoutErrorCode } from '@lib/checkout-attempt'
import { partyMessages } from '@lib/checkout-messages'
import { bookParty, IN_PROGRESS_MESSAGE, type BookInput } from '@lib/parties/checkout'

/**
 * Book and pay for a party online: our own party record on the shared
 * studio schedule, one Square order and one charge, and no Square booking.
 * The work is in src/lib/parties/checkout.ts (shared with /admin); this
 * reads the page's request and answers it.
 *
 * Prices, the craft and the party's length come from the server (saved
 * Parties setup and the catalog). Whatever price, craft name, image or
 * Square variation id a page sends is ignored. An older page still open in a
 * browser (`serviceVariationId`, `people`, `craft.{id,name,perHeadCents}`,
 * no `packageId`) books the default package.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!bookingsOpen(request, 'parties')) return bookingsClosedResponse()
  if (rateLimited(`party-book:${clientAddress}`, 5, 60_000)) {
    return errorResponse('Too many booking attempts — give it a minute.', 429)
  }
  let body: any
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid request body', 400)
  }
  if (!body || typeof body !== 'object') return errorResponse('Invalid request body', 400)

  // --- Validation (today's words) ---
  if (!body.startTime || Number.isNaN(Date.parse(String(body.startTime)))) return errorResponse('Missing party time information', 400)
  if (!body.paymentToken || typeof body.paymentToken !== 'string' || body.paymentToken.length > 4000) {
    return errorResponse('Missing payment information', 400)
  }
  const host = {
    firstName: String(body.customer?.firstName ?? '').trim(),
    lastName: String(body.customer?.lastName ?? '').trim(),
    email: String(body.customer?.email ?? '').trim(),
    phone: String(body.customer?.phone ?? '').trim(),
  }
  if (!host.email || !host.firstName || !host.lastName) return errorResponse('Full name and email are required', 400)
  if (host.phone.replace(/\D/g, '').length < 10) {
    return errorResponse('A phone number is required — it’s how we reach you on party day', 400)
  }
  const craftId = typeof body.craftId === 'string' ? body.craftId : typeof body.craft?.id === 'string' ? body.craft.id : ''
  if (!craftId) return errorResponse('Missing craft selection', 400)
  const guests = Math.floor(Number(body.guests ?? body.people ?? 0))
  const addOns = body.addOns && typeof body.addOns === 'object' && !Array.isArray(body.addOns)
    ? Object.fromEntries(Object.entries(body.addOns as Record<string, unknown>).map(([k, v]) => [String(k), Number(v)]))
    : undefined

  // Older browsers' cached pages may not send one; then every request is its own attempt.
  const key = isAttemptId(body.attemptId) ? body.attemptId : randomUUID()
  const sourceKind: 'card' | 'gift_card' = body.sourceKind === 'gift_card' ? 'gift_card' : 'card'
  const simulated = paymentBypassEnabled(request)

  const input: BookInput = {
    key,
    startIso: String(body.startTime),
    ...(typeof body.packageId === 'string' && body.packageId ? { packageId: body.packageId } : {}),
    guests,
    ...(addOns ? { addOns } : {}),
    craftId,
    host,
    pay: simulated
      ? { kind: 'simulated', paymentToken: body.paymentToken }
      : { kind: 'card', paymentToken: body.paymentToken, sourceKind },
    audience: 'public',
    ...(typeof body.linkPackageId === 'string' && body.linkPackageId ? { linkPackageId: body.linkPackageId } : {}),
    by: null,
    ...(body.theme && typeof body.theme === 'object' ? { theme: { themeId: String(body.theme.themeId ?? ''), serves: Number(body.theme.serves) } } : {}),
    attribution: body.attribution,
    posthogId: body.posthogId,
    origin: new URL(request.url).origin,
    requestUrl: request.url,
  }

  let out: Awaited<ReturnType<typeof bookParty>>
  try {
    out = await bookParty(input)
  } catch (err) {
    // Every money step answers on its own; anything thrown here came before or around them.
    console.error('[api:party:book] Party booking failed', err instanceof Error ? err.message : String(err))
    return errorResponse(partyMessages.unknown_outcome, 500, 'unknown_outcome')
  }

  switch (out.kind) {
    case 'refused':
      return errorResponse(out.message, out.status, out.code, { ...(out.field ? { field: out.field } : {}), ...out.extra })
    case 'in_progress':
      return errorResponse(IN_PROGRESS_MESSAGE, 409, 'in_progress')
    case 'unknown':
      return errorResponse(partyMessages.unknown_outcome, 502, 'unknown_outcome')
    case 'booked': {
      const { rec, charge } = out
      return new Response(
        JSON.stringify({
          data: {
            bookingId: rec.bookingId,
            hostToken: rec.hostToken || null,
            orderId: charge?.orderId ?? null,
            receiptUrl: charge?.receiptUrl ?? null,
            totalCharged: charge?.cents ?? 0,
            emailSent: out.emailSent,
            customer: { id: out.customerId ?? null },
            ...(out.emailCheck ? { emailCheck: out.emailCheck } : {}),
            ...(out.replay ? { replayed: true } : {}),
            ...(charge?.simulated ? { simulated: true } : {}),
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
      )
    }
  }
}

/** A plain sentence for the customer, plus a code the booking panel can act on. */
function errorResponse(detail: string, status: number, code?: CheckoutErrorCode | 'in_progress', extra?: Record<string, unknown>) {
  const resolved =
    code ?? (status === 400 ? 'invalid' : status === 409 ? 'slot_taken' : status === 402 ? 'card_declined' : 'unavailable')
  return new Response(
    JSON.stringify({ error: 'Unable to complete party booking', code: resolved, detail, ...extra }),
    { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
}
