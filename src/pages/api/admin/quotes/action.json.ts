import type { APIRoute } from 'astro'
import { quoteAction, type QuoteActionName } from '@lib/quotes/admin-quotes'
import { audit, isId, json, optBool, ownerWrite, refusalResponse } from '@lib/quotes/admin-route'

export const prerender = false

const ACTIONS: QuoteActionName[] = ['resend', 'withdraw', 'reopen']

/**
 * POST { id, action: resend | withdraw | reopen, expiresAt?, text?, email? }.
 * Refusals follow the guard table: 409 with `why` naming the status (or
 * `paid`), `time_taken` with `clash` on a reopen that can't hold.
 */
export const POST: APIRoute = async ({ request }) => {
  const w = await ownerWrite(request)
  if (w instanceof Response) return w
  const { by, body } = w
  if (!isId(body.id) || !ACTIONS.includes(body.action as QuoteActionName)) return json(400, { error: 'Reload the page and try again.' })
  if ((body.expiresAt !== undefined && typeof body.expiresAt !== 'string') || !optBool(body.text) || !optBool(body.email)) {
    return json(400, { error: 'Reload the page and try again.' })
  }
  const action = body.action as QuoteActionName
  try {
    const quote = await quoteAction(body.id, action, {
      by: by.name, origin: new URL(request.url).origin,
      ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt as string } : {}),
      ...(body.text !== undefined ? { text: body.text as boolean } : {}),
      ...(body.email !== undefined ? { email: body.email as boolean } : {}),
    })
    await audit(by, `quote-${action}`, { kind: 'quote', id: quote.id, label: `Quote for request ${quote.requestId}` }, { status: quote.status })
    return json(200, { data: { quote } })
  } catch (e) {
    return refusalResponse(e, `Quote ${action}`)
  }
}
