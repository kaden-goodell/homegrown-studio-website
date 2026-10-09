import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

/**
 * Add (or update) a party craft as a catalog ITEM in the "Crafts" category.
 * Crafts carry a name, a per-head price, and a description — the party booking
 * flow lists these as craft choices and shows the description in an accordion.
 * Attach an image afterward with:
 *   npx tsx scripts/upload-workshop-image.ts <itemId> <imagePath> --role card
 *
 * Usage:
 *   npx tsx scripts/add-party-craft.ts --name "Junk Journaling" --price 15 \
 *     --description "Design a one-of-a-kind keepsake journal..."
 *
 * Flags: --name (required), --price <per-head dollars, required>, --description,
 *        --personalized (made-to-order & non-refundable — the booking flow will
 *        require the guest to acknowledge this before continuing).
 */

const client = new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN!, environment: SquareEnvironment.Production })

const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const name = flag('name')
const price = flag('price')
const description = flag('description')
const personalized = argv.includes('--personalized')

if (!name || price == null) {
  console.error('Usage: add-party-craft.ts --name "<name>" --price <perHeadDollars> [--description "..."]')
  process.exit(1)
}
const cents = Math.round(Number(price) * 100)
if (!Number.isFinite(cents)) { console.error(`Invalid --price "${price}"`); process.exit(1) }

async function findByName(type: 'CATEGORY' | 'ITEM', n: string): Promise<any | null> {
  for await (const obj of await client.catalog.list({ types: type })) {
    const o = obj as any
    const name = type === 'CATEGORY' ? o.categoryData?.name : o.itemData?.name
    if (name === n) return o
  }
  return null
}

async function main() {
  async function findOrCreateCategory(catName: string): Promise<string> {
    const found = await findByName('CATEGORY', catName)
    if (found) return found.id
    const r: any = await client.catalog.batchUpsert({
      idempotencyKey: `cat-${catName}-${Date.now()}`,
      batches: [{ objects: [{ type: 'CATEGORY', id: '#c', categoryData: { name: catName } }] }],
    })
    return (r.idMappings ?? []).find((m: any) => m.clientObjectId === '#c')?.objectId
  }

  const craftCatId = await findOrCreateCategory('Crafts')
  // Personalized crafts are tagged with a marker category the booking UI reads.
  const categories = [{ id: craftCatId }]
  if (personalized) categories.push({ id: await findOrCreateCategory('Personalized') })

  const existing = await findByName('ITEM', name!)
  let r: any
  if (existing) {
    // UPDATE: start from the full saved item so nothing else is lost (photos,
    // tax, channels, and marker tags like Most Popular / Parties Only), then
    // change only the price, the description, and the made-to-order tag.
    const fresh: any = ((await client.catalog.object.get({ objectId: existing.id })) as any).object
    const personalizedId = await findOrCreateCategory('Personalized')
    const cats: any[] = (fresh.itemData.categories ?? []).filter((c: any) => c.id !== personalizedId)
    if (!cats.some((c: any) => c.id === craftCatId)) cats.unshift({ id: craftCatId })
    if (personalized) cats.push({ id: personalizedId })
    fresh.itemData.categories = cats
    // Square CLEARS a description that is re-sent unchanged (seen 2026-10-09:
    // two crafts lost theirs on a price-only update). So only send it when the
    // text actually differs; otherwise leave Square's copy exactly as it is.
    const current = String(fresh.itemData.descriptionPlaintext ?? fresh.itemData.description ?? '').trim()
    if (description !== undefined && description.trim() !== current) {
      // Plain `description` — Square derives the HTML and plaintext copies from it.
      fresh.itemData.description = description
      delete fresh.itemData.descriptionHtml
      delete fresh.itemData.descriptionPlaintext
    }
    fresh.itemData.variations[0].itemVariationData.priceMoney = { amount: BigInt(cents), currency: 'USD' }
    for (const o of [fresh, fresh.itemData.variations[0]]) { delete o.updatedAt; delete o.createdAt; delete o.versionUpdatedAt }
    r = await client.catalog.batchUpsert({ idempotencyKey: `craft-${name}-${Date.now()}`, batches: [{ objects: [fresh] }] })
  } else {
    r = await client.catalog.batchUpsert({
      idempotencyKey: `craft-${name}-${Date.now()}`,
      batches: [{ objects: [{
        type: 'ITEM', id: '#craft',
        itemData: {
          name, productType: 'REGULAR',
          categories,
          reportingCategory: { id: craftCatId },
          description: description ?? undefined,
          variations: [{
            type: 'ITEM_VARIATION', id: '#var',
            itemVariationData: {
              itemId: '#craft', name: 'Per Guest', pricingType: 'FIXED_PRICING',
              priceMoney: { amount: BigInt(cents), currency: 'USD' },
            },
          }],
        },
      }] }],
    })
  }
  const id = existing ? existing.id : (r.idMappings ?? []).find((m: any) => m.clientObjectId === '#craft')?.objectId
  console.log(`${existing ? 'updated' : 'created'} craft "${name}" @ $${(cents / 100).toFixed(2)}/head${personalized ? ' [personalized]' : ''}  (item ${id})`)
  if (!description) console.log('  note: no description set')
  // Read it back: a description that silently didn't save is worse than an error.
  const saved: any = ((await client.catalog.object.get({ objectId: id })) as any).object
  const savedText = saved?.itemData?.descriptionPlaintext ?? saved?.itemData?.description ?? ''
  if (description && !savedText.trim()) {
    console.error('  ✗ Square saved the craft but the description is EMPTY — check it in the dashboard.')
    process.exit(1)
  }
  console.log(`  saved: $${(Number(saved.itemData.variations[0].itemVariationData.priceMoney.amount) / 100).toFixed(2)}, ${saved.itemData.imageIds?.length ?? 0} photo(s), ${saved.itemData.categories?.length ?? 0} categories, description ${savedText.length} chars`)
  console.log('  add an image:  npx tsx scripts/upload-workshop-image.ts ' + id + ' <imagePath> --role card')
}

main().catch((e) => { console.error('FATAL:', e?.errors ?? e?.body ?? e); process.exit(1) })
