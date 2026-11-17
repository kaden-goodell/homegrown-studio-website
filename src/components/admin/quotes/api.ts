/** The quote menu's requests and the little words its screens share. Browser code: types only from @lib/quotes. */
import { formatMoney } from '@lib/money'
import type { MenuItem, Per, QuoteSettings, SavedPackage } from '@lib/quotes/types'
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
