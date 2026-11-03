/**
 * The pieces of scripts/seed-demo.ts that need no live site: where it may
 * read the real studio's classes from (GET only), how a live class becomes
 * demo content on the preview, and which date it lands on. Unit tested in
 * tests/scripts/seed-demo.test.ts.
 *
 * Writes only ever go to the branch preview (PreviewClient refuses any other
 * host). The live site and the live Square catalog are only ever READ.
 */
import { ageLabel, isDropOff } from '../../../src/lib/workshop-copy'
import { addDays, chicagoDate, chicagoToUtcIso } from '../sandbox-e2e/core'

/** Every library entry the seed makes carries this note (on its first version), so --remove finds exactly those. */
export const DEMO_NOTE = 'Demo seed (scripts/seed-demo.ts)'
/** Seats per demo class unless a scenario says otherwise (Kaden: 35 unless told otherwise). */
export const DEMO_CAPACITY = 35

/** The live site, read for its public class list only. */
export const LIVE_ORIGIN = 'https://ourhometownstudio.com'
/** Square's LIVE API: catalog reads only (GET). */
export const LIVE_SQUARE_ORIGIN = 'https://connect.squareup.com'
/** Where Square keeps the live catalog photos. */
export const LIVE_IMAGES_HOST = 'items-images-production.s3.us-west-2.amazonaws.com'

const READ_HOSTS = new Set([new URL(LIVE_ORIGIN).host, new URL(LIVE_SQUARE_ORIGIN).host, LIVE_IMAGES_HOST])

export class RefusedSourceError extends Error {}

/**
 * A live URL the seed may READ: https, no user info, one of the three live
 * hosts, and only ever with GET. Anything else throws before a request is made.
 */
export function assertReadOnlySource(raw: string | URL, method = 'GET'): URL {
  if (method.toUpperCase() !== 'GET') throw new RefusedSourceError(`Refusing ${method} to a live host: the seed only reads the live studio.`)
  let url: URL
  try {
    url = new URL(String(raw))
  } catch {
    throw new RefusedSourceError(`Refusing a URL that does not parse: ${String(raw).slice(0, 80)}`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || !READ_HOSTS.has(url.host)) {
    throw new RefusedSourceError(`Refusing to read ${url.protocol}//${url.host}: the seed only reads ${[...READ_HOSTS].join(', ')}.`)
  }
  return url
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** GETs on the live hosts only (never a redirect followed off them). */
export class LiveReader {
  constructor(private fetchImpl: FetchLike = fetch, private squareToken: string | null = null) {}

  private async get(raw: string, headers: Record<string, string> = {}): Promise<Response> {
    const url = assertReadOnlySource(raw, 'GET')
    const res = await this.fetchImpl(url.toString(), { method: 'GET', headers, redirect: 'manual' })
    if (res.status < 200 || res.status >= 300) throw new Error(`Reading ${url.host}${url.pathname} answered ${res.status}`)
    return res
  }

  /** The live site's public class list (what /workshops shows customers today). */
  async workshops(): Promise<LiveWorkshop[]> {
    const res = await this.get(`${LIVE_ORIGIN}/api/workshops.json`, { Accept: 'application/json' })
    const body: any = await res.json()
    return Array.isArray(body?.workshops) ? body.workshops : []
  }

  /** Every live catalog object of these types (GET /v2/catalog/list, paged). Needs the live token. */
  async catalog(types: string): Promise<any[]> {
    if (!this.squareToken) throw new Error('No SQUARE_ACCESS_TOKEN in .env, so the live catalog cannot be read.')
    const out: any[] = []
    let cursor: string | undefined
    do {
      const u = new URL(`${LIVE_SQUARE_ORIGIN}/v2/catalog/list`)
      u.searchParams.set('types', types)
      if (cursor) u.searchParams.set('cursor', cursor)
      const res = await this.get(u.toString(), { Authorization: `Bearer ${this.squareToken}`, 'Square-Version': '2026-01-22', Accept: 'application/json' })
      const page: any = await res.json()
      out.push(...(page?.objects ?? []))
      cursor = page?.cursor || undefined
    } while (cursor)
    return out
  }

  /** A live photo's bytes and type (JPEG, PNG or WebP only). */
  async photo(raw: string): Promise<{ bytes: Uint8Array; type: string }> {
    const res = await this.get(raw)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const type = sniffImage(bytes)
    if (!type) throw new Error(`The photo at ${new URL(raw).pathname.slice(0, 60)} is not a JPEG, PNG or WebP`)
    return { bytes, type }
  }
}

/** What the bytes are (the preview's upload checks the same magic numbers). */
export function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  const latin = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to))
  if (b.length > 12 && latin(0, 4) === 'RIFF' && latin(8, 12) === 'WEBP') return 'image/webp'
  return null
}

