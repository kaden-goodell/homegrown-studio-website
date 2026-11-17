import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { getRequest } from '@lib/event-requests'
import { getQuote } from '@lib/quotes/quote-store'
import { quoteFlyerHtml } from '@lib/quotes/flyer'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('page:admin-quote-flyer')

const html = (status: number, body: string) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } })

/** A plain page for when there's no flyer to show: says why, with the way back. */
function plain(status: number, title: string, text: string): Response {
  return html(status, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${title}</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#f8f5f1;color:#3d3229;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}main{max-width:28rem;text-align:center}a{display:inline-block;margin-top:1rem;padding:10px 18px;border-radius:999px;background:#3d3229;color:#fff;text-decoration:none;font-weight:600}</style></head>
<body><main><h1>${title}</h1><p>${text}</p><a href="/admin">Back to admin</a></main></body></html>`)
}

/**
 * GET /admin/quote/<id>/flyer: owners only. The quote as a printable letter
 * page with a QR code to the customer's link (S-55), from the quote sheet's
 * Flyer button.
 */
export const GET: APIRoute = async ({ request, params }) => {
  if (!(await adminAuthorized(request))) return new Response(null, { status: 302, headers: { Location: '/admin', 'Cache-Control': 'no-store' } })
  const id = String(params.id ?? '')
  let quote
  try {
    quote = /^qt_[0-9a-f]+$/.test(id) ? await getQuote(id) : null
  } catch (e) {
    logger.error('Quote flyer: quote unreadable', { quoteId: id, error: e instanceof Error ? e.message : String(e) })
    return plain(503, 'The flyer didn’t load', 'The quote couldn’t be reached. Try again in a minute.')
  }
  if (!quote) return plain(404, 'No quote here', 'This quote isn’t saved. Open the request and make a quote first.')
  let firstName = ''
  try {
    firstName = (await getRequest(quote.requestId))?.about.name.trim().split(/\s+/)[0] ?? ''
  } catch {
    firstName = ''
  }
  return html(200, await quoteFlyerHtml(quote, {
    origin: new URL(request.url).origin,
    firstName,
    backHref: `/admin#request-${encodeURIComponent(quote.requestId)}`,
  }))
}
