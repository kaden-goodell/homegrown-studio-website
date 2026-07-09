import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

/**
 * Move the "Most Popular" badge between party crafts — no code changes needed.
 *
 * The badge is a marker CATEGORY in Square (same mechanism as "Personalized"):
 * whichever craft item is also in the "Most Popular" category gets the badge in
 * the booking UI. You can also manage this straight from the Square Dashboard
 * (Items → edit item → Categories → add/remove "Most Popular"); this script
 * just does it in one shot and guarantees only one craft carries the badge.
 *
 * Usage:
 *   npx tsx scripts/set-popular-craft.ts --name "Patch & Personalize"
 *   npx tsx scripts/set-popular-craft.ts --clear
 */

const client = new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN!, environment: SquareEnvironment.Production })

const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const targetName = flag('name')
const clearOnly = argv.includes('--clear')

const CATEGORY_NAME = 'Most Popular'
const PARTY_CRAFTS_CATEGORY = 'Party Crafts'

if (!targetName && !clearOnly) {
  console.error('Usage: set-popular-craft.ts --name "<craft name>" | --clear')
  process.exit(1)
}

async function findCategoryByName(n: string): Promise<any | null> {
  for await (const obj of await client.catalog.list({ types: 'CATEGORY' })) {
    if ((obj as any).categoryData?.name === n) return obj
  }
  return null
}

async function findOrCreateCategory(n: string): Promise<string> {
  const found = await findCategoryByName(n)
  if (found) return found.id
  const r: any = await client.catalog.batchUpsert({
    idempotencyKey: `cat-${n}-${Date.now()}`,
    batches: [{ objects: [{ type: 'CATEGORY', id: '#c', categoryData: { name: n } }] }],
  })
  return (r.idMappings ?? []).find((m: any) => m.clientObjectId === '#c')?.objectId
}

async function main() {
  const popularCatId = await findOrCreateCategory(CATEGORY_NAME)
  const craftCat = await findCategoryByName(PARTY_CRAFTS_CATEGORY)
  if (!craftCat) { console.error(`Category "${PARTY_CRAFTS_CATEGORY}" not found`); process.exit(1) }

  console.log(`"${CATEGORY_NAME}" category id: ${popularCatId}`)

  // Read-modify-write each party craft so only the target carries the badge.
  for await (const obj of await client.catalog.list({ types: 'ITEM' })) {
    const o = obj as any
    const cats: any[] = o.itemData?.categories ?? []
    const isCraft = cats.some((c) => c.id === craftCat.id)
    if (!isCraft) continue

    const hasBadge = cats.some((c) => c.id === popularCatId)
    const wantsBadge = !clearOnly && o.itemData?.name === targetName
    if (hasBadge === wantsBadge) continue

    const next = wantsBadge
      ? [...cats, { id: popularCatId }]
      : cats.filter((c) => c.id !== popularCatId)

    // Round-trip the fetched object with updated categories (readonly
    // timestamps stripped so the upsert doesn't reject them).
    const fresh: any = ((await client.catalog.object.get({ objectId: o.id })) as any).object
    fresh.itemData.categories = next
    delete fresh.updatedAt
    delete fresh.createdAt
    delete fresh.versionUpdatedAt
    await client.catalog.batchUpsert({
      idempotencyKey: `popular-${o.id}-${Date.now()}`,
      batches: [{ objects: [fresh] }],
    })
    console.log(`${wantsBadge ? 'added badge to' : 'removed badge from'} "${o.itemData?.name}"`)
  }

  if (targetName) console.log(`Done — "${targetName}" is now the Most Popular craft.`)
  else console.log('Done — badge cleared from all crafts.')
}

main().catch((e) => { console.error('FATAL:', e?.errors ?? e?.body ?? e); process.exit(1) })
