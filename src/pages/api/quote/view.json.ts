import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { adminAuthorized } from '@lib/admin-auth'
import { publicView } from '@lib/quotes/public-view'
import { getQuoteByToken } from '@lib/quotes/quote-store'

/**
 * GET /api/quote/view.json?t=<token>: what the customer's quote page shows
 * (spec §3 Public; the work is in src/lib/quotes/public-view.ts). Draft,
 * withdrawn, expired and unknown links all answer `{state:'closed'}`. A view
 * is counted unless the owner's admin cookie is sent (a preview). An open
 * quote also carries its `priceKey`, which pay.json sends back. Read only:
 * the bookings gate and the test-site rule don't apply.
 */
export const GET: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`quote-view:${clientAddress}`, 60, 60_000)) {
    return json({ error: 'That’s a lot of tries in a row. Give it a minute, then try again.', why: 'rate_limited' }, 429)
  }
  const url = new URL(request.url)
  const token = url.searchParams.get('t') ?? ''
  if (!token) return json({ data: { state: 'closed' } }, 200)
  try {
    // The key is read BEFORE the view: if the quote changes in between, the
    // key is the older one and a payment is refused as price_changed (never
    // a charge for prices the page didn't show).
    const key = (await getQuoteByToken(token))?.priceKey
    const view = await publicView(token, { isOwner: await adminAuthorized(request), origin: url.origin })
    return json({ data: view.state === 'open' && key ? { ...view, priceKey: key } : view }, 200)
  } catch (err) {
    console.error('[api:quote:view] failed', err instanceof Error ? err.message : String(err))
    return json({ error: 'We couldn’t load this quote just now. Please try again in a minute.', why: 'unavailable' }, 503)
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
