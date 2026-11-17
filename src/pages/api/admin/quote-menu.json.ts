import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { partyWritesRefusal } from '@lib/parties/test-site'
import { audit, isBool, isId, json, ownerWrite, refusalResponse } from '@lib/quotes/admin-route'
import { deletePackage, getMenu, getSettings, listPackages, newId, saveMenuItems, savePackage, saveSettings } from '@lib/quotes/menu-store'
import { syncSquare } from '@lib/quotes/square-sync'
import type { MenuItem, QuoteLine, QuoteSettings, SavedPackage } from '@lib/quotes/types'

export const prerender = false

const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const isPer = (v: unknown): v is 'person' | 'event' => v === 'person' || v === 'event'
const photoOf = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === 'string' && v.length <= 2000 ? v || null : undefined

type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

/** An owner's item edit: the fields they may set, checked. */
function checkItem(raw: unknown): Checked<{ id?: string; name: string; cents: number; per: 'person' | 'event'; costCents: number | null; tags: string[]; hidden: boolean; photoUrl: string | null }> {
  const i = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (i.id !== undefined && !isId(i.id)) return { ok: false, error: 'Reload the page and try again.' }
  const name = typeof i.name === 'string' ? i.name.trim() : ''
  if (!name || name.length > 120) return { ok: false, error: 'Give the item a name.' }
  if (!isCents(i.cents)) return { ok: false, error: 'The price has to be $0 or more.' }
  if (!isPer(i.per)) return { ok: false, error: 'Pick per person or per event.' }
  const costCents = i.costCents === null || i.costCents === undefined ? null : i.costCents
  if (costCents !== null && !isCents(costCents)) return { ok: false, error: 'The cost has to be $0 or more.' }
  const tags = i.tags === undefined ? [] : i.tags
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string' || t.length > 40)) return { ok: false, error: 'Check the tags.' }
  if (i.hidden !== undefined && !isBool(i.hidden)) return { ok: false, error: 'Reload the page and try again.' }
  const photoUrl = photoOf(i.photoUrl)
  if (photoUrl === undefined) return { ok: false, error: 'Check the photo.' }
  return {
    ok: true,
    value: {
      ...(i.id ? { id: i.id as string } : {}),
      name, cents: i.cents, per: i.per, costCents,
      tags: [...new Set((tags as string[]).map((t) => t.trim().toLowerCase()).filter(Boolean))],
      hidden: i.hidden === true, photoUrl,
    },
  }
}

function checkLines(raw: unknown): Checked<QuoteLine[]> {
  if (!Array.isArray(raw)) return { ok: false, error: 'The package has no lines.' }
  const out: QuoteLine[] = []
  for (const l of raw as Record<string, unknown>[]) {
    if (!l || typeof l !== 'object') return { ok: false, error: 'A line is missing its name or price.' }
    const label = typeof l.label === 'string' ? l.label.trim() : ''
    const photoUrl = photoOf(l.photoUrl)
    const costCents = l.costCents === null || l.costCents === undefined ? null : l.costCents
    if (!label || !isCents(l.cents) || !isPer(l.per) || photoUrl === undefined || (costCents !== null && !isCents(costCents))
      || (l.itemId !== null && l.itemId !== undefined && !isId(l.itemId))) {
      return { ok: false, error: 'A line is missing its name or price.' }
    }
    out.push({ itemId: (l.itemId as string | undefined) ?? null, label, photoUrl, cents: l.cents, per: l.per, costCents })
  }
  return { ok: true, value: out }
}

const SETTING_KEYS = ['capPct', 'yellowFromPct', 'depositPct', 'expiryDays'] as const

/**
 * GET: the quote menu's items, saved packages and settings. Loads from
 * Square first when the menu has never been loaded. Owners only.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  try {
    let menu = await getMenu()
    // A test site can't write the menu: it shows what is there.
    if (menu.syncedAt === null && !partyWritesRefusal(request)) {
      try {
        menu = await syncSquare()
      } catch {
        // The menu still opens; Load from Square says what went wrong.
      }
    }
    const [packages, settings] = await Promise.all([listPackages(), getSettings()])
    return json(200, { data: { items: menu.items, syncedAt: menu.syncedAt, packages, settings } })
  } catch (e) {
    return refusalResponse(e, 'Quote menu read')
  }
}

/**
 * POST { action }: sync-square; save-item { item }; hide-item { id, hidden };
 * save-package { pkg }; delete-package { id }; save-settings { settings,
 * expectedUpdatedAt }. Owners only; each write audited.
 */
