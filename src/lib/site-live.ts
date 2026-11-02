/**
 * Browser side of /api/cafe-hours.json for every page: the site is mostly
 * prerendered, so the footer's studio hours, Google's business details and
 * the special-day bar and cards are built from the config, then corrected
 * here from what the owners saved on /admin (no deploy needed). Asked once
 * per page load (view transitions keep the answer). A failed request leaves
 * the page as it was built.
 *
 * Client-safe: DOM only.
 */
import type { HoursEntry } from '@config/hours'

export interface LiveSite {
  studio?: { days: string; time: string }[]
  studioHours?: HoursEntry[]
  notices?: unknown[]
}

let live: Promise<LiveSite | null> | null = null

export function liveSite(): Promise<LiveSite | null> {
  live ??= fetch('/api/cafe-hours.json')
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => (json?.data && typeof json.data === 'object' ? (json.data as LiveSite) : null))
    .catch(() => null)
  return live
}

/** Forget the answer (tests). */
export function _forgetLiveSite(): void {
  live = null
}

/** The footer's hours list, from the studio hours in force. */
export function applyStudioHours(doc: Document, rows: { days: string; time: string }[] | undefined): void {
  if (!Array.isArray(rows) || !rows.length) return
  for (const box of doc.querySelectorAll<HTMLElement>('[data-studio-hours]')) {
    box.replaceChildren(...rows.map((r) => {
      const row = doc.createElement('div')
      row.className = 'footer-hours-row'
      const dt = doc.createElement('dt')
      dt.textContent = r.days
      const dd = doc.createElement('dd')
      dd.textContent = r.time
      row.append(dt, dd)
      return row
    }))
  }
}

/**
 * Google's business details on the page: the hours in force. Only where the
 * page already publishes hours, or once walk-ins have started (the script
 * carries that date): before then the site doesn't tell Google "come in".
 */
export function applyBusinessHours(doc: Document, hours: HoursEntry[] | undefined, now = Date.now()): void {
  if (!Array.isArray(hours) || !hours.length) return
  for (const el of doc.querySelectorAll<HTMLScriptElement>('script[data-business-jsonld]')) {
    let data: any
    try {
      data = JSON.parse(el.textContent ?? '')
    } catch {
      continue
    }
    const from = Date.parse(el.dataset.hoursFrom ?? '')
    if (!data.openingHoursSpecification && !(Number.isFinite(from) && now >= from)) continue
    data.openingHoursSpecification = hours.map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: h.days, opens: h.opens, closes: h.closes }))
    el.textContent = JSON.stringify(data).replace(/</g, '\\u003c')
  }
}

async function refresh(): Promise<void> {
  if (!document.querySelector('[data-studio-hours], script[data-business-jsonld]')) return
  const site = await liveSite()
  if (!site) return
  applyStudioHours(document, site.studio)
  applyBusinessHours(document, site.studioHours)
}

if (typeof document !== 'undefined') document.addEventListener('astro:page-load', () => { void refresh() })
