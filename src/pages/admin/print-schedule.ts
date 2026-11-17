import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { createLogger } from '@lib/logger'
import { publicScheduleEvents } from '@lib/print-schedule-source'
import { addDays, buildDays, isYmd, LAYOUTS, MAX_DAYS, mondayOf, renderPrintSchedule, SHOWS, type PrintLayout, type PrintShow } from '@lib/print-schedule'
import { localDate } from '@lib/party-slots'

export const prerender = false
const logger = createLogger('page:admin-print-schedule')

const html = (status: number, body: string) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } })

/**
 * GET /admin/print-schedule?from=YYYY-MM-DD&days=7&layout=list|cards|poster&show=full|cafe|workshops[&print=1]
 * Owners only. The window schedule, letter pages, from the public calendar.
 * `print=1` opens the print dialog once the fonts are in.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!(await adminAuthorized(request))) return new Response(null, { status: 302, headers: { Location: '/admin', 'Cache-Control': 'no-store' } })
  const q = url.searchParams
  const layout = (LAYOUTS.find((l) => l.id === q.get('layout'))?.id ?? 'list') as PrintLayout
  const show = (SHOWS.find((s) => s.id === q.get('show'))?.id ?? 'full') as PrintShow
  const from = isYmd(q.get('from')) ? q.get('from')! : addDays(mondayOf(localDate(new Date().toISOString())), 7)
  const days = Math.min(Math.max(Number(q.get('days')) || 7, 1), MAX_DAYS)
  try {
    const { events, incomplete } = await publicScheduleEvents(url.origin, from, addDays(from, days - 1))
    const body = renderPrintSchedule({ days: buildDays(events, from, days, show), layout, show, autoPrint: q.get('print') === '1' })
    // A part of the calendar that didn't load would print an emptier week than the real one: say so on screen only.
    const warn = incomplete
      ? '<div style="position:fixed;top:0;left:0;right:0;background:#b5523b;color:#fff;font:600 15px Inter,sans-serif;padding:10px 16px;text-align:center" class="noprint">Part of the schedule didn’t load. Close this and try again before printing.</div><style>@media print{.noprint{display:none}}</style>'
      : ''
    return html(200, warn ? body.replace('<body>', `<body>${warn}`) : body)
  } catch (e) {
    logger.error('Print schedule failed', { error: e instanceof Error ? e.message : String(e) })
    return html(503, '<!doctype html><meta charset="utf-8"><title>Didn’t load</title><body style="font-family:system-ui;padding:40px;text-align:center"><h1>The schedule didn’t load</h1><p>Try again in a minute.</p><a href="/admin#more-schedule">Back</a></body>')
  }
}
