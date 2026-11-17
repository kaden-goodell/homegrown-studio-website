/**
 * Browser side of Jessyca's visit log (/quote/corky-christmas). Keeps a
 * per-browser visitor id (localStorage) and a per-load session id, counts the
 * time the page is on screen, the deepest scroll, and what she taps, and sends
 * the running totals to /api/quote/corky-visit.json with sendBeacon: once on
 * load, shortly after a tap, and when the page is hidden or left.
 *
 * Other parts of the page report through a window event:
 *   window.dispatchEvent(new CustomEvent('corky-visit', { detail: { type: 'sheet' } }))
 * ('sheet' | 'pay' | 'paid'; 'pay' is sent right away so the deposit text sees it).
 */

const VISITOR_KEY = 'hts-corky-visitor'
const ENDPOINT = '/api/quote/corky-visit.json'
const MAX_EVENTS = 50

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36)
  }
}

/** This browser's visitor id, or null if none was ever made (storage blocked). */
export function readVisitorId(): string | null {
  try {
    const v = localStorage.getItem(VISITOR_KEY)
    return v && /^[A-Za-z0-9-]{8,40}$/.test(v) ? v : null
  } catch {
    return null
  }
}

function visitorId(): string {
  const have = readVisitorId()
  if (have) return have
  const id = newId()
  try { localStorage.setItem(VISITOR_KEY, id) } catch { /* private mode: one id per load */ }
  return id
}

export function deviceKind(ua: string, touchPoints = 0): string {
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'iPad'
  if (/iPhone|iPod/.test(ua)) return 'iPhone'
  if (/Android/.test(ua)) return 'Android'
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  return 'other'
}

function referrerDomain(): string | null {
  try {
    if (!document.referrer) return null
    const host = new URL(document.referrer).hostname
    return host && host !== location.hostname ? host : null
  } catch {
    return null
  }
}

export function startCorkyVisit(): void {
  if (typeof window === 'undefined') return
  const start = Date.now()
  const state = {
    visitorId: visitorId(),
    sessionId: newId(),
    device: deviceKind(navigator.userAgent, navigator.maxTouchPoints || 0),
    referrer: referrerDomain(),
    activeSeconds: 0,
    scroll: 0,
    events: [] as { type: string; id?: string; at: number }[],
    pick: null as string | null,
  }
  let shownSince: number | null = document.visibilityState === 'visible' ? Date.now() : null
  let banked = 0
  let timer: number | undefined

  const active = () => Math.round((banked + (shownSince ? Date.now() - shownSince : 0)) / 1000)
  const at = () => Math.round((Date.now() - start) / 1000)

  function measureScroll() {
    const doc = document.documentElement
    const total = doc.scrollHeight
    if (!total) return
    const pct = Math.min(100, Math.round(((window.scrollY + window.innerHeight) / total) * 100))
    if (pct > state.scroll) state.scroll = pct
  }

  function send() {
    window.clearTimeout(timer)
    timer = undefined
    state.activeSeconds = active()
    measureScroll()
    const body = JSON.stringify(state)
    try {
      if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'text/plain' }))) return
    } catch { /* fall through */ }
    fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => undefined)
  }
  const soon = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(send, 1500)
  }
  const record = (type: string, id?: string) => {
    if (state.events.length < MAX_EVENTS) state.events.push(id ? { type, id, at: at() } : { type, at: at() })
  }

  document.querySelectorAll<HTMLElement>('.theme').forEach((card) =>
    card.addEventListener('click', () => {
      const id = card.dataset.id
      if (!id) return
      state.pick = id
      record('pick', id)
      soon()
    }),
  )
  document.getElementById('textpick')?.addEventListener('click', () => {
    record('text')
    send()
  })
  window.addEventListener('corky-visit', (e) => {
    const type = (e as CustomEvent<{ type?: string }>).detail?.type
    if (type !== 'sheet' && type !== 'pay' && type !== 'paid') return
    record(type)
    if (type === 'sheet') soon()
    else send()
  })
  window.addEventListener('scroll', measureScroll, { passive: true })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (shownSince === null) shownSince = Date.now()
    } else {
      if (shownSince !== null) banked += Date.now() - shownSince
      shownSince = null
      send()
    }
  })
  window.addEventListener('pagehide', send)
  send()
}

/** For the deposit island and the page: tell the visit log something happened. */
export function noteVisit(type: 'sheet' | 'pay' | 'paid'): void {
  try {
    window.dispatchEvent(new CustomEvent('corky-visit', { detail: { type } }))
  } catch { /* never in the way */ }
}
