/**
 * Audit log of staff actions: who did what, to what, and when. Backend only —
 * read it with `scripts/audit-log.ts` (production, via the netlify CLI) or
 * `GET /api/staff/audit.json`.
 *
 * No role gates anywhere: any signed-in staff member can act, and this log is
 * how the owners check afterward. `recordAudit` NEVER throws — an audit failure
 * must not fail (or slow) the action it describes.
 *
 * Netlify Blobs in prod, `.data/audit/` on disk in dev.
 */
import { randomUUID } from 'node:crypto'
import { createLogger } from '@lib/logger'
import { isPreviewOrDev } from '@lib/deploy-context'
import { makeKvStore } from '@lib/blob-store'

const logger = createLogger('audit')
const kv = makeKvStore('audit', 'audit')

export interface AuditEntry {
  id: string
  at: string
  by: { id: string; name: string; role: 'owner' | 'crew' }
  action: string
  target: { kind: string; id: string; label?: string }
  details?: Record<string, string | number | boolean | null>
  /** Done under payment bypass. Absent on every real action. */
  simulated?: true
}

export const AUDIT_PREFIX = 'audit:'
const PREFIX = AUDIT_PREFIX

/** A fresh entry and the key it is stored under. Shared with the CLIs that write production directly. */
export function newAuditEntry(e: Omit<AuditEntry, 'id' | 'at'>): { key: string; entry: AuditEntry } {
  const entry: AuditEntry = { id: 'au_' + randomUUID().slice(0, 8), at: new Date().toISOString(), ...e }
  // ISO `at` first so a plain key listing sorts by time.
  return { key: `${PREFIX}${entry.at}-${entry.id}`, entry }
}

/** Audit keys newest first, from `since` (YYYY-MM-DD) on when given. */
export function auditKeysNewestFirst(keys: string[], since?: string): string[] {
  const sinceKey = since ? `${PREFIX}${since}` : null
  return keys
    .filter((k) => k.startsWith(PREFIX))
    .filter((k) => !sinceKey || k >= sinceKey)
    .sort()
    .reverse()
}

export async function recordAudit(e: Omit<AuditEntry, 'id' | 'at'>): Promise<void> {
  try {
    const { key, entry } = newAuditEntry(e)
    await kv.set(key, JSON.stringify(entry))
  } catch (err) {
    logger.error('Audit write failed', { action: e.action, error: err instanceof Error ? err.message : String(err) })
  }
}

export async function listAudit(opts: { limit?: number; byId?: string; since?: string } = {}): Promise<AuditEntry[]> {
  const keys = auditKeysNewestFirst(await kv.list(), opts.since)
  const hideSimulated = !isPreviewOrDev()
  const out: AuditEntry[] = []
  for (const k of keys) {
    if (opts.limit && out.length >= opts.limit) break
    const json = await kv.get(k)
    if (!json) continue
    let e: AuditEntry
    try { e = JSON.parse(json) as AuditEntry } catch { continue }
    if (hideSimulated && e.simulated === true) continue
    if (opts.byId && e.by?.id !== opts.byId) continue
    out.push(e)
  }
  return out
}
