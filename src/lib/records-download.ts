/**
 * /admin › More › Records (G8): the legal records for a date range as one zip
 * an owner downloads to her own device. Same kinds of files as the weekly
 * archive (src/lib/archive-export.ts: one `<store>.json` each, plus
 * custody.csv), and a README.txt that says in plain words what each file is.
 *
 * Read-only. Bounded: stores are read a few keys at a time, a download that
 * would take too long or be too big for one file is refused with a plain
 * sentence (pick a shorter range), never cut short. Minors' claims run to age
 * 21 in Alabama, so a partial file that looks complete would be worse than
 * none.
 *
 * "In the range" means a record dated in it (studio days, both ends kept):
 * a signature by when it was signed, an RSVP by when it was made, a check-in
 * household by any of its check-in or pickup events (and the custody file
 * keeps only the events in range), an incident by when it happened or was
 * reported, an audit line by when it was done. A record with no date on it
 * at all (an event's settings) comes along whatever the range, so nothing is
 * left out for want of a date.
 *
 * Then what those records rest on comes along too, whenever it was made
 * (`withWhatTheyRestOn`): for every event with a check-in, incident or RSVP
 * in the range, all its RSVPs; and every waiver those RSVPs, check-ins and
 * incidents name, or that was signed for one of those events. A 7 Nov party's
 * check-in rests on a waiver signed 1 Oct; the file for 7 Nov must hold it.
 *
 * No keys to anything (@lib/export-safety): host and payment-link tokens,
 * card tokens and pickup-code hashes are dropped, as in the weekly archive.
 */
import { strToU8, zipSync } from 'fflate'
import { custodyCsv } from '@lib/archive-export'
import { csvRows, redactSecrets } from '@lib/export-safety'
import { ARCHIVE_STORES } from '@lib/archive-stores'
import { makeKvStore, type KvStore } from '@lib/blob-store'
import { AUDIT_PREFIX } from '@lib/audit'
import { localDate } from '@lib/parties/party-times'
import { RECORD_SECTIONS } from '@lib/records-sections'

export interface RecordsRange { from: string; to: string }

export { RECORD_SECTIONS } from '@lib/records-sections'

const LEGAL_STORES = ['waivers', 'rsvps', 'checkins', 'incidents', 'event-meta', 'audit']

/**
 * Never more than this in one download. The site's reply limit is about 6 MB
 * and a zip goes back base64-encoded (a third bigger), so 4 MB of zip is
 * about 5.4 MB on the wire: well inside it.
 */
export const MAX_RECORDS_BYTES = 4 * 1024 * 1024
/** Give up (and say so) before the site function's own 10-second limit cuts the answer off. */
export const RECORDS_DEADLINE_MS = 8_000
const READ_AT_ONCE = 16

export const TOO_BIG = 'That’s too much for one download. Pick a shorter range.'
export const TOO_SLOW = 'That took too long to gather. Pick a shorter range and try again.'
/** Everything has no range to shorten: offer a year at a time. */
export const TOO_BIG_EVERYTHING = 'That’s too much for one download. Download it a year at a time instead: This year, then Last year, then Pick the days for each year before that.'
export const TOO_SLOW_EVERYTHING = 'That took too long to gather. Download it a year at a time instead: This year, then Last year, then Pick the days for each year before that.'

export class RecordsRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecordsRefusal'
  }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** The refusal for a range she typed, or null. */
export function rangeRefusal(r: Partial<RecordsRange>): string | null {
  if (typeof r.from !== 'string' || typeof r.to !== 'string' || !DAY_RE.test(r.from) || !DAY_RE.test(r.to)) return 'Pick the first and last day.'
  if (r.from > r.to) return 'The first day has to be on or before the last day.'
  return null
}

const DATE_FIELDS = ['signedAt', 'at', 'reportedAt', 'firstAt', 'createdAt'] as const

