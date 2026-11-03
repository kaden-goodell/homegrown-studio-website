/**
 * More › Notifications › "Also send the monthly tax split to" (final review
 * I7): one address outside the owners, usually the accountant. The tax split
 * holds only month totals (no customers), so a free-typed address is fine,
 * but a new one still waits a day before the monthly email goes there (like a
 * new owner's email for the records archive), and every owner is told when it
 * changes. Kept in its own small document next to the notification picks.
 *
 * Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import { classWritesRefusal, TestSiteStoreError } from '@lib/classes/test-site-guard'
import type { By } from '@lib/staff-auth'

const kv = makeKvStore('notify-settings', 'notify-settings')
const KEY = 'tax-extra'
export const TAX_EXTRA_HOLD_MS = 24 * 3_600_000
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

export interface TaxExtra {
  /** '' = none. */
  email: string
  /** When this address was saved; the monthly email starts going there a day later. */
  since: string | null
  updatedAt: string | null
  by: string | null
}

export class TaxExtraError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export const TAX_EXTRA_BAD = 'That email doesn’t look right. Check for typos, and type just one address.'

const none: TaxExtra = { email: '', since: null, updatedAt: null, by: null }

export function validTaxEmail(raw: unknown): string | null {
  const e = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return EMAIL_RE.test(e) && e.length <= 120 ? e : null
}

/** What's saved (none when nothing is, or it can't be read: the owners still get it). */
export async function getTaxExtra(): Promise<TaxExtra> {
  try {
    const raw = await kv.get(KEY)
    if (!raw) return none
    const d = JSON.parse(raw)
    return { email: typeof d.email === 'string' ? d.email : '', since: d.since ?? null, updatedAt: d.updatedAt ?? null, by: d.by ?? null }
  } catch {
    return none
  }
}

/** The address the monthly email also goes to now: saved, and saved more than a day ago. */
export async function activeTaxExtra(now = new Date()): Promise<string | null> {
  const x = await getTaxExtra()
  if (!x.email || !x.since) return null
  return now.getTime() - Date.parse(x.since) >= TAX_EXTRA_HOLD_MS ? x.email : null
}

/** When a held address starts getting it (ISO), or null when it already does / there is none. */
export function taxExtraStarts(x: TaxExtra, now = new Date()): string | null {
  if (!x.email || !x.since) return null
  const at = Date.parse(x.since) + TAX_EXTRA_HOLD_MS
  return at > now.getTime() ? new Date(at).toISOString() : null
}

/** Saves the address ('' removes it). Returns what was there before and after. */
export async function saveTaxExtra(raw: unknown, by: By, now = new Date()): Promise<{ before: TaxExtra; after: TaxExtra }> {
  if (classWritesRefusal()) throw new TestSiteStoreError() // R41
  const typed = typeof raw === 'string' ? raw.trim() : ''
  const email = typed ? validTaxEmail(typed) : ''
  if (email === null) throw new TaxExtraError(400, TAX_EXTRA_BAD)
  const before = await getTaxExtra()
  if (before.email === email) return { before, after: before }
  const at = now.toISOString()
  const after: TaxExtra = { email, since: email ? at : null, updatedAt: at, by: by.name }
  await kv.set(KEY, JSON.stringify(after))
  return { before, after }
}
