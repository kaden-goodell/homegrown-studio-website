/**
 * Pure helpers for page-wide tracking: which part of the page a click was in,
 * and what a link or a marked element should report. Kept apart from
 * analytics-auto.ts (which starts listening the moment it is imported) so
 * components can use them without a second set of listeners.
 */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

/** "home/hero", "book/footer", "craft-cafe/the-craft-menu"… */
export function whereOf(el: Element, path: string): string {
  const page = slug(path.replace(/^\//, '')) || 'home'
  const marked = el.closest('[data-track-where]') as HTMLElement | null
  if (marked?.dataset.trackWhere) return `${page}/${marked.dataset.trackWhere}`
  if (el.closest('header')) return `${page}/header`
  if (el.closest('footer')) return `${page}/footer`
  if (el.closest('[role="dialog"]')) return `${page}/dialog`
  const section = el.closest('section')
  const heading = section?.querySelector('h1, h2, h3')?.textContent
  return `${page}/${heading ? slug(heading) : 'page'}`
}

export function contactMethod(href: string): 'phone' | 'text' | 'email' | 'directions' | null {
  const h = href.trim().toLowerCase()
  if (h.startsWith('tel:')) return 'phone'
  if (h.startsWith('sms:')) return 'text'
  if (h.startsWith('mailto:')) return 'email'
  if (/(google\.[a-z.]+\/maps|maps\.google\.|maps\.apple\.com|goo\.gl\/maps|maps\.app\.goo\.gl)/.test(h)) return 'directions'
  return null
}

/**
 * `data-track-props` JSON → plain props. Anything that isn't a short string,
 * a number or a true/false is dropped, and bad JSON gives no props — markup
 * typos must never break a click.
 */
export function parseTrackProps(json: string | undefined | null): Record<string, string | number | boolean> {
  if (!json) return {}
  let raw: unknown
  try { raw = JSON.parse(json) } catch { return {} }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(k)) continue
    if (typeof v === 'string') out[k] = v.slice(0, 100)
    else if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') out[k] = v
  }
  return out
}

const clean = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ')

/** What a click should report, worked out from the markup alone. */
export type AutoEvent =
  | { kind: 'contact'; method: 'phone' | 'text' | 'email' | 'directions'; where: string }
  | { kind: 'cta'; label: string; where: string; href?: string }
  | { kind: 'nav'; label: string; where: string; href: string }
  | { kind: 'menu_open' }
  | { kind: 'markup'; event: string; props: Record<string, string | number | boolean> }

export function autoEventFor(target: Element, path: string): AutoEvent | null {
  // Opted out: the click is reported by the component itself (or not at all —
  // e.g. a host emailing their own guests is not a lead).
  if (target.closest('[data-track-ignore]')) return null

  const marked = target.closest('[data-track-event]') as HTMLElement | null
  if (marked?.dataset.trackEvent) {
    return { kind: 'markup', event: marked.dataset.trackEvent, props: parseTrackProps(marked.dataset.trackProps) }
  }

  // The phone menu button, as it opens (this runs before the header's own
  // handler flips aria-expanded).
  const menu = target.closest('#menu-button')
  if (menu) return menu.getAttribute('aria-expanded') === 'true' ? null : { kind: 'menu_open' }

  const where = whereOf(target, path)
  const link = target.closest('a[href]') as HTMLAnchorElement | null
  const href = link?.getAttribute('href') ?? ''
  if (link) {
    const method = contactMethod(href)
    if (method) return { kind: 'contact', method, where }
  }
  const cta = target.closest('[data-open-booking], a[href="/book"], a[href^="/book?"], [data-track-cta]') as HTMLElement | null
  if (cta) {
    const label = cta.dataset.trackCta || clean(cta.textContent) || 'book'
    const ctaHref = cta.getAttribute('href')
    return { kind: 'cta', label, where, ...(ctaHref ? { href: ctaHref } : {}) }
  }
  // Site navigation: an in-site link in the header or footer menus.
  if (link && href.startsWith('/') && !href.startsWith('//') && link.closest('header nav, footer nav')) {
    return { kind: 'nav', label: clean(link.textContent) || href, where, href }
  }
  return null
}
