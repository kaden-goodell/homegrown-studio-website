import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { isAttemptId } from '@lib/checkout-attempt'
import { partyWritesRefusal } from '@lib/parties/test-site'
import { payQuote, QUOTE_CHECKING_MESSAGE, QUOTE_OUT_OF_DATE_MESSAGE, type PayQuoteWhy } from '@lib/quotes/pay'

/** Spec §3: each refusal's status. Every one but `checking` charged nothing. */
const STATUS: Record<PayQuoteWhy, number> = {
  checking: 202,
  declined: 402,
  tier_unavailable: 404,
  price_changed: 409,
  time_taken: 409,
  busy: 409,
  closed: 410,
  unavailable: 503,
}

/**
 * POST /api/quote/pay.json {t, tierId, priceKey, attemptId, pay:{paymentToken,
 * verificationToken?, sourceKind?}} → {data:{partyId}}: the customer pays the
 * deposit and the quote becomes a booked private event. The work is in
 * src/lib/quotes/pay.ts, which reads `pay` exactly like /api/party/pay.json
 * (incl. the payment bypass). Paying again after success answers the same
 * partyId. Not behind the bookings gate; refused on a test site.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`quote-pay:${clientAddress}`, 5, 60_000)) {
    return refuse('That’s a lot of tries in a row. Give it a minute, then try again.', 'rate_limited', 429)
  }
  const testSite = partyWritesRefusal(request)
  if (testSite) return refuse(testSite, 'unavailable', 503)
  const body = await request.json().catch(() => null)
  if (
    !body || typeof body !== 'object'
    || typeof body.t !== 'string' || typeof body.tierId !== 'string' || typeof body.priceKey !== 'string'
    || !isAttemptId(body.attemptId)
  ) {
    return refuse(QUOTE_OUT_OF_DATE_MESSAGE, 'invalid', 400)
  }

  try {
    const out = await payQuote({
      token: body.t,
      tierId: body.tierId,
      priceKey: body.priceKey,
      attemptId: body.attemptId,
      pay: body.pay && typeof body.pay === 'object' ? body.pay : {},
      requestUrl: request.url,
    })
    if (out.ok) return json({ data: { partyId: out.partyId } }, 200)
    return refuse(out.message, out.why, STATUS[out.why] ?? 503)
  } catch (err) {
    // The charge may have gone through: never say "nothing was charged" here.
    console.error('[api:quote:pay] failed', err instanceof Error ? err.message : String(err))
    return refuse(QUOTE_CHECKING_MESSAGE, 'checking', 202)
  }
}

const refuse = (error: string, why: string, status: number) => json({ error, why }, status)

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
