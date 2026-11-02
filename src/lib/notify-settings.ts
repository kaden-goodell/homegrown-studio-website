/**
 * More › Notifications (G5): which owners get which alerts and reports.
 *
 *   owner-texts      texts about things that need an owner (alertOwners)
 *   booking-alerts   "someone just booked" text and email
 *   warnings-email   the morning warnings email and the other owner emails
 *                    (incident reports, café hours not updating, a class short
 *                    of its minimum, payment problems, forms sent in)
 *   tax-report       the monthly tax split
 *   archive          the weekly records archive
 *
 * One record in kv `notify-settings` (key `settings`), compare-and-set, the
 * last changes kept (who, when, which rows; never contact details), audited
 * by the route, refused on a test site sharing the live stores (R41).
 *
 * Until an owner first saves, everything goes exactly where it did (the site
 * setup: siteConfig owner emails, OWNER_ALERT_NUMBERS, the tax and archive
 * defaults, now both owners). After a save, each row goes to the email or
 * mobile on the staff list of the owners picked for it; the site setup is the
 * fallback when nobody picked has one, or the records can't be read.
 *
 * Server only.
 */
import { siteConfig } from '@config/site.config'
import { makeKvStore } from '@lib/blob-store'
import { classWritesRefusal, TestSiteStoreError } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'
import type { By } from '@lib/staff-auth'
import { savedOwners, type StaffPerson } from '@lib/staff-directory'
import {
  ARCHIVE_FALLBACK, NOTIFY_ROWS, ROW_CHANNELS, parseNotifyDoc, pickedOwners, savedRecipients,
  type NotifyChannel, type NotifyDoc, type NotifyOwner, type NotifyRow,
} from '@lib/notify-recipients'

export { NOTIFY_ROWS, ROW_CHANNELS, type NotifyRow, type NotifyChannel } from '@lib/notify-recipients'

const logger = createLogger('notify-settings')
const kv = makeKvStore('notify-settings', 'notify-settings')
const KEY = 'settings'
const CACHE_MS = 30_000
const HISTORY_CAP = 50

export const ROW_LABEL: Record<NotifyRow, string> = {
  'owner-texts': 'Texts when something needs you',
  'booking-alerts': 'Someone just booked',
  'warnings-email': 'Morning warnings and heads-up emails',
  'tax-report': 'Monthly tax split',
  archive: 'Weekly records archive',
}

export const NOTIFY_MESSAGES = {
  pickSomeone: (row: NotifyRow) => `Pick at least one owner for “${ROW_LABEL[row]}”.`,
  noEmail: (row: NotifyRow) => `Nobody picked for “${ROW_LABEL[row]}” has an email on the staff list. Add one in Staff › People, or pick someone else.`,
  notOwner: 'Someone picked isn’t an owner any more. Refresh and try again.',
  noList: 'Start the staff list first (More › Staff › People), so there are owners to pick.',
  stale: 'Someone else just changed these. Check them and save again.',
  busy: 'Someone else is saving at the same moment. Try again.',
  unreadable: 'We couldn’t reach the notification settings just now. Try again in a minute.',
} as const

export class NotifyError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'NotifyError'
  }
}

let cache: { at: number; doc: NotifyDoc | null } | null = null

/** @internal test-only */
export function _resetNotifyCache(): void {
  cache = null
}

/** @internal test-only: forget the saved settings (back to the site setup). */
export async function _resetNotifyForTests(): Promise<void> {
  cache = null
  await kv.set(KEY, 'null')
}

/** The saved doc, or null (never saved). Throws when the store can't be read. */
async function readDoc(): Promise<NotifyDoc | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.doc
  const doc = parseNotifyDoc(await kv.get(KEY))
  cache = { at: Date.now(), doc }
  return doc
}

const toOwner = (p: StaffPerson): NotifyOwner => ({ id: p.id, name: p.name, email: p.email, phone: p.phone })

function envPhones(): string[] {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  const raw = meta.OWNER_ALERT_NUMBERS || (typeof process !== 'undefined' ? process.env.OWNER_ALERT_NUMBERS : '') || ''
  return String(raw).split(',').map((n: string) => n.trim()).filter(Boolean)
}

function archiveEnv(): string[] {
  const raw = (typeof process !== 'undefined' ? process.env.ARCHIVE_TO : '') || ''
  const list = raw.split(',').map((x) => x.trim()).filter(Boolean)
  return list.length ? list : ARCHIVE_FALLBACK
}

/** Where a row went before this screen existed (and still goes until an owner saves here). */
export function setupRecipients(row: NotifyRow, channel: NotifyChannel): string[] {
  if (channel === 'text') return envPhones()
  if (row === 'tax-report') return [...siteConfig.taxReportEmails]
  if (row === 'archive') return archiveEnv()
  return [...siteConfig.ownerEmails]
}

/**
 * Where a row goes now on `channel`. Never throws: anything unreadable means
 * the site setup, so an alert never goes nowhere because of a store blip.
 */
export async function recipientsFor(row: NotifyRow, channel: NotifyChannel): Promise<string[]> {
  try {
    const doc = await readDoc()
    if (!doc) return setupRecipients(row, channel)
    const owners = await savedOwners()
    return savedRecipients(doc, owners ? owners.map(toOwner) : null, row, channel) ?? setupRecipients(row, channel)
  } catch (err) {
    logger.warn('Notification settings unreadable — using the site setup', { row, error: err instanceof Error ? err.message : String(err) })
    return setupRecipients(row, channel)
  }
}

