import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

/**
 * One-shot script to delete the empty `Workshop` catalog CATEGORY left
 * over from the abandoned catalog-based workshops path.
 *
 * SAFETY:
 *   - Dry-run by default. Pass `--confirm` to actually delete.
 *   - Square catalog DELETE is permanent (no undelete endpoint).
 *   - Refuses to proceed if the object isn't the expected empty CATEGORY.
 *   - Refuses to proceed if the item-reference scan walked zero items
 *     (would indicate the v44 SDK iteration changed shape).
 */

const CATEGORY_ID = 'QXN2HDQQG2YBZBNLLKNFTZRC'
const CONFIRM = process.argv.includes('--confirm')

const token = process.env.SQUARE_ACCESS_TOKEN!
const env = process.env.SQUARE_ENVIRONMENT === 'production'
  ? SquareEnvironment.Production
  : SquareEnvironment.Sandbox

const client = new SquareClient({ token, environment: env })

async function main() {
  console.log(`Mode: ${CONFIRM ? 'DELETE (confirmed)' : 'DRY-RUN (pass --confirm to actually delete)'}`)
  console.log(`Square env: ${env}`)

  // 1. Sanity check the object.
  console.log(`\nFetching catalog object ${CATEGORY_ID}...`)
  const resp: any = await client.catalog.object.get({ objectId: CATEGORY_ID })
  const obj = (resp?.object ?? resp) as any
  console.log('Object:', JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2))
  if (obj?.type !== 'CATEGORY' || (obj?.categoryData?.name ?? '').toLowerCase() !== 'workshop') {
    console.error('\nObject is not the expected empty Workshop category. Aborting.')
    console.error('type:', obj?.type, 'name:', obj?.categoryData?.name)
    process.exit(1)
  }
  console.log('Confirmed: CATEGORY named Workshop.')

  // 2. Scan items for references.
  console.log('\nScanning items for references...')
  let totalItems = 0
  let referenceCount = 0
  for await (const o of await client.catalog.list({ types: 'ITEM' })) {
    totalItems++
    const item = o as any
    for (const cat of item.itemData?.categories ?? []) {
      if (cat.id === CATEGORY_ID) referenceCount++
    }
  }
  console.log(`Scanned ${totalItems} items; ${referenceCount} reference this category.`)
  if (totalItems === 0) {
    console.error('Scanned zero items — SDK iteration may have changed shape under v44. Aborting (no signal of safety).')
    process.exit(1)
  }
  if (referenceCount > 0) {
    console.error(`Refusing to delete: ${referenceCount} items still reference this category.`)
    process.exit(1)
  }
  console.log('No items reference this category. Safe to delete.')

  // 3. Delete (or dry-run).
  if (!CONFIRM) {
    console.log('\nDRY-RUN: would call client.catalog.object.delete with objectId =', CATEGORY_ID)
    console.log('Re-run with --confirm to actually delete.')
    return
  }
  console.log('\nDeleting (point of no return)...')
  await (client.catalog as any).object.delete({ objectId: CATEGORY_ID })
  console.log('Done.')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
