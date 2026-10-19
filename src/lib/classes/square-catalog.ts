/**
 * Our own classes in the Square POS. Each scheduled class is one REGULAR
 * catalog ITEM in the "Classes" category, with one variation per sellable
 * seat cell (pass × ticket type) and one per add-on, so a counter sale
 * counts toward the class. Variation keys match pricing.ts exactly:
 * `${passId}:${ticketTypeId}` for seats, `addon:${addOnId}` for add-ons.
 *
 * Server only. Raw REST via squareFetch (one shared API version).
 */
import { createHash, randomUUID } from 'node:crypto'
import { siteConfig } from '@config/site.config'
import { formatDay } from '@lib/studio-time'
import { squareFetch, squareSettings } from './square-api'
import { sellableCells } from './validate'
import type { Cents, ScheduledClass } from './types'

export interface PlannedVariation { key: string; name: string; cents: Cents }

/** Every variation the POS item should carry, in a stable order. */
export function variationPlan(cls: ScheduledClass): PlannedVariation[] {
  const c = cls.content
  const singlePass = c.passes.length === 1
  const plan: PlannedVariation[] = []
  for (const cell of sellableCells(c)) {
    const pass = c.passes.find((p) => p.id === cell.passId)!
    const ticket = c.ticketTypes.find((t) => t.id === cell.ticketTypeId)!
    plan.push({
      key: `${cell.passId}:${cell.ticketTypeId}`,
      name: singlePass ? ticket.label : `${pass.label} · ${ticket.label}`,
      cents: cell.cents,
    })
  }
  for (const a of c.addOns) plan.push({ key: `addon:${a.id}`, name: `${a.label} (add-on)`, cents: a.priceCents })
  return plan
}

/** "Pottery · Sat Oct 17" — first session's day in studio time. */
function itemName(cls: ScheduledClass): string {
  const first = [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))[0]
  return first ? `${cls.content.name} · ${formatDay(first.startIso).replace(',', '')}` : cls.content.name
}

/** The item as Square has it now, or null when it's gone. */
async function fetchItem(itemId: string): Promise<any | null> {
  try {
    const res = await squareFetch(`/catalog/object/${encodeURIComponent(itemId)}`, { method: 'GET' })
    const obj = res?.object
    return obj && obj.type !== undefined && obj.type !== 'ITEM' ? null : obj ?? null
  } catch (e: any) {
    if (e?.status === 404) return null
    throw e
  }
}

async function upsert(object: any, idempotencyKey: string = randomUUID()): Promise<any> {
  return squareFetch('/catalog/batch-upsert', {
    method: 'POST',
    body: JSON.stringify({ idempotency_key: idempotencyKey, batches: [{ objects: [object] }] }),
  })
}

/**
 * A POS item already made for this class but whose ids we never saved (a
 * lost response, or a failed save). Every variation carries sku = class id.
 */
async function findItemBySku(classId: string): Promise<any | null> {
  const res = await squareFetch('/catalog/search', {
    method: 'POST',
    body: JSON.stringify({
      object_types: ['ITEM_VARIATION'],
      query: { exact_query: { attribute_name: 'sku', attribute_value: classId } },
    }),
  })
  const itemId = (res?.objects ?? []).map((o: any) => o?.item_variation_data?.item_id).find(Boolean)
  return itemId ? fetchItem(itemId) : null
}

/** Upload the class image and make it the item's primary image. */
async function uploadImage(itemId: string, imageUrl: string, className: string): Promise<void> {
  const abs = new URL(imageUrl, siteConfig.url).toString()
  const res = await fetch(abs)
  if (!res.ok) throw new Error(`The class image couldn't be read (${res.status}).`)
  const type = res.headers.get('content-type') || 'image/jpeg'
  const blob = new Blob([await res.arrayBuffer()], { type })
  const ext = type.includes('png') ? 'png' : type.includes('gif') ? 'gif' : 'jpg'
  const form = new FormData()
  form.append('request', new Blob([JSON.stringify({
    idempotency_key: randomUUID(),
    object_id: itemId,
    is_primary: true,
    image: { type: 'IMAGE', id: '#image', image_data: { name: className, caption: 'card' } },
  })], { type: 'application/json' }))
  form.append('image_file', blob, `class.${ext}`)
  await squareFetch('/catalog/images', { method: 'POST', body: form })
}

/** Thrown (before any Square call) when a taxable class would go on the POS with no SQUARE_CLASS_TAX_ID. */
export const CLASS_TAX_NOT_SET = "Class tax isn't set up yet."

/**
 * Create or update the class's POS item. Reuses variation ids by key,
 * drops variations no longer sold (left out of the item, which Square
 * removes), and uploads the image only when its URL changed. Returns the
 * ids to save on the class.
 */
