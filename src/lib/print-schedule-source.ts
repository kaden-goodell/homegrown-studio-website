/**
 * The events the window schedule prints: exactly what the public calendar
 * (/api/calendar.json) shows for those dates, asked as a stranger would (no
 * test-link cookie), so anything the website hides (open party times while
 * booking is paused, link-only classes, classes moved off Square) stays off
 * the sheet too, with no second copy of those rules.
 */
import type { CalendarEvent } from '@components/calendar/calendar-view-model'
import { GET as calendarGET } from '../pages/api/calendar.json'

export async function publicScheduleEvents(origin: string, fromYmd: string, toYmd: string): Promise<{ events: CalendarEvent[]; incomplete: boolean }> {
  const first = fromYmd.slice(0, 7)
  const [fy, fm] = first.split('-').map(Number)
  const [ty, tm] = toYmd.slice(0, 7).split('-').map(Number)
  const months = (ty - fy) * 12 + (tm - fm) + 1
  const url = new URL(`/api/calendar.json?month=${first}&months=${months}`, origin)
  const request = new Request(url)
  const res = await (calendarGET as unknown as (ctx: { url: URL; request: Request }) => Promise<Response>)({ url, request })
  if (!res.ok) throw new Error(`calendar answered ${res.status}`)
  const body = (await res.json()) as { events?: CalendarEvent[]; incomplete?: boolean }
  const events = (body.events ?? []).filter((e) => e.date >= fromYmd && e.date <= toYmd)
  return { events, incomplete: body.incomplete === true }
}
