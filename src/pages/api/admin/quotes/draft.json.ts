import type { APIRoute } from 'astro'
import { draftQuote } from '@lib/quotes/admin-quotes'
import { audit, isBool, isId, json, ownerWrite, refusalResponse } from '@lib/quotes/admin-route'

export const prerender = false

/**
 * POST { requestId, targetCents?, force? }: the request's quote, drafted now
 * or the open one it already has. A booked request is 409 `booked` unless
 * `force`. Owners only.
 */
export const POST: APIRoute = async ({ request }) => {
  const w = await ownerWrite(request)
  if (w instanceof Response) return w
  const { by, body } = w
  if (!isId(body.requestId)) return json(400, { error: 'Reload the page and try again.' })
  if (body.force !== undefined && !isBool(body.force)) return json(400, { error: 'Reload the page and try again.' })
  const t = body.targetCents
  if (t !== undefined && (typeof t !== 'number' || !Number.isFinite(t))) return json(400, { error: 'The target price has to be a number.' })
  try {
    const quote = await draftQuote(body.requestId, { by: by.name, force: body.force === true, ...(t !== undefined ? { targetCents: t as number } : {}) })
    await audit(by, 'quote-draft', { kind: 'quote', id: quote.id, label: `Quote for request ${quote.requestId}` }, { requestId: quote.requestId, version: quote.version })
    return json(200, { data: { quote } })
  } catch (e) {
    return refusalResponse(e, 'Quote draft')
  }
}