export async function syncClassToSquare(cls: ScheduledClass): Promise<ScheduledClass['square']> {
  const cfg = squareSettings()
  const categoryId = cfg.classesCategoryId || ''
  if (!categoryId) throw new Error("Classes category isn't set up yet.")
  const taxId = cfg.classTaxId || ''
  // Fail closed: a taxable class put on the POS without its tax would be sold untaxed.
  // A cancelled class is still taken off the POS.
  if (!taxId && cls.content.rules.taxable && cls.status !== 'cancelled') throw new Error(CLASS_TAX_NOT_SET)
  const plan = variationPlan(cls)
  if (!plan.length) throw new Error('Add a price before putting this class on the POS.')

  let current = cls.square.itemId ? await fetchItem(cls.square.itemId) : null
  let known: Record<string, string> = cls.square.variations
  if (!current) {
    current = await findItemBySku(cls.id)
    if (current) {
      // Adopt it: match its variations to our keys by name.
      const byName = new Map<string, string>((current.item_data?.variations ?? []).map((v: any) => [v.item_variation_data?.name, v.id]))
      known = Object.fromEntries(plan.flatMap((p) => (byName.has(p.name) ? [[p.key, byName.get(p.name)!]] : [])))
    }
  }
  const currentVars = new Map<string, any>(
    (current?.item_data?.variations ?? []).map((v: any) => [v.id as string, v]),
  )
  const itemRef: string = current ? current.id : '#item'
  // A cancelled class never comes back onto the POS.
  const onPos = cls.status !== 'cancelled'
  const presence = onPos ? { present_at_all_locations: true } : { present_at_all_locations: false, present_at_location_ids: [] }

  const tempIdToKey = new Map<string, string>()
  const variations = plan.map((p, i) => {
    const knownId = known[p.key]
    const existing = current && knownId ? currentVars.get(knownId) : undefined
    const id = existing ? existing.id : `#v${i}`
    if (!existing) tempIdToKey.set(id, p.key)
    return {
      type: 'ITEM_VARIATION',
      id,
      ...(existing?.version !== undefined ? { version: existing.version } : {}),
      ...presence,
      item_variation_data: {
        item_id: itemRef,
        name: p.name,
        sku: cls.id,
        ordinal: i,
        pricing_type: 'FIXED_PRICING',
        price_money: { amount: p.cents, currency: 'USD' },
      },
    }
  })

  const itemData: Record<string, unknown> = {
    name: itemName(cls),
    description: cls.content.description || '',
    product_type: 'REGULAR',
    categories: [{ id: categoryId }],
    reporting_category: { id: categoryId },
    ...(taxId && cls.content.rules.taxable ? { tax_ids: [taxId] } : {}),
    ...(current?.item_data?.image_ids?.length ? { image_ids: current.item_data.image_ids } : {}),
    variations,
  }
  const object = {
    type: 'ITEM',
    id: itemRef,
    ...(current?.version !== undefined ? { version: current.version } : {}),
    ...presence,
    item_data: itemData,
  }
  // Creating: a deterministic key, so a retry of the same create can't make a second item.
  const key = current ? undefined : `cls-create:${cls.id}:${createHash('sha256').update(JSON.stringify(object)).digest('hex').slice(0, 32)}`
  const res = await upsert(object, key)

  const realId = new Map<string, string>((res?.id_mappings ?? []).map((m: any) => [m.client_object_id, m.object_id]))
  const itemId = current ? current.id : realId.get('#item') ?? res?.objects?.find((o: any) => o.type === 'ITEM')?.id
  if (!itemId) throw new Error("Square didn't return the class's POS item.")
  const out: Record<string, string> = {}
  for (const v of variations) {
    const key = tempIdToKey.get(v.id)
    if (key) {
      const id = realId.get(v.id)
      if (!id) throw new Error("Square didn't return every option of the class's POS item.")
      out[key] = id
    } else {
      out[plan[v.item_variation_data.ordinal].key] = v.id
    }
  }

  let imageUrl = cls.square.imageUrl ?? null
  const wanted = cls.content.imageUrl
  if (wanted && wanted !== imageUrl) {
    try {
      await uploadImage(itemId, wanted, cls.content.name)
      imageUrl = wanted
    } catch (e: any) {
      // The item is saved; leave the old URL so the next save tries again.
      console.warn(`[classes] image upload for ${cls.id} failed: ${e?.message ?? e}`)
    }
  }
  return { itemId, variations: out, imageUrl }
}

/**
 * Take a cancelled class off the POS: the item and its variations are made
 * present at no location. Never deletes; past orders still point at it.
 */
export async function archiveClassInSquare(cls: ScheduledClass): Promise<void> {
  if (!cls.square.itemId) return
  const item = await fetchItem(cls.square.itemId)
  if (!item) return
  const hide = (o: any) => {
    const { absent_at_location_ids: _drop, ...rest } = o
    return { ...rest, present_at_all_locations: false, present_at_location_ids: [] }
  }
  await upsert({
    ...hide(item),
    item_data: { ...item.item_data, variations: (item.item_data?.variations ?? []).map(hide) },
  })
}

/** Which of our classes (and which seat cell or add-on) a POS variation belongs to. */
export function classIdFromVariation(variationId: string, classes: ScheduledClass[]): { classId: string; key: string } | null {
  for (const c of classes) {
    for (const [key, id] of Object.entries(c.square?.variations ?? {})) {
      if (id === variationId) return { classId: c.id, key }
    }
  }
  return null
}
