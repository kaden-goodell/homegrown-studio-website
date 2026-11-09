// scripts/seed-shop.ts
/**
 * Square catalog for the shop: category "Shop" → "Photo Magnets – Set of 6" $18 (9% tax)
 * and "Shipping" $6 (no tax). Create-only (skips what exists). Prints the ids for
 * src/config/shop.config.ts.
 *
 *   npx tsx scripts/seed-shop.ts            # preview, writes nothing
 *   npx tsx scripts/seed-shop.ts --apply    # write, then read back
 *
 * Undo a wrong --apply: delete the printed ids with client.catalog.batchDelete({ objectIds: [...] }).
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { SquareClient, SquareEnvironment } from 'square'

const APPLY = process.argv.includes('--apply')
const TAX_ID = 'XKZ3OIRJ3SPPO4TO64UUDFA4' // the account's 9% sales tax
const CATEGORY = 'Shop'
const ITEMS = [
  { key: 'magnets', name: 'Photo Magnets – Set of 6', variation: 'Set of 6', cents: 1800, taxed: true },
  { key: 'shipping', name: 'Shipping', variation: 'Flat rate', cents: 600, taxed: false },
] as const
const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment: process.env.SQUARE_ENVIRONMENT === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
})

async function listAll(types: string) {
  const out: any[] = []
  for await (const o of (await client.catalog.list({ types })) as any) out.push(o)
  return out
}

async function main() {
  console.log(`Square env: ${process.env.SQUARE_ENVIRONMENT} · ${APPLY ? 'APPLY' : 'PREVIEW (no writes)'}`)
  const cat = (await listAll('CATEGORY')).find((c) => c.categoryData?.name === CATEGORY && !c.categoryData?.parentCategory?.id)
  const items = await listAll('ITEM')
  const catId = cat?.id ?? '#shop'
  const objects: any[] = []
  if (!cat) objects.push({ type: 'CATEGORY', id: '#shop', presentAtAllLocations: true, categoryData: { name: CATEGORY } })
  for (const it of ITEMS) {
    const found = items.find((i) => i.itemData?.name === it.name && (i.itemData?.categories ?? []).some((c: any) => c.id === cat?.id))
    if (found) { console.log(`Exists: ${it.name} → ${found.id} / ${found.itemData.variations[0].id}`); continue }
    objects.push({
      type: 'ITEM', id: `#${it.key}`, presentAtAllLocations: true,
      itemData: {
        name: it.name, productType: 'REGULAR', categories: [{ id: catId }], reportingCategory: { id: catId },
        ...(it.taxed ? { taxIds: [TAX_ID] } : {}),
        variations: [{ type: 'ITEM_VARIATION', id: `#${it.key}-var`, presentAtAllLocations: true,
          itemVariationData: { name: it.variation, pricingType: 'FIXED_PRICING', priceMoney: { amount: BigInt(it.cents), currency: 'USD' } } }],
      },
    })
  }
  console.log(`Will create: ${objects.map((o) => o.type === 'CATEGORY' ? `category ${CATEGORY}` : `${o.itemData.name} $${Number(o.itemData.variations[0].itemVariationData.priceMoney.amount) / 100}${o.itemData.taxIds ? ' (9% tax)' : ''}`).join(', ') || 'nothing'}`)
  if (!APPLY || !objects.length) return
  const idempotencyKey = createHash('sha256').update(`seed-shop:${objects.map((o) => o.id).join(',')}`).digest('hex').slice(0, 40)
  const res: any = await client.catalog.batchUpsert({ idempotencyKey, batches: [{ objects }] })
  const map = new Map((res.idMappings ?? []).map((m: any) => [m.clientObjectId, m.objectId]))
  for (const it of ITEMS) {
    const id = map.get(`#${it.key}`) as string | undefined
    if (!id) continue
    const got: any = await client.catalog.object.get({ objectId: id })
    const v = got.object.itemData.variations[0]
    console.log(`✅ ${got.object.itemData.name} · $${Number(v.itemVariationData.priceMoney.amount) / 100} · taxIds ${got.object.itemData.taxIds ?? 'none'} → item ${got.object.id}, variation ${v.id}`)
  }
  console.log('Paste into shopConfig.magnets.square: { itemId, variationId (magnets), shippingVariationId (shipping) }')
}

main().catch((e) => { console.error(e?.body ?? e); process.exit(1) })
