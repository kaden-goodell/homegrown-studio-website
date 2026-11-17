/**
 * Rage taps anywhere on the site text Kaden (Kaden, 16 Nov 2026: "add all rage
 * clicks to alerts"). Apple Pay on parties did nothing from July to November;
 * the Oct 20 customer tapped it 28 times and nobody knew.
 *
 * Three or more taps on the same thing within a second, close together, is a
 * rage tap. Reported once per thing per page load through the same browser
 * alarm the booking pop-ups use (/api/alerts/client.json, problem 'rage').
 *
 * Privacy: only the page path and a short label for what was tapped (its
 * aria-label or button/link text). On owner and staff screens (names, phones,
 * allergies on screen) the label is left out: just the kind of thing tapped.
 *
 * Client-safe. Never throws, never blocks a tap.
 */

export const RAGE_TAPS = 3
export const RAGE_WINDOW_MS = 1000
export const RAGE_RADIUS_PX = 40

const PRIVATE_PATHS = /^\/(staff|admin|waiver|party\/|invite)/

/** The thing a person meant to tap: the nearest button/link/input, or the element itself. */
export function tapTarget(path: EventTarget[]): Element | null {
  for (const t of path) {
    if (!(t instanceof Element)) continue
    if (t.matches('button, a, [role=button], input, select, label, summary, apple-pay-button, [onclick]')) return t
  }
  const first = path.find((t): t is Element => t instanceof Element)
  return first ?? null
}

/** A short, safe name for it: "button 'Pay with Apple Pay'". */
export function describe(el: Element, page: string): string {
  const kind = el.tagName.toLowerCase()
  if (PRIVATE_PATHS.test(page)) return kind
  const label = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
  return label ? `${kind} "${label}"` : kind
}

interface Tap { at: number; x: number; y: number; el: Element }

/** Pure detector, so it can be tested: true when this tap makes a rage tap. */
export function isRage(history: Tap[], tap: Tap): boolean {
  const recent = history.filter((t) => tap.at - t.at <= RAGE_WINDOW_MS && t.el === tap.el && Math.hypot(t.x - tap.x, t.y - tap.y) <= RAGE_RADIUS_PX)
  return recent.length + 1 >= RAGE_TAPS
}

export function startRageWatch(send: (body: string) => void = beacon): () => void {
  if (typeof window === 'undefined') return () => {}
  const history: Tap[] = []
  const reported = new Set<Element>()
  const onClick = (e: MouseEvent) => {
    try {
      const el = tapTarget(e.composedPath())
      if (!el) return
      const tap = { at: performance.now(), x: e.clientX, y: e.clientY, el }
      const rage = isRage(history, tap)
      history.push(tap)
      while (history.length > 10) history.shift()
      if (!rage || reported.has(el)) return
      reported.add(el)
      const page = window.location.pathname.slice(0, 80)
      send(JSON.stringify({ kind: 'site', problem: 'rage', detail: describe(el, page), page }))
    } catch {
      /* an alarm must never break the page */
    }
  }
  // Capture phase, so a button that swallows the tap is still seen.
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}

function beacon(body: string): void {
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon('/api/alerts/client.json', new Blob([body], { type: 'application/json' }))
  }
}
