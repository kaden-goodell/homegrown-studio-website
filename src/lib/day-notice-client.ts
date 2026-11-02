/**
 * Shows or hides the special-day bar and cards on the visitor's clock (pages
 * are prerendered, so the build can't know). Each `[data-day-notice]` carries
 * the instants it shows between; the bar also stays off the staff, waiver
 * and party-host pages.
 *
 * The build uses the config's café hours; while a notice is showing, the live
 * notices (the owners' saved café hours, from /api/cafe-hours.json) are
 * swapped in: a day removed or closed on /admin since the build goes away,
 * and changed hours show. A failed request leaves the page as it was.
 */
const QUIET_PATHS = ['/waiver', '/staff', '/admin', '/party/']

/** What /api/cafe-hours.json sends for each announced day (see special-day-notice.ts). */
export interface LiveDayNotice {
  date: string
  hours: string
  regularHours: string
  showFromIso: string
  showUntilIso: string
}

export function showDayNotices(now = Date.now(), path = window.location.pathname): void {
  const quiet = QUIET_PATHS.some((p) => path.startsWith(p))
  document.querySelectorAll<HTMLElement>('[data-day-notice]').forEach((el) => {
    const from = Date.parse(el.dataset.from ?? '')
    const until = Date.parse(el.dataset.until ?? '')
    const inWindow = now >= from && now < until
    el.hidden = !inWindow || (el.dataset.dayNotice === 'bar' && quiet)
  })
}

/** Puts the live notices into the page's bar and cards, then shows the right ones. */
export function applyLiveDayNotices(notices: LiveDayNotice[], now = Date.now(), path = window.location.pathname): void {
  document.querySelectorAll<HTMLElement>('[data-day-notice][data-date]').forEach((el) => {
    const live = notices.find((n) => n.date === el.dataset.date)
    if (!live) {
      // Removed (or closed) since the build: never shown.
      el.dataset.from = ''
      el.dataset.until = ''
      return
    }
    el.dataset.from = live.showFromIso
    el.dataset.until = live.showUntilIso
    el.querySelectorAll('[data-day-notice-hours]').forEach((s) => { s.textContent = live.hours })
    el.querySelectorAll('[data-day-notice-regular-hours]').forEach((s) => { s.textContent = live.regularHours })
    el.querySelectorAll<HTMLElement>('[data-day-notice-regular]').forEach((s) => { s.hidden = !live.regularHours })
  })
  showDayNotices(now, path)
}

let live: Promise<LiveDayNotice[] | null> | null = null

/** The live notices, asked for once per page load (view transitions keep the answer). */
function liveNotices(): Promise<LiveDayNotice[] | null> {
  live ??= fetch('/api/cafe-hours.json')
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => (Array.isArray(json?.data?.notices) ? (json.data.notices as LiveDayNotice[]) : null))
    .catch(() => null)
  return live
}

async function refresh(): Promise<void> {
  showDayNotices()
  // Only while a notice is up (a few weeks a year): no request on ordinary days.
  if (!document.querySelector('[data-day-notice][data-date]:not([hidden])')) return
  const notices = await liveNotices()
  if (notices) applyLiveDayNotices(notices)
}

if (typeof document !== 'undefined') document.addEventListener('astro:page-load', () => { void refresh() })
