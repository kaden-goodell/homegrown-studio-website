import type { APIRoute } from 'astro'
import { saveQuote } from '@lib/quotes/admin-quotes'
import { audit, isId, json, optBool, ownerWrite, refusalResponse } from '@lib/quotes/admin-route'
import type { Quote } from '@lib/quotes/types'

export const prerender = false

/**
 * POST { quote, version, overCapOk? }: an owner's edit. 409 `stale` when
 * someone saved first, `paid` once paid, `over_cap` past the cap on a sent
 * quote, `time_taken` when the new time can't be held (old hold kept).
 */
export const POST: APIRoute = async ({ request }) => {
  const w = await ownerWrite(request)
  if (w instanceof Response) return w
  const { by, body } = w
  const quote = body.quote as Quote | undefined
  if (!quote || typeof quote !== 'object' || !isId(quote.id)) return json(400, { error: 'Reload the page and try again.' })
  if (typeof body.version !== 'number' || !Number.isInteger(body.version)) return json(400, { error: 'Reload the page and try again.' })
  if (!optBool(body.overCapOk)) return json(400, { error: 'Reload the page and try again.' })
  try {
    const saved = await saveQuote(quote, body.version, { by: by.name, overCapOk: body.overCapOk === true })
    await audit(by, 'quote-save', { kind: 'quote', id: saved.id, label: `Quote for request ${saved.requestId}` }, { version: saved.version, status: saved.status })
    return json(200, { data: { quote: saved } })
  } catch (e) {
    return refusalResponse(e, 'Quote save')
  }
}
