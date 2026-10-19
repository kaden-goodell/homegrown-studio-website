import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { isAttemptId } from '@lib/checkout-attempt'
import { UNKNOWN_OUTCOME_MESSAGE } from '@lib/checkout-messages'
import { payBalance, type PayOutcome } from '@lib/parties/pay-balance'
import { dueCents } from '@lib/parties/money'

/**
 * POST /api/party/pay.json { id, k, attemptId, paymentToken, sourceKind }:
 * pay what a party still owes from its payment link. The work is in
 * src/lib/parties/pay-balance.ts. Prices come only from the party record;
 * the bookings gate does not apply (S2-R16).
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`party-pay:${clientAddress}`, 5, 60_000)) return errorResponse('Too many tries — give it a minute.', 429, 'unavailable')
  let body: any
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid request body', 400, 'invalid')
  }
  if (!body || typeof body !== 'object') return errorResponse('Invalid request body', 400, 'invalid')
  if (!isAttemptId(body.attemptId)) return errorResponse('Missing payment information', 400, 'invalid')
  const simulated = paymentBypassEnabled(request)
  if (!simulated && (typeof body.paymentToken !== 'string' || !body.paymentToken || body.paymentToken.length > 4000)) {
    return errorResponse('Missing payment information', 400, 'invalid')
  }

  let out: PayOutcome
  try {
    out = await payBalance({
      partyId: String(body.id ?? ''),
      key: typeof body.k === 'string' ? body.k : '',
      attemptId: body.attemptId,
      pay: simulated
        ? { kind: 'simulated' }
        : { kind: 'card', paymentToken: body.paymentToken, sourceKind: body.sourceKind === 'gift_card' ? 'gift_card' : 'card' },
      requestUrl: request.url,
    })
  } catch (err) {
    console.error('[api:party:pay] Link payment failed', err instanceof Error ? err.message : String(err))
    return errorResponse(UNKNOWN_OUTCOME_MESSAGE, 500, 'unknown_outcome')
  }

  switch (out.kind) {
    case 'refused':
      return errorResponse(out.message, out.status, out.code, out.extra)
    case 'unknown':
      return errorResponse(UNKNOWN_OUTCOME_MESSAGE, 502, 'unknown_outcome')
    case 'paid':
      return new Response(JSON.stringify({
        data: {
          state: 'paid',
          ...(out.already ? { alreadyPaid: true, message: 'Already paid' } : {}),
          ...(out.replay ? { replayed: true } : {}),
          paidCents: out.already ? 0 : out.charge?.cents ?? 0,
          receiptUrl: out.charge?.receiptUrl ?? null,
          stillDueCents: dueCents(out.rec),
          ...(out.charge?.simulated ? { simulated: true } : {}),
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  }
}

function errorResponse(detail: string, status: number, code: string, extra?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ error: 'Unable to take the payment', code, detail, ...extra }),
    { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
}
