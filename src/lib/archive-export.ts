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
 */
import { zipSync, strToU8 } from 'fflate'

/** The subset of `KvStore` (@lib/blob-store) this module needs — kept local
 *  so nothing here imports the alias. Any real KvStore satisfies this. */
export interface ArchiveKvStore {
  list(): Promise<string[]>
  get(key: string): Promise<string | null>
}

export interface ArchiveStoreSpec {
  name: string
  store: ArchiveKvStore
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

/**
 * Export every key of every given store — no filtering, no date range. The
 * archive's completeness is the whole point (HOM-217 / Audit finding H3):
 * "the site got deleted" must never take the evidence with it.
 */
export async function exportAll(stores: ArchiveStoreSpec[]): Promise<ExportResult> {
  const generatedAt = new Date().toISOString()
  const counts: Record<string, number> = {}
  const files: Record<string, Record<string, unknown>> = {}

  for (const { name, store } of stores) {
    const keys = (await store.list()).filter((k) => k !== PROBE_KEY)
    const values: Record<string, unknown> = {}
    for (const key of keys) {
      const json = await store.get(key)
      if (json === null) continue // vanished between list() and get() — skip, don't fabricate
      try {
        values[key] = JSON.parse(json)
      } catch {
        values[key] = json // not JSON (shouldn't happen) — keep the raw text rather than drop it
      }
    }
    files[name] = values
    counts[name] = Object.keys(values).length
  }

  return { generatedAt, counts, files }
}

/** Quote per RFC 4180: wrap in quotes and double any embedded quote whenever
 *  the field contains a comma, quote, or newline. */
function csvField(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
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
  return rows.map((r) => r.map(csvField).join(',')).join('\n') + '\n'
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