/** The studio days a record is dated on (empty when it carries no date). Pure. */
export function recordDays(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const v = value as Record<string, any>
  const days: string[] = []
  const add = (iso: unknown) => {
    if (typeof iso === 'string' && !Number.isNaN(Date.parse(iso))) days.push(localDate(iso))
  }
  for (const f of DATE_FIELDS) add(v[f])
  if (Array.isArray(v.events)) for (const e of v.events) add(e?.at)
  if (v.days && typeof v.days === 'object' && !Array.isArray(v.days)) {
    for (const d of Object.keys(v.days)) if (DAY_RE.test(d)) days.push(d)
  }
  return days
}

/** In the range, or carrying no date (kept so nothing is lost for want of one). Pure. */
export function inRange(value: unknown, r: RecordsRange): boolean {
  const days = recordDays(value)
  return days.length === 0 || days.some((d) => d >= r.from && d <= r.to)
}

/** A check-ins export with each household's events cut to the range (for custody.csv). Pure. */
export function checkinsInRange(checkins: Record<string, unknown>, r: RecordsRange): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(checkins)) {
    const events = Array.isArray((v as any)?.events) ? (v as any).events : []
    out[k] = { ...(v as object), events: events.filter((e: any) => typeof e?.at === 'string' && localDate(e.at) >= r.from && localDate(e.at) <= r.to) }
  }
  return out
}

/** "party:<id>" / "<kind>:<id>" for a check-in key's event half (parties are stored bare). */
function canonicalEvent(eventKey: string): string {
  return eventKey.includes(':') ? eventKey : `party:${eventKey}`
}

const eventOf = (e: unknown): string | null => {
  const ev = e as { kind?: unknown; id?: unknown } | null | undefined
  return ev && typeof ev.kind === 'string' && typeof ev.id === 'string' ? `${ev.kind}:${ev.id}` : null
}

/** The event a waiver was signed for (its context, or the old partyId), or null. */
function waiverEvent(w: any): string | null {
  return eventOf(w?.context) ?? (typeof w?.partyId === 'string' ? `party:${w.partyId}` : null)
}

/** The event an index blob in the waivers store lists ("party-index-<id>" / "event-index-<kind>:<id>"), or null. */
function indexEvent(key: string): string | null {
  if (key.startsWith('party-index-')) return `party:${key.slice('party-index-'.length)}`
  if (key.startsWith('event-index-')) return key.slice('event-index-'.length)
  return null
}

/**
 * Add to the ranged records what they rest on, whenever it was made: every
 * RSVP for an event with a check-in, incident or RSVP in range, and every
 * waiver those name (or signed for one of those events). Pure; `all` is the
 * whole of each store, `kept` the dated-in-range part (changed in place).
 */
export function withWhatTheyRestOn(all: Record<string, Record<string, unknown>>, kept: Record<string, Record<string, unknown>>): void {
  const events = new Set<string>()
  const waiverIds = new Set<string>()
  for (const key of Object.keys(kept.checkins ?? {})) {
    const i = key.indexOf('__')
    if (i === -1) continue
    events.add(canonicalEvent(key.slice(0, i)))
    waiverIds.add(key.slice(i + 2))
  }
  for (const inc of Object.values(kept.incidents ?? {}) as any[]) {
    const ev = eventOf(inc?.event)
    if (ev) events.add(ev)
    for (const w of Array.isArray(inc?.who) ? inc.who : []) if (typeof w?.waiverId === 'string') waiverIds.add(w.waiverId)
  }
  for (const r of Object.values(kept.rsvps ?? {}) as any[]) {
    const ev = eventOf(r?.event)
    if (ev) events.add(ev)
  }
  kept.rsvps ??= {}
  for (const [k, r] of Object.entries(all.rsvps ?? {}) as [string, any][]) {
    const ev = eventOf(r?.event)
    if (ev && events.has(ev)) kept.rsvps[k] = r
  }
  for (const r of Object.values(kept.rsvps) as any[]) if (typeof r?.waiverId === 'string') waiverIds.add(r.waiverId)
  for (const [k, v] of Object.entries(all.waivers ?? {})) {
    const ev = indexEvent(k)
    if (!ev || !events.has(ev) || !Array.isArray(v)) continue
    for (const e of v as any[]) {
      const id = typeof e === 'string' ? e : e?.recordId
      if (typeof id === 'string') waiverIds.add(id)
    }
  }
  kept.waivers ??= {}
  for (const [k, w] of Object.entries(all.waivers ?? {}) as [string, any][]) {
    if (indexEvent(k)) continue
    const id = typeof w?.id === 'string' ? w.id : k
    const ev = waiverEvent(w)
    if (waiverIds.has(id) || waiverIds.has(k) || (ev && events.has(ev))) kept.waivers[k] = w
  }
}

