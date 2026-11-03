/**
 * Weekly self-archive exporter (HOM-217) — pure, alias-free.
 *
 * Deliberately does NOT import `@lib/blob-store` or any other `@lib/*`
 * alias: `netlify/functions/archive-records.ts` imports this module by a
 * relative path (functions can't resolve path aliases), so nothing in here
 * may depend on one. Callers hand in whatever KV-shaped store they have —
 * the real `@lib/blob-store` `KvStore` (structurally compatible) from the
 * app/tests, or a thin `getStore()`-backed wrapper from the function.
 *
 * Never delete. Minor claims toll to age 21 in Alabama — see the retention
 * comment atop `waiver-store.ts` / `checkin-store.ts` / `incident-store.ts` /
 * `rsvp-store.ts`. This module is the export half of that promise: every key
 * of every store, no filtering, so the archive is complete by construction.
 *
 * No keys to anything (./export-safety `redactSecrets`): party host and
 * payment-link tokens, card tokens and pickup-code hashes are dropped from
 * every record, in the snapshot and the email alike. CSV cells never run as
 * spreadsheet formulas (`csvRows`).
 */
import { zipSync, strToU8 } from 'fflate'
import { csvRows, redactSecrets } from './export-safety'

/** The subset of `KvStore` (@lib/blob-store) this module needs — kept local
 *  so nothing here imports the alias. Any real KvStore satisfies this. */
export interface ArchiveKvStore {
  list(): Promise<string[]>
  get(key: string): Promise<string | null>
}

export interface ArchiveStoreSpec {
  name: string
  store: ArchiveKvStore
  /** A value larger than this is listed by key and size instead of copied. */
  maxValueBytes?: number
}

/** One append-only custody-log entry — the fields `custodyCsv` reads. Kept
 *  local (not imported from `@lib/checkin-store`) for the same alias-free
 *  reason as everything else in this file; structurally matches `CheckinEvent`. */
interface CheckinEventLike {
  at?: string
  action?: string
  personIds?: string[]
  by?: { name?: string }
  collectedBy?: string
  reason?: string
  note?: string
  day?: string
}

export interface ExportResult {
  generatedAt: string
  /** Number of keys exported per store. */
  counts: Record<string, number>
  /** Per store, every key → its parsed JSON value. Keyed (not a bare array)
   *  so the checkins export still carries `{eventKey}__{recordId}`, which
   *  `custodyCsv` needs to fill in the `event`/`household` columns. */
  files: Record<string, Record<string, unknown>>
}

/** Netlify Blobs' own probe key (@lib/blob-store's `resolveBlobStore`) — a
 *  read, never a write, so it shouldn't appear in `list()`, but some backends
 *  surface it anyway (see the same defensive filter in `incident-store.ts`). */
const PROBE_KEY = '__probe__'

/** How many stores, and keys within one store, are read at once (I-9: the run must end inside the function's time limit). */
export const STORES_AT_ONCE = 4
export const KEYS_AT_ONCE = 16

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/**
 * Export every key of every given store — no filtering, no date range. The
 * archive's completeness is the whole point (HOM-217 / Audit finding H3):
 * "the site got deleted" must never take the evidence with it.
 *
 * I-9: stores and keys are read in parallel batches (it used to read ~50
 * stores one key at a time and outgrew the scheduled function's 30 s). The
 * result is the same, in the same key order. `onStore` reports each store as
 * it finishes (the function writes progress with it).
 */
export async function exportAll(stores: ArchiveStoreSpec[], opts: { onStore?: (name: string, count: number) => void } = {}): Promise<ExportResult> {
  const generatedAt = new Date().toISOString()
  const counts: Record<string, number> = {}
  const files: Record<string, Record<string, unknown>> = {}

  const done = await mapLimit(stores, STORES_AT_ONCE, async ({ name, store, maxValueBytes }) => {
    const keys = (await store.list()).filter((k) => k !== PROBE_KEY)
    const raw = await mapLimit(keys, KEYS_AT_ONCE, (key) => store.get(key))
    const values: Record<string, unknown> = {}
    keys.forEach((key, i) => {
      const json = raw[i]
      if (json === null) return // vanished between list() and get() — skip, don't fabricate
      if (maxValueBytes !== undefined && json.length > maxValueBytes) {
        values[key] = { notIncluded: 'too large for the archive email', bytes: json.length }
        return
      }
      try {
        values[key] = redactSecrets(JSON.parse(json))
      } catch {
        values[key] = json // not JSON (shouldn't happen) — keep the raw text rather than drop it
      }
    })
    opts.onStore?.(name, Object.keys(values).length)
    return { name, values }
  })
  for (const { name, values } of done) {
    files[name] = values
    counts[name] = Object.keys(values).length
  }

  return { generatedAt, counts, files }
}

