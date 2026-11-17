import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { partyWritesRefusal } from '@lib/parties/test-site'
import { pickTier } from '@lib/quotes/public-view'
import { QUOTE_CLOSED_MESSAGE, QUOTE_TIER_MESSAGE, QUOTE_OUT_OF_DATE_MESSAGE } from '@lib/quotes/pay'

/**
 * POST /api/quote/pick.json {t, tierId}: the customer picks a package
 * (status → picked; no version bump). 410 closed, 404 tier_unavailable.
 * The work is in src/lib/quotes/public-view.ts. Refused on a test site.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`quote-pick:${clientAddress}`, 20, 60_000)) {
    return refuse('That’s a lot of tries in a row. Give it a minute, then try again.', 'rate_limited', 429)
  }
  const testSite = partyWritesRefusal(request)
  if (testSite) return refuse(testSite, 'unavailable', 503)
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || typeof body.t !== 'string' || typeof body.tierId !== 'string') {
    return refuse(QUOTE_OUT_OF_DATE_MESSAGE, 'invalid', 400)
  }
  try {
    const out = await pickTier(body.t, body.tierId)
    if (out.ok) return json({ data: { ok: true } }, 200)
    return out.why === 'closed'
      ? refuse(QUOTE_CLOSED_MESSAGE, 'closed', 410)
      : refuse(QUOTE_TIER_MESSAGE, 'tier_unavailable', 404)
  } catch (err) {
    console.error('[api:quote:pick] failed', err instanceof Error ? err.message : String(err))
    return refuse('We couldn’t save that just now. Please try again in a minute.', 'unavailable', 503)
  }
}

const refuse = (error: string, why: string, status: number) => json({ error, why }, status)

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