export const POST: APIRoute = async ({ request }) => {
  const w = await ownerWrite(request)
  if (w instanceof Response) return w
  const { by, body } = w
  const now = new Date()
  try {
    switch (body.action) {
      case 'sync-square': {
        const menu = await syncSquare(now)
        await audit(by, 'quote-menu-sync', { kind: 'quote-menu', id: 'menu', label: 'Quote menu' }, { items: menu.items.length })
        return json(200, { data: { items: menu.items, syncedAt: menu.syncedAt } })
      }
      case 'save-item': {
        const c = checkItem(body.item)
        if (!c.ok) return json(400, { error: c.error })
        const { id, ...fields } = c.value
        let saved: MenuItem | null = null
        await saveMenuItems((items) => {
          if (id) {
            return items.map((i) => (i.id === id ? (saved = { ...i, ...fields, updatedAt: now.toISOString() }) : i))
          }
          saved = { id: newId('own'), source: 'own', ...fields, updatedAt: now.toISOString() }
          return [...items, saved]
        })
        if (!saved) return json(404, { error: 'That item is not there. Reload the menu.' })
        const item = saved as MenuItem
        await audit(by, 'quote-menu-item', { kind: 'quote-item', id: item.id, label: item.name }, { cents: item.cents, per: item.per, created: !id })
        return json(200, { data: { item } })
      }
      case 'hide-item': {
        if (!isId(body.id) || !isBool(body.hidden)) return json(400, { error: 'Reload the page and try again.' })
        let saved: MenuItem | null = null
        await saveMenuItems((items) => items.map((i) => (i.id === body.id ? (saved = { ...i, hidden: body.hidden as boolean, updatedAt: now.toISOString() }) : i)))
        if (!saved) return json(404, { error: 'That item is not there. Reload the menu.' })
        const item = saved as MenuItem
        await audit(by, 'quote-menu-hide', { kind: 'quote-item', id: item.id, label: item.name }, { hidden: item.hidden })
        return json(200, { data: { item } })
      }
      case 'save-package': {
        const p = (body.pkg && typeof body.pkg === 'object' ? body.pkg : {}) as Record<string, unknown>
        if (p.id !== undefined && !isId(p.id)) return json(400, { error: 'Reload the page and try again.' })
        const name = typeof p.name === 'string' ? p.name.trim() : ''
        if (!name || name.length > 120) return json(400, { error: 'Give the package a name.' })
        const photoUrl = photoOf(p.photoUrl)
        if (photoUrl === undefined) return json(400, { error: 'Check the photo.' })
        const lines = checkLines(p.lines)
        if (!lines.ok) return json(400, { error: lines.error })
        const pkg: SavedPackage = { id: (p.id as string | undefined) ?? newId('pkg'), name, photoUrl, lines: lines.value, savedAt: now.toISOString(), by: by.name }
        const packages = await savePackage(pkg)
        await audit(by, 'quote-package-save', { kind: 'quote-package', id: pkg.id, label: pkg.name }, { lines: pkg.lines.length })
        return json(200, { data: { pkg, packages } })
      }
      case 'delete-package': {
        if (!isId(body.id)) return json(400, { error: 'Reload the page and try again.' })
        const packages = await deletePackage(body.id)
        await audit(by, 'quote-package-delete', { kind: 'quote-package', id: body.id })
        return json(200, { data: { packages } })
      }
      case 'save-settings': {
        const s = (body.settings && typeof body.settings === 'object' ? body.settings : null) as Record<string, unknown> | null
        if (!s || typeof body.expectedUpdatedAt !== 'string') return json(400, { error: 'Reload the page and try again.' })
        const patch: Partial<QuoteSettings> = {}
        for (const k of SETTING_KEYS) {
          if (s[k] === undefined) continue
          if (typeof s[k] !== 'number' || !Number.isFinite(s[k])) return json(400, { error: 'Check the numbers.' })
          patch[k] = s[k] as number
        }
        const settings = await saveSettings(patch, body.expectedUpdatedAt, now)
        await audit(by, 'quote-settings', { kind: 'settings', id: 'quotes', label: 'Quote settings' }, {
          capPct: settings.capPct, yellowFromPct: settings.yellowFromPct, depositPct: settings.depositPct, expiryDays: settings.expiryDays,
        })
        return json(200, { data: { settings } })
      }
      default:
        return json(400, { error: 'Unknown action.' })
    }
  } catch (e) {
    return refusalResponse(e, `Quote menu ${String(body.action)}`)
  }
}