/** `{eventKey}__{recordId}` (checkin-store.ts's `key()`) — split on the
 *  FIRST `__`. Event keys (bare party id, or `workshop:scheduleId`) never
 *  contain a double underscore; waiver record ids (`wvr_...`) use single
 *  underscores only, so this is unambiguous. */
function splitCheckinKey(key: string): { event: string; household: string } {
  const idx = key.indexOf('__')
  return idx === -1 ? { event: key, household: '' } : { event: key.slice(0, idx), household: key.slice(idx + 2) }
}

const CUSTODY_CSV_HEADER = ['event', 'household', 'day', 'at', 'action', 'personIds', 'by', 'collectedBy', 'reason', 'note']

/**
 * One CSV row per `CheckinEvent`, across every household in a `checkins`
 * export (i.e. `exportAll(...).files.checkins`) — "what you'd hand a
 * lawyer" (HOM-217). Columns exactly: event, household, day, at, action,
 * personIds (pipe-joined), by (name only), collectedBy, reason, note.
 */
export function custodyCsv(checkins: Record<string, unknown>): string {
  const rows: string[][] = [CUSTODY_CSV_HEADER]
  for (const [key, raw] of Object.entries(checkins)) {
    const { event, household } = splitCheckinKey(key)
    const events = raw && typeof raw === 'object' && Array.isArray((raw as any).events)
      ? ((raw as any).events as CheckinEventLike[])
      : []
    for (const e of events) {
      rows.push([
        event,
        household,
        e.day ?? '',
        e.at ?? '',
        e.action ?? '',
        Array.isArray(e.personIds) ? e.personIds.join('|') : '',
        e.by?.name ?? '',
        e.collectedBy ?? '',
        e.reason ?? '',
        e.note ?? '',
      ])
    }
  }
  return csvRows(rows)
}

/** `{generatedAt, counts}` — the zip's `manifest.json`. */
function manifestOf(result: ExportResult): { generatedAt: string; counts: Record<string, number> } {
  return { generatedAt: result.generatedAt, counts: result.counts }
}

/**
 * Zip one `{store}.json` per named store, plus `custody.csv` (when a
 * `checkins` export is present) and `manifest.json`. Pure — takes an
 * already-computed `ExportResult`, does no I/O.
 */
export function buildArchiveZip(result: ExportResult, storeNames: string[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const name of storeNames) {
    entries[`${name}.json`] = strToU8(JSON.stringify(result.files[name] ?? {}, null, 2))
  }
  if (result.files.checkins) {
    entries['custody.csv'] = strToU8(custodyCsv(result.files.checkins))
  }
  entries['manifest.json'] = strToU8(JSON.stringify(manifestOf(result), null, 2))
  return zipSync(entries)
}

export const MAX_ARCHIVE_ATTACHMENT_BYTES = 20 * 1024 * 1024

export interface ArchiveAttachment {
  filename: string
  content: Uint8Array
}

/**
 * The zip(s) to actually attach/email: one combined zip when it fits under
 * `maxBytes` (default 20 MB), otherwise one zip PER STORE (`checkins`'
 * carries `custody.csv` too) plus a standalone manifest zip — so a single
 * oversized store never blocks the rest of the archive from going out.
 */
export function buildArchiveAttachments(
  result: ExportResult,
  storeNames: string[],
  maxBytes: number = MAX_ARCHIVE_ATTACHMENT_BYTES,
): ArchiveAttachment[] {
  const dateStr = result.generatedAt.slice(0, 10)
  const full = buildArchiveZip(result, storeNames)
  if (full.byteLength <= maxBytes) {
    return [{ filename: `archive-${dateStr}.zip`, content: full }]
  }

  const out: ArchiveAttachment[] = []
  for (const name of storeNames) {
    const entries: Record<string, Uint8Array> = {
      [`${name}.json`]: strToU8(JSON.stringify(result.files[name] ?? {}, null, 2)),
    }
    if (name === 'checkins' && result.files.checkins) {
      entries['custody.csv'] = strToU8(custodyCsv(result.files.checkins))
    }
    out.push({ filename: `archive-${dateStr}-${name}.zip`, content: zipSync(entries) })
  }
  out.push({
    filename: `archive-${dateStr}-manifest.zip`,
    content: zipSync({ 'manifest.json': strToU8(JSON.stringify(manifestOf(result), null, 2)) }),
  })
  return out
}
