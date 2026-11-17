import type { APIRoute } from 'astro'
import { sendQuote } from '@lib/quotes/admin-quotes'
import { audit, isBool, isId, json, optBool, ownerWrite, refusalResponse } from '@lib/quotes/admin-route'

export const prerender = false

/**
 * POST { id, text, email, overCapOk?, noHold? }: hold the date (unless
 * `noHold`) and text/email the customer the link. 400 `no_tiers` /
 * `incomplete`; 409 `over_cap`, `time_taken` (with `clash`), `closed`.
 */
export const POST: APIRoute = async ({ request }) => {
  const w = await ownerWrite(request)
  if (w instanceof Response) return w
  const { by, body } = w
  if (!isId(body.id) || !isBool(body.text) || !isBool(body.email) || !optBool(body.overCapOk) || !optBool(body.noHold)) {
    return json(400, { error: 'Reload the page and try again.' })
  }
  try {
    const out = await sendQuote(body.id, {
      text: body.text, email: body.email, overCapOk: body.overCapOk === true, noHold: body.noHold === true,
      by: by.name, origin: new URL(request.url).origin,
    })
    await audit(by, 'quote-send', { kind: 'quote', id: out.quote.id, label: `Quote for request ${out.quote.requestId}` }, {
      held: out.quote.held, texted: out.texted, emailed: out.emailed, overCapOk: body.overCapOk === true,
    })
    return json(200, { data: { quote: out.quote, texted: out.texted, emailed: out.emailed } })
  } catch (e) {
    return refusalResponse(e, 'Quote send')
  }
}
