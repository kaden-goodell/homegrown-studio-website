import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

/**
 * Add (or update) a party craft as a catalog ITEM in the "Party Crafts" category.
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

  const craftCatId = await findOrCreateCategory('Party Crafts')
  // Personalized crafts are tagged with a marker category the booking UI reads.
  const categories = [{ id: craftCatId }]
  if (personalized) categories.push({ id: await findOrCreateCategory('Personalized') })

  const existing = await findByName('ITEM', name!)
  const objectId = existing ? existing.id : '#craft'
  const varId = existing ? existing.itemData.variations[0].id : '#var'
  const version = existing ? existing.version : undefined
  const varVersion = existing ? existing.itemData.variations[0].version : undefined

  const r: any = await client.catalog.batchUpsert({
    idempotencyKey: `craft-${name}-${Date.now()}`,
    batches: [{ objects: [{
      type: 'ITEM', id: objectId, version,
      itemData: {
        name, productType: 'REGULAR',
        categories,
        reportingCategory: { id: craftCatId },
        // Preserve any already-attached image(s) on update, so re-running to
        // change price/description/tags doesn't drop the craft's picture.
        imageIds: existing?.itemData?.imageIds ?? undefined,
        descriptionHtml: description ?? undefined,
        variations: [{
          type: 'ITEM_VARIATION', id: varId, version: varVersion,
          itemVariationData: {
            itemId: objectId, name: 'Per Guest', pricingType: 'FIXED_PRICING',
            priceMoney: { amount: BigInt(cents), currency: 'USD' },
          },
        }],
      },
    }] }],
  })
  const id = existing ? existing.id : (r.idMappings ?? []).find((m: any) => m.clientObjectId === '#craft')?.objectId
  console.log(`${existing ? 'updated' : 'created'} craft "${name}" @ $${(cents / 100).toFixed(2)}/head${personalized ? ' [personalized]' : ''}  (item ${id})`)
  if (!description) console.log('  note: no description set')
  console.log('  add an image:  npx tsx scripts/upload-workshop-image.ts ' + id + ' <imagePath> --role card')
}

main().catch((e) => { console.error('FATAL:', e?.errors ?? e?.body ?? e); process.exit(1) })
