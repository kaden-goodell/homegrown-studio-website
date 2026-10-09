import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

/**
 * Move the "Most Popular" badge between party crafts — no code changes needed.
 *
 * The badge is a marker CATEGORY in Square (same mechanism as "Personalized"):
 * whichever craft item is also in the "Most Popular" category gets the badge in
 * the booking UI. You can also manage this straight from the Square Dashboard
 * (Items → edit item → Categories → add/remove "Most Popular"); this script
 * just does it in one shot. Several crafts can carry the badge (use --add).
 *
 * Usage:
 *   npx tsx scripts/set-popular-craft.ts --name "Patch & Personalize"         # only this one
 *   npx tsx scripts/set-popular-craft.ts --name "Patch & Personalize" --add   # this one too
 *   npx tsx scripts/set-popular-craft.ts --name "Patch & Personalize" --remove
 *   npx tsx scripts/set-popular-craft.ts --clear
 */

const client = new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN!, environment: SquareEnvironment.Production })

const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const targetName = flag('name')
const clearOnly = argv.includes('--clear')
// --add badges this craft and leaves the others; --remove takes it off just this one.
const addOnly = argv.includes('--add')
const removeOnly = argv.includes('--remove')

const CATEGORY_NAME = 'Most Popular'
const PARTY_CRAFTS_CATEGORY = 'Crafts'

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

  // Read-modify-write each party craft whose badge needs to change.
  for await (const obj of await client.catalog.list({ types: 'ITEM' })) {
    const o = obj as any
    const cats: any[] = o.itemData?.categories ?? []
    const isCraft = cats.some((c) => c.id === craftCat.id)
    if (!isCraft) continue

    const hasBadge = cats.some((c) => c.id === popularCatId)
    const isTarget = o.itemData?.name === targetName
    const wantsBadge = clearOnly ? false
      : addOnly ? (isTarget || hasBadge)
      : removeOnly ? (hasBadge && !isTarget)
      : isTarget
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

  if (targetName && addOnly) console.log(`Done — "${targetName}" now has the Most Popular badge too.`)
  else if (targetName && removeOnly) console.log(`Done — badge removed from "${targetName}".`)
  else if (targetName) console.log(`Done — "${targetName}" is now the Most Popular craft.`)
  else console.log('Done — badge cleared from all crafts.')
}

main().catch((e) => { console.error('FATAL:', e?.errors ?? e?.body ?? e); process.exit(1) })
