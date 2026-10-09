/**
 * Page-wide tracking that needs no per-button code: remembers where the
 * visitor came from, and reports every call / text / email / directions tap
 * (a lead) and every "book" call-to-action, with which part of the page it
 * was in. Loaded by Analytics.astro on every customer page.
 */
import { captureAttribution } from '@lib/attribution'
import { trackContactClick, trackCtaClick } from '@lib/analytics'

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

function onClick(e: MouseEvent) {
  const target = e.target as Element | null
  if (!target) return
  const link = target.closest('a[href]') as HTMLAnchorElement | null
  const where = whereOf(target, location.pathname)
  if (link) {
    const method = contactMethod(link.getAttribute('href') ?? '')
    if (method) { trackContactClick(method, where); return }
  }
  const cta = target.closest('[data-open-booking], a[href="/book"], a[href^="/book?"], [data-track-cta]') as HTMLElement | null
  if (cta) {
    const label = cta.dataset.trackCta || cta.textContent?.trim().replace(/\s+/g, ' ') || 'book'
    trackCtaClick(label, where, (cta as HTMLAnchorElement).getAttribute?.('href') ?? undefined)
  }
}

captureAttribution()
document.addEventListener('click', onClick, { capture: true })
