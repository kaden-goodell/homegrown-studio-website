// No imports: netlify/functions/archive-records.ts imports this by a relative path (no @lib aliases there).

/**
 * Who gets which owner alert or report (G5), as pure rules over two saved
 * records: the notifications doc (kv `notify-settings`, key `settings`) and
 * the staff list (kv `staff-people`, key `people`). Used by
 * notify-settings.ts on the site and by the weekly archive function, so both
 * answer the same.
 */

export const NOTIFY_ROWS = ['owner-texts', 'booking-alerts', 'warnings-email', 'tax-report', 'archive'] as const
export type NotifyRow = (typeof NOTIFY_ROWS)[number]
export type NotifyChannel = 'email' | 'text'

/** Which ways each row reaches people. */
export const ROW_CHANNELS: Record<NotifyRow, NotifyChannel[]> = {
  'owner-texts': ['text'],
  'booking-alerts': ['text', 'email'],
  'warnings-email': ['email'],
  'tax-report': ['email'],
  archive: ['email'],
}

export interface NotifyDoc {
  v: 1
  /** Per row, the staff ids of the owners picked. A row not here: every owner. */
  rows: Partial<Record<NotifyRow, string[]>>
  updatedAt: string
  by: { id: string; name: string }
  /** newest first: who changed what, never contact details. */
  history: { at: string; by: { id: string; name: string }; changed: string[] }[]
}

/** An owner as the staff list holds them (the fields the rules need). */
export interface NotifyOwner { id: string; name: string; email: string | null; phone: string | null }

/** A saved notifications doc, or null when it is missing or unreadable. Never throws. */
export function parseNotifyDoc(json: string | null): NotifyDoc | null {
  if (!json) return null
  try {
    const d = JSON.parse(json)
    if (!d || typeof d !== 'object' || !d.rows || typeof d.rows !== 'object' || typeof d.updatedAt !== 'string') return null
    const rows: NotifyDoc['rows'] = {}
    for (const r of NOTIFY_ROWS) {
      const ids = d.rows[r]
      if (Array.isArray(ids)) rows[r] = ids.filter((x: unknown): x is string => typeof x === 'string' && !!x)
    }
    return { v: 1, rows, updatedAt: d.updatedAt, by: d.by && typeof d.by.name === 'string' ? d.by : { id: 'unknown', name: 'Someone' }, history: Array.isArray(d.history) ? d.history : [] }
  } catch {
    return null
  }
}

/** The active Owners on a saved staff list (raw record), or null when there is no list. Never throws. */
export function ownersFromStaffJson(json: string | null): NotifyOwner[] | null {
  if (!json) return null
  try {
    const doc = JSON.parse(json)
    if (!doc || !Array.isArray(doc.people)) return null
    return doc.people
      .filter((p: any) => p && p.active && p.role === 'owner' && typeof p.id === 'string')
      .map((p: any) => ({ id: p.id, name: String(p.givenName ?? ''), email: typeof p.email === 'string' && p.email ? p.email : null, phone: typeof p.phone === 'string' && p.phone ? p.phone : null }))
  } catch {
    return null
  }
}

/** The owners picked for a row: those saved, still owners; every owner when the row was never set or all its picks left. */
export function pickedOwners(doc: NotifyDoc, owners: NotifyOwner[], row: NotifyRow): NotifyOwner[] {
  const ids = doc.rows[row]
  if (!ids) return owners
  const picked = owners.filter((o) => ids.includes(o.id))
  return picked.length ? picked : owners
}

/**
 * The addresses (or phone numbers) a row goes to on `channel`, from the
 * owners picked on the saved screen. null = use the site's setup instead:
 * nothing saved on the screen yet, no staff list, or nobody picked has one.
 */
export function savedRecipients(doc: NotifyDoc | null, owners: NotifyOwner[] | null, row: NotifyRow, channel: NotifyChannel): string[] | null {
  if (!doc || !owners || owners.length === 0) return null
  const out = pickedOwners(doc, owners, row).map((o) => (channel === 'email' ? o.email : o.phone)).filter((x): x is string => !!x)
  const unique = [...new Set(out.map((x) => x.trim()).filter(Boolean))]
  return unique.length ? unique : null
}

/** The weekly archive's addresses when nothing is saved: ARCHIVE_TO, else both owners (stopgap: never one mailbox). */
export const ARCHIVE_FALLBACK = ['kaden@ourhometownstudio.com', 'catherine@ourhometownstudio.com']
