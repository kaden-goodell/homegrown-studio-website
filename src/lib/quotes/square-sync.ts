/**
 * Quote menu ← Square (S-6): every catalog ITEM in every category, every
 * variation, merged into the menu by variation id. Owners' cost, tags, hidden
 * and per are kept; name, price and photo follow Square. All pages are read
 * before anything is written, so a failed sync changes nothing; a variation
 * missing from a complete sync is marked `gone` and cleared when it returns.
 * Café costs are then filled where still unknown (S-45). Server only.
 */
import { squareFetch } from '@lib/classes/square-api'
import cafeCosts from '../../../scripts/data/cafe-costs.json'
import { applyCafeCosts, type CafeCosts } from './cost-import'
import { QuoteStoreError, saveMenuItems, type MenuDoc } from './menu-store'
import type { MenuItem } from './types'

/** Every catalog object of these types (read-only, paged; as craft-admin's listCatalog). */
async function listCatalog(types: string): Promise<any[]> {
  const out: any[] = []
  let cursor: string | undefined
  do {
    const page: any = await squareFetch(`/catalog/list?types=${types}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { method: 'GET' })
    out.push(...(page?.objects ?? []))
    cursor = page?.cursor
  } while (cursor)
  return out
}

/** What Square says about one variation (the fields a sync owns). */
type FromSquare = Pick<MenuItem, 'squareItemId' | 'squareVariationId' | 'name' | 'cents' | 'photoUrl'>

/** One entry per live variation. Single-variation items keep the item name; others read "Item · Variation". Pure. */
export function variationsFrom(objects: any[]): FromSquare[] {
  const images: Record<string, string> = {}
  for (const o of objects) if (o?.type === 'IMAGE' && o.image_data?.url) images[o.id] = o.image_data.url
  const out: FromSquare[] = []
  for (const o of objects) {
    if (o?.type !== 'ITEM' || o.is_deleted) continue
    const d = o.item_data ?? {}
    const name = String(d.name ?? '').trim()
    const vars = (d.variations ?? []).filter((v: any) => v && !v.is_deleted)
    const itemPhoto = (d.image_ids ?? []).map((id: string) => images[id]).find(Boolean) ?? null
    for (const v of vars) {
      const vd = v.item_variation_data ?? {}
      const vName = String(vd.name ?? '').trim()
      const vPhoto = (vd.image_ids ?? []).map((id: string) => images[id]).find(Boolean) ?? null
      out.push({
        squareItemId: o.id,
        squareVariationId: v.id,
        name: vars.length > 1 && vName ? `${name} · ${vName}` : name,
        cents: Number(vd.price_money?.amount ?? 0) || 0,
        photoUrl: vPhoto ?? itemPhoto,
      })
    }
  }
  return out
}

/** Merge a complete Square listing into the menu. Pure. */
export function mergeSquare(items: MenuItem[], fresh: FromSquare[], now: Date): MenuItem[] {
  const at = now.toISOString()
  const seen = new Map(fresh.map((f) => [f.squareVariationId!, f]))
  const merged = items.map((i): MenuItem => {
    if (i.source !== 'square' || !i.squareVariationId) return i
    const f = seen.get(i.squareVariationId)
    if (!f) return i.gone ? i : { ...i, gone: true, updatedAt: at }
    seen.delete(i.squareVariationId)
    const { gone: _gone, ...rest } = i
    const next: MenuItem = { ...rest, ...f }
    const changed = i.gone || i.name !== f.name || i.cents !== f.cents || i.photoUrl !== f.photoUrl || i.squareItemId !== f.squareItemId
    return changed ? { ...next, updatedAt: at } : next
  })
  for (const f of seen.values()) {
    merged.push({ id: `sq-${f.squareVariationId}`, source: 'square', ...f, per: 'person', costCents: null, tags: [], hidden: false, updatedAt: at })
  }
  return merged
}

/** Pull the whole Square catalog into the quote menu. Throws QuoteStoreError('sync_failed') and writes nothing when Square fails. */
export async function syncSquare(now: Date = new Date()): Promise<MenuDoc> {
  let objects: any[]
  try {
    objects = await listCatalog('ITEM,CATEGORY,IMAGE')
  } catch (e: any) {
    throw new QuoteStoreError('sync_failed', `Couldn't reach Square to load the menu${e?.message ? ` (${e.message})` : ''}. Nothing changed; try again.`)
  }
  const fresh = variationsFrom(objects)
  return saveMenuItems((items) => applyCafeCosts(mergeSquare(items, fresh, now), cafeCosts as CafeCosts), now.toISOString())
}
