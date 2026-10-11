import type { APIRoute } from 'astro'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { siteConfig, type SquareConfig } from '@config/site.config'
import { createLogger } from '@lib/logger'
import { sendEmail } from '@lib/email'
import { loadCatalogIndex, loadOrders, loadSourceOrders, summarizeTax, renderTaxReport, previousMonth } from '@lib/tax-report'

export const prerender = false
const logger = createLogger('api:jobs:tax-report')

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

/** The key the scheduled function sends: made from a secret only the site holds. */
export function taxReportJobKey(secret: string): string {
  return createHmac('sha256', secret).update('job:tax-report').digest('hex')
}

function allowed(request: Request): boolean {
  const secret = env('LOOKUP_SIGNING_SECRET')
  if (!secret) return false
  const given = Buffer.from(request.headers.get('x-job-key') ?? '')
  const wanted = Buffer.from(taxReportJobKey(secret))
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/**
 * Run on the 1st by netlify/functions/tax-report.ts: last month's tax,
 * split into use tax and sales tax (src/lib/tax-report.ts), emailed to
 * siteConfig.taxReportEmails. A report that can't be built emails too, so a
 * missing email never quietly means "nothing to report". Read-only.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!allowed(request)) return json({ error: 'Not allowed' }, 403)
  const body = await request.json().catch(() => ({}))
  const month = typeof body?.month === 'string' && /^\d{4}-\d{2}$/.test(body.month) ? body.month : previousMonth()
  const to = siteConfig.taxReportEmails.join(', ')
  try {
    const config = siteConfig.providers.payment.config as SquareConfig
    const [index, orders] = await Promise.all([loadCatalogIndex(config), loadOrders(config, month)])
    const sources = await loadSourceOrders(config, orders)
    const report = renderTaxReport(month, summarizeTax(orders, index, sources))
    const { sent } = await sendEmail({ to, ...report })
    logger.info('Tax report', { month, orders: orders.length, sent })
    return json({ data: { month, orders: orders.length, sent } }, 200)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    logger.error('Tax report failed', { month, error })
    await sendEmail({
      to,
      subject: `Tax report for ${month} could not be made`,
      text: `The monthly tax split couldn't be built from Square (${error.slice(0, 200)}). Run it by hand: npx tsx scripts/tax-report.ts ${month}`,
      html: `<p>The monthly tax split couldn’t be built from Square.</p><p>Run it by hand: <code>npx tsx scripts/tax-report.ts ${month}</code></p>`,
    }).catch(() => undefined)
    return json({ error: 'Report failed' }, 502)
  }
}