/** Who did what, one line each, oldest first. Pure. */
export function auditCsv(entries: Record<string, unknown>): string {
  const rows: unknown[][] = [['at', 'who', 'role', 'action', 'what', 'id', 'label', 'details']]
  const list = Object.values(entries).filter((e): e is Record<string, any> => !!e && typeof e === 'object')
  list.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))
  for (const e of list) {
    rows.push([e.at, e.by?.name, e.by?.role, e.action, e.target?.kind, e.target?.id, e.target?.label, e.details ? JSON.stringify(e.details) : ''])
  }
  return csvRows(rows)
}

export function readme(input: { range: RecordsRange | null; everything: boolean; generatedAt: string; by: string; counts: Record<string, number> }): string {
  const when = input.range ? `${input.range.from} to ${input.range.to} (both days included)` : 'everything on file'
  const lines = [
    'Hometown Studio records',
    '',
    `Covers: ${when}.`,
    `Made: ${input.generatedAt} by ${input.by}.`,
    '',
    'What is in here:',
    ...RECORD_SECTIONS.map((s) => `- ${s.file}: ${s.what}`),
    ...(input.everything ? ['- The other .json files: everything else the site keeps (classes, seats sold, parties and their payments, settings, staff), whatever their date, the same as the weekly archive email.'] : []),
    '- manifest.json: when this was made and how many records each file holds.',
    '',
    'How many records:',
    ...Object.entries(input.counts).map(([k, n]) => `- ${k}: ${n}`),
    '',
    'The .csv files open in Numbers or Excel. The .json files open in any text app; each record is listed under its own id.',
    ...(input.range ? [
      'A record dated in the range is included. Waivers and RSVPs for the events in this range are included too, whenever they were signed.',
      'A record with no date on it (an event’s door settings) is always included.',
    ] : ['Everything the site keeps is included, whatever its date.']),
    'Links and codes that open things (host pages, payment links, pickup codes) are left out on purpose; nothing else is.',
    'Keep this file somewhere safe and private. It holds names, phone numbers, children’s details and signatures.',
    'Records are never deleted from the site; a claim for a child can be brought until they turn 21.',
  ]
  return lines.join('\n') + '\n'
}

export interface RecordsDownload {
  filename: string
  bytes: Uint8Array
  counts: Record<string, number>
}

/** The studio day an audit key was written ("audit:<ISO>-<id>"), or null when it isn't one. */
function auditKeyDay(key: string): string | null {
  if (!key.startsWith(AUDIT_PREFIX)) return null
  const iso = key.slice(AUDIT_PREFIX.length, AUDIT_PREFIX.length + 24)
  return Number.isNaN(Date.parse(iso)) ? null : localDate(iso)
}

/** Read every key of a store, a few at a time, before the deadline. */
async function readStore(store: KvStore, keys: string[], deadline: number, maxValueBytes: number | undefined, tooSlow: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (let i = 0; i < keys.length; i += READ_AT_ONCE) {
    if (Date.now() > deadline) throw new RecordsRefusal(tooSlow)
    const batch = keys.slice(i, i + READ_AT_ONCE)
    const values = await Promise.all(batch.map((k) => store.get(k)))
    batch.forEach((k, j) => {
      const json = values[j]
      if (json === null) return
      if (maxValueBytes !== undefined && json.length > maxValueBytes) { out[k] = { notIncluded: 'too large for this file (a photo); it is still on the site', bytes: json.length }; return }
      try { out[k] = JSON.parse(json) } catch { out[k] = json }
    })
  }
  return out
}

