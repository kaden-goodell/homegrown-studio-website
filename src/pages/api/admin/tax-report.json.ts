import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { recordAudit } from '@lib/audit'
import { sendEmail } from '@lib/email'
import { rateLimited } from '@lib/rate-limit'
import { renderTaxReport, taxReportCsv } from '@lib/tax-report'
import { buildTaxMonth, lastTaxSent, recordTaxSent, taxReportRecipients } from '@lib/tax-report-store'
import { monthOf } from './reports.json'

export const prerender = false

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
export const SQUARE_UNREADABLE = 'Square couldn’t be asked for that month just now. Try again in a minute.'

function monthRefusal(month: unknown): string | null {
  if (typeof month !== 'string' || !MONTH_RE.test(month)) return 'Pick a month.'
  if (month > monthOf(new Date())) return 'That month hasn’t happened yet.'
  return null
}

/**
 * The tax split for one month (G7), owners only. Read-only on Square.
 *
 * GET ?month=2026-10            → { data: TaxMonth & { lastSent } }
 * GET ?month=2026-10&fresh=1    → the same, asked of Square again
 * GET ?month=2026-10&format=csv → the spreadsheet, as a download
 * POST { month, action: 'send' } → emails that month's report to the tax
 *   report list again ("Send it again"); audited.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const params = (url ?? new URL(request.url)).searchParams
  const month = params.get('month')
  const refused = monthRefusal(month)
  if (refused) return json(400, { error: refused })
  try {
    // Ask Square again: at most 10 times a month per 10 minutes; past that, the remembered numbers are shown.
    const fresh = params.get('fresh') === '1' && !rateLimited(`tax-fresh:${month}`, 10, 10 * 60_000)
    const report = await buildTaxMonth(month!, { fresh })
    if (params.get('format') === 'csv') {
      return new Response(taxReportCsv([report]), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="hometown-tax-${month}${report.partial ? '-so-far' : ''}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }
    return json(200, { data: { ...report, lastSent: await lastTaxSent(month!) } })
  } catch (e) {
    console.error(`[admin/tax-report] ${month}: ${e instanceof Error ? e.message : e}`)
    return json(503, { error: SQUARE_UNREADABLE })
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => ({}))
  if (body?.action !== 'send') return json(400, { error: 'That didn’t work. Try again.' })
  const month = body?.month
  const refused = monthRefusal(month)
  if (refused) return json(400, { error: refused })
  if (rateLimited(`tax-report-send:${month}`, 5, 10 * 60_000)) return json(429, { error: 'It was just sent a few times. Check the inbox, or wait ten minutes.' })
  const recipients = taxReportRecipients()
  const to = recipients.join(', ')
  let report
  try {
    report = await buildTaxMonth(month)
  } catch (e) {
    console.error(`[admin/tax-report] send ${month}: ${e instanceof Error ? e.message : e}`)
    return json(503, { error: SQUARE_UNREADABLE })
  }
  const email = renderTaxReport(month, report.summary, { partial: report.partial, classesCategoryMissing: report.classesCategoryMissing })
  const { sent } = await sendEmail({ to, ...email }).catch(() => ({ sent: false }))
  const by = adminActor(request)
  await recordAudit({ by: { ...by, role: 'owner' }, action: 'tax-report-send', target: { kind: 'tax-report', id: month, label: email.subject }, details: { to, sent } })
  if (!sent) return json(502, { error: 'The email didn’t go. Download it instead, or try again later.' })
  const at = new Date().toISOString()
  await recordTaxSent(month, { at, to, by: by.name })
  return json(200, { data: { sent: true, to, at } })
}
