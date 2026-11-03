import type { APIRoute } from 'astro'
import { randomUUID } from 'node:crypto'
import { bookingsOpenNow, bookingsClosedResponse } from '@lib/bookings-gate'
import { rateLimited } from '@lib/rate-limit'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { isAttemptId, type CheckoutErrorCode } from '@lib/checkout-attempt'
import { partyMessages } from '@lib/checkout-messages'
import { bookParty, partyIdFor, IN_PROGRESS_MESSAGE, type BookInput } from '@lib/parties/checkout'
import { getPartyRecord, type PartyCharge, type PartyRecord } from '@lib/party-store'
import { recentPartyBySamePerson, recentPartyMessage, PARTY_ALREADY_BOOKED, PARTY_STILL_GOING_THROUGH } from '@lib/parties/same-person'

/** Final review I19: what a customer reads when the request itself is off (never "Invalid request body"). */
const WORDS = {
  slowDown: 'That’s a lot of tries in a row. Give it a minute, then try again.',
  time: 'Pick a date and time first. Nothing was charged.',
  card: 'We couldn’t read that card. Check the number, date and code, then try again. Nothing was charged.',
  name: 'Add your first and last name and your email. Nothing was charged.',
  phone: 'Add a phone number. It’s how we reach you on party day. Nothing was charged.',
  craft: 'Pick a craft first. Nothing was charged.',
}

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
  const open = await bookingsOpenNow(request, 'parties')
  if (open && rateLimited(`party-book:${clientAddress}`, 5, 60_000)) {
    return errorResponse(WORDS.slowDown, 429)
  }
  let body: any
  try {
    body = await request.json()
  } catch {
    return open ? errorResponse(partyMessages.invalid, 400) : await bookingsClosedResponse()
  }
  if (!body || typeof body !== 'object') return open ? errorResponse(partyMessages.invalid, 400) : await bookingsClosedResponse()
  if (!open) {
    // A paid customer retrying after bookings closed still gets their confirmation (read only).
    const stored = isAttemptId(body.attemptId) ? await getPartyRecord(partyIdFor(body.attemptId)).catch(() => null) : null
    if (stored && stored.status === 'booked') return bookedResponse(stored, stored.charges?.[0] ?? null, { emailSent: true, replay: true })
    return await bookingsClosedResponse()
  }

  // --- Validation (today's words) ---
  if (!body.startTime || Number.isNaN(Date.parse(String(body.startTime)))) return errorResponse(WORDS.time, 400)
  if (!body.paymentToken || typeof body.paymentToken !== 'string' || body.paymentToken.length > 4000) {
    return errorResponse(WORDS.card, 400)
  }
  const host = {
    firstName: String(body.customer?.firstName ?? '').trim(),
    lastName: String(body.customer?.lastName ?? '').trim(),
    email: String(body.customer?.email ?? '').trim(),
    phone: String(body.customer?.phone ?? '').trim(),
  }
  if (!host.email || !host.firstName || !host.lastName) return errorResponse(WORDS.name, 400)
  if (host.phone.replace(/\D/g, '').length < 10) {
    return errorResponse(WORDS.phone, 400)
  }
  const craftId = typeof body.craftId === 'string' ? body.craftId : typeof body.craft?.id === 'string' ? body.craft.id : ''
  if (!craftId) return errorResponse(WORDS.craft, 400)
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

  // C2: the same host minutes ago with another attempt (a closed panel, a reload, a back swipe). A retry of
  // this very attempt is the same party id and goes on to bookParty, which answers with its stored result.
  const same = await recentPartyBySamePerson(host.email, partyIdFor(key), String(body.startTime))
  if (same?.kind === 'charging') return errorResponse(PARTY_STILL_GOING_THROUGH, 409, 'in_progress')
  if (same?.kind === 'booked' && same.sameTime) return errorResponse(PARTY_ALREADY_BOOKED, 409, 'already_booked')
  if (same?.kind === 'booked' && body.confirmRepeat !== true) return errorResponse(recentPartyMessage(same.whenLabel), 409, 'recent_booking')

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
    case 'booked':
      return bookedResponse(out.rec, out.charge, out)
  }
}

/** The booked answer (also a replay of a stored one). */
function bookedResponse(
  rec: PartyRecord, charge: PartyCharge | null,
  o: { emailSent: boolean; replay: boolean; customerId?: string | null; emailCheck?: unknown },
): Response {
  return new Response(
    JSON.stringify({
      data: {
        bookingId: rec.bookingId,
        hostToken: rec.hostToken || null,
        orderId: charge?.orderId ?? null,
        receiptUrl: charge?.receiptUrl ?? null,
        totalCharged: charge?.cents ?? 0,
        emailSent: o.emailSent,
        customer: { id: o.customerId ?? null },
        ...(o.emailCheck ? { emailCheck: o.emailCheck } : {}),
        ...(o.replay ? { replayed: true } : {}),
        ...(charge?.simulated ? { simulated: true } : {}),
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
}

/** A plain sentence for the customer, plus a code the booking panel can act on. */
function errorResponse(detail: string, status: number, code?: CheckoutErrorCode | 'in_progress' | 'recent_booking', extra?: Record<string, unknown>) {
  const resolved =
    code ?? (status === 400 ? 'invalid' : status === 409 ? 'slot_taken' : status === 402 ? 'card_declined' : 'unavailable')
  return new Response(
    JSON.stringify({ error: 'Unable to complete party booking', code: resolved, detail, ...extra }),
    { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
}
