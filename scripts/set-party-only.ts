import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

/**
 * Keep a craft off the Craft Café menu while it stays bookable for parties.
 *
 * "Parties only" is a marker CATEGORY in Square (same mechanism as "Most
 * Popular" and "Personalized"): a craft also in it is hidden from /craft-cafe.
 * You can also manage it in the Square Dashboard (Items → edit item →
 * Categories → add/remove "Parties Only").
 *
 * Usage:
 *   npx tsx scripts/set-party-only.ts --name "Patch & Personalize"          # parties only
 *   npx tsx scripts/set-party-only.ts --name "Patch & Personalize" --off    # back on the café menu
 */

const client = new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN!, environment: SquareEnvironment.Production })
const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const targetName = flag('name')
const off = argv.includes('--off')
const CATEGORY_NAME = 'Parties Only'

if (!targetName) {
  console.error('Usage: set-party-only.ts --name "<craft name>" [--off]')
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
  const catId = await findOrCreateCategory(CATEGORY_NAME)
  console.log(`"${CATEGORY_NAME}" category id: ${catId}`)
  let found = false
  for await (const obj of await client.catalog.list({ types: 'ITEM' })) {
    const o = obj as any
    if (o.itemData?.name !== targetName) continue
    found = true
    const cats: any[] = o.itemData?.categories ?? []
    const has = cats.some((c) => c.id === catId)
    if (has === !off) { console.log(`"${targetName}" is already ${off ? 'on the café menu' : 'parties only'}.`); continue }
    const fresh: any = ((await client.catalog.object.get({ objectId: o.id })) as any).object
    fresh.itemData.categories = off ? cats.filter((c) => c.id !== catId) : [...cats, { id: catId }]
    delete fresh.updatedAt
    delete fresh.createdAt
    delete fresh.versionUpdatedAt
    await client.catalog.batchUpsert({ idempotencyKey: `party-only-${o.id}-${Date.now()}`, batches: [{ objects: [fresh] }] })
    console.log(`"${targetName}" is now ${off ? 'back on the café menu' : 'parties only'}.`)
  }
  if (!found) { console.error(`No craft named "${targetName}".`); process.exit(1) }
}

main().catch((e) => { console.error('FATAL:', e?.errors ?? e?.body ?? e); process.exit(1) })
