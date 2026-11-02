import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { getStudioDays } from '@lib/studio-settings'
import { flyerFacts, flyerHtml } from '@lib/day-flyer'
import { siteConfig } from '@config/site.config'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('page:admin-flyer')

const YMD = /^\d{4}-\d{2}-\d{2}$/
const html = (status: number, body: string) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } })

/** A plain page for when there's no flyer to show: says why, with the way back. */
function plain(status: number, title: string, text: string): Response {
  return html(status, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${title}</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#f8f5f1;color:#3d3229;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}main{max-width:28rem;text-align:center}a{display:inline-block;margin-top:1rem;padding:10px 18px;border-radius:999px;background:#3d3229;color:#fff;text-decoration:none;font-weight:600}</style></head>
<body><main><h1>${title}</h1><p>${text}</p><a href="/admin#more-hours">Back to Hours &amp; Craft Café</a></main></body></html>`)
}

/**
 * GET /admin/flyer/<YYYY-MM-DD>: owners only. The printable flyer for that
 * Craft Café special day, from what's saved on /admin right now (headline from
 * its announcement, else its name). Replaces running scripts/make-day-flyer.ts.
 */
export const GET: APIRoute = async ({ request, params }) => {
  if (!adminAuthorized(request)) return new Response(null, { status: 302, headers: { Location: '/admin', 'Cache-Control': 'no-store' } })
  const date = String(params.date ?? '')
  if (!YMD.test(date)) return plain(404, 'No flyer for that date', 'That isn’t a date the site knows.')
  let days
  try {
    days = await getStudioDays({ fresh: true, strict: true })
  } catch (e) {
    logger.error('Flyer: studio settings unreadable', { error: e instanceof Error ? e.message : String(e) })
    return plain(503, 'The flyer didn’t load', 'The studio settings couldn’t be reached. Try again in a minute.')
  }
  const day = days.cafe.special.find((d) => d.date === date)
  if (!day) return plain(404, 'No special day on that date', 'Add the special day in Hours & Craft Café first, then print its flyer from there.')
  const site = siteConfig.url.replace(/\/$/, '')
  return html(200, await flyerHtml({
    facts: flyerFacts(day, days.cafe),
    pageUrl: `${site}/craft-cafe`,
    logoSrc: '/images/logo.png',
    photoSrc: '/images/party-hero.jpg',
    address: siteConfig.address,
    printBar: { backHref: '/admin#more-hours' },
  }))
}
