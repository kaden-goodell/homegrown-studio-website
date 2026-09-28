import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'
import { partyConfig } from '../src/config/party.config'

/**
 * Rename the crafts category in Square. The same items are sold at parties and
 * at open studio, so "Party Crafts" read oddly at the register; it is "Crafts".
 *
 * Safe for the site: it finds the category by ID (partyConfig.square.
 * partyCraftCategoryId), never by name. Only the name changes here: the
 * category keeps its ID, its items and every other setting.
 *
 * Usage:
 *   npx tsx scripts/rename-craft-category.ts            # show what would change
 *   npx tsx scripts/rename-craft-category.ts --apply    # make the change
 *   npx tsx scripts/rename-craft-category.ts --apply --name "Party Crafts"   # put it back
 */

const client = new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN!, environment: SquareEnvironment.Production })

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const nameAt = argv.indexOf('--name')
const newName = nameAt >= 0 ? argv[nameAt + 1] : 'Crafts'

async function main() {
  if (!newName?.trim()) throw new Error('A name is needed after --name')
  const id = partyConfig.square.partyCraftCategoryId

  const got: any = await client.catalog.object.get({ objectId: id })
  const category = got?.object ?? got
  if (category?.type !== 'CATEGORY') throw new Error(`${id} is not a category`)
  const oldName = category.categoryData?.name

  for await (const obj of await client.catalog.list({ types: 'CATEGORY' })) {
    const other = obj as any
    if (other.id !== id && other.categoryData?.name === newName) {
      throw new Error(`Another category is already called "${newName}" (${other.id}). Nothing changed.`)
    }
  }

  if (oldName === newName) {
    console.log(`Already called "${newName}". Nothing to do.`)
    return
  }
  console.log(`Category ${id}: "${oldName}" -> "${newName}"`)
  if (!apply) {
    console.log('Nothing changed. Run again with --apply to rename it.')
    return
  }

  // Send the category back exactly as it is, with only the name changed. The
  // version makes Square refuse the write if someone edited it in between.
  await client.catalog.object.upsert({
    idempotencyKey: `rename-category-${id}-${Date.now()}`,
    object: { ...category, categoryData: { ...category.categoryData, name: newName } },
  })

  const check: any = await client.catalog.object.get({ objectId: id })
  console.log(`Square now says: "${(check?.object ?? check).categoryData?.name}"`)
}

main().catch((err) => {
  console.error(err?.message ?? err)
  process.exit(1)
})
