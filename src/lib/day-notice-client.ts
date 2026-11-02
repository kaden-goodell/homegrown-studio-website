/**
 * Shows or hides the special-day bar and cards on the visitor's clock (pages
 * are prerendered, so the build can't know). Each `[data-day-notice]` carries
 * the instants it shows between; the bar also stays off the staff, waiver
 * and party-host pages.
 *
 * The build uses the config's café days; the live notices (the owners' saved
 * special days and their announcements, from /api/cafe-hours.json through
 * @lib/site-live) are applied on every page load: a day announced on /admin
 * since the build is added from the page's `<template data-day-notice-template>`,
 * a changed headline or hours show, and a day removed, closed or no longer
 * announced goes away. A failed request leaves the page as it was built.
 */
import { liveSite } from '@lib/site-live'

const QUIET_PATHS = ['/waiver', '/staff', '/admin', '/party/']

/** What /api/cafe-hours.json sends for each announced day (see special-day-notice.ts). */
export interface LiveDayNotice {
  date: string
  hours: string
  regularHours: string
  showFromIso: string
  showUntilIso: string
  /** Sent since announcements became editable on /admin; older answers leave the built words. */
  headline?: string
  weekday?: string
  monthDay?: string
  shortDate?: string
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

const FIELDS: [keyof LiveDayNotice, string][] = [
  ['hours', 'data-day-notice-hours'],
  ['regularHours', 'data-day-notice-regular-hours'],
  ['headline', 'data-day-notice-headline'],
  ['weekday', 'data-day-notice-weekday'],
  ['monthDay', 'data-day-notice-month-day'],
  ['shortDate', 'data-day-notice-short-date'],
]

function fill(el: HTMLElement, live: LiveDayNotice): void {
  el.dataset.from = live.showFromIso
  el.dataset.until = live.showUntilIso
  for (const [key, attr] of FIELDS) {
    const value = live[key]
    if (typeof value !== 'string') continue
    el.querySelectorAll(`[${attr}]`).forEach((s) => { s.textContent = value })
  }
  el.querySelectorAll<HTMLElement>('[data-day-notice-regular]').forEach((s) => { s.hidden = !live.regularHours })
  if (live.headline && live.shortDate && el.hasAttribute('aria-label')) el.setAttribute('aria-label', `${live.headline}, ${live.shortDate}`)
}

/** Adds a bar or card for each live notice the page was built without (from the page's templates). */
function addMissing(notices: LiveDayNotice[]): void {
  document.querySelectorAll<HTMLTemplateElement>('template[data-day-notice-template]').forEach((tpl) => {
    const kind = tpl.dataset.dayNoticeTemplate
    for (const live of notices) {
      if (!live.headline) continue // an older answer can't fill a new one
      if (document.querySelector(`[data-day-notice="${kind}"][data-date="${live.date}"]`)) continue
      const node = tpl.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined
      if (!node) continue
      node.dataset.date = live.date
      node.hidden = true
      tpl.parentNode?.insertBefore(node, tpl)
    }
  })
}

/** Puts the live notices into the page's bars and cards (adding any the build didn't have), then shows the right ones. */
export function applyLiveDayNotices(notices: LiveDayNotice[], now = Date.now(), path = window.location.pathname): void {
  addMissing(notices)
  document.querySelectorAll<HTMLElement>('[data-day-notice][data-date]').forEach((el) => {
    const live = notices.find((n) => n.date === el.dataset.date)
    if (!live) {
      // Removed, closed or no longer announced since the build: never shown.
      el.dataset.from = ''
      el.dataset.until = ''
      return
    }
    fill(el, live)
  })
  showDayNotices(now, path)
}

async function refresh(): Promise<void> {
  showDayNotices()
  if (!document.querySelector('[data-day-notice], template[data-day-notice-template]')) return
  const site = await liveSite()
  if (site && Array.isArray(site.notices)) applyLiveDayNotices(site.notices as LiveDayNotice[])
}

if (typeof document !== 'undefined') document.addEventListener('astro:page-load', () => { void refresh() })
