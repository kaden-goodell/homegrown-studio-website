import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { isId, json, quoteStatusView, refusalResponse } from '@lib/quotes/admin-route'
import { getQuoteForRequest } from '@lib/quotes/quote-store'

export const prerender = false

/**
 * GET ?requestId=: the request's current quote (or null) and where it
 * stands: status (sent/picked past the reply-by date read `expired`), views,
 * when it was sent and last seen, the pick, and the customer's link. Owners only.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const url = new URL(request.url)
  const requestId = url.searchParams.get('requestId')
  if (!isId(requestId)) return json(400, { error: 'Reload the page and try again.' })
  try {
    const quote = await getQuoteForRequest(requestId)
    return json(200, { data: { quote, view: quote ? quoteStatusView(quote, url.origin) : null } })
  } catch (e) {
    return refusalResponse(e, 'Quote read')
  }
}