/** The emails for a row, comma-joined for one email's `to`. */
export async function emailsFor(row: NotifyRow): Promise<string> {
  return (await recipientsFor(row, 'email')).join(', ')
}

// ---------------------------------------------------------------- the screen

export interface NotifyRowView {
  row: NotifyRow
  label: string
  channels: NotifyChannel[]
  /** Owner staff ids ticked now (every owner when never set). */
  picked: string[]
  /** Where it goes right now, per channel (phones shown as the last four digits). */
  goesTo: { email?: string[]; text?: string[] }
  /** 'screen': set here; 'setup': from the site setup (never saved here, or nobody picked has one). */
  from: { email?: 'screen' | 'setup'; text?: 'screen' | 'setup' }
}

export interface NotifyView {
  saved: boolean
  updatedAt: string | null
  by: string | null
  owners: { id: string; name: string; email: string | null; phone: string | null }[]
  /** No staff list yet: nothing can be picked; everything goes where the site setup says. */
  noList: boolean
  rows: NotifyRowView[]
}

const lastFour = (phone: string) => `…${phone.replace(/\D/g, '').slice(-4)}`

/** What /admin › More › Notifications shows. Throws when the store can't be read. */
export async function notifyView(): Promise<NotifyView> {
  cache = null
  const doc = await readDoc()
  const staff = await savedOwners()
  const owners = staff ? staff.map(toOwner) : []
  const rows = NOTIFY_ROWS.map((row): NotifyRowView => {
    const channels = ROW_CHANNELS[row]
    const picked = doc && staff ? pickedOwners(doc, owners, row).map((o) => o.id) : owners.map((o) => o.id)
    const goesTo: NotifyRowView['goesTo'] = {}
    const from: NotifyRowView['from'] = {}
    for (const ch of channels) {
      const saved = savedRecipients(doc, staff ? owners : null, row, ch)
      const list = saved ?? setupRecipients(row, ch)
      goesTo[ch] = ch === 'text' ? list.map(lastFour) : list
      from[ch] = saved ? 'screen' : 'setup'
    }
    return { row, label: ROW_LABEL[row], channels, picked, goesTo, from }
  })
  return { saved: !!doc, updatedAt: doc?.updatedAt ?? null, by: doc?.by.name ?? null, owners, noList: !staff, rows }
}

/** Checks the picks: owners only, at least one per row, and an email for the email-only rows. */
export function cleanPicks(raw: unknown, owners: NotifyOwner[]): Record<NotifyRow, string[]> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ids = new Set(owners.map((x) => x.id))
  const out = {} as Record<NotifyRow, string[]>
  for (const row of NOTIFY_ROWS) {
    const list = Array.isArray(o[row]) ? [...new Set((o[row] as unknown[]).filter((x): x is string => typeof x === 'string'))] : null
    if (!list || list.length === 0) throw new NotifyError(400, NOTIFY_MESSAGES.pickSomeone(row))
    if (list.some((id) => !ids.has(id))) throw new NotifyError(409, NOTIFY_MESSAGES.notOwner)
    const people = owners.filter((x) => list.includes(x.id))
    // Email-only rows must reach someone by email; text rows fall back to the site's numbers.
    if (!ROW_CHANNELS[row].includes('text') && !people.some((p) => p.email)) throw new NotifyError(400, NOTIFY_MESSAGES.noEmail(row))
    out[row] = list
  }
  return out
}

/** Saves the picks. `expectedUpdatedAt` = what the screen loaded (null: never saved). Returns the rows that changed. */
export async function saveNotify(raw: unknown, by: By, expectedUpdatedAt: string | null, now = new Date()): Promise<{ updatedAt: string; changed: NotifyRow[] }> {
  if (classWritesRefusal()) throw new TestSiteStoreError() // R41
  const staff = await savedOwners()
  if (!staff || staff.length === 0) throw new NotifyError(409, NOTIFY_MESSAGES.noList)
  const owners = staff.map(toOwner)
  const picks = cleanPicks(raw, owners)
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await kv.getWithMeta(KEY)
    const cur = parseNotifyDoc(value)
    if ((cur?.updatedAt ?? null) !== (expectedUpdatedAt ?? null)) throw new NotifyError(409, NOTIFY_MESSAGES.stale)
    const before = (row: NotifyRow) => (cur ? pickedOwners(cur, owners, row) : owners).map((x) => x.id).sort().join(',')
    const changed = NOTIFY_ROWS.filter((row) => !cur || before(row) !== [...picks[row]].sort().join(','))
    const stamp = cur && now.toISOString() <= cur.updatedAt ? new Date(Date.parse(cur.updatedAt) + 1).toISOString() : now.toISOString()
    const doc: NotifyDoc = {
      v: 1,
      rows: picks,
      updatedAt: stamp,
      by,
      history: [{ at: stamp, by, changed: changed.map((r) => ROW_LABEL[r]) }, ...(cur?.history ?? [])].slice(0, HISTORY_CAP),
    }
    if (await kv.setIfMatch(KEY, JSON.stringify(doc), etag, value !== null)) {
      cache = { at: Date.now(), doc }
      logger.info('Notification settings saved', { by: by.name, changed })
      return { updatedAt: stamp, changed }
    }
  }
  throw new NotifyError(503, NOTIFY_MESSAGES.busy)
}
