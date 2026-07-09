import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

/**
 * Seed the REAL party infrastructure in Square (replaces the old TEST data):
 *   - a "Party Crafts" category (crafts live here as items, joined by category)
 *   - the "Whole Studio Party" bookable APPOINTMENTS_SERVICE ($200 flat, 2h)
 *
 * Idempotent: re-running finds existing objects by name instead of duplicating.
 * Prints the IDs to paste into src/config/party.config.ts.
 *
 * Add individual crafts with scripts/add-party-craft.ts.
 * Run: npx tsx scripts/seed-party.ts
 */

const client = new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN!, environment: SquareEnvironment.Production })
const TEAM = ['TMeIN-kxF-ZVhTVj', 'TMnRaFgOE4r0ip7o'] // Kaden, Catherine

async function findByName(type: 'CATEGORY' | 'ITEM', name: string): Promise<any | null> {
  for await (const obj of await client.catalog.list({ types: type })) {
    const o = obj as any
    const n = type === 'CATEGORY' ? o.categoryData?.name : o.itemData?.name
    if (n === name) return o
  }
  return null
}

async function main() {
  // 1. Party Crafts category (find or create)
  let craftCat = await findByName('CATEGORY', 'Party Crafts')
  if (!craftCat) {
    const r: any = await client.catalog.batchUpsert({
      idempotencyKey: `seed-party-craftcat-${Date.now()}`,
      batches: [{ objects: [{ type: 'CATEGORY', id: '#c', categoryData: { name: 'Party Crafts' } }] }],
    })
    const id = (r.idMappings ?? []).find((m: any) => m.clientObjectId === '#c')?.objectId
    craftCat = { id }
    console.log('created category: Party Crafts')
  } else {
    console.log('found existing category: Party Crafts')
  }

  const partyCat = await findByName('CATEGORY', 'Party')

  // 2. Whole Studio Party bookable service (find or create)
  let party = await findByName('ITEM', 'Whole Studio Party')
  if (!party) {
    const r: any = await client.catalog.batchUpsert({
      idempotencyKey: `seed-party-service-${Date.now()}`,
      batches: [{ objects: [{
        type: 'ITEM', id: '#party',
        itemData: {
          name: 'Whole Studio Party',
          productType: 'APPOINTMENTS_SERVICE',
          categories: partyCat ? [{ id: partyCat.id }] : undefined,
          description: 'Rent the whole studio for a private event. $200 flat studio fee plus craft cost per guest.',
          variations: [{
            type: 'ITEM_VARIATION', id: '#var',
            itemVariationData: {
              name: '2-Hour Party', pricingType: 'FIXED_PRICING',
              priceMoney: { amount: 20000n, currency: 'USD' }, // $200 flat base
              serviceDuration: 7200000n, // 2h; 1h cleanup enforced app-side
              availableForBooking: true, teamMemberIds: TEAM,
            },
          }],
        },
      }] }],
    })
    const id = (r.idMappings ?? []).find((m: any) => m.clientObjectId === '#party')?.objectId
    const got: any = await client.catalog.object.get({ objectId: id })
    party = got.object ?? got
    console.log('created service: Whole Studio Party')
  } else {
    console.log('found existing service: Whole Studio Party')
  }
  const variation = party.itemData.variations[0]

  console.log('\n=== paste into src/config/party.config.ts (square:) ===')
  console.log(`  catalogItemId:        '${party.id}',`)
  console.log(`  partyCraftCategoryId: '${craftCat.id}',`)
  console.log(`\n(party service variation ${variation.id} v${variation.version} — fetched live by service-info)`)
}

main().catch((e) => { console.error('FATAL:', e?.errors ?? e?.body ?? e); process.exit(1) })
