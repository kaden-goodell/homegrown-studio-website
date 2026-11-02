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
 */
import { strToU8, zipSync } from 'fflate'
import { custodyCsv } from '@lib/archive-export'
import { ARCHIVE_STORES } from '@lib/archive-stores'
import { makeKvStore, type KvStore } from '@lib/blob-store'
import { AUDIT_PREFIX } from '@lib/audit'
import { localDate } from '@lib/parties/party-times'
import { RECORD_SECTIONS } from '@lib/records-sections'

export interface RecordsRange { from: string; to: string }

export { RECORD_SECTIONS } from '@lib/records-sections'

const LEGAL_STORES = ['waivers', 'rsvps', 'checkins', 'incidents', 'event-meta', 'audit']

/** Never more than this in one download (a phone or iPad, and the site's own reply limit). */
export const MAX_RECORDS_BYTES = 5 * 1024 * 1024
/** Give up (and say so) rather than keep the page waiting longer than this. */
export const RECORDS_DEADLINE_MS = 20_000
const READ_AT_ONCE = 16

export const TOO_BIG = 'That’s too much for one download. Pick a shorter range.'
export const TOO_SLOW = 'That took too long to gather. Pick a shorter range and try again.'

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

const csvField = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Who did what, one line each, oldest first. Pure. */
export function auditCsv(entries: Record<string, unknown>): string {
  const rows: unknown[][] = [['at', 'who', 'role', 'action', 'what', 'id', 'label', 'details']]
  const list = Object.values(entries).filter((e): e is Record<string, any> => !!e && typeof e === 'object')
  list.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))
  for (const e of list) {
    rows.push([e.at, e.by?.name, e.by?.role, e.action, e.target?.kind, e.target?.id, e.target?.label, e.details ? JSON.stringify(e.details) : ''])
  }
  return rows.map((r) => r.map(csvField).join(',')).join('\n') + '\n'
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
    'A record dated in the range is included. A record with no date on it (an event’s door settings) is always included.',
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
async function readStore(store: KvStore, keys: string[], deadline: number, maxValueBytes?: number): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (let i = 0; i < keys.length; i += READ_AT_ONCE) {
    if (Date.now() > deadline) throw new RecordsRefusal(TOO_SLOW)
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
  const files: Record<string, Record<string, unknown>> = {}
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
    const all = await readStore(store, keys, deadline, maxBytes.get(name))
    const legal = LEGAL_STORES.includes(name)
    const kept = range && legal ? Object.fromEntries(Object.entries(all).filter(([, v]) => inRange(v, range))) : all
    files[name] = kept
    counts[name] = Object.keys(kept).length
    size += JSON.stringify(kept).length
    if (size > MAX_RECORDS_BYTES * 3) throw new RecordsRefusal(TOO_BIG) // far over even before squeezing: stop reading
  }
  const generatedAt = now.toISOString()
  const entries: Record<string, Uint8Array> = {}
  for (const name of names) entries[`${name}.json`] = strToU8(JSON.stringify(files[name] ?? {}, null, 2))
  entries['custody.csv'] = strToU8(custodyCsv(range ? checkinsInRange(files.checkins ?? {}, range) : files.checkins ?? {}))
  entries['audit.csv'] = strToU8(auditCsv(files.audit ?? {}))
  entries['manifest.json'] = strToU8(JSON.stringify({ generatedAt, by: input.by, range, everything: !!input.everything, counts }, null, 2))
  entries['README.txt'] = strToU8(readme({ range, everything: !!input.everything, generatedAt, by: input.by, counts }))
  const bytes = zipSync(entries, { level: 9 })
  if (bytes.byteLength > MAX_RECORDS_BYTES) throw new RecordsRefusal(TOO_BIG)
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
