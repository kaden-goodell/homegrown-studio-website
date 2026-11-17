/**
 * Jessyca's visits to /quote/corky-christmas, kept in our own small log so
 * the deposit text can say what she picked and how she browsed (Kaden,
 * 17 Nov 2026). Privacy-light on purpose: a random per-browser id, the device
 * kind (never the full user agent), the referring site's domain, and what she
 * tapped. No IP, no name until she pays.
 *
 * One record per page load, key `corky-<visitorId>-<sessionId>` in the
 * 'quote-visits' store. The page sends its running totals; the server keeps
 * the larger of old and new (a late or repeated beacon never shrinks a visit).
 */
import { makeKvStore, type KvStore } from '@lib/blob-store'

export const VISIT_PREFIX = 'corky-'
/** Not visits (same store, same prefix; loadVisits skips them). */
export const PAID_KEY = 'corky-paid'
export const FIRST_OPEN_KEY = 'corky-first-open'
export const visitStore = (): KvStore => makeKvStore('quote-visits', 'quote-visits')

export const NIGHTS = [
  { id: 'mosaic', name: 'Mosaics & Plant Bar', short: 'Mosaics' },
  { id: 'tote', name: 'Tote & Keychain Bar', short: 'Tote' },
  { id: 'ornament', name: 'Ornament Bar', short: 'Ornament' },
] as const
export type NightId = (typeof NIGHTS)[number]['id']
/** The night whose card carries "Want it monogrammed? $15 more per person." */
export const MONOGRAM_NIGHT: NightId = 'tote'

export const DEVICES = ['iPhone', 'iPad', 'Android', 'Mac', 'Windows', 'other'] as const
export type Device = (typeof DEVICES)[number]
export const EVENT_TYPES = ['pick', 'sheet', 'text', 'pay', 'paid', 'monoOn', 'monoOff'] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const MAX_EVENTS = 50
const MAX_SECONDS = 24 * 60 * 60
const ID_RE = /^[A-Za-z0-9-]{8,40}$/
const DOMAIN_RE = /^[a-z0-9.-]{1,60}$/

export interface VisitEvent {
  type: EventType
  /** The night, for a 'pick'. */
  id?: NightId
  /** Seconds after the page opened. */
  at: number
}

export interface Visit {
  visitorId: string
  sessionId: string
  /** Server time (ms) we first heard from this page load, and last. */
  first: number
  last: number
  device: Device
  referrer: string | null
  /** Seconds the page was on screen. */
  activeSeconds: number
  /** Deepest scroll, 0–100. */
  scroll: number
  events: VisitEvent[]
  /** The night picked at the latest beacon, or null. */
  pick: NightId | null
}

export const isVisitId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v)
export const nightByName = (v: unknown) => NIGHTS.find((n) => n.name === v) ?? null
const nightById = (v: unknown) => NIGHTS.find((n) => n.id === v) ?? null
const int = (v: unknown, max: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0
  return Math.min(max, Math.max(0, n))
}

/** The page's beacon, checked and clamped. Null when the ids are missing or malformed. */
export function visitFromBeacon(body: any, now: number): Visit | null {
  if (!body || typeof body !== 'object') return null
  if (!isVisitId(body.visitorId) || !isVisitId(body.sessionId)) return null
  const device: Device = (DEVICES as readonly string[]).includes(body.device) ? body.device : 'other'
  const ref = typeof body.referrer === 'string' ? body.referrer.trim().toLowerCase().replace(/^www\./, '') : ''
  const events: VisitEvent[] = []
  if (Array.isArray(body.events)) {
    for (const e of body.events.slice(0, MAX_EVENTS)) {
      if (!e || typeof e !== 'object' || !(EVENT_TYPES as readonly string[]).includes(e.type)) continue
      const ev: VisitEvent = { type: e.type, at: int(e.at, MAX_SECONDS) }
      if (ev.type === 'pick') {
        const n = nightById(e.id)
        if (!n) continue
        ev.id = n.id
      }
      events.push(ev)
    }
  }
  return {
    visitorId: body.visitorId,
    sessionId: body.sessionId,
    first: now,
    last: now,
    device,
    referrer: ref && DOMAIN_RE.test(ref) ? ref : null,
    activeSeconds: int(body.activeSeconds, MAX_SECONDS),
    scroll: int(body.scroll, 100),
    events,
    pick: nightById(body.pick)?.id ?? null,
  }
}

