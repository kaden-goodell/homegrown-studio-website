/**
 * Page-wide tracking that needs no per-button code: remembers where the
 * visitor came from, and reports every call / text / email / directions tap
 * (a lead), every "book" call-to-action, header/footer navigation, the phone
 * menu, FAQ answers opened, and any element marked `data-track-event`
 * (with `data-track-props` JSON) — with which part of the page it was in.
 * Anything inside `[data-track-ignore]` is left alone. Loaded by
 * Analytics.astro on every customer page.
 */
import { captureAttribution } from '@lib/attribution'
import { trackContactClick, trackCtaClick, trackFaqOpen, trackMarkupEvent, trackNavClick, trackNavMenuOpen } from '@lib/analytics'
import { autoEventFor, whereOf } from '@lib/analytics-where'

export { whereOf, contactMethod, parseTrackProps, autoEventFor } from '@lib/analytics-where'

function onClick(e: MouseEvent) {
  const target = e.target instanceof Element ? e.target : null
  if (!target) return
  try {
    const ev = autoEventFor(target, location.pathname)
    if (!ev) return
    if (ev.kind === 'contact') trackContactClick(ev.method, ev.where)
    else if (ev.kind === 'cta') trackCtaClick(ev.label, ev.where, ev.href)
    else if (ev.kind === 'nav') trackNavClick(ev.label, ev.where, ev.href)
    else if (ev.kind === 'menu_open') trackNavMenuOpen()
    else trackMarkupEvent(ev.event, ev.props)
  } catch { /* analytics never gets in the way of a click */ }
}

/** `<details data-track-faq>` opened. `toggle` doesn't bubble, so listen in the capture phase. */
function onToggle(e: Event) {
  const el = e.target
  if (!(el instanceof HTMLDetailsElement) || !el.open || !el.hasAttribute('data-track-faq')) return
  try {
    const question = el.dataset.trackFaq || el.querySelector('summary')?.textContent?.trim().replace(/\s+/g, ' ') || 'faq'
    trackFaqOpen(question, whereOf(el, location.pathname))
  } catch { /* ignore */ }
}

captureAttribution()
document.addEventListener('click', onClick, { capture: true })
document.addEventListener('toggle', onToggle, { capture: true })