/** One class on the live site's /api/workshops.json (only what the seed uses). */
export interface LiveWorkshop {
  name: string
  description?: string | null
  startTime: string
  endTime?: string | null
  duration?: number | null
  price: number
  taxPercent?: number | null
  imageUrl?: string | null
}

/** A live class as library content on the preview: its words, price, ages and length; the photo is filled in later. */
export function contentFromLive(w: LiveWorkshop, capacity = DEMO_CAPACITY): any {
  const minutes = Math.min(1440, Math.max(5, Math.round(w.duration || minutesBetween(w.startTime, w.endTime) || 120)))
  return {
    name: w.name.trim().slice(0, 80),
    description: (w.description ?? '').trim(),
    imageUrl: null,
    instructor: null,
    rules: { ages: ageLabel(w.description), dropOff: isDropOff(w.description), taxable: w.taxPercent !== 0, linkOnly: false, maxPerBooking: 10 },
    ticketTypes: [{ id: 'person', label: 'Person' }],
    passes: [{ id: 'all', label: 'Full class', covers: { kind: 'all' } }],
    prices: { all: { person: Math.max(0, Math.round(w.price)) } },
    questions: [],
    addOns: [],
    defaultCapacity: capacity,
    defaultMinutes: minutes,
  }
}

function minutesBetween(a: string, b?: string | null): number {
  if (!b) return 0
  const ms = Date.parse(b) - Date.parse(a)
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60_000) : 0
}

/**
 * Where a live class goes on the preview: its own date and time when that is
 * still at least `leadHours` away, else the same weekday and time a week (or
 * more) later.
 */
export function slotFor(startIso: string, minutes: number, now: Date, leadHours = 2): { startIso: string; endIso: string } {
  let start = Date.parse(startIso)
  if (!Number.isFinite(start)) throw new Error(`Not a time: ${startIso}`)
  const ymd0 = chicagoDate(start)
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(start))
  let weeks = 0
  while (start < now.getTime() + leadHours * 3_600_000) {
    weeks++
    start = Date.parse(chicagoToUtcIso(addDays(ymd0, 7 * weeks), hhmm))
  }
  return { startIso: new Date(start).toISOString(), endIso: new Date(start + minutes * 60_000).toISOString() }
}

/** A library entry the seed made: its first version carries DEMO_NOTE. */
export function isDemoLibrary(lib: any): boolean {
  return Array.isArray(lib?.versions) && lib.versions.some((v: any) => v?.note === DEMO_NOTE)
}

/** The library entry's current name. */
export const libraryName = (lib: any): string => String(lib?.versions?.at?.(-1)?.content?.name ?? '')

/** Run options: --remove, --dry-run, --help. */
export interface SeedArgs { remove: boolean; dryRun: boolean; help: boolean }
export function parseSeedArgs(argv: string[]): SeedArgs {
  const out: SeedArgs = { remove: false, dryRun: false, help: false }
  for (const a of argv) {
    if (a === '--remove') out.remove = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--help' || a === '-h') out.help = true
    else throw new Error(`Unknown option ${a}. Use --remove, --dry-run or --help.`)
  }
  if (out.remove && out.dryRun) throw new Error('--remove and --dry-run go separately.')
  return out
}