/** Old record + new beacon: keep the earliest start and the largest totals. */
export function mergeVisit(old: Visit | null, next: Visit): Visit {
  if (!old) return next
  return {
    ...next,
    first: Math.min(old.first, next.first),
    last: Math.max(old.last, next.last),
    device: old.device !== 'other' ? old.device : next.device,
    referrer: old.referrer ?? next.referrer,
    activeSeconds: Math.max(old.activeSeconds, next.activeSeconds),
    scroll: Math.max(old.scroll, next.scroll),
    events: next.events.length >= old.events.length ? next.events : old.events,
    pick: next.pick ?? old.pick,
  }
}

export function visitKey(visitorId: string, sessionId: string): string {
  return `${VISIT_PREFIX}${visitorId}-${sessionId}`
}

/** Every recorded page load, oldest first. Unreadable rows are skipped. */
export async function loadVisits(kv: KvStore = visitStore()): Promise<Visit[]> {
  const keys = (await kv.list(VISIT_PREFIX)).filter((k) => k.startsWith(VISIT_PREFIX) && k !== PAID_KEY && k !== FIRST_OPEN_KEY)
  const rows = await Promise.all(keys.map((k) => kv.get(k)))
  const out: Visit[] = []
  for (const r of rows) {
    if (!r) continue
    try {
      const v = JSON.parse(r) as Visit
      if (v && typeof v.first === 'number' && Array.isArray(v.events)) out.push(v)
    } catch { /* skip */ }
  }
  return out.sort((a, b) => a.first - b.first)
}

// ── Summary for the owners ────────────────────────────────────────────────────

const TZ = 'America/Chicago'
/** "Mon Nov 18 9:02 AM", studio time. */
export function studioStamp(ms: number): string {
  const d = new Date(ms)
  const day = d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')
  const time = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
  return `${day} ${time}`
}
const studioDay = (ms: number) => new Date(ms).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' })
const minutes = (s: number) => (s < 60 ? '<1 min' : `${Math.round(s / 60)} min`)
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
const shortName = (id: NightId) => NIGHTS.find((n) => n.id === id)!.short
/** Whether the monogram switch was left on in this visit. */
const lastMono = (v: Visit) => [...v.events].reverse().find((e) => e.type === 'monoOn' || e.type === 'monoOff')?.type === 'monoOn'

export interface VisitSummary {
  visits: number
  devices: number
  firstMs: number | null
  activeSeconds: number
  deepestScroll: number
  /** Taps per night, most first, then page order. */
  taps: { id: NightId; count: number }[]
  textTapped: boolean
  sheetOpened: boolean
  referrers: string[]
  list: Visit[]
}

export function summarize(list: Visit[]): VisitSummary {
  const count = new Map<NightId, number>()
  for (const v of list) for (const e of v.events) if (e.type === 'pick' && e.id) count.set(e.id, (count.get(e.id) ?? 0) + 1)
  const order = NIGHTS.map((n) => n.id)
  return {
    visits: list.length,
    devices: new Set(list.map((v) => v.visitorId)).size,
    firstMs: list.length ? Math.min(...list.map((v) => v.first)) : null,
    activeSeconds: list.reduce((t, v) => t + v.activeSeconds, 0),
    deepestScroll: list.reduce((m, v) => Math.max(m, v.scroll), 0),
    taps: [...count].map(([id, c]) => ({ id, count: c })).sort((a, b) => b.count - a.count || order.indexOf(a.id) - order.indexOf(b.id)),
    textTapped: list.some((v) => v.events.some((e) => e.type === 'text')),
    sheetOpened: list.some((v) => v.events.some((e) => e.type === 'sheet')),
    referrers: [...new Set(list.map((v) => v.referrer).filter((r): r is string => !!r))],
    list,
  }
}

export interface PaidFacts {
  who: string
  phone: string
  email: string
  orderId: string
  night: string | null
  /** Monograms added (only ever true with the tote night). */
  monogram: boolean
  /** The browser that paid, to mark its visits. */
  visitorId: string | null
}

const TEXT_MAX = 300

const pickedLabel = (f: PaidFacts) => `${f.night}${f.monogram ? ' + monograms' : ''}`

/** The paid lock-in, kept so the page shows the date held on any device and a second deposit is refused. */
export interface PaidRecord {
  night: string | null
  monogram: boolean
  paidAt: string
  firstName: string
  receiptUrl: string | null
}

export async function readPaid(kv: KvStore = visitStore()): Promise<PaidRecord | null> {
  const raw = await kv.get(PAID_KEY)
  if (!raw) return null
  try {
    const r = JSON.parse(raw)
    return r && typeof r.paidAt === 'string' ? (r as PaidRecord) : null
  } catch {
    return null
  }
}

/** Create-only: the first payment's record stays. */
export async function savePaid(rec: PaidRecord, kv: KvStore = visitStore()): Promise<boolean> {
  return kv.setIfMatch(PAID_KEY, JSON.stringify(rec), null, false)
}

