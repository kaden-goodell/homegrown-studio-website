import type { APIRoute } from 'astro'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { siteConfig } from '@config/site.config'
import { createLogger } from '@lib/logger'
import { sendEmail } from '@lib/email'
import { renderTaxReport, previousMonth } from '@lib/tax-report'
import { buildTaxMonth, recordTaxSent, taxReportRecipients } from '@lib/tax-report-store'

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

/** "October 2026" for "2026-10". */
export function monthName(month: string): string {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/**
 * The email when the report couldn't be built: where to see it in the app and
 * how to send it again, never a script (G7).
 */
export function taxFailureEmail(month: string, error: string): { subject: string; text: string; html: string } {
  const name = monthName(month)
  const link = `${siteConfig.url.replace(/\/$/, '')}/admin#more-reports`
  const steps = `Open the admin page (${link}) › More › Reports › pick ${name} › Tax split. It asks Square again when it opens. When it shows, tap Send it again to get this email, or Download it. If Square still doesn't answer, try again tomorrow.`
  return {
    subject: `Tax report for ${name} could not be made`,
    text: `The monthly tax split for ${name} couldn't be built from Square just now (${error.slice(0, 200)}).\n\n${steps}`,
    html: `<p>The monthly tax split for ${name} couldn’t be built from Square just now.</p><p>Open the <a href="${link}">admin page</a> › More › Reports › pick ${name} › Tax split. It asks Square again when it opens. When it shows, tap <strong>Send it again</strong> to get this email, or <strong>Download</strong> it.</p><p>If Square still doesn’t answer, try again tomorrow.</p>`,
  }
}

/**
 * Run on the 1st by netlify/functions/tax-report.ts: last month's tax,
 * split into use tax and sales tax (src/lib/tax-report.ts), emailed to
 * the tax report list. Built the same way /admin › More › Reports builds it
 * (src/lib/tax-report-store.ts). A report that can't be built emails too, so
 * a missing email never quietly means "nothing to report". Read-only.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!allowed(request)) return json({ error: 'Not allowed' }, 403)
  const body = await request.json().catch(() => ({}))
  const month = typeof body?.month === 'string' && /^\d{4}-\d{2}$/.test(body.month) ? body.month : previousMonth()
  const to = taxReportRecipients().join(', ')
  try {
    const built = await buildTaxMonth(month, { fresh: true })
    const report = renderTaxReport(month, built.summary, { partial: built.partial, classesCategoryMissing: built.classesCategoryMissing })
    const { sent } = await sendEmail({ to, ...report })
    if (sent) await recordTaxSent(month, { at: new Date().toISOString(), to, by: 'Monthly email' })
    logger.info('Tax report', { month, orders: built.orders, sent })
    return json({ data: { month, orders: built.orders, sent } }, 200)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    logger.error('Tax report failed', { month, error })
    await sendEmail({ to, ...taxFailureEmail(month, error) }).catch(() => undefined)
    return json({ error: 'Report failed' }, 502)
  }
}