/**
 * Build the zip. `range` null with `everything` = the whole archive (every
 * store, every date). Throws RecordsRefusal (TOO_BIG / TOO_SLOW) when it
 * can't be made in one go. `stores` is injectable for tests.
 */
export async function buildRecordsDownload(input: {
  range: RecordsRange | null
  everything?: boolean
  by: string
  now?: Date
  storeFor?: (name: string) => KvStore
}): Promise<RecordsDownload> {
  const now = input.now ?? new Date()
  const deadline = Date.now() + RECORDS_DEADLINE_MS
  const storeFor = input.storeFor ?? ((name: string) => makeKvStore(name, name))
  const names = input.everything ? [...new Set([...LEGAL_STORES, ...ARCHIVE_STORES.map((s) => s.name)])] : LEGAL_STORES
  const maxBytes = new Map(ARCHIVE_STORES.map((s) => [s.name, s.maxValueBytes]))
  const range = input.range
  const tooBig = input.everything ? TOO_BIG_EVERYTHING : TOO_BIG
  const tooSlow = input.everything ? TOO_SLOW_EVERYTHING : TOO_SLOW
  const files: Record<string, Record<string, unknown>> = {}
  const whole: Record<string, Record<string, unknown>> = {}
  const counts: Record<string, number> = {}
  let size = 0
  for (const name of names) {
    const store = storeFor(name)
    let keys = (await store.list()).filter((k) => k !== '__probe__')
    // Audit keys start with their time: only those in the range are read at all.
    if (name === 'audit' && range) {
      keys = keys.filter((k) => {
        const day = auditKeyDay(k)
        return day === null || (day >= range.from && day <= range.to)
      })
    }
    const all = redactSecrets(await readStore(store, keys, deadline, maxBytes.get(name), tooSlow))
    const legal = LEGAL_STORES.includes(name)
    const kept = range && legal ? Object.fromEntries(Object.entries(all).filter(([, v]) => inRange(v, range))) : all
    if (range && (name === 'waivers' || name === 'rsvps')) whole[name] = all
    files[name] = kept
    size += JSON.stringify(kept).length
    if (size > MAX_RECORDS_BYTES * 3) throw new RecordsRefusal(tooBig) // far over even before squeezing: stop reading
  }
  if (range) withWhatTheyRestOn(whole, files)
  for (const name of names) counts[name] = Object.keys(files[name] ?? {}).length
  const generatedAt = now.toISOString()
  const entries: Record<string, Uint8Array> = {}
  for (const name of names) entries[`${name}.json`] = strToU8(JSON.stringify(files[name] ?? {}, null, 2))
  entries['custody.csv'] = strToU8(custodyCsv(range ? checkinsInRange(files.checkins ?? {}, range) : files.checkins ?? {}))
  entries['audit.csv'] = strToU8(auditCsv(files.audit ?? {}))
  entries['manifest.json'] = strToU8(JSON.stringify({ generatedAt, by: input.by, range, everything: !!input.everything, counts }, null, 2))
  entries['README.txt'] = strToU8(readme({ range, everything: !!input.everything, generatedAt, by: input.by, counts }))
  const bytes = zipSync(entries, { level: 9 })
  if (bytes.byteLength > MAX_RECORDS_BYTES) throw new RecordsRefusal(tooBig)
  const stamp = range ? `${range.from}-to-${range.to}` : `everything-${generatedAt.slice(0, 10)}`
  return { filename: `hometown-records-${stamp}.zip`, bytes, counts }
}

/** The day of the newest weekly archive copy on the site ("2026-11-01"), or null. */
export async function lastWeeklyArchive(store: KvStore = makeKvStore('archive', 'archive')): Promise<string | null> {
  const days = (await store.list().catch(() => [] as string[]))
    .map((k) => /(\d{4}-\d{2}-\d{2})\.json$/.exec(k)?.[1])
    .filter((d): d is string => !!d)
    .sort()
  return days.length ? days[days.length - 1] : null
}
