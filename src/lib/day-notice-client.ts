/**
 * Shows or hides the special-day bar and cards on the visitor's clock (pages
 * are prerendered, so the build can't know). Each `[data-day-notice]` carries
 * the instants it shows between; the bar also stays off the staff, waiver
 * and party-host pages.
 */
const QUIET_PATHS = ['/waiver', '/staff', '/admin', '/party/']

export function showDayNotices(now = Date.now(), path = window.location.pathname): void {
  const quiet = QUIET_PATHS.some((p) => path.startsWith(p))
  document.querySelectorAll<HTMLElement>('[data-day-notice]').forEach((el) => {
    const from = Date.parse(el.dataset.from ?? '')
    const until = Date.parse(el.dataset.until ?? '')
    const inWindow = now >= from && now < until
    el.hidden = !inWindow || (el.dataset.dayNotice === 'bar' && quiet)
  })
}

if (typeof document !== 'undefined') document.addEventListener('astro:page-load', () => showDayNotices())
