/**
 * Where a visitor came from — remembered on their first visit (first touch)
 * and updated on each later visit that arrives with a campaign link or from
 * another site (last touch). Sent along with every booking so our own records
 * say which channel actually books: Google, Facebook, an Instagram link, a
 * texted link, a QR code with ?utm_source=flyer, …
 *
 * Browser-only to capture; `cleanAttribution` is shared with the server, which
 * never trusts the shape it is sent.
 */

export interface Touch {
  /** utm_source, else the referring site's host, else "direct". */
  source: string
  /** utm_medium, else "referral" / "organic" (search engines) / "none". */
  medium: string
  campaign?: string
  content?: string
  term?: string
  /** Google/Facebook ad click ids, when present (proves the click was an ad). */
  gclid?: string
  fbclid?: string
  /** Path the visit landed on, with its query string. */
  landing: string
  /** Full referrer URL (host + path only — no query). */
  referrer?: string
  at: string
}

export interface Attribution {
  first: Touch
  last: Touch
  /** Visits seen so far (a visit = a page load at least 30 minutes after the last). */
  visits: number
}

const KEY = 'hs_attribution'
const LAST_SEEN = 'hs_last_seen'
const VISIT_GAP_MS = 30 * 60 * 1000
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
const SEARCH = /(^|\.)(google|bing|yahoo|duckduckgo|ecosia|baidu|yandex)\./i
const SOCIAL = /(^|\.)(facebook|fb|instagram|t\.co|twitter|x|pinterest|tiktok|youtube|nextdoor|linkedin|reddit)\./i

const clip = (v: unknown, n: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.trim().slice(0, n)
  return t || undefined
}

/** Work out a Touch from a URL + referrer. Pure, for tests. */
export function touchFrom(href: string, referrer: string, now: Date, ownHost: string): Touch | null {
  let url: URL
  try { url = new URL(href) } catch { return null }
  const q = url.searchParams
  let refHost = ''
  let refPath = ''
  try { if (referrer) { const r = new URL(referrer); refHost = r.hostname.replace(/^www\./, ''); refPath = r.pathname } } catch { /* ignore */ }
  const external = refHost && refHost !== ownHost.replace(/^www\./, '')
  const utmSource = clip(q.get('utm_source'), 80)
  const gclid = clip(q.get('gclid'), 200)
  const fbclid = clip(q.get('fbclid'), 200)
  // Only a campaign link, an ad click or another site counts as a new touch;
  // an internal page view or a plain reload keeps what we already know.
  if (!utmSource && !gclid && !fbclid && !external) return null
  const source = utmSource ?? (gclid ? 'google' : fbclid ? 'facebook' : refHost)
  const medium = clip(q.get('utm_medium'), 80)
    ?? (gclid || fbclid ? 'cpc' : SEARCH.test(refHost) ? 'organic' : SOCIAL.test(refHost) ? 'social' : 'referral')
  return {
    source, medium,
    campaign: clip(q.get('utm_campaign'), 120),
    content: clip(q.get('utm_content'), 120),
    term: clip(q.get('utm_term'), 120),
    gclid, fbclid,
    landing: (url.pathname + url.search).slice(0, 300),
    referrer: external ? `${refHost}${refPath}`.slice(0, 200) : undefined,
    at: now.toISOString(),
  }
}

/** Call once per page load (browser). */
export function captureAttribution(): void {
  try {
    const now = new Date()
    const prev = readAttribution()
    const lastSeen = Number(localStorage.getItem(LAST_SEEN) || 0)
    const newVisit = !lastSeen || now.getTime() - lastSeen > VISIT_GAP_MS
    localStorage.setItem(LAST_SEEN, String(now.getTime()))
    const touch = touchFrom(location.href, document.referrer, now, location.hostname)
    if (!prev) {
      const direct: Touch = { source: 'direct', medium: 'none', landing: (location.pathname + location.search).slice(0, 300), at: now.toISOString() }
      const t = touch ?? direct
      localStorage.setItem(KEY, JSON.stringify({ first: t, last: t, visits: 1 } satisfies Attribution))
      return
    }
    const next: Attribution = { ...prev, visits: prev.visits + (newVisit ? 1 : 0), last: touch ?? prev.last }
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch { /* storage blocked: nothing to remember */ }
}

/** What we know about this visitor, or null. Expires after 90 days. */
export function readAttribution(): Attribution | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const a = cleanAttribution(JSON.parse(raw))
    if (!a || Date.now() - Date.parse(a.first.at) > MAX_AGE_MS) return null
    return a
  } catch { return null }
}

function cleanTouch(t: any): Touch | null {
  if (!t || typeof t !== 'object') return null
  const source = clip(t.source, 80)
  const medium = clip(t.medium, 80)
  const landing = clip(t.landing, 300)
  const at = clip(t.at, 40)
  if (!source || !medium || !landing || !at || Number.isNaN(Date.parse(at))) return null
  const out: Touch = { source, medium, landing, at }
  for (const [k, n] of [['campaign', 120], ['content', 120], ['term', 120], ['gclid', 200], ['fbclid', 200], ['referrer', 200]] as const) {
    const v = clip(t[k], n)
    if (v) (out as any)[k] = v
  }
  return out
}

/** Validates an attribution object from an untrusted source (the browser). */
export function cleanAttribution(raw: unknown): Attribution | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as any
  const first = cleanTouch(r.first)
  const last = cleanTouch(r.last) ?? first
  if (!first || !last) return null
  const visits = Number.isInteger(r.visits) && r.visits > 0 && r.visits < 100000 ? r.visits : 1
  return { first, last, visits }
}
