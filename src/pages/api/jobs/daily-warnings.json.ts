import type { APIRoute } from 'astro'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { siteConfig } from '@config/site.config'
import { SITE_URL } from '@config/site-url'
import { createLogger } from '@lib/logger'
import { sendEmail } from '@lib/email'
import { addDays } from '@lib/kit-dates'
import { studioDate } from '@lib/studio-time'
import { listWarnings, warningLine, WARNING_WINDOW_DAYS } from '@lib/warnings'

export const prerender = false
const logger = createLogger('api:jobs:daily-warnings')

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

/** The key the scheduled function sends: made from a secret only the site holds. */
export function dailyWarningsJobKey(secret: string): string {
  return createHmac('sha256', secret).update('job:daily-warnings').digest('hex')
}

function allowed(request: Request): boolean {
  const secret = env('LOOKUP_SIGNING_SECRET')
  if (!secret) return false
  const given = Buffer.from(request.headers.get('x-job-key') ?? '')
  const wanted = Buffer.from(dailyWarningsJobKey(secret))
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Run each morning by netlify/functions/daily-warnings.ts: the same scan as
 * the staff panel, emailed to the owners only when something needs a person.
 * Read-only; it changes nothing anywhere.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!allowed(request)) return json({ error: 'Unauthorized' }, 401)

  const from = studioDate(new Date().toISOString())
  const to = addDays(from, WARNING_WINDOW_DAYS - 1)
  let warnings
  try {
    warnings = await listWarnings({ from, to })
  } catch (err) {
    logger.error('Daily warnings scan failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'Scan failed' }, 503)
  }
  if (warnings.length === 0) return json({ data: { count: 0, sent: false } }, 200)

  const lines = warnings.map(warningLine)
  const subject = `⚠ Studio schedule needs attention (${warnings.length})`
  const footer = 'Nothing has been changed. Each line needs a person, in Square.'
  const text = [...lines, '', `Open the staff console: ${SITE_URL}/staff`, '', footer].join('\n')
  const html = `<div style="max-width:560px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#b91c1c;">${esc(subject)}</p>
  <ul style="margin:0 0 12px;padding-left:18px;">${lines.map((l) => `<li style="margin:0 0 6px;font-size:14px;color:#3d3630;">${esc(l)}</li>`).join('')}</ul>
  <p style="margin:0 0 10px;"><a href="${esc(SITE_URL)}/staff" style="color:#7a4a2e;font-weight:600;">Open the staff console</a></p>
  <p style="margin:0;font-size:13px;color:#6f635b;">${esc(footer)}</p>
</div>`

  const { sent } = await sendEmail({ to: siteConfig.ownerEmails.join(', '), subject, html, text })
  return json({ data: { count: warnings.length, sent } }, 200)
}