/** The first-open flag, set once ever (create-only, so two opens at once can't both win). */
export async function claimFirstOpen(device: string, at: number, kv: KvStore = visitStore()): Promise<boolean> {
  return kv.setIfMatch(FIRST_OPEN_KEY, JSON.stringify({ device, at: new Date(at).toISOString() }), null, false)
}

/** "Jessyca opened her Christmas quote: iPhone, Tue 9:14 AM." */
export function firstOpenText(device: string, at: number): string {
  const d = new Date(at)
  const day = d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' })
  const time = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
  return `Jessyca opened her Christmas quote: ${device}, ${day} ${time}.`
}

/** The owners' text: ≤ 300 characters; the visit parts drop off the end first if it runs long. */
export function paidText(f: PaidFacts, s: VisitSummary | null): string {
  const core = [
    'Deposit paid $1,500: Corky Child Care, Sat Dec 12.',
    `${f.who} ${f.phone}.`,
    f.night ? `Picked: ${pickedLabel(f)}.` : 'No night picked yet.',
  ]
  const extra: string[] = []
  if (s) {
    if (s.visits === 0) extra.push('No page visits on record.')
    else {
      extra.push(`${plural(s.visits, 'visit')} on ${plural(s.devices, 'device')} since ${studioDay(s.firstMs!)}, ${minutes(s.activeSeconds)} on page.`)
      extra.push(s.taps.length ? `Tapped ${s.taps.map((t) => `${shortName(t.id)} ×${t.count}`).join(', ')}.` : 'Tapped no nights.')
      if (s.textTapped) extra.push('Tapped "Text us".')
    }
  }
  let parts = [...core, ...extra]
  while (parts.join(' ').length > TEXT_MAX && parts.length > core.length) parts = parts.slice(0, -1)
  const text = parts.join(' ')
  return text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 1)}…` : text
}

/** The owners' email: everything in the text, plus each visit. Plain text; the route wraps it for HTML. */
export function paidEmailLines(f: PaidFacts, s: VisitSummary | null): string[] {
  const lines = [
    'Deposit paid: Corky Child Care Collective, Sat Dec 12, $1,500',
    '',
    `${f.who} · ${f.phone} · ${f.email}`,
    `Square order ${f.orderId}`,
    '',
    f.night
      ? `Picked: ${pickedLabel(f)}${f.monogram ? ' ($15 more a guest, names due Fri, Nov 27)' : nightByName(f.night)?.id === MONOGRAM_NIGHT ? ' (no monograms)' : ''}`
      : 'No night picked yet',
  ]
  if (!s) return lines
  lines.push('')
  if (s.visits === 0) {
    lines.push('No page visits on record.')
    return lines
  }
  lines.push(
    `Visits: ${plural(s.visits, 'visit')} on ${plural(s.devices, 'device')}, first opened ${studioStamp(s.firstMs!)}`,
    `Time on page: ${minutes(s.activeSeconds)} in all · deepest scroll ${s.deepestScroll}%`,
    `Nights tapped: ${s.taps.length ? s.taps.map((t) => `${NIGHTS.find((n) => n.id === t.id)!.name} ×${t.count}`).join(', ') : 'none'}`,
    `Tapped "Text us your pick": ${s.textTapped ? 'yes' : 'no'}`,
    `Opened the deposit sheet: ${s.sheetOpened ? 'yes' : 'no'}`,
  )
  if (s.referrers.length) lines.push(`Came from: ${s.referrers.join(', ')}`)
  const payer = f.visitorId ? s.list.filter((v) => v.visitorId === f.visitorId).at(-1) : undefined
  if (payer) lines.push(`Paid from: ${payer.device}`)
  lines.push('', 'Each visit:')
  for (const v of s.list) {
    const taps = v.events.filter((e) => e.type === 'pick' && e.id).map((e) => shortName(e.id!))
    const did = [
      taps.length ? `tapped ${taps.join(', ')}` : 'no taps',
      ...(v.events.some((e) => e.type === 'monoOn') ? [lastMono(v) ? 'monograms on' : 'monograms on then off'] : []),
      ...(v.events.some((e) => e.type === 'text') ? ['tapped Text us'] : []),
      ...(v.events.some((e) => e.type === 'sheet') ? ['opened deposit'] : []),
      ...(v.events.some((e) => e.type === 'paid') ? ['paid'] : v.events.some((e) => e.type === 'pay') ? ['started paying'] : []),
    ]
    lines.push(`- ${studioStamp(v.first)} · ${v.device} · ${minutes(v.activeSeconds)} · ${v.scroll}% scrolled · ${did.join(' · ')}`)
  }
  return lines
}
