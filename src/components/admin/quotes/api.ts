/**
 * The quote screens' requests and the little words they share. Browser code:
 * from @lib/quotes only the browser-safe types.ts, money.ts and draft.ts.
 */
import { formatMoney } from '@lib/money'
import { isExpired, type MenuItem, type Per, type Quote, type QuoteLine, type QuoteSettings, type QuoteStatus, type SavedPackage } from '@lib/quotes/types'
import { api } from '../classes/api'
import { dayAndClock } from '../shell/time'

export const QUOTE_MENU = '/api/admin/quote-menu.json'

export interface MenuData { items: MenuItem[]; syncedAt: string | null; packages: SavedPackage[]; settings: QuoteSettings }

/** What an owner may change on one item (save-item's body). */
export interface ItemFields { id?: string; name: string; cents: number; per: Per; costCents: number | null; tags: string[]; hidden: boolean; photoUrl: string | null }

export type SettingNumbers = Omit<QuoteSettings, 'updatedAt'>

export const loadMenu = () => api<MenuData>(QUOTE_MENU)
export const syncSquare = () => api<{ items: MenuItem[]; syncedAt: string }>(QUOTE_MENU, { action: 'sync-square' })
export const saveItem = (item: ItemFields) => api<{ item: MenuItem }>(QUOTE_MENU, { action: 'save-item', item })
export const savePackage = (pkg: SavedPackage) => api<{ pkg: SavedPackage; packages: SavedPackage[] }>(QUOTE_MENU, { action: 'save-package', pkg })
export const deletePackage = (id: string) => api<{ packages: SavedPackage[] }>(QUOTE_MENU, { action: 'delete-package', id })
export const saveSettings = (settings: SettingNumbers, expectedUpdatedAt: string) =>
  api<{ settings: QuoteSettings }>(QUOTE_MENU, { action: 'save-settings', settings, expectedUpdatedAt })

/** "35", "$12.50", "0" → cents; empty or not a price → null. Pure. */
export function centsFromDollars(v: string): number | null {
  const t = v.trim().replace(/^\$\s*/, '').replace(/,/g, '')
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100)
}

/** Cents → what goes in a dollars box: "35" or "12.50". */
export const dollarsFromCents = (c: number) => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2))

/** "$35 / person", "$120 / event". */
export const priceText = (cents: number, per: Per) => `${formatMoney(cents)} / ${per}`

/** "Last loaded from Square Mon Nov 16 · 9 AM", or that it never was. */
export const syncedText = (iso: string | null) => (iso ? `Last loaded from Square ${dayAndClock(iso)}` : 'Not loaded from Square yet')

/** "Up to 25% off · deposit 50% · reply within 14 days". */
export const settingsText = (s: QuoteSettings) => `Up to ${s.capPct}% off · deposit ${s.depositPct}% · reply within ${s.expiryDays} days`

// ── Quotes (the quote sheet and the request sheet's entry) ───────────────────

export const QUOTES = '/api/admin/quotes'

export type QuoteState = QuoteStatus | 'expired'

/** Where a quote stands, as by-request.json reads it (sent/picked past the reply-by date read `expired`). */
export interface QuoteView {
  status: QuoteState
  views: number
  sentAt: string | null
  lastViewedAt: string | null
  pickedTierId: string | null
  expiresAt: string
  held: boolean
  paidAt: string | null
  url: string
}

export const loadQuote = (requestId: string) =>
  api<{ quote: Quote | null; view: QuoteView | null }>(`${QUOTES}/by-request.json?requestId=${encodeURIComponent(requestId)}`)
export const draftQuote = (requestId: string, o: { targetCents?: number; force?: boolean } = {}) =>
  api<{ quote: Quote }>(`${QUOTES}/draft.json`, { requestId, ...o })
export const saveQuote = (quote: Quote, version: number, overCapOk = false) =>
  api<{ quote: Quote }>(`${QUOTES}/save.json`, { quote, version, ...(overCapOk ? { overCapOk: true } : {}) })
export const sendQuote = (id: string, o: { text: boolean; email: boolean; overCapOk?: boolean; noHold?: boolean }) =>
  api<{ quote: Quote; texted: boolean; emailed: boolean }>(`${QUOTES}/send.json`, {
    id, text: o.text, email: o.email, ...(o.overCapOk ? { overCapOk: true } : {}), ...(o.noHold ? { noHold: true } : {}),
  })
export const quoteAction = (id: string, action: 'resend' | 'withdraw' | 'reopen', extra: { text?: boolean; email?: boolean } = {}) =>
  api<{ quote: Quote }>(`${QUOTES}/action.json`, { id, action, ...extra })
/** A new saved package from one of a quote's packages (the server gives it an id). */
export const savePackageFrom = (pkg: { name: string; photoUrl: string | null; lines: QuoteLine[] }) =>
  api<{ pkg: SavedPackage; packages: SavedPackage[] }>(QUOTE_MENU, { action: 'save-package', pkg })

/** The state a quote shows: sent/picked past its reply-by date read as expired. */
export const stateOf = (q: Pick<Quote, 'status' | 'expiresAt'>, now: Date = new Date()): QuoteState => (isExpired(q, now) ? 'expired' : q.status)

const CHIP: Record<QuoteState, string> = {
  draft: 'Draft', sent: 'Sent', picked: 'Picked', paying: 'Paying', paid: 'Paid', expired: 'Expired', withdrawn: 'Withdrawn',
}

/** The quote chip: Draft, Sent, Viewed 2×, Picked, Paying, Paid, Expired, Withdrawn. */
export function chipText(state: QuoteState, views = 0): string {
  if (state === 'sent' && views > 0) return `Viewed ${views}×`
  return CHIP[state] ?? state
}

/** The chip's look: green once paid, red when it ran out, grey before it goes out or once taken back. */
export function chipClass(state: QuoteState): string {
  if (state === 'paid' || state === 'paying') return 'adm-tag is-on'
  if (state === 'expired') return 'adm-tag is-red'
  if (state === 'withdrawn' || state === 'draft') return 'adm-tag is-grey'
  return 'adm-tag'
}
